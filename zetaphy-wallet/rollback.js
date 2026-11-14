// Your own proof + the rollback alarm (docs/ANTI-ROLLBACK-OFFCHAIN.md, items Q and F).
//
// Every few minutes (and on Refresh) the wallet takes a checkpoint of block H = latest - 1 from the node:
//   - the EVM block H (number, hash, stateRoot; stateRoot is the app hash in CometBFT header H),
//   - eth_getProof of the account at H (and of token(X)'s balanceOf slot when a token is loaded): the IAVL proofs
//     a holder needs for a forced exit (zetaphy-network/src/forcedexit.js -> ZetaphyForcedExit.prove),
//   - when a CometBFT RPC answers: block H+1's PQ finality certificate (its first tx), checked with the same code as
//     every node (pqcert.js verifyBlock: ML-DSA-44 votes of more than 2/3 of the power for header H), and header H's
//     app_hash, which must equal the EVM stateRoot.
// and keeps it on this device only (localStorage). It raises the alarm, and the page refuses to sign, when the node
// later serves
//   lower      a latest block below one the wallet already holds,
//   fork       another hash or state root for a block it holds,
//   missing    nothing for a block it served before,
//   mismatch   two views that disagree (EVM stateRoot vs certified header, the proof vs the balance).
// The alarm stays until the user accepts the new chain (after downloading the proofs). Nothing here is secret.

export const BOOK_VERSION = 1;
export const MAX_SEEN = 48;
export const INTERVAL_MS = 5 * 60 * 1000;

const hex = (v) => '0x' + BigInt(v).toString(16);
const norm = (h) => String(h ?? '').toLowerCase().replace(/^0x/, '');

export function newBook() {
  return { v: BOOK_VERSION, seen: [], latest: null, alarm: null };
}

/** A stored book, or a new one if it is missing or malformed. */
export function parseBook(text) {
  try {
    const b = JSON.parse(text);
    if (b?.v === BOOK_VERSION && Array.isArray(b.seen)) return { ...newBook(), ...b };
  } catch { /* none */ }
  return newBook();
}

/** { height (BigInt), hash, stateRoot } of an eth_getBlockByNumber answer. */
export function headOf(block) {
  if (!block || block.number == null || !block.hash || !block.stateRoot) throw new Error('the node did not return a block');
  return { height: BigInt(block.number), hash: norm(block.hash), stateRoot: norm(block.stateRoot) };
}

// The block the wallet holds proofs for (its latest checkpoint); heads it only saw count for "fork", not for "lower"
// (a node one block behind another is no rollback).
const held = (book) => (book.latest ? { height: book.latest.height, hash: book.latest.hash, stateRoot: book.latest.stateRoot } : null);

/** The alarm for what the node serves now (head = its latest block, or a block it serves again), or null. */
export function checkHead(book, head, { latest = false } = {}) {
  const top = held(book);
  if (latest && top && head.height < BigInt(top.height)) return { kind: 'lower', held: String(top.height), served: String(head.height) };
  const same = book.seen.find((s) => BigInt(s.height) === head.height);
  if (same && (same.hash !== head.hash || same.stateRoot !== head.stateRoot)) {
    return { kind: 'fork', height: String(head.height), held: same.stateRoot, served: head.stateRoot, heldHash: same.hash, servedHash: head.hash };
  }
  return null;
}

/** The book with this head remembered (newest MAX_SEEN heights). */
export function addHead(book, head) {
  const seen = book.seen.filter((s) => BigInt(s.height) !== head.height);
  seen.push({ height: String(head.height), hash: head.hash, stateRoot: head.stateRoot });
  seen.sort((x, y) => (BigInt(x.height) < BigInt(y.height) ? -1 : 1));
  return { ...book, seen: seen.slice(-MAX_SEEN) };
}

/**
 * One checkpoint. call(method, params): the node's EVM JSON-RPC; comet: a CometBFT RPC function or null;
 * verifyBlock / decodeCertificate: pqcert.js; address: the account (0x); token: { address, slot } or null;
 * chainId: the Cosmos chain id the certificate must be for. Returns { book, alarm, record?, note? }: when `alarm` is
 * set the book carries it too (book.alarm) and nothing new was recorded.
 */
