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
  AccountState,
  createInitializeDefaultAccountStateInstruction,
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

  async function setPolicy(mint: PublicKey, tokenProgram: PublicKey, enabled: boolean, reviewed: boolean, trustFreeze = false) {
    return program.methods.setMintPolicy(enabled, reviewed, trustFreeze)
      .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, mint, tokenProgram, mintPolicy: mintPolicy(mint), payer: payer.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
  }

  /** Creates a Token-2022 mint at `kp` with the given mint-level extensions. */
  async function createToken2022Mint(kp: Keypair, exts: ExtensionType[], init: (mint: PublicKey) => anchor.web3.TransactionInstruction[], decimals = 6, freezeAuthority: PublicKey | null = null) {
    const len = getMintLen(exts);
    const lamports = await conn.getMinimumBalanceForRentExemption(len);
    const tx = new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey, space: len, lamports, programId: TOKEN_2022_PROGRAM_ID }),
      ...init(kp.publicKey),
      createInitializeMintInstruction(kp.publicKey, decimals, payer.publicKey, freezeAuthority, TOKEN_2022_PROGRAM_ID)
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
      await program.methods.setAllowedMint(true, false)
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
  // CP pools are not compiled into a `--features v2-only` build.
  const HAS_CP = program.idl.instructions.some((ix: any) => ix.name === "initializePool" || ix.name === "initialize_pool");
  (HAS_CP ? it : it.skip)("F-5: CP swap min_amount_out is checked against what the trader receives, not the pre-fee amount", async () => {
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
  // Governance-action helpers (F-2, F-4, K-3)
  // ------------------------------------------------------------------
  async function proposeAs(action: any, gov: Keypair = payer) {
    const s: any = await program.account.governanceSettings.fetch(settings);
    const pending = pda(Buffer.from("gov_action"), u64le(s.nextActionId));
    await program.methods.proposeGovAction(action)
      .accounts({ config: globalConfig, governanceAuthority: gov.publicKey, settings, pending, payer: gov.publicKey, systemProgram: SystemProgram.programId })
      .signers(gov === payer ? [] : [gov]).rpc();
    return pending;
  }
  const accept = (pending: PublicKey, signer: Keypair) => program.methods.acceptAuthority()
    .accounts({ config: globalConfig, newAuthority: signer.publicKey, pending })
    .signers(signer === payer ? [] : [signer]).rpc();
  const delayMs = async () => (Number(((await program.account.governanceSettings.fetch(settings)) as any).timelockDelaySecs) + 2) * 1000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const authorities = async () => {
    const c: any = await program.account.globalConfig.fetch(globalConfig);
    return { gov: c.governanceAuthority.toBase58(), em: c.emergencyAuthority.toBase58() };
  };

  // ------------------------------------------------------------------
  // F-4 bricking governance with the default key (now via K-3 rotation)
  // ------------------------------------------------------------------
  it("F-4: an authority rotation to the all-zero key, or to the other role's key, is refused", async () => {
    for (const action of [
      { setGovernanceAuthority: { newAuthority: PublicKey.default } },
      { setEmergencyAuthority: { newAuthority: PublicKey.default } },
    ]) assert.equal(code(await expectThrows(() => proposeAs(action), "default key")), "InvalidAuthority");
    assert.equal(code(await expectThrows(() => proposeAs({ setGovernanceAuthority: { newAuthority: emergencyAuthority.publicKey } }), "gov = emergency")), "EmergencyCannotEqualGovernance");
    assert.equal(code(await expectThrows(() => proposeAs({ setEmergencyAuthority: { newAuthority: payer.publicKey } }), "emergency = gov")), "EmergencyCannotEqualGovernance");
  });

  // ------------------------------------------------------------------
  // K-3 two-step authority rotation
  // ------------------------------------------------------------------
  it("K-3: the old single-step set_authorities is gone", () => {
    assert.isFalse(program.idl.instructions.some((ix: any) => ix.name === "setAuthorities" || ix.name === "set_authorities"));
  });

  it("K-3: a governance rotation to a key nobody controls cannot take effect (typo safety) and can be cancelled", async () => {
    const before = await authorities();
    const typo = Keypair.generate(); // stands for an address with no known private key
    const pending = await proposeAs({ setGovernanceAuthority: { newAuthority: typo.publicKey } });
    await sleep(await delayMs());
    // Before K-3 the typo'd key became governance in the same instruction.
    assert.equal(code(await expectThrows(() => accept(pending, payer), "accept by the old governance")), "Unauthorized");
    const stranger = Keypair.generate(); await fund(stranger, 1);
    assert.equal(code(await expectThrows(() => accept(pending, stranger), "accept by a stranger")), "Unauthorized");
    assert.deepEqual(await authorities(), before, "nothing changed");
    // Not executable through any permissionless execute_* either.
    assert.equal(code(await expectThrows(() => program.methods.executeSettingsAction().accounts({ config: globalConfig, pending, settings }).rpc(), "execute")), "WrongActionKind");
    await program.methods.cancelGovAction().accounts({ config: globalConfig, governanceAuthority: payer.publicKey, pending }).rpc();
    assert.equal(code(await expectThrows(() => accept(pending, typo), "accept a cancelled rotation")), "ActionNotPending");
  });

  it("K-3: governance moves only after the timelock and the new key's signature; stale rotations die with the old governance", async () => {
    const original = await authorities();
    const newGov = Keypair.generate(); await fund(newGov, 2);
    const pending = await proposeAs({ setGovernanceAuthority: { newAuthority: newGov.publicKey } });
    // queued by the CURRENT governance, accepted only after it moved: stale
    const strayEmergency = Keypair.generate(); await fund(strayEmergency, 1);
    const stray = await proposeAs({ setEmergencyAuthority: { newAuthority: strayEmergency.publicKey } });
    // Same for every other kind of action (internal review 2026-11-11): one
    // queued by a governance key that has since been replaced must not be
    // executable by anyone.
    const strayTreasury = await proposeAs({ setTreasury: { treasury: Keypair.generate().publicKey } });
    const executeStray = () => program.methods.executeSettingsAction().accounts({ config: globalConfig, pending: strayTreasury, settings }).rpc();
    assert.equal(code(await expectThrows(() => accept(pending, newGov), "accept before the delay")), "TimelockNotElapsed");
    await sleep(await delayMs());
    await accept(pending, newGov);
    try {
      assert.deepEqual(await authorities(), { gov: newGov.publicKey.toBase58(), em: original.em });
      assert.equal(code(await expectThrows(() => program.methods.setPoolCreationPaused(true)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey }).rpc(), "old governance")), "Unauthorized");
      assert.equal(code(await expectThrows(() => accept(stray, strayEmergency), "stale emergency rotation")), "StaleAuthorityProposal");
      const treasuryBefore = ((await program.account.governanceSettings.fetch(settings)) as any).treasury.toBase58();
      assert.equal(code(await expectThrows(executeStray, "matured SetTreasury of the old governance")), "StaleAuthorityProposal");
      assert.equal(((await program.account.governanceSettings.fetch(settings)) as any).treasury.toBase58(), treasuryBefore);
      // its own proposer (payer) is no longer governance either, so a replay is stale before it is "executed"
      assert.equal(code(await expectThrows(() => accept(pending, newGov), "accept twice")), "StaleAuthorityProposal");
    } finally {
      // hand it back (same two steps, the other way round)
      const back = await proposeAs({ setGovernanceAuthority: { newAuthority: payer.publicKey } }, newGov);
      await sleep(await delayMs());
      await accept(back, payer);
    }
    assert.deepEqual(await authorities(), original);
    // `stray` was proposed by the governance key that is back in charge, so it
    // is valid again: governance cancels what it no longer wants.
    await program.methods.cancelGovAction().accounts({ config: globalConfig, governanceAuthority: payer.publicKey, pending: stray }).rpc();
    await program.methods.cancelGovAction().accounts({ config: globalConfig, governanceAuthority: payer.publicKey, pending: strayTreasury }).rpc();
  });

  it("K-3: the emergency key rotates without a delay, but still only with the new key's signature", async () => {
    const original = await authorities();
    const newEm = Keypair.generate(); await fund(newEm, 1);
    const stranger = Keypair.generate(); await fund(stranger, 1);
    const pending = await proposeAs({ setEmergencyAuthority: { newAuthority: newEm.publicKey } });
    assert.equal(code(await expectThrows(() => accept(pending, stranger), "stranger")), "Unauthorized");
    await accept(pending, newEm); // no timelock wait
    assert.deepEqual(await authorities(), { gov: original.gov, em: newEm.publicKey.toBase58() });
    // only the governance authority proposes rotations, never the emergency key
    assert.equal(code(await expectThrows(() => proposeAs({ setEmergencyAuthority: { newAuthority: stranger.publicKey } }, newEm), "emergency proposes")), "Unauthorized");
    const back = await proposeAs({ setEmergencyAuthority: { newAuthority: emergencyAuthority.publicKey } });
    await accept(back, emergencyAuthority);
    assert.deepEqual(await authorities(), original);
  });

  // ------------------------------------------------------------------
  // K-1 freeze authority
  // ------------------------------------------------------------------
  it("K-1: a mint with a freeze authority is refused unless governance explicitly trusts it (USDC / USDT case)", async () => {
    const freezer = Keypair.generate();
    const f = await createMint(conn, payer, payer.publicKey, freezer.publicKey, 6);
    const plain = await createMint(conn, payer, payer.publicKey, null, 6);
    // Before K-1 this was enabled and the issuer could freeze a pool vault, stopping every withdrawal.
    assert.equal(code(await expectThrows(() => setPolicy(f, TOKEN_PROGRAM_ID, true, false), "untrusted freeze authority")), "FreezeAuthorityNotTrusted");
    await setPolicy(f, TOKEN_PROGRAM_ID, false, false); // disabling never needs the flag
    await setPolicy(f, TOKEN_PROGRAM_ID, true, false, true); // explicit trust
    await setPolicy(plain, TOKEN_PROGRAM_ID, true, false, false);
    const p: any = await program.account.mintPolicy.fetch(mintPolicy(f));
    assert.isTrue(p.enabled);
    const params = { baseFee: FIXED_1PCT, dynamicFee: NO_DYNAMIC, collectFeeMode: 0, activationTs: new BN(0), maxPriceImpactBps: 5_000, oracle: NO_ORACLE };
    const pool = v2Pool(f, plain, 100);
    await program.methods.initializeV2Pool(params).accounts({
      creator: payer.publicKey, config: globalConfig, settings, mintA: f, mintB: plain,
      mintPolicyA: mintPolicy(f), mintPolicyB: mintPolicy(plain), pool,
      vaultA: v2Vault(pool, f), vaultB: v2Vault(pool, plain), mintFeedA: null, mintFeedB: null,
      tokenProgramA: TOKEN_PROGRAM_ID, tokenProgramB: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();
    if (HAS_CP) {
      const err = await expectThrows(() => program.methods.setAllowedMint(true, false)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, mint: f, allowedMint: allowedMint(f), payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc(), "CP/DLMM allowlist");
      assert.equal(code(err), "FreezeAuthorityNotTrusted", String(err));
      await program.methods.setAllowedMint(true, true)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, mint: f, allowedMint: allowedMint(f), payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    }
  });

  it("K-1: a Token-2022 mint whose accounts are born frozen (DefaultAccountState) cannot get a pool", async () => {
    const kp = Keypair.generate();
    await createToken2022Mint(kp, [ExtensionType.DefaultAccountState], (m) => [
      createInitializeDefaultAccountStateInstruction(m, AccountState.Frozen, TOKEN_2022_PROGRAM_ID),
    ], 6, payer.publicKey); // the token program requires a freeze authority for this
    const m = kp.publicKey;
    assert.equal(code(await expectThrows(() => setPolicy(m, TOKEN_2022_PROGRAM_ID, true, true), "no trust")), "FreezeAuthorityNotTrusted");
    await setPolicy(m, TOKEN_2022_PROGRAM_ID, true, true, true); // even if governance trusts the issuer...
    const b = await createMint(conn, payer, payer.publicKey, null, 6);
    await setPolicy(b, TOKEN_PROGRAM_ID, true, false);
    const params = { baseFee: FIXED_1PCT, dynamicFee: NO_DYNAMIC, collectFeeMode: 0, activationTs: new BN(0), maxPriceImpactBps: 5_000, oracle: NO_ORACLE };
    const pool = v2Pool(m, b, 100);
    const err = await expectThrows(() => program.methods.initializeV2Pool(params).accounts({
      creator: payer.publicKey, config: globalConfig, settings, mintA: m, mintB: b,
      mintPolicyA: mintPolicy(m), mintPolicyB: mintPolicy(b), pool,
      vaultA: v2Vault(pool, m), vaultB: v2Vault(pool, b), mintFeedA: null, mintFeedB: null,
      tokenProgramA: TOKEN_2022_PROGRAM_ID, tokenProgramB: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc(), "pool with a born-frozen vault");
    // ...the pool is refused: its vault would be frozen from the start.
    assert.equal(code(err), "VaultFrozen", String(err));
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
