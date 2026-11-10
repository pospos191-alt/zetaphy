/// <reference lib="es2020.bigint" />
// Test suite for SWD Quantum (programs/swd_quantum — quantum-safe vaults and
// the PQ key commitment registry, see docs/SWD_QUANTUM.md).
//
// STATUS (2026-11-09): written for `anchor test` (CI's "program" job runs it
// on a local validator). The LM-OTS math and the message layout have their
// own tests: `cargo test -p swd_quantum` and, in
// integrations/swd-quantum-ts, `npm test` (shared golden vectors).
//
// Every signature here is a REAL one-time signature made with the
// off-chain library (integrations/swd-quantum-ts) — the same code a wallet
// uses — and every spend transaction is a normal legacy transaction (no
// lookup tables, no signature buffer account). Compute units and
// transaction sizes are printed as "[measure]" lines.

import * as anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotent,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMint,
  ExtensionType,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  transferChecked,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { assert } from "chai";
import { randomBytes } from "crypto";
import * as q from "../integrations/swd-quantum-ts/src";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const connection: Connection = provider.connection;
const payer: Keypair = (provider.wallet as anchor.Wallet).payer;
// The program id comes from the workspace (CI rewrites declare_id! to a throwaway key).
const programId: PublicKey = anchor.workspace.SwdQuantum.programId;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const measured: string[] = [];
const measure = (line: string) => {
  measured.push(line);
  console.log(`      [measure] ${line}`);
};

async function send(ixs: TransactionInstruction[], signers: Keypair[] = [payer]): Promise<{ sig: string; cu: number; size: number }> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const raw = tx.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: true });
  const res = await connection.confirmTransaction(sig, "confirmed");
  const info = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (res.value.err) {
    const e: any = new Error(`tx failed: ${JSON.stringify(res.value.err)}\n${(info?.meta?.logMessages ?? []).join("\n")}`);
    e.logs = info?.meta?.logMessages ?? [];
    throw e;
  }
  return { sig, cu: info?.meta?.computeUnitsConsumed ?? 0, size: raw.length };
}

async function expectError(p: Promise<unknown>, needle: string) {
  try {
    await p;
  } catch (e: any) {
    const text = `${e?.message ?? e}\n${(e?.logs ?? []).join("\n")}`;
    assert.include(text, needle, `expected "${needle}" in:\n${text}`);
    return;
  }
  assert.fail(`expected failure "${needle}"`);
}

async function fundedKeypair(sol = 2): Promise<Keypair> {
  const k = Keypair.generate();
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: sol * LAMPORTS_PER_SOL })]);
  return k;
}

async function vaultState(vault: PublicKey): Promise<q.VaultState> {
  const ai = await connection.getAccountInfo(vault, "confirmed");
  assert.ok(ai, "vault exists");
  assert.ok(ai!.owner.equals(programId));
  return q.decodeVault(ai!.data);
}

async function waitNextSlot(after: bigint) {
  for (let i = 0; i < 50; i++) {
    if (BigInt(await connection.getSlot("confirmed")) > after) return;
    await sleep(200);
  }
}

/** A fresh vault from a fresh random master seed, opened by `payer`. */
async function newVault() {
  const master = new Uint8Array(randomBytes(32));
  const v = q.vaultFromSeed(master, 0, programId);
  await send([q.openVaultIx({ payer: payer.publicKey, id: v.keys.id, key: v.genesisKey, programId })]);
  const st = await vaultState(v.address);
  await waitNextSlot(st.openedSlot);
  return { master, ...v };
}

// A tampered signature walks other chain lengths than the honest one, so it
// may need more compute than the honest limit; give it the maximum so the
// test sees the program's verdict (BadSignature), not a budget error.
const maxCu = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

function replaceData(ix: TransactionInstruction, patch: (d: Buffer) => void): TransactionInstruction {
  const data = Buffer.from(ix.data);
  patch(data);
  return new TransactionInstruction({ programId: ix.programId, keys: ix.keys.map((k) => ({ ...k })), data });
}

