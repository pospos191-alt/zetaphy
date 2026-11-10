// Checks for the reduced mainnet build (`anchor build -- --features mainnet,v2-only`,
// see AUDIT_README.md). Skipped on the default (full) build. Together with
// swdmm_v2.ts and security-review.ts this is the governance + v2 suite CI runs
// against the v2-only binary.

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

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
];

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
    try {
      await program.methods.initializeGovernanceSettings(new BN(5), 1_000, payer.publicKey)
        .accounts({ config: globalConfig, governanceAuthority: payer.publicKey, settings, payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    } catch (e) { if (!String(e).includes("already in use")) throw e; }
  });

  it("the IDL has no constant-product / DLMM / allowlist instructions, and keeps every v2 + governance one", () => {
    for (const n of REMOVED) assert.isFalse(names.has(n), `${n} must not be in a v2-only build`);
    for (const n of [
      "initializeGlobalConfig", "setAuthorities", "setPoolCreationPaused", "setMintFeed", "verifyGovernanceMultisig",
      "initializeGovernanceSettings", "proposeGovAction", "cancelGovAction", "emergencyCancelUnpause",
      "executeV2PoolAction", "executeSettingsAction", "executeWithdrawProtocolFees", "setMintPolicy",
      "initializeV2Pool", "createV2Position", "addV2Liquidity", "removeV2Liquidity", "claimV2Fees",
      "lockV2Liquidity", "transferV2Position", "closeV2Position", "swapV2", "emergencyPauseV2Pool",
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

  it("only the governance authority can pause pool creation; set_authorities is governance-only", async () => {
    const stranger = Keypair.generate();
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: stranger.publicKey, lamports: 100_000_000 })), [payer]);
    const e1 = await expectThrows(() => program.methods.setPoolCreationPaused(true)
      .accounts({ config: globalConfig, governanceAuthority: stranger.publicKey }).signers([stranger]).rpc(), "stranger pause");
    assert.equal(code(e1), "Unauthorized", String(e1));
    const e2 = await expectThrows(() => program.methods.setAuthorities(stranger.publicKey, stranger.publicKey)
      .accounts({ config: globalConfig, governanceAuthority: stranger.publicKey }).signers([stranger]).rpc(), "stranger set_authorities");
    assert.equal(code(e2), "Unauthorized", String(e2));
  });
});
