// Checks for the reduced mainnet build (`anchor build -- --features mainnet,v2-only`,
// see AUDIT_README.md). Skipped on the default (full) build. Together with
// swdmm_v2.ts and security-review.ts this is the governance + v2 suite CI runs
// against the v2-only binary.

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccount, createMint, mintTo, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import { LEGACY_POOLS, mintFeedPda, registerFeeds, v2PositionIndex } from "./oracle-fixtures";

const code = (e: any) => e?.error?.errorCode?.code ?? (String(e).match(/Error Code: (\w+)/) || [])[1];
async function expectThrows(fn: () => Promise<unknown>, label: string): Promise<any> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error(`expected "${label}" to throw, but it succeeded`);
}

const REMOVED = [
  "initializePool", "addLiquidity", "removeLiquidity", "swap",
  "initializeDlmmPool", "addDlmmLiquidity", "removeDlmmLiquidity", "swapDlmm",
  "emergencyPausePool", "emergencyPauseDlmmPool", "governedUnpausePool", "governedUnpauseDlmmPool",
  "executeUnpausePool", "executeUnpauseDlmmPool", "setAllowedMint",
  "setAuthorities", // replaced by propose (SetGovernance/EmergencyAuthority) + acceptAuthority, K-3
];
// SWD_MAINNET_BUILD=1: the binary was built with `mainnet,v2-only`, whose
// timelock must be 24h-48h (timelock.rs), so the set-up uses 24h and the
// suites that wait for a timelock (swdmm_v2.ts) cannot run against it.
const MAINNET_BUILD = process.env.SWD_MAINNET_BUILD === "1";
const DELAY = MAINNET_BUILD ? 86_400 : 5;

