// test-ui/sol-safety.js: reading what a Solana transaction does before it is signed.
// Run: node --test test-ui/tests/sol-safety.test.mjs (no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { solTxInfo, instructionsOf, SPL_UNLIMITED_MIN, confirmSolana } from "../sol-safety.js";

const OWNER = "JDxHq1Zk2yN3xG8m9pXa7vQeW4tRbY6uLcFs5oPeamz";
const OTHER = "4T8mq3mX7nB2cR8tY4wZ1aS6dF5gH3jK2kP9o5867iN";
const SYS = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const AMM = "SWDammProgram1111111111111111111111111111111";
const le = (v, n) => { const b = []; let x = BigInt(v); for (let i = 0; i < n; i++) { b.push(Number(x & 255n)); x >>= 8n; } return b; };
const transfer = (from, lamports) => ({ programId: { toBase58: () => SYS }, keys: [{ pubkey: from }, { pubkey: OTHER }], data: Uint8Array.from([...le(2, 4), ...le(lamports, 8)]) });
const approve = (amount, kind = 4) => ({ programId: TOKEN, keys: [{ pubkey: "src" }, { pubkey: "delegate1" }, { pubkey: OWNER }], data: Uint8Array.from([kind, ...le(amount, 8), ...(kind === 13 ? [6] : [])]) });

test("legacy transactions: SOL sent by the owner, programs named, approvals", () => {
  const tx = { instructions: [transfer(OWNER, 1_500_000_000n), transfer(OTHER, 7n), { programId: AMM, keys: [], data: new Uint8Array([1, 2]) }, approve(5n), approve((1n << 64n) - 1n, 13)] };
  const i = solTxInfo(tx, OWNER, { [AMM]: "SWD AMM" });
  assert.equal(i.txs, 1);
  assert.equal(i.instructions, 5);
  assert.equal(i.solOut, 1_500_000_000n, "only the owner's transfers count");
  assert.deepEqual(i.programs, [`System (${SYS})`, `SWD AMM (${AMM})`, `SPL Token (${TOKEN})`]);
  assert.deepEqual(i.approvals, [{ delegate: "delegate1", amount: 5n, unlimited: false }, { delegate: "delegate1", amount: (1n << 64n) - 1n, unlimited: true }]);
  assert.equal(SPL_UNLIMITED_MIN, 1n << 63n);
});

test("versioned transactions (compiled instructions) and lists (signAllTransactions)", () => {
  const v0 = { message: { staticAccountKeys: [OWNER, OTHER, SYS].map((k) => ({ toBase58: () => k })), compiledInstructions: [{ programIdIndex: 2, accountKeyIndexes: [0, 1], data: Uint8Array.from([...le(2, 4), ...le(42n, 8)]) }] } };
  assert.deepEqual(instructionsOf(v0)[0].accounts, [OWNER, OTHER]);
  const i = solTxInfo([v0, v0], OWNER);
  assert.equal(i.txs, 2);
  assert.equal(i.solOut, 84n);
  assert.deepEqual(i.programs, [`System (${SYS})`]);
});

test("anything unreadable is no instruction, never a throw", () => {
  for (const x of [null, undefined, {}, { message: {} }, { instructions: [{ programId: null, data: "zz" }] }]) assert.doesNotThrow(() => solTxInfo(x, OWNER));
  assert.equal(solTxInfo({ instructions: [{ programId: SYS, keys: [{ pubkey: OWNER }], data: new Uint8Array([2, 0, 0]) }] }, OWNER).solOut, 0n, "a short transfer is not read");
});

test("confirmSolana: the summary fields, and Cancel is false", async () => {
  let seen;
  const sf = { t: (k, v = {}) => `${k}${JSON.stringify(v)}`, confirmTx: async (o) => { seen = o; return null; } };
  const ok = await confirmSolana(sf, { network: "Solana devnet", owner: OWNER, txs: { instructions: [transfer(OWNER, 2_000_000_000n), approve((1n << 64n) - 1n)] } });
  assert.equal(ok, false);
  assert.equal(seen.network, "Solana devnet");
  assert.equal(seen.from, OWNER);
  assert.equal(seen.value, 2_000_000_000n);
  assert.equal(seen.decimals, 9);
  assert.equal(seen.symbol, "SOL");
  assert.match(seen.warnings[0], /^cfSplUnlimited/);
  sf.confirmTx = async () => "0x";
  assert.equal(await confirmSolana(sf, { network: "x", owner: OWNER, txs: [] }), true);
});

// ---- attack tests (2026-11-10): what a hostile or buggy transaction builder could slip past the summary ----
const keyBytes = (fill) => new Uint8Array(32).fill(fill);