export async function checkpoint(book, { call, comet = null, verifyBlock = null, decodeCertificate = null, address, token = null, chainId, now = Date.now() }) {
  const raise = (alarm) => ({ book: { ...book, alarm: { ...alarm, at: now } }, alarm });
  if (book.alarm) return { book, alarm: book.alarm };
  const latest = headOf(await call('eth_getBlockByNumber', ['latest', false]));
  let alarm = checkHead(book, latest, { latest: true });
  if (alarm) return raise(alarm);
  // the block held (the last checkpoint) must still be there, unchanged
  const top = held(book);
  if (top && BigInt(top.height) < latest.height) {
    const again = await call('eth_getBlockByNumber', [hex(top.height), false]);
    if (!again) return raise({ kind: 'missing', height: String(top.height) });
    alarm = checkHead(book, headOf(again));
    if (alarm) return raise(alarm);
  }
  book = addHead(book, latest);
  const H = latest.height - 1n;
  if (H < 3n) return { book, alarm: null, note: 'too early' }; // proofs need height > 2
  const blk = await call('eth_getBlockByNumber', [hex(H), false]);
  if (!blk) return raise({ kind: 'missing', height: String(H) });
  const head = headOf(blk);
  alarm = checkHead(book, head);
  if (alarm) return raise(alarm);
  book = addHead(book, head);

  // the proofs at H
  const [proof, balance] = await Promise.all([call('eth_getProof', [address, [], hex(H)]), call('eth_getBalance', [address, hex(H)])]);
  if (!proof || proof.balance == null) throw new Error('the node did not return eth_getProof');
  if (BigInt(proof.balance) !== BigInt(balance)) return raise({ kind: 'mismatch', height: String(H), what: 'balance' });
  const record = {
    height: String(H), hash: head.hash, stateRoot: head.stateRoot, at: now,
    account: { address, balance: String(BigInt(proof.balance)), nonce: proof.nonce ?? null, codeHash: proof.codeHash ?? null, storageHash: proof.storageHash ?? null, accountProof: proof.accountProof ?? [] },
    token: null, cert: null,
  };
  if (token?.address && token.slot) {
    try {
      const tp = await call('eth_getProof', [token.address, [token.slot], hex(H)]);
      const sp = tp?.storageProof?.[0];
      if (sp) record.token = { address: token.address, slot: token.slot, value: String(BigInt(sp.value ?? 0)), proof: tp };
    } catch { /* a node without storage proofs: the account proof is still kept */ }
  }

  // the PQ finality certificate of header H (in block H+1), and header H's app hash = the EVM stateRoot
  if (comet && verifyBlock) {
    try {
      const hb = await comet('block', { height: String(H) });
      const appHash = norm(hb?.block?.header?.app_hash);
      if (appHash && appHash !== head.stateRoot) return raise({ kind: 'mismatch', height: String(H), what: 'appHash', held: head.stateRoot, served: appHash });
      const v = await verifyBlock(comet, H, { chainId });
      const next = await comet('block', { height: String(H + 1n) });
      const tx0 = next?.block?.data?.txs?.[0] ?? null;
      let certHeight = null;
      try { certHeight = tx0 && decodeCertificate ? String(decodeCertificate(Uint8Array.from(atob(tx0), (c) => c.charCodeAt(0)))?.height ?? '') : null; } catch { certHeight = null; }
      record.cert = { ok: !!v.ok, pqMajority: !!v.pqMajority, signedPower: String(v.signedPower ?? 0n), totalPower: String(v.totalPower ?? 0n),
        blockHash: v.hash ?? null, chainId: v.chainId ?? chainId, problems: (v.problems ?? []).slice(0, 3), tx: tx0, certHeight };
    } catch (e) {
      record.cert = { ok: false, error: String(e?.message ?? e).slice(0, 200) };
    }
  }
  return { book: { ...book, latest: record }, alarm: null, record };
}

/** The BridgedToken balanceOf slot of `holder` (keccak256(abi.encode(holder, 3))), given a keccak-256 function. */
export function bridgedBalanceSlot(holder, keccak256, slot = 3n) {
  const word = (v) => BigInt(v).toString(16).padStart(64, '0');
  const bytes = Uint8Array.from((word(BigInt(holder)) + word(slot)).match(/../g).map((b) => parseInt(b, 16)));
  return '0x' + Array.from(keccak256(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the user downloads: the book (latest checkpoint with its proofs and certificate, the heads held, any alarm). */
export function exportProofs(book, { address, rpc, chain = 'ZETAPHY mainnet (zetaphy_3659-1)' }) {
  return JSON.stringify({ kind: 'zetaphy-wallet-proofs/v1', address, rpc, exportedAt: new Date().toISOString(),
    note: `${chain}. Proofs as the node served them: eth_getProof (ICS23 ops; zetaphy-network/src/forcedexit.js turns the token one into ZetaphyForcedExit.prove arguments) and the PQ finality certificate of the same block.`,
    ...book }, null, 2);
}