describe("swd_quantum: quantum vault (LM-OTS N24_W8)", () => {
  let V: Awaited<ReturnType<typeof newVault>>;
  const dest = Keypair.generate().publicKey;

  it("opens a vault at the PDA of (I, K0); a second open fails", async () => {
    V = await newVault();
    const st = await vaultState(V.address);
    assert.equal(st.seq, 0);
    assert.deepEqual(Buffer.from(st.key), Buffer.from(V.genesisKey));
    assert.deepEqual(Buffer.from(st.id), Buffer.from(V.keys.id));
    await expectError(
      send([q.openVaultIx({ payer: payer.publicKey, id: V.keys.id, key: V.genesisKey, programId })]),
      "already in use",
    );
    const rent = await connection.getMinimumBalanceForRentExemption(q.VAULT_ACCOUNT_SIZE);
    assert.equal((await connection.getBalance(V.address, "confirmed")), rent);
    measure(`vault account ${q.VAULT_ACCOUNT_SIZE} bytes, rent ${rent} lamports (${rent / LAMPORTS_PER_SOL} SOL), paid once, stays in the vault`);
  });

  it("refuses any signed action in the slot the vault was opened (opened_slot binding)", async () => {
    const master = new Uint8Array(randomBytes(32));
    const v = q.vaultFromSeed(master, 0, programId);
    const fake = { c: new Uint8Array(24), y: Array.from({ length: 26 }, () => new Uint8Array(24)) };
    await expectError(
      send([
        q.openVaultIx({ payer: payer.publicKey, id: v.keys.id, key: v.genesisKey, programId }),
        q.spendSolIx({ vault: v.address, destination: dest, signature: fake, amount: 1, nextKey: q.publicKey(v.keys, 1), programId }),
      ]),
      "TooSoon",
    );
  });

  it("takes SOL deposits (instruction and plain transfer)", async () => {
    await send([q.depositSolIx({ depositor: payer.publicKey, vault: V.address, lamports: 2 * LAMPORTS_PER_SOL, programId })]);
    await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: V.address, lamports: LAMPORTS_PER_SOL / 2 })]);
    const rent = await connection.getMinimumBalanceForRentExemption(q.VAULT_ACCOUNT_SIZE);
    assert.equal(await connection.getBalance(V.address, "confirmed"), rent + 2.5 * LAMPORTS_PER_SOL);
  });

  it("spend_sol: a valid one-time signature moves exactly the amount and rotates the key; any fee payer works", async () => {
    const st = await vaultState(V.address);
    const prep = q.prepareSpendSol({ keys: V.keys, vault: V.address, state: st, destination: dest, lamports: 0.7 * LAMPORTS_PER_SOL, programId });
    const relayer = await fundedKeypair(1); // an unrelated wallet pays the fee
    const r = await send(prep.instructions, [relayer]);
    assert.equal(await connection.getBalance(dest, "confirmed"), 0.7 * LAMPORTS_PER_SOL);
    const after = await vaultState(V.address);
    assert.equal(after.seq, 1);
    assert.deepEqual(Buffer.from(after.key), Buffer.from(q.publicKey(V.keys, 1)));
    measure(`spend_sol: ${r.cu} CU for ${prep.signature.verifyHashes} chain hashes (limit requested ${prep.computeUnits}), tx ${r.size} bytes`);
    (V as any).lastSpend = prep;
  });

  it("replay of a used signature fails (key rotated)", async () => {
    const prep = (V as any).lastSpend as q.PreparedSpend;
    // its next key is now the current key, so the reuse check fires first;
    // with that check out of the way, the signature itself no longer verifies
    await expectError(send(prep.instructions), "KeyReuse");
  });

  it("malleability: changing the amount, destination, next key, C or a chain value breaks the signature", async () => {
    const st = await vaultState(V.address);
    const prep = q.prepareSpendSol({ keys: V.keys, vault: V.address, state: st, destination: dest, lamports: 1000, programId });
    const ix = prep.instructions[1];
    const cb = maxCu();
    // data layout: disc(8) C(24) y(624) amount(8) next(24)
    await expectError(send([cb, replaceData(ix, (d) => d.writeBigUInt64LE(BigInt(2000), 656))]), "BadSignature");
    await expectError(send([cb, replaceData(ix, (d) => (d[8] ^= 1))]), "BadSignature");
    await expectError(send([cb, replaceData(ix, (d) => (d[100] ^= 1))]), "BadSignature");
    await expectError(send([cb, replaceData(ix, (d) => (d[664] ^= 1))]), "BadSignature");
    const other = Keypair.generate().publicKey;
    const swapped = new TransactionInstruction({ programId, keys: [ix.keys[0], { ...ix.keys[1], pubkey: other }], data: ix.data });
    await expectError(send([cb, swapped]), "BadSignature");
    // the honest one still goes through afterwards (the key was never rotated by the failures)
    await send(prep.instructions);
    assert.equal((await vaultState(V.address)).seq, 2);
  });

  it("refuses next key = current key / first key / zero (one-time key rule)", async () => {
    const st = await vaultState(V.address);
    const fake = { c: new Uint8Array(24), y: Array.from({ length: 26 }, () => new Uint8Array(24)) };
    const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
    for (const [k, err] of [
      [st.key, "KeyReuse"],
      [V.genesisKey, "KeyReuse"],
      [new Uint8Array(24), "BadKey"],
    ] as [Uint8Array, string][]) {
      await expectError(send([cu, q.spendSolIx({ vault: V.address, destination: dest, signature: fake, amount: 1, nextKey: k, programId })]), err);
    }
  });

  it("a signature for another vault or by another seed does not verify", async () => {
    const st = await vaultState(V.address);
    const W = await newVault();
    await send([q.depositSolIx({ depositor: payer.publicKey, vault: W.address, lamports: LAMPORTS_PER_SOL / 10, programId })]);
    // a correct signature for V, sent against W (same seq 0 is not even the issue: vault address is bound)
    const forV = q.prepareSpendSol({ keys: V.keys, vault: V.address, state: st, destination: dest, lamports: 1000, programId });
    const atW = new TransactionInstruction({ programId, keys: [{ ...forV.instructions[1].keys[0], pubkey: W.address }, forV.instructions[1].keys[1]], data: forV.instructions[1].data });
    await expectError(send([maxCu(), atW]), "BadSignature");
    // the wrong seed is caught by the library before anything is signed
    assert.throws(() => q.prepareSpendSol({ keys: q.vaultKeys(W.master, 1), vault: W.address, state: st, destination: dest, lamports: 1, programId }));
    // (V's key seq=2 signed a message above that never landed — in real use, re-send THAT
    //  signature instead of signing anything else with the same key; here V is a test vault.)
    await send(forV.instructions);
  });

  it("keeps the rent-exempt minimum: everything above it can leave, one lamport more cannot", async () => {
    const st = await vaultState(V.address);
    const rent = await connection.getMinimumBalanceForRentExemption(q.VAULT_ACCOUNT_SIZE);
    const bal = await connection.getBalance(V.address, "confirmed");
    const tooMuch = q.prepareSpendSol({ keys: V.keys, vault: V.address, state: st, destination: dest, lamports: bal - rent + 1, programId });
    await expectError(send(tooMuch.instructions), "InsufficientFunds");
    // test-only: a different message with the same key (see the note above)
    const all = q.prepareSpendSol({ keys: V.keys, vault: V.address, state: st, destination: dest, lamports: bal - rent, programId });
    await send(all.instructions);
    assert.equal(await connection.getBalance(V.address, "confirmed"), rent);
  });

  it("measures verification cost across signatures (CU per chain hash)", async () => {
    const S = await newVault();
    await send([q.depositSolIx({ depositor: payer.publicKey, vault: S.address, lamports: LAMPORTS_PER_SOL, programId })]);
    const pts: [number, number][] = [];
    for (const tries of [1, 1, 16, 4096]) {
      const st = await vaultState(S.address);
      const prep = q.prepareSpendSol({ keys: S.keys, vault: S.address, state: st, destination: dest, lamports: 1000 + pts.length, programId, tries });
      const r = await send(prep.instructions);
      pts.push([prep.signature.verifyHashes, r.cu]);
      measure(`spend_sol tries=${tries}: ${prep.signature.verifyHashes} hashes -> ${r.cu} CU`);
    }
    const [a, b] = [pts.reduce((m, p) => (p[0] < m[0] ? p : m)), pts.reduce((m, p) => (p[0] > m[0] ? p : m))];
    if (b[0] > a[0]) {
      const per = (b[1] - a[1]) / (b[0] - a[0]);
      const fixed = a[1] - per * a[0];
      // cost = 255 * (floor(checksum / 256) + 2) hashes; checksum <= 6120, so at most 6375
      const worst = Math.round(fixed + per * 6375);
      measure(`fit: ~${per.toFixed(1)} CU per chain hash + ~${Math.round(fixed)} CU fixed; theoretical worst case (6375 hashes, a signer that does not grind) ~${worst} CU of the 1,400,000 limit`);
      assert.isAtLeast(q.spendComputeUnits(6375, false), worst, "the library's limit covers the worst case");
      assert.isBelow(worst, 1_400_000);
    }
  });
});

