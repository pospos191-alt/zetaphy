// node:test suite for swd-quantum (run: npm test). The golden vectors are
// shared with programs/swd_quantum/src/tests.rs (cargo test -p swd_quantum).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import * as q from "../src";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const G: Record<string, string> = Object.fromEntries(
  readFileSync(resolve(__dirname, "../../../../programs/swd_quantum/src/golden_vectors.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const pk = (k: string) => new PublicKey(unhex(G[k]));

function goldenMessage(): q.SpendMessage {
  return {
    action: Number(G["msg.action"]),
    programId: pk("msg.program_id"),
    vault: pk("msg.vault"),
    openedSlot: BigInt(G["msg.opened_slot"]),
    seq: Number(G["msg.seq"]),
    nextKey: unhex(G["msg.next_key"]),
    mint: pk("msg.mint"),
    tokenProgram: pk("msg.token_program"),
    source: pk("msg.source"),
    destination: pk("msg.destination"),
    amount: BigInt(G["msg.amount"]),
    flags: Number(G["msg.flags"]),
  };
}

const master = unhex(G["master_seed"]);
const keys = q.vaultKeys(master, Number(G["vault_index"]));

test("golden vectors: keys, message, signature, PDA, commitment", () => {
  assert.equal(hex(keys.id), G["id"]);
  assert.equal(hex(keys.seed), G["lmots_seed"]);
  const x = q.privateChains(keys, 0);
  assert.equal(hex(x[0]), G["x0_0"]);
  assert.equal(hex(x[25]), G["x0_25"]);
  assert.equal(hex(q.publicKey(keys, 0)), G["k0"]);
  assert.equal(hex(q.publicKey(keys, 1)), G["k1"]);
  const enc = q.encodeSpendMessage(goldenMessage());
  assert.equal(hex(enc), G["msg.encoded"]);
  const sig = q.sign(keys, 0, enc, Number(G["sign.tries"]));
  assert.equal(hex(sig.c), G["sig.c"]);
  assert.equal(sig.y.map(hex).join(""), G["sig.y"]);
  assert.equal(String(sig.verifyHashes), G["sig.verify_hashes"]);
  assert.ok(q.verify(keys.id, 0, unhex(G["k0"]), sig, enc));
  const [vault] = q.findVaultAddress(keys.id, unhex(G["k0"]), pk("msg.program_id"));
  assert.equal(hex(vault.toBytes()), G["vault_pda"]);
  const mldsaPk = Uint8Array.from({ length: 1312 }, (_, i) => (i * 7 + 1) & 0xff);
  const kh = q.mldsaKeyHash(mldsaPk);
  assert.equal(hex(kh), G["commit.mldsa_pk_hash"]);
  assert.equal(hex(q.pqCommitment(pk("commit.wallet"), kh, unhex(G["commit.secret"]))), G["commit.value"]);
});

test("any changed byte breaks the signature", () => {
  const enc = q.encodeSpendMessage(goldenMessage());
  const k0 = unhex(G["k0"]);
  const sig = q.sign(keys, 0, enc, 8);
  for (const i of [0, 16, 17, 49, 81, 89, 93, 117, 149, 181, 213, 245, 253]) {
    const e = enc.slice();
    e[i] ^= 1;
    assert.equal(q.verify(keys.id, 0, k0, sig, e), false, `byte ${i}`);
  }
  const c = sig.c.slice();
  c[3] ^= 1;
  assert.equal(q.verify(keys.id, 0, k0, { c, y: sig.y }, enc), false);
  const y = sig.y.map((v) => v.slice());
  y[25][0] ^= 1;
  assert.equal(q.verify(keys.id, 0, k0, { c: sig.c, y }, enc), false);
  assert.equal(q.verify(keys.id, 1, k0, sig, enc), false, "wrong key index");
  assert.equal(q.verify(keys.id, 0, q.publicKey(keys, 1), sig, enc), false, "wrong key");
});

test("signing is deterministic and the grind lowers verification cost", () => {
  const enc = q.encodeSpendMessage(goldenMessage());
  const a = q.sign(keys, 0, enc, 64);
  const b = q.sign(keys, 0, enc, 64);
  assert.equal(hex(q.signatureBytes(a)), hex(q.signatureBytes(b)));
  assert.equal(q.signatureBytes(a).length, q.SIGNATURE_BYTES);
  const one = q.sign(keys, 0, enc, 1).verifyHashes;
  const many = q.sign(keys, 0, enc, 4096).verifyHashes;
  assert.ok(many <= one);
  assert.ok(many < 2600, `4096 tries: ${many}`);
});

test("checksum: no digit vector dominates another", () => {
  let s = 0x9e3779b9;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) >>> 24);
  for (let t = 0; t < 5000; t++) {
    const a = Uint8Array.from({ length: q.N }, rnd);
    const b = a.map((v) => (rnd() % 3 === 0 ? rnd() : v));
    if (a.every((v, i) => v === b[i])) continue;
    const da = q.digits(a), db = q.digits(b);
    assert.ok(db.some((v, i) => v < da[i]));
  }
});

