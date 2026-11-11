#!/usr/bin/env ts-node
// Governance OPS CLI (added 2026-09-24) — a real operational tool for
// calling this program's governance instructions against a REAL deployed
// program (devnet or mainnet-beta), signed by a REAL keypair or, more
// realistically, run once per member as part of building up a Squads
// proposal. This is NOT a test script — nothing here spins up a local
// validator or uses test fixtures; it talks to whatever cluster/wallet
// your Solana CLI config (or ANCHOR_PROVIDER_URL/ANCHOR_WALLET env vars)
// currently points at, exactly like any other Anchor CLI-adjacent tool.
//
// WRITTEN BLIND, NOT YET RUN AGAINST A REAL DEPLOYMENT: same caveat as
// everything else added this pass (see SECURITY.md) — this was authored
// without a live devnet/mainnet deployment to actually exercise it
// against. Try every subcommand against devnet first, read the printed
// output carefully, and only then trust it against mainnet-beta.
//
// SAFETY: every state-changing subcommand PRINTS what it is about to do
// and requires `--yes` to actually submit the transaction — running any
// subcommand without `--yes` is always a safe, read-only dry run that
// shows you the exact accounts/args it would use.
//
// Usage:
//   yarn ts-node scripts/governance.ts <command> [args...] [--yes]
//
// Commands:
//   status
//       Fetch and print GlobalConfig (governance_authority,
//       emergency_authority, pool_creation_paused) plus the program id and
//       cluster this CLI is currently pointed at. Always read-only.
//
//   init-global-config <governanceAuthority> <emergencyAuthority>
//       One-time bootstrap. Only ever works once per deployment.
//
//   --- Authority rotation: two steps (2026-11-11, KNOWN_ISSUES K-3) ---
//   (the old one-step `set-authorities` no longer exists on-chain)
//
//   propose-governance-authority <newGovernanceAuthority>
//       Governance-only. Queues SetGovernanceAuthority; the new key can
//       accept after the timelock (24-48 h on mainnet) and within 7 days.
//
//   propose-emergency-authority <newEmergencyAuthority>
//       Governance-only. Queues SetEmergencyAuthority with NO delay (a lost
//       or compromised emergency key must be replaceable at once).
//
//   accept-authority <actionId>
//       Signed by the NEW authority named in the action (it pays the fee:
//       fund it). If this wallet is
//       not that key (e.g. the new authority is a Squads vault), nothing is
//       sent: the command prints the exact instruction (program, accounts,
//       data) to put in a Squads proposal, plus the Squads steps.
//
//   cancel <actionId> (below) withdraws a pending rotation. Rotations
//   proposed by an earlier governance key cannot be accepted
//   (StaleAuthorityProposal); after a handover review `settings` and
//   cancel anything still pending that the new governance did not intend.
//
//   If the authority that must SIGN any command here is a Squads vault, the
//   command has to be wrapped in a Squads proposal (vaultTransactionCreate
//   -> proposalCreate -> 2 approvals -> vaultTransactionExecute, e.g. in the
//   Squads app); run it with --print-ix to get the instruction to wrap.
//
//   set-pool-creation-paused <true|false>
//       Governance-only global switch — stops ALL new pool creation
//       instantly, does not touch any existing pool.
//
//   set-allowed-mint <mintPubkey> <true|false> [trust-freeze]
//       Governance-only (full build: CP / DLMM). Enables/disables a mint for
//       NEW pool creation (existing pools using this mint are unaffected
//       either way). A mint with a freeze authority needs "trust-freeze"
//       (KNOWN_ISSUES K-1).
//
//   set-mint-feed <mintPubkey> <pythFeedIdHex>
//       Governance-only (added 2026-10-08). Registers the Pyth feed id
//       (64 hex chars, with or without 0x) for a mint. New CP/DLMM pools —
//       and oracle-enabled SWDMM v2 pools — must name exactly these feeds,
//       so nobody can create a pool for a mint with another asset's feed.
//       Can be called again to change it; existing pools keep their feeds.
//
//   emergency-pause-pool <mintA> <mintB> <pauseSwap> <pauseDeposit> <pauseWithdraw>
//   emergency-pause-dlmm-pool <mintA> <mintB> <pauseSwap> <pauseDeposit> <pauseWithdraw>
//       Emergency-authority-only, instant, pause-only. <mintA>/<mintB>
//       must be given in the SAME order the pool was created with (this
//       program has no canonical mint ordering — see SECURITY.md's design
//       notes). <pauseSwap>/<pauseDeposit>/<pauseWithdraw> are each
//       "true"/"false".
//
//   governed-unpause-pool <mintA> <mintB> <unpauseSwap> <unpauseDeposit> <unpauseWithdraw>
//   governed-unpause-dlmm-pool <mintA> <mintB> <unpauseSwap> <unpauseDeposit> <unpauseWithdraw>
//       Governance-only (NOT emergency_authority — see governance.rs's
//       module doc comment for why that split is deliberate).
//
//   --- Governance v2 (timelock.rs / swdmm_v2.rs, added 2026-09-29) ---
//
//   init-settings <timelockDelaySecs> <protocolFeeShareBps> <treasury>
//       One-time. Delay must be 5s-48h on a devnet build, 24h-48h on a
//       `--features mainnet` build. Share is capped at 2000 (20%).
//
//   settings
//       Read-only: GovernanceSettings plus every governance action and its
//       status (pending / ready / executed / cancelled).
//
//   set-mint-policy <mint> <true|false> [reviewed] [trust-freeze]
//       SWDMM v2 allowlist. Pass "reviewed" to confirm a Token-2022 mint
//       was reviewed (required to enable one). Pass "trust-freeze" to enable
//       a mint that HAS a freeze authority (e.g. USDC, USDT): its issuer can
//       freeze a pool vault and stop all withdrawals, so this is an explicit
//       governance decision (KNOWN_ISSUES K-1, runbook Gate 8). The dry run
//       prints the mint's freeze authority.
//
//   propose-unpause-cp   <mintA> <mintB> <swap> <deposit> <withdraw>
//   propose-unpause-dlmm <mintA> <mintB> <swap> <deposit> <withdraw>
//   propose-unpause-v2   <pool> <swap> <deposit> <withdraw>
//   propose-protocol-fee-share <bps>
//   propose-timelock-delay <secs>
//   propose-treasury <pubkey>
//   propose-v2-params <pool> <maxPriceImpactBps> <dynamicFeeEnabled>
//   propose-withdraw-protocol-fees <pool>
//       Governance-only: queue a timelocked action. Prints its id and the
//       earliest time it can be executed.
//
//   execute <actionId>
//       Anyone, after the delay. Builds the right accounts for the action
//       kind (for protocol-fee withdrawals it creates the treasury's token
//       accounts if needed).
//
//   cancel <actionId>
//       Governance-only, before execution.
//
//   emergency-cancel-unpause <actionId>
//       Emergency authority: cancel a pending propose-unpause-* action
//       (e.g. right after a new emergency pause). Other kinds: governance.
//
//   A matured action must be executed within 7 days (EXECUTION_GRACE_SECS
//   in timelock.rs) or it expires and has to be proposed again.
//
//   emergency-pause-v2-pool <pool> <pauseSwap> <pauseDeposit> <pauseWithdraw>
//
//   NOTE: governed-unpause-pool / governed-unpause-dlmm-pool below now
//   always fail on-chain (UseTimelockedUnpause) — use propose-unpause-*.
//
//   verify-multisig <squadsMultisigPubkey> <vaultIndex>
//       Permissionless, read-only in effect (emits an event, writes
//       nothing). Confirms the given Squads Multisig account's vault at
//       <vaultIndex> really is this program's current governance_authority
//       and prints that multisig's real threshold/member count. See
//       tests/z-squads-live-verification.ts for the same check exercised
//       against a real cloned Squads program in the test suite.
//
// Every subcommand accepts an optional trailing `--yes` to actually submit
// (state-changing ones only — `status` and `verify-multisig` always run),
// and `--print-ix` to print the instruction (for a Squads proposal) instead.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const GLOBAL_CONFIG_SEED = Buffer.from("global-config");
const ALLOWED_MINT_SEED = Buffer.from("allowed-mint");
const POOL_SEED = Buffer.from("pool");
const DLMM_POOL_SEED = Buffer.from("dlmm_pool"); // fixed 2026-09-29: the program seed is "dlmm_pool"
const GOV_SETTINGS_SEED = Buffer.from("gov_settings");
const GOV_ACTION_SEED = Buffer.from("gov_action");
const MINT_POLICY_SEED = Buffer.from("mint_policy");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function loadProgram(): anchor.Program<anchor.Idl> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idlPath = path.resolve(__dirname, "..", "target", "idl", "swd_amm.json");
  if (!fs.existsSync(idlPath)) {
    console.error(
      `Could not find ${idlPath} — run \`anchor build\` first (this CLI reads the IDL it generates, ` +
        `same as \`anchor test\` does).`
    );
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  // Anchor 0.30+ IDLs embed the program's address; older ones need it
  // passed explicitly. Prefer the embedded one so this CLI automatically
  // tracks whichever cluster's declare_id! you actually built against.
  const programId = new PublicKey(idl.address ?? idl.metadata?.address);
  return new anchor.Program(idl, provider) as anchor.Program<anchor.Idl>;
}