test("attack: System Assign of the wallet account is a DANGER warning (wallet takeover)", async () => {
  const assign = { programId: SYS, keys: [{ pubkey: OWNER }], data: Uint8Array.from([...le(1, 4), ...keyBytes(7)]) };
  const i = solTxInfo({ instructions: [assign] }, OWNER);
  assert.equal(i.assigns.length, 1);
  assert.equal(i.assigns[0].program.length >= 32, true, "the new owner program is shown as base58");
  let seen;
  const sf = { t: (k) => k, confirmTx: async (o) => { seen = o; return null; } };
  await confirmSolana(sf, { network: "x", owner: OWNER, txs: { instructions: [assign] } });
  assert.match(seen.warnings[0], /^DANGER/);
  // someone else's account being assigned (e.g. a new mint account) is not a warning
  assert.equal(solTxInfo({ instructions: [{ ...assign, keys: [{ pubkey: OTHER }] }] }, OWNER).assigns.length, 0);
});

test("attack: SOL leaving through CreateAccount / CreateAccountWithSeed / TransferWithSeed is counted", () => {
  const create = { programId: SYS, keys: [{ pubkey: OWNER }, { pubkey: OTHER }], data: Uint8Array.from([...le(0, 4), ...le(5_000_000_000n, 8), ...le(0, 8), ...keyBytes(1)]) };
  const seed = new TextEncoder().encode("x");
  const withSeed = { programId: SYS, keys: [{ pubkey: OWNER }, { pubkey: OTHER }], data: Uint8Array.from([...le(3, 4), ...keyBytes(2), ...le(seed.length, 8), ...seed, ...le(7n, 8), ...le(0, 8), ...keyBytes(1)]) };
  const tws = { programId: SYS, keys: [{ pubkey: OTHER }, { pubkey: OWNER }, { pubkey: OTHER }], data: Uint8Array.from([...le(11, 4), ...le(3n, 8)]) };
  assert.equal(solTxInfo({ instructions: [create, withSeed, tws] }, OWNER).solOut, 5_000_000_010n);
});

test("attack: SPL SetAuthority / CloseAccount to another address / Transfer by the owner are warned about", async () => {
  const setAuth = { programId: TOKEN, keys: [{ pubkey: "myAta" }, { pubkey: OWNER }], data: Uint8Array.from([6, 2, 1, ...keyBytes(9)]) };
  const close = { programId: TOKEN, keys: [{ pubkey: "myAta" }, { pubkey: OTHER }, { pubkey: OWNER }], data: Uint8Array.from([9]) };
  const closeToSelf = { programId: TOKEN, keys: [{ pubkey: "myAta" }, { pubkey: OWNER }, { pubkey: OWNER }], data: Uint8Array.from([9]) };
  const xfer = { programId: TOKEN, keys: [{ pubkey: "myAta" }, { pubkey: "theirAta" }, { pubkey: OWNER }], data: Uint8Array.from([3, ...le(1000n, 8)]) };
  const xferChecked = { programId: TOKEN, keys: [{ pubkey: "myAta" }, { pubkey: "mint" }, { pubkey: "theirAta" }, { pubkey: OWNER }], data: Uint8Array.from([12, ...le(5n, 8), 6]) };
  const i = solTxInfo({ instructions: [setAuth, close, closeToSelf, xfer, xferChecked] }, OWNER);
  assert.equal(i.authorities.length, 1);
  assert.equal(i.closes.length, 1, "closing to yourself is normal (unwrapping SOL)");
  assert.deepEqual(i.tokenOut.map((x) => [x.to, x.amount]), [["theirAta", 1000n], ["theirAta", 5n]]);
  let seen;
  const sf = { t: (k) => k, confirmTx: async (o) => { seen = o; return null; } };
  await confirmSolana(sf, { network: "x", owner: OWNER, lang: "th", txs: { instructions: [setAuth, close, xfer] } });
  assert.equal(seen.warnings.length, 3);
  assert.match(seen.warnings[0], /^อันตราย/, "Thai text for Thai visitors");
});

test("attack: accounts hidden in address lookup tables are called out", async () => {
  const v0 = { message: { staticAccountKeys: [OWNER, TOKEN].map((k) => ({ toBase58: () => k })), addressTableLookups: [{ accountKey: OTHER, writableIndexes: [0], readonlyIndexes: [] }],
    compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [2, 3, 0], data: Uint8Array.from([4, ...le(1n << 64n - 1n, 8)]) }] } };
  const i = solTxInfo(v0, OWNER);
  assert.equal(i.lookupTables, true);
  assert.equal(i.approvals[0].delegate, "?", "a delegate loaded from a lookup table cannot be named");
  let seen;
  const sf = { t: (k) => k, confirmTx: async (o) => { seen = o; return null; } };
  await confirmSolana(sf, { network: "x", owner: OWNER, txs: v0 });
  assert.ok(seen.warnings.some((w) => /lookup tables/.test(w)));
});

test("attack: a normal swap-shaped transaction has no extra warnings", () => {
  const ata = { programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", keys: [{ pubkey: OWNER }], data: new Uint8Array([1]) };
  const swap = { programId: AMM, keys: [{ pubkey: OWNER }], data: new Uint8Array([9, 9, 9]) };
  const i = solTxInfo({ instructions: [ata, swap] }, OWNER);
  assert.deepEqual([i.assigns, i.authorities, i.closes, i.tokenOut, i.approvals, i.lookupTables], [[], [], [], [], [], false]);
});
