// "Phase 2b" (Squads multisig LIVE on-chain verification, added 2026-09-24)
// — see governance.rs's module doc comment ("SQUADS MULTISIG TRANSPARENCY"
// / "KNOWN UNCERTAINTY") and tests/squads-vault-pda.ts's header comment
// for the backstory. Between those two, this project already had:
//   1. Offline proof that the VAULT PDA SEED LITERALS are correct
//      (tests/squads-vault-pda.ts, matches the real @sqds/multisig SDK's
//      own getVaultPda — no chain interaction needed).
//   2. The Multisig ACCOUNT BYTE LAYOUT (read_squads_multisig_summary's
//      fixed offsets) cross-checked against Squads' own published docs.
// Neither of those proves `verify_governance_multisig` actually works
// end-to-end against a REAL Squads v4 Multisig account produced by the
// REAL Squads program running on-chain — governance.rs's own comment
// flagged this exact gap as "not done here, a follow-up piece of work".
// THIS file is that follow-up.
//
// HOW: Anchor.toml's `[test.validator]` now sets `url` (a real mainnet-
// beta RPC) and two `[[test.validator.clone]]` entries — the real Squads
// v4 program (SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf) and its
// ProgramConfig singleton PDA — so this localnet validator starts with a
// working copy of the ACTUAL deployed program, not a mock. This file then
// uses the official `@sqds/multisig` SDK (already a package.json
// dependency) to create a genuine multisig against that cloned program.
//
// The ProgramConfig PDA address baked into Anchor.toml
// (BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr) was computed OFFLINE from
// the ACTUAL installed @sqds/multisig v2.1.1 package's own compiled
// source (node_modules/@sqds/multisig/lib/index.js:
// `SEED_PREFIX = toUtfBytes("multisig")`,
// `SEED_PROGRAM_CONFIG = toUtfBytes("program_config")`,
// `getProgramConfigPda` derives `[SEED_PREFIX, SEED_PROGRAM_CONFIG]`) —
// i.e. read directly out of the real, running client code, not
// reconstructed from memory or guessed. The same source also confirms
// getVaultPda's seeds (`[SEED_PREFIX, multisigPda, SEED_VAULT,
// u8(index)]`) match governance.rs's `derive_squads_vault_pda` byte for
// byte, independently corroborating tests/squads-vault-pda.ts's own
// offline result.
//
// IF THIS FILE FAILS AT VALIDATOR STARTUP (before any test even runs):
// the clone itself failed — almost certainly the public mainnet-beta RPC
// in Anchor.toml rate-limited or refused the request for the whole
// program's executable data. Check `.anchor/test-ledger/validator.log`;
// if it's an RPC/timeout error, swap Anchor.toml's `[test.validator].url`
// for a private RPC endpoint and retry — this is an infrastructure
// problem, not a bug in this file or governance.rs.
//
// SHARED-STATE WARNING (read before touching this file): GlobalConfig is
// a program-wide singleton PDA — every test file in this `anchor test`
// run shares ONE GlobalConfig, and by the time this file's tests run,
// some other file's before()/ensureGlobalConfig() has already initialized
// it with governance_authority = payer.publicKey (a plain keypair, NOT a
// Squads vault) so the rest of the governance suite can sign for it
// directly (see tests/governance.ts / tests/swd_amm.ts). The third test
// below temporarily points governance_authority at a REAL vault PDA to
// prove the happy path, then restores it — but restoring is NOT a plain
// signed call (a vault PDA has no private key; only Squads' own program
// can produce a valid signature for it, via invoke_signed during a real
// executed transaction), so the restore itself goes through a genuine
// Squads propose -> approve -> execute flow. If that flow ever throws
// partway, this run's shared GlobalConfig is left pointed at an
// unspendable PDA for the REST of this `anchor test` invocation — this
// file is deliberately named to sort alphabetically LAST among
// tests/**/*.ts (the "z-" prefix) so that outcome can only affect ITS OWN
// remaining tests, never a file that already finished. A later, separate
// `anchor test` run always starts a brand-new validator/ledger regardless
// (Anchor's normal behavior), so a bad run here never contaminates the
// next one.