describe("swd_quantum: tokens in the vault (SPL Token and Token-2022)", () => {
  let V: Awaited<ReturnType<typeof newVault>>;
  let swd: PublicKey; // a classic SPL Token mint with 5 decimals, like SWD
  let payerSwd: PublicKey;
  let recipient: Keypair;
  let recipientSwd: PublicKey;

  before(async () => {
    V = await newVault();
    swd = await createMint(connection, payer, payer.publicKey, null, 5, undefined, { commitment: "confirmed" });
    payerSwd = await createAssociatedTokenAccountIdempotent(connection, payer, swd, payer.publicKey, { commitment: "confirmed" });
    await mintTo(connection, payer, swd, payerSwd, payer, 1_000_000_00000, [], { commitment: "confirmed" });
    recipient = Keypair.generate();
    recipientSwd = await createAssociatedTokenAccountIdempotent(connection, payer, swd, recipient.publicKey, { commitment: "confirmed" });
  });

  it("deposit_token creates the vault's ATA and records exactly the amount", async () => {
    const r = await send([q.depositTokenIx({ depositor: payer.publicKey, vault: V.address, mint: swd, from: payerSwd, amount: 10_000_00000, programId })]);
    const ata = q.associatedTokenAddress(V.address, swd);
    assert.ok(ata.equals(getAssociatedTokenAddressSync(swd, V.address, true)));
    assert.equal((await getAccount(connection, ata, "confirmed")).amount, BigInt(10_000_00000));
    measure(`deposit_token (incl. ATA creation): ${r.cu} CU, tx ${r.size} bytes`);
  });

  it("spend_token moves exactly the amount, binds mint / token program / accounts", async () => {
    const st = await vaultState(V.address);
    const prep = q.prepareSpendToken({ keys: V.keys, vault: V.address, state: st, mint: swd, destination: recipientSwd, amount: 2_500_00000, programId });
    const r = await send(prep.instructions);
    assert.equal((await getAccount(connection, recipientSwd, "confirmed")).amount, BigInt(2_500_00000));
    assert.equal((await getAccount(connection, q.associatedTokenAddress(V.address, swd), "confirmed")).amount, BigInt(7_500_00000));
    measure(`spend_token: ${r.cu} CU for ${prep.signature.verifyHashes} chain hashes (limit requested ${prep.computeUnits}), tx ${r.size} bytes`);
    await expectError(send(prep.instructions), "KeyReuse"); // replay
  });

  it("refuses a wrong mint, a wrong destination, a wrong token program, an attacker's source", async () => {
    const st = await vaultState(V.address);
    const prep = q.prepareSpendToken({ keys: V.keys, vault: V.address, state: st, mint: swd, destination: recipientSwd, amount: 1_00000, programId });
    const ix = prep.instructions[1];
    const cb = maxCu();
    const keys = (i: number, pk: PublicKey) => ix.keys.map((k, j) => (j === i ? { ...k, pubkey: pk } : { ...k }));
    // another mint (and accounts of it) -> constraint or signature failure
    const other = await createMint(connection, payer, payer.publicKey, null, 5, undefined, { commitment: "confirmed" });
    await expectError(send([cb, new TransactionInstruction({ programId, keys: keys(1, other), data: ix.data })]), "ConstraintTokenMint");
    // another SWD account of the attacker as destination
    const attacker = Keypair.generate();
    const attackerSwd = await createAssociatedTokenAccountIdempotent(connection, payer, swd, attacker.publicKey, { commitment: "confirmed" });
    await expectError(send([cb, new TransactionInstruction({ programId, keys: keys(3, attackerSwd), data: ix.data })]), "BadSignature");
    // Token-2022 program id with classic accounts
    await expectError(send([cb, new TransactionInstruction({ programId, keys: keys(4, TOKEN_2022_PROGRAM_ID), data: ix.data })]), "Error");
    // a source token account not owned by the vault
    await expectError(send([cb, new TransactionInstruction({ programId, keys: keys(2, payerSwd), data: ix.data })]), "ConstraintTokenOwner");
    await send(prep.instructions);
  });

  it("full withdrawal with FLAG_CLOSE_SOURCE closes the vault's token account INTO the vault", async () => {
    const st = await vaultState(V.address);
    const ata = q.associatedTokenAddress(V.address, swd);
    const left = (await getAccount(connection, ata, "confirmed")).amount;
    const ataRent = await connection.getBalance(ata, "confirmed");
    const before = await connection.getBalance(V.address, "confirmed");
    // closing while tokens remain is refused
    const partial = q.prepareSpendToken({ keys: V.keys, vault: V.address, state: st, mint: swd, destination: recipientSwd, amount: left - BigInt(1), closeSource: true, programId });
    await expectError(send(partial.instructions), "SourceNotEmpty");
    const prep = q.prepareSpendToken({ keys: V.keys, vault: V.address, state: st, mint: swd, destination: recipientSwd, amount: left, closeSource: true, programId });
    const r = await send(prep.instructions);
    assert.isNull(await connection.getAccountInfo(ata, "confirmed"));
    assert.equal(await connection.getBalance(V.address, "confirmed"), before + ataRent);
    measure(`spend_token + close source: ${r.cu} CU; token account rent ${ataRent} lamports returned into the vault`);
  });

  async function token2022Mint(exts: ExtensionType[], init: (mint: PublicKey) => TransactionInstruction[]): Promise<PublicKey> {
    const mint = Keypair.generate();
    const len = getMintLen(exts);
    const lamports = await connection.getMinimumBalanceForRentExemption(len);
    await send(
      [
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: len, lamports, programId: TOKEN_2022_PROGRAM_ID }),
        ...init(mint.publicKey),
        createInitializeMintInstruction(mint.publicKey, 6, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
      ],
      [payer, mint],
    );
    return mint.publicKey;
  }

  async function fund2022(mint: PublicKey, owner: PublicKey, amount: number) {
    const ata = await createAssociatedTokenAccountIdempotent(connection, payer, mint, owner, { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
    await mintTo(connection, payer, mint, ata, payer, amount, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
    return ata;
  }

  it("Token-2022 with an allowed extension (metadata pointer): deposit and spend work", async () => {
    const mint = await token2022Mint([ExtensionType.MetadataPointer], (m) => [
      createInitializeMetadataPointerInstruction(m, payer.publicKey, m, TOKEN_2022_PROGRAM_ID),
    ]);
    const from = await fund2022(mint, payer.publicKey, 1_000_000);
    await send([q.depositTokenIx({ depositor: payer.publicKey, vault: V.address, mint, from, amount: 400_000, tokenProgram: TOKEN_2022_PROGRAM_ID, programId })]);
    const st = await vaultState(V.address);
    const prep = q.prepareSpendToken({ keys: V.keys, vault: V.address, state: st, mint, destination: from, amount: 150_000, tokenProgram: TOKEN_2022_PROGRAM_ID, programId });
    const r = await send(prep.instructions);
    assert.equal((await getAccount(connection, q.associatedTokenAddress(V.address, mint, TOKEN_2022_PROGRAM_ID), "confirmed", TOKEN_2022_PROGRAM_ID)).amount, BigInt(250_000));
    measure(`spend_token (Token-2022): ${r.cu} CU, tx ${r.size} bytes`);
  });

  it("Token-2022 transfer fee: deposit refused; tokens sent around the program cannot leave short (PartialTransfer)", async () => {
    const mint = await token2022Mint([ExtensionType.TransferFeeConfig], (m) => [
      createInitializeTransferFeeConfigInstruction(m, payer.publicKey, payer.publicKey, 100, BigInt(1_000_000), TOKEN_2022_PROGRAM_ID),
    ]);
    const from = await fund2022(mint, payer.publicKey, 1_000_000);
    await expectError(
      send([q.depositTokenIx({ depositor: payer.publicKey, vault: V.address, mint, from, amount: 1000, tokenProgram: TOKEN_2022_PROGRAM_ID, programId })]),
      "UnsupportedMint",
    );
    const vaultAta = await createAssociatedTokenAccountIdempotent(connection, payer, mint, V.address, { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID, undefined, true);
    await transferChecked(connection, payer, from, mint, vaultAta, payer, 100_000, 6, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
    const st = await vaultState(V.address);
    const prep = q.prepareSpendToken({ keys: V.keys, vault: V.address, state: st, mint, destination: from, amount: 10_000, tokenProgram: TOKEN_2022_PROGRAM_ID, programId });
    await expectError(send(prep.instructions), "PartialTransfer");
  });

  it("Token-2022 permanent delegate (an Ed25519 key that could take vault tokens): deposit refused", async () => {
    const mint = await token2022Mint([ExtensionType.PermanentDelegate], (m) => [
      createInitializePermanentDelegateInstruction(m, payer.publicKey, TOKEN_2022_PROGRAM_ID),
    ]);
    const from = await fund2022(mint, payer.publicKey, 1_000_000);
    await expectError(
      send([q.depositTokenIx({ depositor: payer.publicKey, vault: V.address, mint, from, amount: 1000, tokenProgram: TOKEN_2022_PROGRAM_ID, programId })]),
      "UnsupportedMint",
    );
  });

  it("measures transaction sizes against the 1232-byte limit", async () => {
    const st = await vaultState(V.address);
    const p = q.prepareSpendToken({ keys: V.keys, vault: V.address, state: st, mint: swd, destination: recipientSwd, amount: 1, closeSource: true, programId, tries: 1 });
    const tx = new Transaction().add(...p.instructions);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    const size = tx.serialize().length;
    measure(`spend_token tx: ${size} of 1232 bytes (${1232 - size} spare); signature data ${q.SIGNATURE_BYTES} bytes`);
    assert.isAtMost(size, 1232);
  });
});

describe("swd_quantum: PQ key commitment registry", () => {
  const delay = 8; // COMMIT_DELAY_SECS of a non-mainnet build
  let wallet: Keypair;
  let record: PublicKey;
  const mldsaPk = new Uint8Array(randomBytes(1312));
  const secret = new Uint8Array(randomBytes(32));

  before(async () => {
    wallet = await fundedKeypair(1);
    record = q.findCommitAddress(wallet.publicKey, programId)[0];
  });

  async function rec() {
    const ai = await connection.getAccountInfo(record, "confirmed");
    return q.decodeCommitment(ai!.data);
  }

  it("commit: stores only the hash, pending for the delay, event emitted", async () => {
    const c = q.pqCommitment(wallet.publicKey, q.mldsaKeyHash(mldsaPk), secret);
    const r = await send([q.commitPqKeyIx({ wallet: wallet.publicKey, commitment: c, programId })], [wallet]);
    const s = await rec();
    assert.ok(s.wallet.equals(wallet.publicKey));
    assert.ok(s.hasPending);
    assert.deepEqual(Buffer.from(s.pending), Buffer.from(c));
    assert.equal(q.inForceAt(s, s.pendingSince + BigInt(delay - 1), BigInt(delay)), null);
    assert.deepEqual(Buffer.from(q.inForceAt(s, s.pendingSince + BigInt(delay), BigInt(delay))!), Buffer.from(c));
    const tx = await connection.getTransaction(r.sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    assert.ok(tx!.meta!.logMessages!.some((l) => l.startsWith("Program data: ")), "PqCommitted event");
    const rent = await connection.getMinimumBalanceForRentExemption(q.COMMITMENT_ACCOUNT_SIZE);
    measure(`commitment record ${q.COMMITMENT_ACCOUNT_SIZE} bytes, rent ${rent} lamports (${rent / LAMPORTS_PER_SOL} SOL); commit ${r.cu} CU`);
    await expectError(send([q.commitPqKeyIx({ wallet: wallet.publicKey, commitment: c, programId })], [wallet]), "NoChange");
  });

  it("promote is refused before the delay, works after it (anyone may call it)", async () => {
    await expectError(send([q.promotePqKeyIx({ wallet: wallet.publicKey, programId })]), "TooSoon");
    await sleep((delay + 2) * 1000);
    await send([q.promotePqKeyIx({ wallet: wallet.publicKey, programId })]); // paid by `payer`, not the wallet
    const s = await rec();
    assert.isFalse(s.hasPending);
    assert.notEqual(s.activeSince, BigInt(0));
  });

  it("rotation: the old commitment stays in force while the new one matures; the wallet can cancel it; others cannot", async () => {
    const before = (await rec()).active;
    const c2 = q.pqCommitment(wallet.publicKey, q.mldsaKeyHash(new Uint8Array(randomBytes(1312))), new Uint8Array(randomBytes(32)));
    await send([q.commitPqKeyIx({ wallet: wallet.publicKey, commitment: c2, programId })], [wallet]);
    let s = await rec();
    assert.deepEqual(Buffer.from(q.inForceAt(s, s.pendingSince, BigInt(delay))!), Buffer.from(before));
    const stranger = await fundedKeypair(1);
    const forged = q.cancelPqPendingIx({ wallet: stranger.publicKey, programId });
    forged.keys[1].pubkey = record; // the stranger signs, but the record is not theirs
    await expectError(send([forged], [stranger]), "ConstraintSeeds");
    await send([q.cancelPqPendingIx({ wallet: wallet.publicKey, programId })], [wallet]);
    s = await rec();
    assert.isFalse(s.hasPending);
    assert.deepEqual(Buffer.from(s.active), Buffer.from(before));
    await expectError(send([q.cancelPqPendingIx({ wallet: wallet.publicKey, programId })], [wallet]), "NothingPending");
  });

  after(() => {
    console.log("\n      SWD Quantum measurements:\n" + measured.map((l) => `        - ${l}`).join("\n"));
  });
});
