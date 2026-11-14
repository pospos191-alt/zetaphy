// The hub's JSON fetch and EVM JSON-RPC helper (hub.js evmCall, got-ztphy.js): no cache, no cookies, a 12 s timeout,
// an RPC error becomes a thrown Error. Reads only: nothing here signs or sends a transaction.

/** GET (or `init`) a JSON document; throws on a non-2xx answer or after `timeoutMs`. */
export async function getJson(url, init, { timeoutMs = 12_000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** One JSON-RPC call to the EVM endpoint `url` (e.g. eth_getBalance); its `result`, or a thrown Error. */
export async function rpcCall(url, method, params = [], opts) {
  const j = await getJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, opts);
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}
