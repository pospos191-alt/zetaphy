// SWD holder snapshot on Solana: every token account of the SWD mint
// (SPL Token and Token-2022), summed per wallet owner. Read-only RPC.

const PROGRAMS = {
  spl: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
};
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Pure: RPC getProgramAccounts (jsonParsed) results -> sorted holders. */
export function sumHolders(accountsByProgram, mint, exclude = new Set()) {
  const byOwner = new Map();
  for (const accounts of accountsByProgram) {
    for (const a of accounts) {
      const info = a.account?.data?.parsed?.info;
      if (!info || info.mint !== mint) continue; // never trust the filter alone
      const amount = BigInt(info.tokenAmount?.amount ?? '0');
      if (amount === 0n || exclude.has(info.owner)) continue;
      byOwner.set(info.owner, (byOwner.get(info.owner) ?? 0n) + amount);
    }
  }
  return [...byOwner].map(([owner, amount]) => ({ owner, amount }))
    .sort((x, y) => (y.amount > x.amount ? 1 : y.amount < x.amount ? -1 : x.owner < y.owner ? -1 : 1));
}

async function rpc(url, method, params, fetchImpl) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

export async function takeSnapshot({ mint, rpcUrl, exclude = [], fetchImpl = globalThis.fetch }) {
  if (!BASE58.test(mint)) throw new Error('mint must be a Solana address');
  const slot = await rpc(rpcUrl, 'getSlot', [{ commitment: 'finalized' }], fetchImpl);
  const lists = [];
  for (const program of Object.values(PROGRAMS)) {
    lists.push(await rpc(rpcUrl, 'getProgramAccounts', [program, {
      encoding: 'jsonParsed', commitment: 'finalized', minContextSlot: slot,
      filters: [{ memcmp: { offset: 0, bytes: mint } }],
    }], fetchImpl));
  }
  const holders = sumHolders(lists, mint, new Set(exclude));
  return { mint, slot, takenAt: new Date().toISOString(), holders: holders.map((h) => ({ owner: h.owner, amount: h.amount.toString() })) };
}

/**
 * The holders AS OF `at` (an ISO time already past): today's token accounts, each rolled back through every finalized
 * transaction that touched it after `at` (its post minus pre token balance, from the transaction itself). An account
 * a later transaction emptied and closed is found in that transaction's token balances and rolled back the same way,
 * so its holder is counted too. Read-only RPC; `pause` ms between calls (public RPCs rate-limit).
 */
export async function snapshotAt({ mint, rpcUrl, at, exclude = [], fetchImpl = globalThis.fetch, pause = 0, log = () => {} }) {
  if (!BASE58.test(mint)) throw new Error('mint must be a Solana address');
  const atSec = Math.floor(Date.parse(at) / 1000);
  if (!Number.isFinite(atSec)) throw new Error('--at: an ISO time, e.g. 2026-11-20T14:00:00Z');
  const call = async (m, p) => { const r = await rpc(rpcUrl, m, p, fetchImpl); if (pause) await new Promise((res) => setTimeout(res, pause)); return r; };
  const slot = await call('getSlot', [{ commitment: 'finalized' }]);
  const accounts = new Map(); // token account -> { owner, now }
  for (const program of Object.values(PROGRAMS)) {
    const list = await call('getProgramAccounts', [program, { encoding: 'jsonParsed', commitment: 'finalized', minContextSlot: slot, filters: [{ memcmp: { offset: 0, bytes: mint } }] }]);
    for (const a of list) {
      const info = a.account?.data?.parsed?.info;
      if (!info || info.mint !== mint || typeof a.pubkey !== 'string') continue;
      accounts.set(a.pubkey, { owner: info.owner, now: BigInt(info.tokenAmount?.amount ?? '0') });
    }
  }
  const seenTx = new Map(); // signature -> parsed tx (one fetch per transaction)
  const queue = [...accounts.keys()], done = new Set(), atBalance = new Map();
  let changed = 0;
  while (queue.length) {
    const acct = queue.shift();
    if (done.has(acct)) continue;
    done.add(acct);
    // the account's signatures after `at`, newest first
    const sigs = [];
    let before;
    for (;;) {
      const page = await call('getSignaturesForAddress', [acct, { limit: 1000, commitment: 'finalized', ...(before ? { before } : {}) }]);
      const after = page.filter((s) => (s.blockTime ?? 0) > atSec);
      sigs.push(...after);
      if (page.length < 1000 || after.length < page.length) break;
      before = page[page.length - 1].signature;
    }
    let delta = 0n;
    for (const s of sigs) {
      if (!seenTx.has(s.signature)) seenTx.set(s.signature, await call('getTransaction', [s.signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]));
      const tx = seenTx.get(s.signature);
      if (!tx?.meta || tx.meta.err) continue;
      const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === 'string' ? k : k.pubkey));
      const bal = (list) => new Map((list ?? []).filter((b) => b.mint === mint).map((b) => [keys[b.accountIndex], { owner: b.owner, amount: BigInt(b.uiTokenAmount?.amount ?? '0') }]));
      const pre = bal(tx.meta.preTokenBalances), post = bal(tx.meta.postTokenBalances);
      delta += (post.get(acct)?.amount ?? 0n) - (pre.get(acct)?.amount ?? 0n);
      // accounts of this mint that held tokens before this transaction and no longer exist: roll them back too
      for (const [k, b] of pre) if (!accounts.has(k) && !done.has(k) && b.amount > 0n) { accounts.set(k, { owner: b.owner, now: 0n }); queue.push(k); }
    }
    const a = accounts.get(acct);
    const then = a.now - delta;
    if (then < 0n) throw new Error(`${acct}: rolling back gives a negative balance (${then}); nothing written`);
    if (delta !== 0n) changed++;
    atBalance.set(acct, { owner: a.owner, amount: then });
    log(`${done.size}/${done.size + queue.length} accounts checked`);
  }
  const fake = [[...atBalance.values()].map((v) => ({ account: { data: { parsed: { info: { mint, owner: v.owner, tokenAmount: { amount: String(v.amount) } } } } } }))];
  const holders = sumHolders(fake, mint, new Set(exclude));
  return { mint, slot, takenAt: new Date().toISOString(), at: new Date(atSec * 1000).toISOString(), accountsRolledBack: changed, transactionsAfter: seenTx.size,
    holders: holders.map((h) => ({ owner: h.owner, amount: h.amount.toString() })) };
}
