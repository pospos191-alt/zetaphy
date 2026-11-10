// Attack tests from the 2026-11-10 security review of programs/swd_amm.
// Each test reproduces one finding and asserts the FIXED behaviour (it
// fails on the code before the fix). Runs in the same validator as the
// other suites and is order-independent (idempotent global set-up).

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createCloseAccountInstruction,
  createInitializeMintCloseAuthorityInstruction,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction } from "@solana/web3.js";
import { assert } from "chai";
import { LEGACY_POOLS, mintFeedPda, registerFeeds, TEST_ORACLE_MAX_STALENESS_SECS } from "./oracle-fixtures";

const code = (e: any) => e?.error?.errorCode?.code ?? (String(e).match(/Error Code: (\w+)/) || [])[1];
async function expectThrows(fn: () => Promise<unknown>, label: string): Promise<any> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error(`expected "${label}" to throw, but it succeeded`);
}

describe("security review 2026-11-10 (attack tests)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SwdAmm as anchor.Program<any>;
  const conn = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer; // governance authority in every suite
  const emergencyAuthority = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

  const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const globalConfig = pda(Buffer.from("global-config"));
  const settings = pda(Buffer.from("gov_settings"));
  const mintPolicy = (m: PublicKey) => pda(Buffer.from("mint_policy"), m.toBuffer());
  const allowedMint = (m: PublicKey) => pda(Buffer.from("allowed-mint"), m.toBuffer());
  const u16le = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u64le = (n: number | BN) => new BN(n).toArrayLike(Buffer, "le", 8);
  const v2Pool = (a: PublicKey, b: PublicKey, floor: number) => pda(Buffer.from("swdmm_v2_pool"), a.toBuffer(), b.toBuffer(), u16le(floor));
  const v2Vault = (pool: PublicKey, m: PublicKey) => pda(Buffer.from("swdmm_v2_vault"), pool.toBuffer(), m.toBuffer());

  const FIXED_1PCT = { mode: 0, decay: 0, cliffFeeBps: 100, floorFeeBps: 100, numberOfPeriods: 0, periodFrequency: new BN(0), reductionFactor: new BN(0) };
  const NO_DYNAMIC = { enabled: false, maxDynamicFeeBps: 0, variableFeeControl: 0, filterPeriod: 0, decayPeriod: 0, reductionFactor: 0, maxVolatilityAccumulator: new BN(0) };
  const NO_ORACLE = { enabled: false, pythFeedIdA: Array(32).fill(0), pythFeedIdB: Array(32).fill(0), maxStalenessSecs: 0, maxDeviationBps: 0 };

  async function fund(kp: Keypair, sol = 2) {
    await provider.sendAndConfirm(
      new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: sol * LAMPORTS_PER_SOL })),
      [payer]
    );
  }

  before(async () => {
    try {
      await program.methods.initializeGlobalConfig(payer.publicKey, emergencyAuthority.publicKey)
        .accounts({ config: globalConfig, programData: PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0], payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    } catch (e) { if (!String(e).includes("already in use")) throw e; }
    try {
      await program.methods.initializeGovernanceSettings(new BN(5), 1_000, payer.publicKey)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, settings, payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    } catch (e) { if (!String(e).includes("already in use")) throw e; }
  });

  async function setPolicy(mint: PublicKey, tokenProgram: PublicKey, enabled: boolean, reviewed: boolean) {
    return program.methods.setMintPolicy(enabled, reviewed)
      .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, mint, tokenProgram, mintPolicy: mintPolicy(mint), payer: payer.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
  }

  /** Creates a Token-2022 mint at `kp` with the given mint-level extensions. */
  async function createToken2022Mint(kp: Keypair, exts: ExtensionType[], init: (mint: PublicKey) => anchor.web3.TransactionInstruction[], decimals = 6) {
    const len = getMintLen(exts);
    const lamports = await conn.getMinimumBalanceForRentExemption(len);
    const tx = new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey, space: len, lamports, programId: TOKEN_2022_PROGRAM_ID }),
      ...init(kp.publicKey),
      createInitializeMintInstruction(kp.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID)
    );
    await provider.sendAndConfirm(tx, [payer, kp]);
  }

  // ------------------------------------------------------------------
  // F-1 MintCloseAuthority: close + re-create the mint with new extensions
  // ------------------------------------------------------------------
  it("F-1: a Token-2022 mint with a close authority is refused (it could come back with a PermanentDelegate)", async () => {
    const mintKp = Keypair.generate();
    await createToken2022Mint(mintKp, [ExtensionType.MintCloseAuthority], (m) => [
      createInitializeMintCloseAuthorityInstruction(m, payer.publicKey, TOKEN_2022_PROGRAM_ID),
    ]);

    // Before the fix this passed the extension gate and the mint was enabled.
    const err = await expectThrows(() => setPolicy(mintKp.publicKey, TOKEN_2022_PROGRAM_ID, true, true), "policy for a closable mint");
    assert.equal(code(err), "UnsupportedMintExtension", String(err));

    // Why it matters: with supply 0 the issuer can close the mint and
    // re-create THE SAME ADDRESS with a PermanentDelegate. Every check the
    // program does on a mint runs once (policy / pool creation), so a pool
    // or policy created for the first incarnation would keep accepting the
    // second, whose delegate can move tokens out of the pool vault.
    const attacker = Keypair.generate();
    await provider.sendAndConfirm(
      new Transaction().add(createCloseAccountInstruction(mintKp.publicKey, payer.publicKey, payer.publicKey, [], TOKEN_2022_PROGRAM_ID)),
      [payer]
    );
    await createToken2022Mint(mintKp, [ExtensionType.PermanentDelegate], (m) => [
      createInitializePermanentDelegateInstruction(m, attacker.publicKey, TOKEN_2022_PROGRAM_ID),
    ]);
    const info = await conn.getAccountInfo(mintKp.publicKey);
    assert.ok(info && info.owner.equals(TOKEN_2022_PROGRAM_ID), "same address, re-created with a permanent delegate");
    const err2 = await expectThrows(() => setPolicy(mintKp.publicKey, TOKEN_2022_PROGRAM_ID, true, true), "policy for a delegate mint");
    assert.equal(code(err2), "UnsupportedMintExtension");
  });

  // ------------------------------------------------------------------
  // CP pool helpers (Token-2022 side A with a transfer fee)
  // ------------------------------------------------------------------
  async function initCpPool(mA: PublicKey, mB: PublicKey, tpA: PublicKey, tpB: PublicKey, feeBps: number, maxFeeBps: number, creator: Keypair = payer) {
    for (const m of [mA, mB]) {
      await program.methods.setAllowedMint(true)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, mint: m, allowedMint: allowedMint(m), payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    }
    const feed = LEGACY_POOLS.ratioOne;
    await registerFeeds(program, payer, globalConfig, [[mA, feed.feedIdA], [mB, feed.feedIdB]]);
    const pool = pda(Buffer.from("pool"), mA.toBuffer(), mB.toBuffer());
    const vaultA = pda(Buffer.from("vault_a"), pool.toBuffer());
    const vaultB = pda(Buffer.from("vault_b"), pool.toBuffer());
    const lpMint = pda(Buffer.from("lp_mint"), pool.toBuffer());
    await program.methods
      .initializePool(feeBps, feed.feedIdA, feed.feedIdB, TEST_ORACLE_MAX_STALENESS_SECS, 5_000, maxFeeBps)
      .accounts({
        payer: creator.publicKey, mintA: mA, mintB: mB, config: globalConfig,
        allowedMintA: allowedMint(mA), allowedMintB: allowedMint(mB),
        mintFeedA: mintFeedPda(program.programId, mA), mintFeedB: mintFeedPda(program.programId, mB),
        pool, vaultA, vaultB, lpMint,
        tokenProgramA: tpA, tokenProgramB: tpB, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      })
      .signers(creator === payer ? [] : [creator])
      .rpc();
    return { pool, vaultA, vaultB, lpMint };
  }

  // ------------------------------------------------------------------
  // F-5 CP swap slippage vs. an outbound transfer fee
  // ------------------------------------------------------------------
  it("F-5: CP swap min_amount_out is checked against what the trader receives, not the pre-fee amount", async () => {
    const FEE_BPS_T22 = 100; // 1% Token-2022 transfer fee on mint A
    const aKp = Keypair.generate();
    await createToken2022Mint(aKp, [ExtensionType.TransferFeeConfig], (m) => [
      createInitializeTransferFeeConfigInstruction(m, payer.publicKey, payer.publicKey, FEE_BPS_T22, BigInt("1000000000000"), TOKEN_2022_PROGRAM_ID),
    ]);
    const mA = aKp.publicKey;
    const mB = await createMint(conn, payer, payer.publicKey, null, 6);
    // fee == max fee: the dynamic fee is then constant, so the output is exact
    const { pool, vaultA, vaultB, lpMint } = await initCpPool(mA, mB, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, 30, 30);

    const ta = await createAssociatedTokenAccountIdempotent(conn, payer, mA, payer.publicKey, {}, TOKEN_2022_PROGRAM_ID);
    await mintTo(conn, payer, mA, ta, payer, 1_000_000_000n, [], undefined, TOKEN_2022_PROGRAM_ID);
    const tb = (await getOrCreateAssociatedTokenAccount(conn, payer, mB, payer.publicKey)).address;
    await mintTo(conn, payer, mB, tb, payer, 1_000_000_000n);

    await program.methods.addLiquidity(new BN(101_010_102), new BN(100_000_000), new BN(0))
      .accounts({
        depositor: payer.publicKey, pool, vaultA, vaultB, lpMint, mintA: mA, mintB: mB,
        depositorTokenA: ta, depositorTokenB: tb,
        depositorLp: getAssociatedTokenAddressSync(lpMint, payer.publicKey),
        poolLpLock: getAssociatedTokenAddressSync(lpMint, pool, true),
        tokenProgramA: TOKEN_2022_PROGRAM_ID, tokenProgramB: TOKEN_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).rpc();

    const p: any = await program.account.pool.fetch(pool);
    const ra = BigInt(p.reserveA.toString());
    const rb = BigInt(p.reserveB.toString());
    const amountIn = 1_000_000n; // B -> A
    const inAfterFee = (amountIn * 9_970n) / 10_000n;
    const k = ra * rb;
    const newIn = rb + inAfterFee;
    const nominalOut = ra - (k + newIn - 1n) / newIn;
    const t22Fee = (nominalOut * BigInt(FEE_BPS_T22) + 9_999n) / 10_000n;
    const received = nominalOut - t22Fee;
    assert.ok(t22Fee > 0n);

    const swap = (minOut: bigint) => program.methods.swap(new BN(amountIn.toString()), new BN(minOut.toString()), false)
      .accounts({
        trader: payer.publicKey, pool, vaultA, vaultB, mintA: mA, mintB: mB,
        traderTokenIn: tb, traderTokenOut: ta,
        tokenProgramA: TOKEN_2022_PROGRAM_ID, tokenProgramB: TOKEN_PROGRAM_ID,
        priceUpdateA: LEGACY_POOLS.ratioOne.priceUpdateA, priceUpdateB: LEGACY_POOLS.ratioOne.priceUpdateB,
      }).rpc();

    // Before the fix this succeeded and the trader got `received` < minOut.
    const err = await expectThrows(() => swap(nominalOut), "min out above the net amount");
    assert.equal(code(err), "SlippageExceeded", String(err));

    const before = (await getAccount(conn, ta, undefined, TOKEN_2022_PROGRAM_ID)).amount;
    await swap(received);
    const got = (await getAccount(conn, ta, undefined, TOKEN_2022_PROGRAM_ID)).amount - before;
    assert.equal(got.toString(), received.toString());
  });

  // ------------------------------------------------------------------
  // F-3 pool squatting: governance can create while creation is paused
  // ------------------------------------------------------------------
  it("F-3: while pool creation is paused a squatter cannot create a pool, but governance can", async () => {
    const a = await createMint(conn, payer, payer.publicKey, null, 6);
    const b = await createMint(conn, payer, payer.publicKey, null, 6);
    await setPolicy(a, TOKEN_PROGRAM_ID, true, false);
    await setPolicy(b, TOKEN_PROGRAM_ID, true, false);
    const squatter = Keypair.generate(); await fund(squatter);
    const params = { baseFee: FIXED_1PCT, dynamicFee: NO_DYNAMIC, collectFeeMode: 0, activationTs: new BN(0), maxPriceImpactBps: 5_000, oracle: NO_ORACLE };
    const pool = v2Pool(a, b, 100);
    const init = (creator: Keypair) => program.methods.initializeV2Pool(params)
      .accounts({
        creator: creator.publicKey, config: globalConfig, settings, mintA: a, mintB: b,
        mintPolicyA: mintPolicy(a), mintPolicyB: mintPolicy(b), pool,
        vaultA: v2Vault(pool, a), vaultB: v2Vault(pool, b), mintFeedA: null, mintFeedB: null,
        tokenProgramA: TOKEN_PROGRAM_ID, tokenProgramB: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers(creator === payer ? [] : [creator]).rpc();

    const setPaused = (paused: boolean) => program.methods.setPoolCreationPaused(paused)
      .accounts({ config: globalConfig, governanceAuthority: payer.publicKey }).rpc();
    await setPaused(true);
    try {
      assert.equal(code(await expectThrows(() => init(squatter), "squat while paused")), "PoolCreationPaused");
      // Before the fix governance was blocked too, so "pause until the
      // canonical pools exist" (runbook Gate 8) was impossible.
      await init(payer);
      const p: any = await program.account.swdmmV2Pool.fetch(pool);
      assert.equal(p.creator.toBase58(), payer.publicKey.toBase58());
    } finally {
      await setPaused(false);
    }
  });

  // ------------------------------------------------------------------
  // F-4 bricking governance with the default key
  // ------------------------------------------------------------------
  it("F-4: set_authorities refuses the all-zero key (no private key: governance would be bricked)", async () => {
    const err = await expectThrows(() => program.methods.setAuthorities(PublicKey.default, emergencyAuthority.publicKey)
      .accounts({ config: globalConfig, governanceAuthority: payer.publicKey }).rpc(), "default governance");
    assert.equal(code(err), "InvalidAuthority");
    const err2 = await expectThrows(() => program.methods.setAuthorities(payer.publicKey, PublicKey.default)
      .accounts({ config: globalConfig, governanceAuthority: payer.publicKey }).rpc(), "default emergency");
    assert.equal(code(err2), "InvalidAuthority");
  });

  // ------------------------------------------------------------------
  // F-2 stale unpause proposals: emergency authority can cancel them
  // ------------------------------------------------------------------
  it("F-2: the emergency authority can cancel a pending UNPAUSE (and only an unpause)", async () => {
    const propose = async (action: any) => {
      const s: any = await program.account.governanceSettings.fetch(settings);
      const pending = pda(Buffer.from("gov_action"), u64le(s.nextActionId));
      await program.methods.proposeGovAction(action)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, settings, pending, payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
      return pending;
    };
    const cancel = (pending: PublicKey, signer: Keypair) => program.methods.emergencyCancelUnpause()
      .accounts({ config: globalConfig, emergencyAuthority: signer.publicKey, pending }).signers([signer]).rpc();

    const unpause = await propose({ unpauseV2Pool: { pool: Keypair.generate().publicKey, swap: true, deposit: true, withdraw: true } });
    const stranger = Keypair.generate(); await fund(stranger, 1);
    assert.equal(code(await expectThrows(() => cancel(unpause, stranger), "stranger cancel")), "Unauthorized");
    await cancel(unpause, emergencyAuthority);
    assert.isTrue(((await program.account.pendingAction.fetch(unpause)) as any).cancelled);
    assert.equal(code(await expectThrows(() => cancel(unpause, emergencyAuthority), "cancel twice")), "ActionNotPending");

    const s: any = await program.account.governanceSettings.fetch(settings);
    const other = await propose({ setProtocolFeeShare: { bps: s.protocolFeeShareBps } });
    assert.equal(code(await expectThrows(() => cancel(other, emergencyAuthority), "cancel a fee action")), "WrongActionKind");
    await program.methods.cancelGovAction().accounts({ config: globalConfig, governanceAuthority: payer.publicKey, pending: other }).rpc();
  });
});