test("instruction layouts and transaction sizes (one transaction, no buffer account)", () => {
  const programId = pk("msg.program_id");
  const payer = Keypair.generate();
  const { address: vault } = q.vaultFromSeed(master, 7, programId);
  const state: q.VaultState = {
    version: 1, bump: 255, id: keys.id, genesisKey: unhex(G["k0"]), key: unhex(G["k0"]), seq: 0, openedSlot: BigInt(5), spends: BigInt(0),
  };
  const sol = q.prepareSpendSol({ keys, vault, state, destination: Keypair.generate().publicKey, lamports: 1000, programId, tries: 64 });
  assert.equal(sol.instructions[1].data.length, 8 + 648 + 8 + 24);
  const mint = Keypair.generate().publicKey;
  const tok = q.prepareSpendToken({
    keys, vault, state, mint, destination: Keypair.generate().publicKey, amount: 5, closeSource: true, programId, tokenProgram: q.TOKEN_2022_PROGRAM_ID, tries: 64,
  });
  assert.equal(tok.instructions[1].data.length, 8 + 648 + 8 + 1 + 24);
  const size = (ixs: typeof sol.instructions) => {
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(...ixs);
    tx.sign(payer);
    return tx.serialize().length;
  };
  const solSize = size(sol.instructions);
  const tokSize = size(tok.instructions);
  console.log(`tx size: spend_sol ${solSize} bytes, spend_token ${tokSize} bytes (limit 1232)`);
  assert.ok(solSize <= 1232 && tokSize <= 1232);
  // prepare refuses a seed that does not hold the current key
  assert.throws(() => q.prepareSpendSol({ keys: q.vaultKeys(master, 8), vault, state, destination: vault, lamports: 1, programId }));
  assert.throws(() => q.prepareSpendSol({ keys, vault, state: { ...state, seq: 1 }, destination: vault, lamports: 1, programId }));
});

test("account decoding", () => {
  const data = new Uint8Array(q.VAULT_ACCOUNT_SIZE);
  data.set(q.accountDiscriminator("Vault"), 0);
  data[8] = 1;
  data[9] = 254;
  data.set(keys.id, 10);
  data.set(unhex(G["k0"]), 26);
  data.set(unhex(G["k1"]), 50);
  new DataView(data.buffer).setUint32(74, 1, true);
  new DataView(data.buffer).setBigUint64(78, BigInt(77), true);
  const v = q.decodeVault(data);
  assert.equal(v.seq, 1);
  assert.equal(v.openedSlot, BigInt(77));
  assert.equal(hex(v.key), G["k1"]);
  assert.throws(() => q.decodeVault(new Uint8Array(q.VAULT_ACCOUNT_SIZE)));

  const s: q.CommitmentState = {
    wallet: PublicKey.default, bump: 1, active: new Uint8Array(32).fill(1), activeSince: BigInt(100),
    pending: new Uint8Array(32), pendingSince: BigInt(200), hasPending: true, changes: 2,
  };
  assert.equal(q.inForceAt(s, BigInt(99), BigInt(8)), null);
  assert.equal(q.inForceAt(s, BigInt(150), BigInt(8))?.[0], 1);
  assert.equal(q.inForceAt(s, BigInt(208), BigInt(8)), null, "matured revoke");
});