describe("v2-only build (reduced mainnet scope)", function () {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SwdAmm as anchor.Program<any>;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const emergencyAuthority = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  const names = new Set(program.idl.instructions.map((ix: any) => camel(ix.name)));
  const V2_ONLY = !names.has("initializePool");

  const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const globalConfig = pda(Buffer.from("global-config"));
  const settings = pda(Buffer.from("gov_settings"));
  const u64le = (n: number | BN) => new BN(n).toArrayLike(Buffer, "le", 8);

  before(async function () {
    if (!V2_ONLY) this.skip();
    try {
      await program.methods.initializeGlobalConfig(payer.publicKey, emergencyAuthority.publicKey)
        .accounts({ config: globalConfig, programData: PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0], payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    } catch (e) { if (!String(e).includes("already in use")) throw e; }
    if (MAINNET_BUILD) {
      // Must run before any other suite initialises the settings.
      const err = await expectThrows(() => program.methods.initializeGovernanceSettings(new BN(5), 1_000, payer.publicKey)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, settings, payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc(), "5s timelock on a mainnet build");
      if (!String(err).includes("already in use")) assert.equal(code(err), "InvalidTimelockDelay", String(err));
    }
    try {
      await program.methods.initializeGovernanceSettings(new BN(DELAY), 1_000, payer.publicKey)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, settings, payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    } catch (e) { if (!String(e).includes("already in use")) throw e; }
  });

  it("the IDL has no constant-product / DLMM / allowlist instructions, and keeps every v2 + governance one", () => {
    for (const n of REMOVED) assert.isFalse(names.has(n), `${n} must not be in a v2-only build`);
    for (const n of [
      "initializeGlobalConfig", "acceptAuthority", "setPoolCreationPaused", "setMintFeed", "verifyGovernanceMultisig",
      "initializeGovernanceSettings", "proposeGovAction", "cancelGovAction", "emergencyCancelUnpause",
      "executeV2PoolAction", "executeSettingsAction", "executeWithdrawProtocolFees", "setMintPolicy",
      "initializeV2Pool", "createV2Position", "addV2Liquidity", "removeV2Liquidity", "claimV2Fees",
      "lockV2Liquidity", "transferV2Position", "closeV2Position", "swapV2", "emergencyPauseV2Pool", "emergencyPauseV2Pools",
    ]) assert.isTrue(names.has(n), `${n} missing`);
    assert.equal(names.size, 24);
  });

  it("the binary refuses a CP instruction discriminator (not just the IDL)", async () => {
    // sha256("global:swap")[0..8]: the old CP swap entry point.
    const disc = Buffer.from(anchor.utils.sha256.hash("global:swap"), "hex").subarray(0, 8);
    const ix = new anchor.web3.TransactionInstruction({ programId: program.programId, keys: [], data: disc });
    const err = await expectThrows(() => provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), [payer]), "CP swap");
    assert.match(String(err), /0x65|InstructionFallbackNotFound|Fallback functions are not supported/);
  });

  it("governance cannot propose an unpause for a CP or DLMM pool (it could never execute)", async () => {
    const s: any = await program.account.governanceSettings.fetch(settings);
    const pending = pda(Buffer.from("gov_action"), u64le(s.nextActionId));
    for (const action of [
      { unpauseCpPool: { pool: Keypair.generate().publicKey, swap: true, deposit: false, withdraw: false } },
      { unpauseDlmmPool: { pool: Keypair.generate().publicKey, swap: true, deposit: false, withdraw: false } },
    ]) {
      const err = await expectThrows(() => program.methods.proposeGovAction(action)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, settings, pending, payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc(), "propose CP/DLMM unpause");
      assert.equal(code(err), "WrongActionKind", String(err));
    }
  });

  const funded = async () => {
    const k = Keypair.generate();
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: 100_000_000 })), [payer]);
    return k;
  };
  async function propose(action: any, gov: Keypair = payer) {
    const s: any = await program.account.governanceSettings.fetch(settings);
    const pending = pda(Buffer.from("gov_action"), u64le(s.nextActionId));
    await program.methods.proposeGovAction(action)
      .accounts({ config: globalConfig, governanceAuthority: gov.publicKey, settings, pending, payer: gov.publicKey, systemProgram: SystemProgram.programId })
      .signers(gov === payer ? [] : [gov]).rpc();
    return pending;
  }
  const accept = (pending: PublicKey, signer: Keypair) => program.methods.acceptAuthority()
    .accounts({ config: globalConfig, newAuthority: signer.publicKey, pending }).signers([signer]).rpc();

  it("only the governance authority can pause pool creation or propose an authority rotation", async () => {
    const stranger = await funded();
    const e1 = await expectThrows(() => program.methods.setPoolCreationPaused(true)
      .accounts({ config: globalConfig, governanceAuthority: stranger.publicKey }).signers([stranger]).rpc(), "stranger pause");
    assert.equal(code(e1), "Unauthorized", String(e1));
    const e2 = await expectThrows(() => propose({ setGovernanceAuthority: { newAuthority: stranger.publicKey } }, stranger), "stranger rotation");
    assert.equal(code(e2), "Unauthorized", String(e2));
  });

  it("K-3: a governance rotation waits for the build's timelock (24 h on mainnet); the emergency key rotates at once (two-step)", async () => {
    const newGov = await funded();
    const pending = await propose({ setGovernanceAuthority: { newAuthority: newGov.publicKey } });
    const pa: any = await program.account.pendingAction.fetch(pending);
    assert.equal(Number(pa.executeAfter) - Number(pa.createdAt), Number(((await program.account.governanceSettings.fetch(settings)) as any).timelockDelaySecs));
    assert.equal(code(await expectThrows(() => accept(pending, newGov), "accept before the timelock")), "TimelockNotElapsed");
    await program.methods.cancelGovAction().accounts({ config: globalConfig, governanceAuthority: payer.publicKey, pending }).rpc();

    const newEm = await funded();
    const p2 = await propose({ setEmergencyAuthority: { newAuthority: newEm.publicKey } });
    await accept(p2, newEm);
    let c: any = await program.account.globalConfig.fetch(globalConfig);
    assert.equal(c.emergencyAuthority.toBase58(), newEm.publicKey.toBase58());
    await accept(await propose({ setEmergencyAuthority: { newAuthority: emergencyAuthority.publicKey } }), emergencyAuthority);
    c = await program.account.globalConfig.fetch(globalConfig);
    assert.equal(c.emergencyAuthority.toBase58(), emergencyAuthority.publicKey.toBase58());
    assert.equal(c.governanceAuthority.toBase58(), payer.publicKey.toBase58());
  });

  it(`K-5: v2 pool creation is ${MAINNET_BUILD ? "governance-only on this mainnet build" : "permissionless on this devnet build"}`, async () => {
    const creator = await funded();
    const mintPolicy = (m: PublicKey) => pda(Buffer.from("mint_policy"), m.toBuffer());
    const mints: PublicKey[] = [];
    for (let i = 0; i < 2; i++) {
      const m = await createMint(provider.connection, payer, payer.publicKey, null, 6);
      await program.methods.setMintPolicy(true, false, false)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, mint: m, tokenProgram: TOKEN_PROGRAM_ID, mintPolicy: mintPolicy(m), payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
      mints.push(m);
    }
    const [a, b] = mints;
    const u16le = (n: number) => { const x = Buffer.alloc(2); x.writeUInt16LE(n); return x; };
    const pool = pda(Buffer.from("swdmm_v2_pool"), a.toBuffer(), b.toBuffer(), u16le(100));
    const params = {
      baseFee: { mode: 0, decay: 0, cliffFeeBps: 100, floorFeeBps: 100, numberOfPeriods: 0, periodFrequency: new BN(0), reductionFactor: new BN(0) },
      dynamicFee: { enabled: false, maxDynamicFeeBps: 0, variableFeeControl: 0, filterPeriod: 0, decayPeriod: 0, reductionFactor: 0, maxVolatilityAccumulator: new BN(0) },
      collectFeeMode: 0, activationTs: new BN(0), maxPriceImpactBps: 5_000,
      oracle: { enabled: false, pythFeedIdA: Array(32).fill(0), pythFeedIdB: Array(32).fill(0), maxStalenessSecs: 0, maxDeviationBps: 0 },
    };
    const init = (who: Keypair) => program.methods.initializeV2Pool(params).accounts({
      creator: who.publicKey, config: globalConfig, settings, mintA: a, mintB: b,
      mintPolicyA: mintPolicy(a), mintPolicyB: mintPolicy(b), pool,
      vaultA: pda(Buffer.from("swdmm_v2_vault"), pool.toBuffer(), a.toBuffer()),
      vaultB: pda(Buffer.from("swdmm_v2_vault"), pool.toBuffer(), b.toBuffer()),
      mintFeedA: null, mintFeedB: null,
      tokenProgramA: TOKEN_PROGRAM_ID, tokenProgramB: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers(who === payer ? [] : [who]).rpc();
    if (MAINNET_BUILD) {
      // Before K-5 the first caller fixed this pair's fee schedule for good.
      const err = await expectThrows(() => init(creator), "squatter on mainnet");
      assert.equal(code(err), "GovernanceOnlyPoolCreation", String(err));
      await init(payer);
    } else {
      await init(creator);
    }
    const p: any = await program.account.swdmmV2Pool.fetch(pool);
    assert.equal(p.creator.toBase58(), (MAINNET_BUILD ? payer : creator).publicKey.toBase58());
  });

  // KNOWN_ISSUES K-17: the most expensive swap_v2 path — Token-2022 mints on
  // both sides, the Pyth guard, the dynamic fee, an exponential fee scheduler
  // and (second swap of a transaction) the per-slot impact check — must fit
  // the DEFAULT compute budget (200,000 units per instruction), because a
  // wallet or aggregator may not set a limit. The swaps below carry no
  // ComputeBudget instruction, so they would fail if they needed more; the
  // numbers are printed for the audit package.
  it("K-17: worst-case swap_v2 (Token-2022 + oracle guard + dynamic fee) fits the default compute budget", async () => {
    const conn = provider.connection;
    const T22 = TOKEN_2022_PROGRAM_ID;
    const mintPolicy = (m: PublicKey) => pda(Buffer.from("mint_policy"), m.toBuffer());
    const u16le = (n: number) => { const x = Buffer.alloc(2); x.writeUInt16LE(n); return x; };
    const mints: PublicKey[] = [];
    const tokens: PublicKey[] = [];
    for (let i = 0; i < 2; i++) {
      // 6 decimals on both sides: the "legacy-ratio1" fixture prices 1 raw B per raw A
      const m = await createMint(conn, payer, payer.publicKey, null, 6, undefined, undefined, T22);
      await program.methods.setMintPolicy(true, true, false)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, mint: m, tokenProgram: T22, mintPolicy: mintPolicy(m), payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
      const t = await createAssociatedTokenAccount(conn, payer, m, payer.publicKey, undefined, T22);
      await mintTo(conn, payer, m, t, payer, 100_000_000_000n, [], undefined, T22);
      mints.push(m); tokens.push(t);
    }
    const [a, b] = mints;
    const [ta, tb] = tokens;
    const fx = LEGACY_POOLS.ratioOne;
    await registerFeeds(program, payer, globalConfig, [[a, fx.feedIdA], [b, fx.feedIdB]]);

    const FLOOR = 100;
    const pool = pda(Buffer.from("swdmm_v2_pool"), a.toBuffer(), b.toBuffer(), u16le(FLOOR));
    const vaultA = pda(Buffer.from("swdmm_v2_vault"), pool.toBuffer(), a.toBuffer());
    const vaultB = pda(Buffer.from("swdmm_v2_vault"), pool.toBuffer(), b.toBuffer());
    const params = {
      // time scheduler, exponential decay, the maximum number of periods (pow_q64 loop)
      baseFee: { mode: 1, decay: 1, cliffFeeBps: 500, floorFeeBps: FLOOR, numberOfPeriods: 10_000, periodFrequency: new BN(1), reductionFactor: new BN(1) },
      dynamicFee: { enabled: true, maxDynamicFeeBps: 500, variableFeeControl: 1_000, filterPeriod: 10, decayPeriod: 120, reductionFactor: 5_000, maxVolatilityAccumulator: new BN(100_000) },
      collectFeeMode: 1, // fee in token B: taken from the output on A -> B, from the input on B -> A
      activationTs: new BN(0), maxPriceImpactBps: 5_000,
      oracle: { enabled: true, pythFeedIdA: fx.feedIdA, pythFeedIdB: fx.feedIdB, maxStalenessSecs: 3_600, maxDeviationBps: 5_000 },
    };
    await program.methods.initializeV2Pool(params).accounts({
      creator: payer.publicKey, config: globalConfig, settings, mintA: a, mintB: b,
      mintPolicyA: mintPolicy(a), mintPolicyB: mintPolicy(b), pool, vaultA, vaultB,
      mintFeedA: mintFeedPda(program.programId, a), mintFeedB: mintFeedPda(program.programId, b),
      tokenProgramA: T22, tokenProgramB: T22, systemProgram: SystemProgram.programId,
    }).rpc();

    const index = new BN(v2PositionIndex(payer.publicKey, 0).toString());
    const position = pda(Buffer.from("swdmm_v2_position"), pool.toBuffer(), u64le(index));
    await program.methods.createV2Position(new BN(0), index).accounts({ owner: payer.publicKey, pool, position, systemProgram: SystemProgram.programId }).rpc();
    await program.methods.addV2Liquidity(new BN(10_000_000_000), new BN(10_000_000_000), new BN(0)).accounts({
      owner: payer.publicKey, pool, position, mintA: a, mintB: b, vaultA, vaultB,
      ownerTokenA: ta, ownerTokenB: tb, tokenProgramA: T22, tokenProgramB: T22,
    }).rpc();

    const swapIx = (amount: number, aToB: boolean) => program.methods.swapV2(new BN(amount), new BN(0), aToB).accounts({
      trader: payer.publicKey, settings, pool, mintA: a, mintB: b, vaultA, vaultB,
      traderTokenA: ta, traderTokenB: tb, tokenProgramA: T22, tokenProgramB: T22,
      priceUpdateA: fx.priceUpdateA, priceUpdateB: fx.priceUpdateB,
    }).instruction();
    const units = async (label: string, ixs: anchor.web3.TransactionInstruction[]) => {
      // provider defaults (a per-call commitment made the preflight look for a
      // blockhash the node did not have at that commitment yet)
      const sig = await provider.sendAndConfirm(new anchor.web3.Transaction().add(...ixs), []);
      let tx = null;
      for (let i = 0; i < 60 && !tx; i++) {
        tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!tx) await new Promise((r) => setTimeout(r, 500));
      }
      const cu = tx?.meta?.computeUnitsConsumed;
      assert.isNumber(cu, `no compute-unit figure for ${label}`);
      console.log(`    [K-17] ${label}: ${cu} compute units`);
      return cu as number;
    };

    const LIMIT = 200_000; // default per instruction when no ComputeBudget instruction is sent
    const first = await units("swap_v2 A->B (fee on output)", [await swapIx(500_000_000, true)]);
    const back = await units("swap_v2 B->A (fee on input, volatility accumulated)", [await swapIx(300_000_000, false)]);
    const pair = await units("two swap_v2 in one transaction (per-slot impact check on the second)", [await swapIx(200_000_000, true), await swapIx(200_000_000, true)]);
    const worst = Math.max(first, back, pair - Math.min(first, back));
    console.log(`    [K-17] worst single swap_v2: about ${worst} of ${LIMIT} compute units (${MAINNET_BUILD ? "mainnet,v2-only" : "v2-only"} build)`);
    assert.isBelow(first, LIMIT);
    assert.isBelow(back, LIMIT);
    assert.isBelow(pair, 2 * LIMIT);
    const after: any = await program.account.swdmmV2Pool.fetch(pool);
    assert.equal(after.swapCount.toString(), "4");
    assert.ok(new BN(after.volatilityAccumulator).gtn(0), "the dynamic fee path ran");
  });
});