import * as anchor from "@coral-xyz/anchor";
import * as multisig from "@sqds/multisig";
import { PublicKey, Keypair, SystemProgram, TransactionMessage } from "@solana/web3.js";
import { assert } from "chai";

describe("squads multisig — live on-chain verification (Phase 2b)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SwdAmm as anchor.Program<any>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // Same deterministic seed every other test file uses (see
  // architecture-and-decisions.md's "Round 3" note) — GlobalConfig can
  // only ever be initialized once across the whole shared `anchor test`
  // run, so every file's emergencyAuthority must resolve to the SAME
  // keypair or whichever file's initializeGlobalConfig call wins the race
  // sets an authority the OTHER files' independently-generated keypair
  // wouldn't match.
  const EMERGENCY_AUTHORITY_SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const emergencyAuthority = Keypair.fromSeed(EMERGENCY_AUTHORITY_SEED);

  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-config")],
    program.programId
  );

  async function ensureGlobalConfig() {
    try {
      await program.methods
        .initializeGlobalConfig(payer.publicKey, emergencyAuthority.publicKey)
        .accounts({
          config: globalConfigPda,
          programData: PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0], payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_e) {
      // Another test file's before() hook already won the race and
      // initialized the shared singleton first — expected, same
      // idempotent pattern every other file in this suite uses.
    }
  }

  async function extractErrorCode(fn: () => Promise<unknown>): Promise<string | null> {
    try {
      await fn();
      return null;
    } catch (e: any) {
      return e?.error?.errorCode?.code ?? null;
    }
  }

  // BUG FIX (2026-09-24, after the first real `anchor test` run against
  // this file): every `multisig.rpc.*` function is a thin wrapper around
  // `connection.sendTransaction(tx, sendOptions)` (confirmed by reading
  // node_modules/@sqds/multisig/lib/index.js directly — e.g.
  // `multisigCreateV23`/`vaultTransactionCreate3` end with exactly that,
  // nothing more). `sendTransaction` resolves as soon as the RPC *accepts*
  // the transaction for broadcast — NOT once it lands/executes. Combined
  // with `sendOptions: { skipPreflight: true }` (the original version of
  // this file passed that everywhere), a transaction that fails on-chain
  // produces NO exception at all: the call "succeeds", returns a
  // signature, and whatever this test does next silently races ahead
  // against state that was never actually written. That race is what
  // produced the first real run's failure 1 (`NotASquadsMultisigAccount`
  // instead of `MultisigVaultMismatch`): `createRealMultisig` returned
  // before — or regardless of whether — the multisig account actually
  // existed on-chain.
  //
  // Fix: (a) drop `skipPreflight: true` so a real on-chain failure surfaces
  // immediately as a `SendTransactionError` WITH program logs attached,
  // instead of being swallowed; (b) explicitly confirm every signature
  // before treating the call as done, so later reads/instructions never
  // race ahead of a transaction that hasn't landed yet.
  async function sendAndConfirm(sendPromise: Promise<string>): Promise<string> {
    const signature = await sendPromise;
    const result = await provider.connection.confirmTransaction(signature, "confirmed");
    if (result.value.err) {
      throw new Error(
        `transaction ${signature} was accepted but failed on-chain: ${JSON.stringify(result.value.err)}`
      );
    }
    return signature;
  }

  async function createRealMultisig(threshold: number) {
    const createKey = Keypair.generate();
    const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
    const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

    const programConfigPda = multisig.getProgramConfigPda({})[0];
    const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
      provider.connection,
      programConfigPda
    );

    await sendAndConfirm(
      multisig.rpc.multisigCreateV2({
        connection: provider.connection,
        createKey,
        creator: payer,
        multisigPda,
        configAuthority: null,
        timeLock: 0,
        members: [{ key: payer.publicKey, permissions: multisig.types.Permissions.all() }],
        threshold,
        rentCollector: null,
        treasury: programConfig.treasury,
      })
    );

    return { multisigPda, vaultPda };
  }

  it("rejects an account not owned by the real (cloned) Squads v4 program", async () => {
    await ensureGlobalConfig();

    // globalConfigPda is convenient here: guaranteed to exist (just
    // ensured above), owned by OUR program, definitely not Squads'.
    const code = await extractErrorCode(() =>
      program.methods
        .verifyGovernanceMultisig(0)
        .accounts({ config: globalConfigPda, squadsMultisig: globalConfigPda })
        .rpc()
    );
    assert.equal(code, "NotASquadsMultisigAccount");
  });

  it("parses a REAL, freshly-created Squads v4 Multisig account's layout correctly", async () => {
    await ensureGlobalConfig();
    const { multisigPda } = await createRealMultisig(1);

    // governance_authority in the SHARED GlobalConfig is NOT this
    // multisig's vault (it's payer.publicKey, set by whichever test file's
    // before() ran first) — so this is expected to reach
    // MultisigVaultMismatch, not succeed outright. Reaching THAT SPECIFIC
    // error (rather than NotASquadsMultisigAccount or
    // MultisigAccountTooShort, and rather than a raw Borsh/slice panic) is
    // itself the proof that read_squads_multisig_summary correctly parsed
    // a REAL account's threshold/member_count off the REAL cloned Squads
    // v4 program's output. The full "governance_authority genuinely equals
    // the vault" happy path is proven separately by the next test, via a
    // real Squads-approved CPI rather than by mutating this shared
    // singleton directly here.
    const code = await extractErrorCode(() =>
      program.methods
        .verifyGovernanceMultisig(0)
        .accounts({ config: globalConfigPda, squadsMultisig: multisigPda })
        .rpc()
    );
    assert.equal(
      code,
      "MultisigVaultMismatch",
      `got ${code} instead of MultisigVaultMismatch — if this is MultisigAccountTooShort or a raw ` +
        `deserialization failure, read_squads_multisig_summary's byte offsets in governance.rs do not ` +
        `match the REAL cloned Squads v4 account layout (check the field-by-field comment above that ` +
        `function); if it's NotASquadsMultisigAccount, the program clone in Anchor.toml isn't taking ` +
        `effect (check .anchor/test-ledger/validator.log for the clone step at startup)`
    );
  });

  // Runs one instruction as the Squads vault: vaultTransactionCreate ->
  // proposalCreate -> proposalApprove -> vaultTransactionExecute, i.e. the
  // exact flow 2-of-3 members follow on mainnet (here one member, threshold 1).
  //
  // BUG FIX (2026-09-24): `vaultTransactionCreate` is the ONE call of these
  // four whose `creator` is a PublicKey (the others take a Signer); passing
  // the Keypair crashed deep inside the SDK's compileToV0Message.
  async function runAsVault(multisigPda: PublicKey, vaultPda: PublicKey, transactionIndex: bigint, ix: anchor.web3.TransactionInstruction) {
    const transactionMessage = new TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await provider.connection.getLatestBlockhash()).blockhash,
      instructions: [ix],
    });
    await sendAndConfirm(multisig.rpc.vaultTransactionCreate({
      connection: provider.connection, feePayer: payer, multisigPda, transactionIndex,
      creator: payer.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage,
    }));
    await sendAndConfirm(multisig.rpc.proposalCreate({ connection: provider.connection, feePayer: payer, creator: payer, multisigPda, transactionIndex }));
    await sendAndConfirm(multisig.rpc.proposalApprove({ connection: provider.connection, feePayer: payer, member: payer, multisigPda, transactionIndex }));
    await sendAndConfirm(multisig.rpc.vaultTransactionExecute({ connection: provider.connection, feePayer: payer, multisigPda, transactionIndex, member: payer.publicKey }));
  }

  // Two-step authority rotation (2026-11-11, KNOWN_ISSUES K-3): this is the
  // mainnet handover (scripts/deploy-mainnet.sh) end to end — the deployer
  // proposes, the timelock passes, and the VAULT accepts through a real
  // Squads proposal. Then the vault hands governance back the same way.
  it("hands governance to a REAL Squads vault (propose -> timelock -> vault accepts via Squads) and back", async () => {
    await ensureGlobalConfig();
    const settingsPda = PublicKey.findProgramAddressSync([Buffer.from("gov_settings")], program.programId)[0];
    try {
      await program.methods.initializeGovernanceSettings(new anchor.BN(5), 1_000, payer.publicKey)
        .accounts({ config: globalConfigPda, governanceAuthority: payer.publicKey, settings: settingsPda, payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    } catch (e) { if (!String(e).includes("already in use")) throw e; }
    const actionPda = async () => {
      const st: any = await program.account.governanceSettings.fetch(settingsPda);
      return { pending: PublicKey.findProgramAddressSync([Buffer.from("gov_action"), new anchor.BN(st.nextActionId).toArrayLike(Buffer, "le", 8)], program.programId)[0], delay: Number(st.timelockDelaySecs) };
    };
    const wait = (secs: number) => new Promise((r) => setTimeout(r, (secs + 2) * 1000));

    // Single-member, threshold-1 — still a completely real Squads v4
    // multisig; ONE signer (payer) can propose, approve and execute.
    const { multisigPda, vaultPda } = await createRealMultisig(1);
    // the vault pays rent for the PendingAction it proposes in step 4
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vaultPda, lamports: 100_000_000 })), [payer]);

    const before = await program.account.globalConfig.fetch(globalConfigPda);
    const originalGovernanceAuthority = before.governanceAuthority as PublicKey;

    // Step 1 — the current governance (payer) proposes the vault.
    const toVault = await actionPda();
    await program.methods.proposeGovAction({ setGovernanceAuthority: { newAuthority: vaultPda } })
      .accounts({ config: globalConfigPda, governanceAuthority: payer.publicKey, settings: settingsPda, pending: toVault.pending, payer: payer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    await wait(toVault.delay);

    // Step 2 — the vault accepts, through a real Squads proposal.
    const acceptIx = await program.methods.acceptAuthority()
      .accounts({ config: globalConfigPda, newAuthority: vaultPda, pending: toVault.pending }).instruction();
    await runAsVault(multisigPda, vaultPda, 1n, acceptIx);
    const mid = await program.account.globalConfig.fetch(globalConfigPda);
    assert.isTrue((mid.governanceAuthority as PublicKey).equals(vaultPda), "the Squads-executed accept did not land");

    // Step 3 — THE happy-path proof this file exists for.
    await program.methods.verifyGovernanceMultisig(0).accounts({ config: globalConfigPda, squadsMultisig: multisigPda }).rpc();

    // Step 4 — hand back: the vault proposes (Squads), payer accepts.
    const back = await actionPda();
    const proposeIx = await program.methods.proposeGovAction({ setGovernanceAuthority: { newAuthority: originalGovernanceAuthority } })
      .accounts({ config: globalConfigPda, governanceAuthority: vaultPda, settings: settingsPda, pending: back.pending, payer: vaultPda, systemProgram: SystemProgram.programId }).instruction();
    await runAsVault(multisigPda, vaultPda, 2n, proposeIx);
    await wait(back.delay);
    await program.methods.acceptAuthority().accounts({ config: globalConfigPda, newAuthority: payer.publicKey, pending: back.pending }).rpc();

    const after = await program.account.globalConfig.fetch(globalConfigPda);
    assert.isTrue(
      (after.governanceAuthority as PublicKey).equals(originalGovernanceAuthority),
      "restore did not land — governance_authority is still the vault PDA, so this run's shared GlobalConfig " +
        "is stuck for any later test file (re-run from scratch; every run starts a new validator)."
    );
  });
});
