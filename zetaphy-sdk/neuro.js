// ZETAPHY Neuro for any app: ask ZETAPHY's on-chain AI whether a contract is flagged, read its Neuro badge, and request
// a fresh check that ZETAPHY's runners carry out and agree on. Everything goes through ZETAPHY mainnet (chain 3659):
// reads are eth_calls to its RPC, a check is a NeuroJobs job paid in ZTPHY on ZETAPHY, and the answer is what ZETAPHY's
// contracts hold. No dependencies; runs in browsers (with an EIP-1193 wallet for requests) and in Node 18+.
//
//   import { createNeuro } from '@zetaphy/sdk';
//   const neuro = createNeuro();                              // ZETAPHY mainnet, public RPC
//   await neuro.isFlagged({ chainId: 56, address: '0x…' });   // { flagged, reason }
//   await neuro.badge('0x…');                                 // the Neuro attestation of a ZETAPHY contract, if any
//   const { id } = await neuro.requestCheck(window.ethereum, { chain: 'bsc', address: '0x…' });   // pays the fee in ZTPHY
//   await neuro.waitForJob(id);                               // { status: 'done', verdict: '0x…' }
//
// Licence: BUSL-1.1 with an Additional Use Grant for apps that connect to an Official ZETAPHY Network (LICENSE).

export const ZETAPHY = Object.freeze({
  chainId: 3659, chainIdHex: '0xe4b', name: 'ZETAPHY', rpc: 'https://rpc.sawasdeecoin.com',
  explorer: 'https://explorer.sawasdeecoin.com', nativeCurrency: { name: 'ZETAPHY', symbol: 'ZTPHY', decimals: 18 },
  contracts: Object.freeze({
    // zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json (test/neuro.test.js checks they agree)
    neuroJobs: '0x5044309622064d21c5D7Ac681f7a4489ca4Ce4fB',
    neuroControl: '0x97F5D7FBc6228aA7A145505AABdbdC7825e161AE',
    threatRegistry: '0xaACfc7Cf7148b7AE530c2Ab891D4220E648A2139',
    neuroAttest: '0x16706E3Fdbb7d472ABf801fFfbDb139e405a6d9A',
  }),
});

/** ThreatRegistry.Reason, in order. */
export const REASONS = Object.freeze(['none', 'cannot-sell-in-simulation', 'unlimited-mint', 'owner-can-block-transfers', 'owner-can-move-holder-funds',
  'same-name-as-known-token', 'sweeps-approved-tokens', 'other']);
/** NeuroJobs.Status, in order. */
export const JOB_STATUS = Object.freeze(['none', 'open', 'done', 'failed']);

export const SEL = Object.freeze({
  isAddressFlagged: '0x25f11c9f', isCodeFlagged: '0x8a6a504b', minFee: '0x24ec7590', request: '0x1c660c1d', getJob: '0xbf22c457',
  jobCount: '0x4c5d8a0f', badge: '0x88e179c7', chainAllowed: '0xb47b05b5', paused: '0x5c975abb', activeSkill: '0x92057678',
});
/** keccak256("JobRequested(uint256,bytes32,string,uint256)") */
export const JOB_REQUESTED = '0x659dff5d1efb5c9df576587d3f740f3827f3baa46bc1e5f0f519e57a0a3fbf59';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const strip = (h) => String(h).replace(/^0x/, '');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => { if (!ADDR.test(String(a))) throw new Error(`not an address: ${a}`); return strip(a).toLowerCase().padStart(64, '0'); };
const words = (hex) => strip(hex).match(/.{64}/g) ?? [];
const toAddr = (w) => '0x' + w.slice(24);
const big = (w) => BigInt('0x' + (w || '0'));

/** A NeuroJobs chain key ("bsc", "base", "eth", …) as bytes32. */
export function chainKey(key) {
  if (!/^[a-z0-9-]{1,31}$/.test(String(key))) throw new Error('chain: a key such as bsc, base, eth (1-31 of a-z 0-9 -)');
  return '0x' + Array.from(new TextEncoder().encode(key), (b) => b.toString(16).padStart(2, '0')).join('').padEnd(64, '0');
}

/** Calldata of NeuroJobs.request(bytes32 chain, string target). */
export function requestData(chain, target) {
  const t = String(target ?? '');
  if (!t || t.length > 128) throw new Error('address: the contract to check (at most 128 characters)');
  const bytes = new TextEncoder().encode(t);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return SEL.request + strip(chainKey(chain)) + word(64) + word(bytes.length) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
}

/** getJob's answer: (address requester, uint64 created, uint8 status, bytes32 chain, string target, uint256 fee, bytes32 result, uint8 commits, uint8 reveals, address[3] seat). */
export function decodeJob(hex) {
  const w = words(hex);
  if (w.length < 13) throw new Error('bad getJob answer');
  const at = Number(big(w[4])) / 32, len = Number(big(w[at]));
  const target = new TextDecoder().decode(Uint8Array.from((w.slice(at + 1).join('').slice(0, len * 2).match(/../g) ?? []).map((b) => parseInt(b, 16))));
  const chainBytes = (w[3].match(/../g) ?? []).map((b) => parseInt(b, 16)).filter((b) => b !== 0);
  const status = JOB_STATUS[Number(big(w[2]))] ?? 'unknown';
  const result = '0x' + w[6];
  return {
    requester: toAddr(w[0]), created: Number(big(w[1])), status, chain: new TextDecoder().decode(Uint8Array.from(chainBytes)), target,
    fee: big(w[5]), verdict: status === 'done' && !/^0x0{64}$/.test(result) ? result : null, commits: Number(big(w[7])), reveals: Number(big(w[8])),
  };
}