function pda(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function parseBool(raw: string | undefined, label: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  console.error(`Expected "true" or "false" for ${label}, got: ${raw}`);
  process.exit(1);
}

function parsePubkey(raw: string | undefined, label: string): PublicKey {
  if (!raw) {
    console.error(`Missing required argument: ${label}`);
    process.exit(1);
  }
  try {
    return new PublicKey(raw);
  } catch {
    console.error(`Not a valid pubkey for ${label}: ${raw}`);
    process.exit(1);
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const yes = rawArgs.includes("--yes");
  const printIx = rawArgs.includes("--print-ix");
  const args = rawArgs.filter((a) => a !== "--yes" && a !== "--print-ix");
  const [command, ...rest] = args;

  const program = loadProgram();
  const provider = program.provider as anchor.AnchorProvider;
  const wallet = provider.wallet.publicKey;
  const configPda = pda([GLOBAL_CONFIG_SEED], program.programId);
  const actionPda = (id: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(id));
    return pda([GOV_ACTION_SEED, b], program.programId);
  };

  console.log(`# swd-amm governance CLI`);
  console.log(`# cluster:    ${provider.connection.rpcEndpoint}`);
  console.log(`# program id: ${program.programId.toBase58()}`);
  console.log(`# wallet:     ${wallet.toBase58()}`);
  console.log(`# config PDA: ${configPda.toBase58()}`);
  console.log();

  // Prints an instruction in the form the Squads app's transaction builder
  // (and @sqds/multisig's vaultTransactionCreate) needs.
  function printInstruction(ix: anchor.web3.TransactionInstruction) {
    console.log("Instruction for a Squads proposal (signer = the vault):");
    console.log(`  program: ${ix.programId.toBase58()}`);
    ix.keys.forEach((k, i) => console.log(`  account ${i}: ${k.pubkey.toBase58()}${k.isSigner ? "  [signer]" : ""}${k.isWritable ? "  [writable]" : ""}`));
    console.log(`  data (hex):    ${Buffer.from(ix.data).toString("hex")}`);
    console.log(`  data (base58): ${anchor.utils.bytes.bs58.encode(ix.data)}`);
  }

  async function confirmOrDryRun(describe: () => void, submit: () => Promise<string>, builder?: any) {
    describe();
    if (printIx && builder) {
      console.log();
      printInstruction(await builder.instruction());
      return;
    }
    if (!yes) {
      console.log();
      console.log("(dry run — nothing was submitted. Re-run with --yes to actually send this transaction.)");
      return;
    }
    console.log();
    console.log("Submitting...");
    const sig = await submit();
    console.log(`Confirmed: ${sig}`);
  }

  switch (command) {
    case "status": {
      const config = await (program.account as any).globalConfig.fetch(configPda);
      console.log("GlobalConfig:");
      console.log(`  governance_authority: ${(config.governanceAuthority as PublicKey).toBase58()}`);
      console.log(`  emergency_authority:  ${(config.emergencyAuthority as PublicKey).toBase58()}`);
      console.log(`  pool_creation_paused: ${config.poolCreationPaused}`);
      break;
    }

    case "init-global-config": {
      const governanceAuthority = parsePubkey(rest[0], "governanceAuthority");
      const emergencyAuthority = parsePubkey(rest[1], "emergencyAuthority");
      await confirmOrDryRun(
        () => {
          console.log("Would call initialize_global_config with:");
          console.log(`  governance_authority: ${governanceAuthority.toBase58()}`);
          console.log(`  emergency_authority:  ${emergencyAuthority.toBase58()}`);
          console.log(`  payer (this wallet):  ${wallet.toBase58()}`);
        },
        () =>
          program.methods
            .initializeGlobalConfig(governanceAuthority, emergencyAuthority)
            .accounts({ config: configPda, programData: PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0], payer: wallet, systemProgram: SystemProgram.programId })
            .rpc()
      );
      break;
    }

    case "propose-governance-authority":
    case "propose-emergency-authority": {
      const isGov = command === "propose-governance-authority";
      const newAuthority = parsePubkey(rest[0], isGov ? "newGovernanceAuthority" : "newEmergencyAuthority");
      const config = await (program.account as any).globalConfig.fetch(configPda);
      const governance = config.governanceAuthority as PublicKey;
      const settingsPda = pda([GOV_SETTINGS_SEED], program.programId);
      const st: any = await (program.account as any).governanceSettings.fetch(settingsPda);
      const id = Number(st.nextActionId);
      const pending = actionPda(id);
      const action = isGov ? { setGovernanceAuthority: { newAuthority } } : { setEmergencyAuthority: { newAuthority } };
      const builder = program.methods
        .proposeGovAction(action)
        .accounts({ config: configPda, governanceAuthority: governance, settings: settingsPda, pending, payer: governance, systemProgram: SystemProgram.programId });
      await confirmOrDryRun(
        () => {
          console.log(`Would propose governance action #${id}: ${isGov ? "SetGovernanceAuthority" : "SetEmergencyAuthority"}`);
          console.log(`  new ${isGov ? "governance" : "emergency"} authority: ${newAuthority.toBase58()}`);
          console.log(`  current governance (must sign):   ${governance.toBase58()}`);
          console.log(`  current emergency:                ${(config.emergencyAuthority as PublicKey).toBase58()}`);
          console.log(isGov
            ? `  the new key can accept after ~${st.timelockDelaySecs.toString()}s (timelock) and within 7 days: accept-authority ${id}`
            : `  no delay: the new key can accept right away: accept-authority ${id}`);
          if (!governance.equals(wallet)) {
            console.log("  NOTE: this wallet is not the governance authority — submitting from here will fail. If governance is a");
            console.log("  Squads vault, re-run with --print-ix and put the instruction in a Squads proposal.");
          }
        },
        () => builder.rpc(),
        builder
      );
      break;
    }

    case "accept-authority": {
      const id = Number(rest[0]);
      const pending = actionPda(id);
      const a: any = await (program.account as any).pendingAction.fetch(pending);
      const kind = Object.keys(a.action)[0];
      if (kind !== "setGovernanceAuthority" && kind !== "setEmergencyAuthority") {
        console.error(`Action #${id} is ${kind}, not an authority rotation.`);
        process.exit(1);
      }
      const newAuthority = a.action[kind].newAuthority as PublicKey;
      const status = a.executed ? "already accepted" : a.cancelled ? "CANCELLED" : `executable from ${new Date(Number(a.executeAfter) * 1000).toISOString()} for 7 days`;
      const builder = program.methods.acceptAuthority().accounts({ config: configPda, newAuthority, pending });
      if (!newAuthority.equals(wallet)) {
        // The usual mainnet case: the new governance authority is the Squads vault.
        console.log(`Action #${id} (${kind}) names ${newAuthority.toBase58()} — not this wallet, so nothing is sent.`);
        console.log(`Status: ${status}. Proposed by ${(a.proposer as PublicKey).toBase58()} (must still be governance).`);
        console.log();
        printInstruction(await builder.instruction());
        console.log();
        console.log("If the new authority is a Squads vault (Squads app, after the timelock above):");
        console.log("  1. New transaction -> transaction builder / 'add instruction' with the program, accounts and data above");
        console.log("     (the vault is the only signer; no other signer may appear).");
        console.log("  2. Propose it, collect the threshold of member approvals (2 of 3), then Execute.");
        console.log("  3. Check: yarn governance status   (governance_authority must now be the vault)");
        console.log("     and:   yarn governance verify-multisig <MULTISIG_PDA> 0");
        console.log("If the new authority is a plain key (e.g. a new emergency key): run this command with that key as the wallet.");
        break;
      }
      await confirmOrDryRun(
        () => console.log(`Would accept action #${id} (${kind}) as ${newAuthority.toBase58()} — ${status}`),
        () => builder.rpc(),
        builder
      );
      break;
    }

    case "set-pool-creation-paused": {
      const paused = parseBool(rest[0], "paused");
      await confirmOrDryRun(
        () => console.log(`Would call set_pool_creation_paused(${paused})`),
        () =>
          program.methods
            .setPoolCreationPaused(paused)
            .accounts({ config: configPda, governanceAuthority: wallet })
            .rpc()
      );
      break;
    }

    case "set-allowed-mint": {
      const mint = parsePubkey(rest[0], "mintPubkey");
      const enabled = parseBool(rest[1], "enabled");
      const trustFreeze = rest[2] === "trust-freeze";
      const allowedMintPda = pda([ALLOWED_MINT_SEED, mint.toBuffer()], program.programId);
      await confirmOrDryRun(
        () => {
          console.log(`Would call set_allowed_mint(${enabled}, trust_freeze_authority=${trustFreeze}) for:`);
          console.log(`  mint:         ${mint.toBase58()}`);
          console.log(`  allowed_mint: ${allowedMintPda.toBase58()}`);
        },
        () =>
          program.methods
            .setAllowedMint(enabled, trustFreeze)
            .accounts({
              config: configPda,
              governanceAuthority: wallet,
              mint,
              allowedMint: allowedMintPda,
              payer: wallet,
              systemProgram: SystemProgram.programId,
            })
            .rpc()
      );
      break;
    }

    case "set-mint-feed": {
      const mint = parsePubkey(rest[0], "mintPubkey");
      const hex = (rest[1] ?? "").replace(/^0x/i, "");
      if (!/^[0-9a-fA-F]{64}$/.test(hex) || /^0+$/.test(hex)) {
        console.error("pythFeedIdHex must be 64 hex characters and not all zero.");
        process.exit(1);
      }
      const feedId = Array.from(Buffer.from(hex, "hex"));
      const mintFeedPda = pda([Buffer.from("mint-feed"), mint.toBuffer()], program.programId);
      await confirmOrDryRun(
        () => {
          console.log(`Would call set_mint_feed(0x${hex.toLowerCase()}) for:`);
          console.log(`  mint:      ${mint.toBase58()}`);
          console.log(`  mint_feed: ${mintFeedPda.toBase58()}`);
        },
        () =>
          program.methods
            .setMintFeed(feedId)
            .accounts({
              config: configPda,
              governanceAuthority: wallet,
              mint,
              mintFeed: mintFeedPda,
              payer: wallet,
              systemProgram: SystemProgram.programId,
            })
            .rpc()
      );
      break;
    }

    case "emergency-pause-pool":
    case "emergency-pause-dlmm-pool":
    case "governed-unpause-pool":
    case "governed-unpause-dlmm-pool": {
      const isDlmm = command.includes("dlmm");
      const isEmergency = command.startsWith("emergency");
      const mintA = parsePubkey(rest[0], "mintA");
      const mintB = parsePubkey(rest[1], "mintB");
      const flagSwap = parseBool(rest[2], isEmergency ? "pauseSwap" : "unpauseSwap");
      const flagDeposit = parseBool(rest[3], isEmergency ? "pauseDeposit" : "unpauseDeposit");
      const flagWithdraw = parseBool(rest[4], isEmergency ? "pauseWithdraw" : "unpauseWithdraw");

      const poolSeed = isDlmm ? DLMM_POOL_SEED : POOL_SEED;
      const poolPda = pda([poolSeed, mintA.toBuffer(), mintB.toBuffer()], program.programId);
      const authorityField = isEmergency ? "emergencyAuthority" : "governanceAuthority";
      const methodName = isEmergency
        ? isDlmm
          ? "emergencyPauseDlmmPool"
          : "emergencyPausePool"
        : isDlmm
          ? "governedUnpauseDlmmPool"
          : "governedUnpausePool";

      await confirmOrDryRun(
        () => {
          console.log(`Would call ${methodName}(${flagSwap}, ${flagDeposit}, ${flagWithdraw}) for:`);
          console.log(`  pool (${isDlmm ? "DLMM" : "constant-product"}): ${poolPda.toBase58()}`);
          console.log(`  mintA: ${mintA.toBase58()}`);
          console.log(`  mintB: ${mintB.toBase58()}`);
          console.log(`  ${authorityField} (signer): ${wallet.toBase58()}`);
        },
        () =>
          (program.methods as any)
            [methodName](flagSwap, flagDeposit, flagWithdraw)
            .accounts({ config: configPda, [authorityField]: wallet, pool: poolPda })
            .rpc()
      );
      break;
    }

    case "init-settings": {
      const delay = Number(rest[0]);
      const share = Number(rest[1]);
      const treasury = parsePubkey(rest[2], "treasury");
      const settings = pda([GOV_SETTINGS_SEED], program.programId);
      await confirmOrDryRun(
        () => console.log(`Would call initialize_governance_settings(delay=${delay}s, protocolFeeShare=${share}bps, treasury=${treasury.toBase58()})`),
        () =>
          program.methods
            .initializeGovernanceSettings(new anchor.BN(delay), share, treasury)
            .accounts({ config: configPda, governanceAuthority: wallet, settings, payer: wallet, systemProgram: SystemProgram.programId })
            .rpc()
      );
      break;
    }

    case "settings": {
      const settingsPda = pda([GOV_SETTINGS_SEED], program.programId);
      const st: any = await (program.account as any).governanceSettings.fetchNullable(settingsPda);
      if (!st) {
        console.log("GovernanceSettings not initialized yet — run init-settings.");
        break;
      }
      console.log("GovernanceSettings:");
      console.log(`  timelock_delay_secs:    ${st.timelockDelaySecs.toString()}`);
      console.log(`  protocol_fee_share_bps: ${st.protocolFeeShareBps}`);
      console.log(`  treasury:               ${st.treasury.toBase58()}`);
      console.log(`  actions proposed:       ${st.nextActionId.toString()}`);
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < Number(st.nextActionId); i++) {
        const a: any = await (program.account as any).pendingAction.fetchNullable(actionPda(i));
        if (!a) continue;
        const status = a.executed ? "executed" : a.cancelled ? "cancelled" : now > Number(a.executeAfter) + 7 * 24 * 3600 ? "EXPIRED" : now >= Number(a.executeAfter) ? "READY" : `pending until ${new Date(Number(a.executeAfter) * 1000).toISOString()}`;
        console.log(`  #${i} ${JSON.stringify(a.action, (_k, v) => (v instanceof PublicKey ? v.toBase58() : v))} — ${status}`);
      }
      break;
    }

    case "set-mint-policy": {
      const mint = parsePubkey(rest[0], "mint");
      const enabled = parseBool(rest[1], "enabled");
      const flags = rest.slice(2);
      const reviewed = flags.includes("reviewed");
      const trustFreeze = flags.includes("trust-freeze");
      const info = await provider.connection.getAccountInfo(mint);
      if (!info) { console.error("Mint not found on this cluster."); process.exit(1); }
      const tokenProgram = info.owner;
      // SPL mint layout (both token programs): freeze_authority COption at bytes 46..82.
      const freezeAuthority = info.data.length >= 82 && info.data.readUInt32LE(46) === 1 ? new PublicKey(info.data.subarray(50, 82)) : null;
      const mintPolicy = pda([MINT_POLICY_SEED, mint.toBuffer()], program.programId);
      const config = await (program.account as any).globalConfig.fetch(configPda);
      const governance = config.governanceAuthority as PublicKey;
      const builder = program.methods
        .setMintPolicy(enabled, reviewed, trustFreeze)
        .accounts({ config: configPda, governanceAuthority: governance, mint, tokenProgram, mintPolicy, payer: governance, systemProgram: SystemProgram.programId });
      await confirmOrDryRun(
        () => {
          console.log(`Would call set_mint_policy(enabled=${enabled}, token_2022_reviewed=${reviewed}, trust_freeze_authority=${trustFreeze}) for ${mint.toBase58()} (token program ${tokenProgram.toBase58()})`);
          console.log(`  freeze authority: ${freezeAuthority ? freezeAuthority.toBase58() : "none"}`);
          if (enabled && freezeAuthority && !trustFreeze) {
            console.log("  WARNING: this mint has a freeze authority; the program refuses it (FreezeAuthorityNotTrusted) unless you");
            console.log("  pass trust-freeze — only for issuers governance trusts not to freeze pool vaults (runbook Gate 8).");
          }
        },
        () => builder.rpc(),
        builder
      );
      break;
    }

    case "propose-unpause-cp":
    case "propose-unpause-dlmm":
    case "propose-unpause-v2":
    case "propose-protocol-fee-share":
    case "propose-timelock-delay":
    case "propose-treasury":
    case "propose-v2-params":
    case "propose-withdraw-protocol-fees": {
      let action: any;
      if (command === "propose-unpause-cp" || command === "propose-unpause-dlmm") {
        const mintA = parsePubkey(rest[0], "mintA");
        const mintB = parsePubkey(rest[1], "mintB");
        const seed = command === "propose-unpause-cp" ? POOL_SEED : DLMM_POOL_SEED;
        const pool = pda([seed, mintA.toBuffer(), mintB.toBuffer()], program.programId);
        const body = { pool, swap: parseBool(rest[2], "swap"), deposit: parseBool(rest[3], "deposit"), withdraw: parseBool(rest[4], "withdraw") };
        action = command === "propose-unpause-cp" ? { unpauseCpPool: body } : { unpauseDlmmPool: body };
      } else if (command === "propose-unpause-v2") {
        action = { unpauseV2Pool: { pool: parsePubkey(rest[0], "pool"), swap: parseBool(rest[1], "swap"), deposit: parseBool(rest[2], "deposit"), withdraw: parseBool(rest[3], "withdraw") } };
      } else if (command === "propose-protocol-fee-share") {
        action = { setProtocolFeeShare: { bps: Number(rest[0]) } };
      } else if (command === "propose-timelock-delay") {
        action = { setTimelockDelay: { secs: new anchor.BN(Number(rest[0])) } };
      } else if (command === "propose-treasury") {
        action = { setTreasury: { treasury: parsePubkey(rest[0], "treasury") } };
      } else if (command === "propose-v2-params") {
        action = { setV2PoolParams: { pool: parsePubkey(rest[0], "pool"), maxPriceImpactBps: Number(rest[1]), dynamicFeeEnabled: parseBool(rest[2], "dynamicFeeEnabled") } };
      } else {
        action = { withdrawV2ProtocolFees: { pool: parsePubkey(rest[0], "pool") } };
      }
      const settingsPda = pda([GOV_SETTINGS_SEED], program.programId);
      const st: any = await (program.account as any).governanceSettings.fetch(settingsPda);
      const id = Number(st.nextActionId);
      const pending = actionPda(id);
      const config = await (program.account as any).globalConfig.fetch(configPda);
      const governance = config.governanceAuthority as PublicKey;
      const builder = program.methods
        .proposeGovAction(action)
        .accounts({ config: configPda, governanceAuthority: governance, settings: settingsPda, pending, payer: governance, systemProgram: SystemProgram.programId });
      await confirmOrDryRun(
        () => {
          console.log(`Would propose governance action #${id}:`);
          console.log(`  ${JSON.stringify(action, (_k, v) => (v instanceof PublicKey ? v.toBase58() : v))}`);
          console.log(`  executable after ~${st.timelockDelaySecs.toString()}s (timelock)`);
        },
        () => builder.rpc(),
        builder
      );
      break;
    }

    case "execute":
    case "cancel": {
      const id = Number(rest[0]);
      const pending = actionPda(id);
      const a: any = await (program.account as any).pendingAction.fetch(pending);
      const kind = Object.keys(a.action)[0];
      const body = a.action[kind];
      if (command === "cancel") {
        const config = await (program.account as any).globalConfig.fetch(configPda);
        const builder = program.methods.cancelGovAction().accounts({ config: configPda, governanceAuthority: config.governanceAuthority, pending });
        await confirmOrDryRun(
          () => console.log(`Would cancel action #${id} (${kind})`),
          () => builder.rpc(),
          builder
        );
        break;
      }
      if (kind === "setGovernanceAuthority" || kind === "setEmergencyAuthority") {
        console.error(`Action #${id} is an authority rotation: the new key accepts it with  accept-authority ${id}`);
        process.exit(1);
      }
      const settingsPda = pda([GOV_SETTINGS_SEED], program.programId);
      let builder: any;
      if (kind === "unpauseCpPool") builder = program.methods.executeUnpausePool().accounts({ pending, pool: body.pool });
      else if (kind === "unpauseDlmmPool") builder = program.methods.executeUnpauseDlmmPool().accounts({ pending, pool: body.pool });
      else if (kind === "unpauseV2Pool" || kind === "setV2PoolParams") builder = program.methods.executeV2PoolAction().accounts({ pending, pool: body.pool });
      else if (kind === "withdrawV2ProtocolFees") {
        const st: any = await (program.account as any).governanceSettings.fetch(settingsPda);
        const pool: any = await (program.account as any).swdmmV2Pool.fetch(body.pool);
        const ataOf = (mint: PublicKey, owner: PublicKey, prog: PublicKey) =>
          PublicKey.findProgramAddressSync([owner.toBuffer(), prog.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
        const ta = ataOf(pool.mintA, st.treasury, pool.tokenProgramA);
        const tb = ataOf(pool.mintB, st.treasury, pool.tokenProgramB);
        const createAta = (ata: PublicKey, mint: PublicKey, prog: PublicKey) => new anchor.web3.TransactionInstruction({
          programId: ATA_PROGRAM,
          keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: ata, isSigner: false, isWritable: true },
            { pubkey: st.treasury, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: prog, isSigner: false, isWritable: false },
          ],
          data: Buffer.from([1]), // CreateIdempotent
        });
        builder = program.methods.executeWithdrawProtocolFees()
          .accounts({ pending, settings: settingsPda, pool: body.pool, mintA: pool.mintA, mintB: pool.mintB, vaultA: pool.vaultA, vaultB: pool.vaultB, treasuryTokenA: ta, treasuryTokenB: tb, tokenProgramA: pool.tokenProgramA, tokenProgramB: pool.tokenProgramB })
          .preInstructions([createAta(ta, pool.mintA, pool.tokenProgramA), createAta(tb, pool.mintB, pool.tokenProgramB)]);
      } else builder = program.methods.executeSettingsAction().accounts({ pending, settings: settingsPda });
      await confirmOrDryRun(
        () => console.log(`Would execute action #${id} (${kind}); earliest execution ${new Date(Number(a.executeAfter) * 1000).toISOString()}`),
        () => builder.rpc()
      );
      break;
    }

    case "emergency-cancel-unpause": {
      const id = Number(rest[0]);
      const pending = actionPda(id);
      await confirmOrDryRun(
        () => console.log(`Would cancel unpause action #${id} (signer must be emergency_authority)`),
        () => program.methods.emergencyCancelUnpause().accounts({ config: configPda, emergencyAuthority: wallet, pending }).rpc()
      );
      break;
    }

    case "emergency-pause-v2-pool": {
      const pool = parsePubkey(rest[0], "pool");
      const f = [parseBool(rest[1], "pauseSwap"), parseBool(rest[2], "pauseDeposit"), parseBool(rest[3], "pauseWithdraw")];
      await confirmOrDryRun(
        () => console.log(`Would call emergency_pause_v2_pool(${f.join(", ")}) on ${pool.toBase58()} (signer must be emergency_authority)`),
        () => program.methods.emergencyPauseV2Pool(f[0], f[1], f[2]).accounts({ config: configPda, emergencyAuthority: wallet, pool }).rpc()
      );
      break;
    }

    case "verify-multisig": {
      const squadsMultisig = parsePubkey(rest[0], "squadsMultisigPubkey");
      const vaultIndex = Number(rest[1] ?? "0");
      console.log(`Calling verify_governance_multisig(vault_index=${vaultIndex}) for ${squadsMultisig.toBase58()}...`);
      console.log("(permissionless + read-only in effect — this always submits, no --yes needed)");
      const sig = await program.methods
        .verifyGovernanceMultisig(vaultIndex)
        .accounts({ config: configPda, squadsMultisig })
        .rpc();
      console.log(`Confirmed: ${sig}`);
      const tx = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages ?? [];
      const parser = new anchor.EventParser(program.programId, new anchor.BorshCoder(program.idl));
      const ev = Array.from(parser.parseLogs(logs)).find((e) => e.name === "governanceMultisigVerified" || e.name === "GovernanceMultisigVerified");
      if (ev) {
        const d: any = ev.data;
        console.log("GovernanceMultisigVerified:");
        console.log(`  squads_multisig:      ${d.squadsMultisig?.toBase58?.() ?? d.squads_multisig?.toBase58?.()}`);
        console.log(`  governance_authority: ${(d.governanceAuthority ?? d.governance_authority)?.toBase58?.()}`);
        console.log(`  threshold:            ${d.threshold} of ${d.memberCount ?? d.member_count}`);
      } else {
        console.log("(no GovernanceMultisigVerified event found in this transaction's logs — check the signature on an explorer)");
      }
      break;
    }

    default:
      console.error(
        `Unknown or missing command: ${command ?? "(none)"}\n\n` +
          `Run with no arguments to see this file's own header comment for the full command list, or open ` +
          `scripts/governance.ts directly.`
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