/** The job id from a request's receipt (its JobRequested log on NeuroJobs). */
export function jobIdFromReceipt(receipt, neuroJobs = ZETAPHY.contracts.neuroJobs) {
  const log = (receipt?.logs ?? []).find((l) => String(l.address).toLowerCase() === neuroJobs.toLowerCase() && String(l.topics?.[0]).toLowerCase() === JOB_REQUESTED);
  if (!log) throw new Error('no JobRequested log in the receipt');
  return Number(BigInt(log.topics[1]));
}

/**
 * The client. opts: { rpc, fetch, contracts } (defaults: ZETAPHY mainnet's). Reads never need a wallet; requestCheck
 * needs an EIP-1193 provider (MetaMask, any wallet) and switches it to ZETAPHY first.
 */
export function createNeuro(opts = {}) {
  const rpcUrl = opts.rpc ?? ZETAPHY.rpc;
  const fetchFn = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  const C = { ...ZETAPHY.contracts, ...(opts.contracts ?? {}) };
  let id = 0;
  async function rpc(method, params) {
    const r = await fetchFn(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message ?? 'ZETAPHY RPC error');
    return j.result;
  }
  const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
  const flagged = (hex) => { const w = words(hex); return { flagged: big(w[0]) === 1n, reason: REASONS[Number(big(w[1]))] ?? 'other' }; };

  const api = {
    contracts: C,
    /** Is this contract (on `chainId`, an EVM chain id) flagged by ZETAPHY's Neuro quorum? */
    async isFlagged({ chainId, address }) {
      if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('chainId: the EVM chain id of the contract, e.g. 56');
      return flagged(await call(C.threatRegistry, SEL.isAddressFlagged + word(chainId) + addrWord(address)));
    },
    /** Is EVM code with this code hash (extcodehash) flagged? */
    async isCodeFlagged(codeHash) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(String(codeHash))) throw new Error('codeHash: 0x + 64 hex');
      return flagged(await call(C.threatRegistry, SEL.isCodeFlagged + strip(codeHash)));
    },
    /** The Neuro attestation (NeuroAttest.badge) of a contract on ZETAPHY, or null. */
    async badge(address) {
      const w = words(await call(C.neuroAttest, SEL.badge + addrWord(address)));
      if (big(w[0]) !== 1n) return null;
      return { uid: big(w[1]), reportHash: '0x' + w[2], skill: '0x' + w[3], model: '0x' + w[4], by: toAddr(w[5]), time: Number(big(w[6])) };
    },
    /** The ZTPHY (in wei) a check costs at least. */
    async fee() { return big(words(await call(C.neuroJobs, SEL.minFee))[0]); },
    /** Does NeuroJobs take checks for this chain key now (and is Neuro running)? */
    async canCheck(chain) {
      const [allowed, paused] = await Promise.all([call(C.neuroControl, SEL.chainAllowed + strip(chainKey(chain))), call(C.neuroControl, SEL.paused)]);
      return big(words(allowed)[0]) === 1n && big(words(paused)[0]) === 0n;
    },
    /** A job's state; `verdict` is the hash ZETAPHY's runners agreed on (null until done). */
    async getJob(jobId) { return decodeJob(await call(C.neuroJobs, SEL.getJob + word(jobId))); },
    /** The transaction a wallet sends to request a check: { to, data, value (hex wei), chainId }. */
    async requestTx({ chain, address, fee }) {
      const value = fee ?? await api.fee();
      return { to: C.neuroJobs, data: requestData(chain, address), value: '0x' + BigInt(value).toString(16), chainId: ZETAPHY.chainIdHex };
    },
    /**
     * Requests a check through the user's wallet on ZETAPHY: switches (or adds) the network, refuses another chain,
     * sends NeuroJobs.request with the fee in ZTPHY, waits for the receipt. Returns { id, hash }.
     */
    async requestCheck(provider, { chain, address, fee }) {
      if (!provider?.request) throw new Error('an EIP-1193 wallet provider is required (e.g. window.ethereum)');
      if (!(await api.canCheck(chain))) throw new Error(`ZETAPHY's Neuro does not take checks for "${chain}" right now`);
      try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ZETAPHY.chainIdHex }] }); } catch (e) {
        if (e?.code === 4001) throw e;
        await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: ZETAPHY.chainIdHex, chainName: ZETAPHY.name, nativeCurrency: ZETAPHY.nativeCurrency, rpcUrls: [rpcUrl], blockExplorerUrls: [ZETAPHY.explorer] }] });
      }
      if (String(await provider.request({ method: 'eth_chainId' })).toLowerCase() !== ZETAPHY.chainIdHex) throw new Error('the wallet is not on ZETAPHY (chain 3659): nothing was sent');
      const [from] = await provider.request({ method: 'eth_requestAccounts' });
      const tx = await api.requestTx({ chain, address, fee });
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from, ...tx }] });
      for (let i = 0; i < 120; i++) {
        const receipt = await rpc('eth_getTransactionReceipt', [hash]);
        if (receipt) {
          if (receipt.status !== '0x1') throw new Error(`the request reverted (${hash})`);
          return { id: jobIdFromReceipt(receipt, C.neuroJobs), hash };
        }
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
      }
      throw new Error(`no receipt yet for ${hash}`);
    },
    /** Polls getJob until it is done or failed (default: up to 30 minutes). */
    async waitForJob(jobId, { timeoutMs = 30 * 60 * 1000, everyMs = 15_000 } = {}) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const j = await api.getJob(jobId);
        if (j.status === 'done' || j.status === 'failed') return j;
        if (Date.now() + everyMs > end) return j;
        await new Promise((r) => setTimeout(r, everyMs));
      }
    },
  };
  return api;
}
