#!/usr/bin/env node
// @zetaphy/mcp: ZETAPHY's Neuro for AI assistants and agents (Model Context Protocol, stdio). Claude, Cursor, VS Code
// and any MCP client can ask "is this token safe?" and get Neuro's answer, which comes from ZETAPHY:
//   - neuro_token_report     Neuro's published report of a token (https://neuro.sawasdeecoin.com/reports/…/summary.json)
//   - zetaphy_threat_flag    whether ZETAPHY mainnet's ThreatRegistry flags an address (chain 3659, the network's verdict)
//   - neuro_request_check    the unsigned ZETAPHY transaction that asks ZETAPHY's runners for a fresh check (the user's
//                            wallet signs it; this server never holds a key)
//   - neuro_job              a check's status and verdict on ZETAPHY
//   - neuro_latest_checks    the latest reports (the Atom feed)
// No dependencies, no key, no account: reads public ZETAPHY RPC and static files only.
//
//   npx -y @zetaphy/mcp            (or: node zetaphy-mcp/server.js in this repository)
//   Claude Desktop / Cursor config: { "mcpServers": { "zetaphy-neuro": { "command": "npx", "args": ["-y", "@zetaphy/mcp"] } } }
// env: ZETAPHY_RPC (default https://rpc.sawasdeecoin.com), NEURO_ORIGIN (default https://neuro.sawasdeecoin.com).
// Licence: BUSL-1.1 with the Additional Use Grant for apps that connect to an Official ZETAPHY Network (LICENSE).
import { createInterface } from 'node:readline';

const VERSION = '0.1.0';
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const NEURO = (process.env.NEURO_ORIGIN || 'https://neuro.sawasdeecoin.com').replace(/\/$/, '');
const CHAINS = { eth: 1, bsc: 56, base: 8453, arbitrum: 42161 };
const LEVELS = ['high', 'medium', 'low', 'info'];
const EVM = /^0x[0-9a-fA-F]{40}$/;

async function sdk() {
  try { return await import('@zetaphy/sdk'); } catch { return import('../zetaphy-sdk/index.js'); }
}

const chainProp = { type: 'string', enum: Object.keys(CHAINS), description: 'eth (Ethereum), bsc (BNB Chain), base (Base) or arbitrum (Arbitrum One)' };
const addrProp = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'the token or contract address, 0x + 40 hex' };

export const TOOLS = [
  { name: 'neuro_token_report', title: 'Neuro token report',
    description: "Neuro's published check of a token on Ethereum, BNB Chain, Base or Arbitrum: risk level, what the contract allows (mint, block sales, owner LP share, sell simulation…), the date it was read, and links to the full report and a live re-check. Neuro is ZETAPHY's open, reproducible token checker; its results are code facts, not investment advice.",
    inputSchema: { type: 'object', properties: { chain: chainProp, address: addrProp, lang: { type: 'string', enum: ['en', 'th'], description: 'wording of the findings (default en)' } }, required: ['chain', 'address'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'zetaphy_threat_flag', title: 'ZETAPHY on-chain threat flag',
    description: "Whether ZETAPHY mainnet's ThreatRegistry (chain 3659) flags this address on that chain, and the reason category. A flag is the network's verdict, recorded on chain by ZETAPHY's Neuro runners and governance.",
    inputSchema: { type: 'object', properties: { chain: chainProp, address: addrProp }, required: ['chain', 'address'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'neuro_request_check', title: 'Request a fresh Neuro check on ZETAPHY',
    description: "The unsigned ZETAPHY mainnet transaction (NeuroJobs.request, fee in ZTPHY) that asks ZETAPHY's runners to check a contract now. Return it to the user to sign in their own wallet (chain 3659); this tool never signs or sends. Then use neuro_job with the job id from the receipt.",
    inputSchema: { type: 'object', properties: { chain: chainProp, address: addrProp }, required: ['chain', 'address'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'neuro_job', title: 'Neuro check status on ZETAPHY',
    description: 'A NeuroJobs check on ZETAPHY mainnet: status (open, done, failed), the chain and target, and the verdict hash once runners agree.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'integer', minimum: 1, description: 'the job id (JobRequested event of the request)' } }, required: ['jobId'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'neuro_latest_checks', title: 'Latest Neuro token checks',
    description: 'The tokens Neuro checked most recently (new and trending tokens on Ethereum, BNB Chain, Base and Arbitrum), with their risk level and report link. Optionally only one level.',
    inputSchema: { type: 'object', properties: { level: { type: 'string', enum: LEVELS }, limit: { type: 'integer', minimum: 1, maximum: 100, description: 'default 20' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true } },
];

const fail = (msg) => { const e = new Error(msg); e.userFacing = true; throw e; };
function args(a, keys) {
  const o = a && typeof a === 'object' ? a : {};
  if (keys.includes('chain') && !Object.hasOwn(CHAINS, o.chain)) fail(`chain: one of ${Object.keys(CHAINS).join(', ')}`);
  if (keys.includes('address') && !EVM.test(String(o.address ?? ''))) fail('address: 0x + 40 hex characters');
  return o;
}

async function getJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) fail(`${new URL(url).host} answered HTTP ${r.status}`);
  return r.json();
}

/** The text between `open` and the next `close` in s, from `from` (indexOf only: linear time on any input). */
function between(s, open, close, from = 0) {
  const a = s.indexOf(open, from);
  if (a < 0) return null;
  const b = s.indexOf(close, a + open.length);
  return b < 0 ? null : { text: s.slice(a + open.length, b), end: b + close.length };
}
const MAX_FEED = 2_000_000;

/** Atom entries of Neuro's feed (its own fixed format: title, link, updated, summary, category). */
export function parseFeed(xml) {
  const s = String(xml).slice(0, MAX_FEED);
  const un = (t) => String(t ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const out = [];
  for (let at = 0, e; (e = between(s, '<entry>', '</entry>', at)); at = e.end) {
    const x = e.text;
    const f = (o, c) => between(x, o, c)?.text;
    out.push({ title: un(f('<title>', '</title>')), link: un(f('<link href="', '"')), updated: f('<updated>', '</updated>'), level: f('<category term="', '"'), summary: un(f('<summary>', '</summary>')) });
  }
  return out.filter((x) => x.link?.startsWith(`${NEURO}/reports/`) && /^[a-z]{1,10}$/.test(x.level ?? ''));
}

/** Runs one tool: { text, data }. `deps` lets tests replace the network. */
export async function callTool(name, a, { fetchImpl = fetch, neuro } = {}) {
  if (name === 'neuro_token_report') {
    const { chain, address, lang = 'en' } = args(a, ['chain', 'address']);
    const addr = address.toLowerCase();
    const live = `${NEURO}/web/?chain=${chain}&address=${addr}`;
    const j = await getJson(`${NEURO}/reports/${chain}/${addr}/summary.json`, fetchImpl);
    if (!j || j.chain !== chain || String(j.address).toLowerCase() !== addr || !LEVELS.includes(j.level)) {
      return { text: `Neuro has no published report for ${addr} on ${chain} yet. Live check (in a browser): ${live}. A fresh check by ZETAPHY's runners: neuro_request_check.`, data: { reported: false, chain, address: addr, live } };
    }
    const w = (lang === 'th' ? j.th : j.en) ?? j.en ?? { title: j.level, lines: [] };
    const lines = (w.lines ?? []).map((l) => `- [${l.severity}] ${l.text}`).join('\n');
    const page = `${NEURO}/reports/${chain}/${addr}/`;
    return { text: `${j.symbol ? `${j.symbol} ` : ''}(${chain} ${addr}): ${w.title}\nChecked ${String(j.checkedAt).slice(0, 10)} by Neuro (ZETAPHY).\n${lines}\nReport: ${page}\nLive re-check: ${live}\nAutomated, reproducible code analysis; not investment advice.`,
      data: { reported: true, chain, address: addr, symbol: j.symbol, level: j.level, checkedAt: j.checkedAt, findings: w.lines ?? [], page, live } };
  }
  const n = neuro ?? (await sdk()).createNeuro({ rpc: process.env.ZETAPHY_RPC || undefined, fetch: fetchImpl });
  if (name === 'zetaphy_threat_flag') {
    const { chain, address } = args(a, ['chain', 'address']);
    const r = await n.isFlagged({ chainId: CHAINS[chain], address });
    return { text: r.flagged ? `FLAGGED on ZETAPHY mainnet's ThreatRegistry: ${address} on ${chain}, reason "${r.reason}".` : `Not flagged on ZETAPHY mainnet's ThreatRegistry: ${address} on ${chain}. (Not flagged is not a guarantee: see neuro_token_report.)`,
      data: { chain, address: address.toLowerCase(), flagged: r.flagged, reason: r.reason, registry: 'ZETAPHY mainnet (chain 3659) ThreatRegistry' } };
  }
  if (name === 'neuro_request_check') {
    const { chain, address } = args(a, ['chain', 'address']);
    if (!(await n.canCheck(chain))) fail(`NeuroJobs on ZETAPHY does not take ${chain} requests right now`);
    const tx = await n.requestTx({ chain, address });
    const fee = BigInt(tx.value);
    return { text: `Unsigned ZETAPHY mainnet transaction (chain 3659): to ${tx.to}, value ${fee} azetaphy (${Number(fee) / 1e18} ZTPHY), data ${tx.data}. The user signs it in their own wallet on ZETAPHY; the receipt's JobRequested event gives the job id for neuro_job.`,
      data: { transaction: tx, feeAzetaphy: fee.toString() } };
  }
  if (name === 'neuro_job') {
    const id = Number(a?.jobId);
    if (!Number.isSafeInteger(id) || id < 1) fail('jobId: a positive integer');
    const j = await n.getJob(id);
    const plain = JSON.parse(JSON.stringify(j, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
    return { text: `NeuroJobs job ${id} on ZETAPHY: ${plain.status}${plain.verdict && !/^0x0*$/.test(plain.verdict) ? `, verdict ${plain.verdict}` : ''}.`, data: { jobId: id, ...plain } };
  }
  if (name === 'neuro_latest_checks') {
    const level = a?.level;
    if (level != null && !LEVELS.includes(level)) fail(`level: one of ${LEVELS.join(', ')}`);
    const limit = Math.min(100, Math.max(1, Number(a?.limit ?? 20) || 20));
    const r = await fetchImpl(`${NEURO}/reports/feed.xml`);
    if (!r.ok) fail(`the feed answered HTTP ${r.status}`);
    const items = parseFeed(await r.text()).filter((x) => !level || x.level === level).slice(0, limit);
    return { text: items.length ? items.map((x) => `- ${x.title} (${String(x.updated).slice(0, 10)}): ${x.link}`).join('\n') : 'No checks match.', data: { checks: items } };
  }
  fail(`unknown tool ${name}`);
}

/** One JSON-RPC message in, the answer out (null for notifications). */
export async function handle(msg, deps) {
  const { id, method, params } = msg ?? {};
  const isReq = id !== undefined && id !== null;
  const ok = (result) => (isReq ? { jsonrpc: '2.0', id, result } : null);
  const err = (code, message) => (isReq ? { jsonrpc: '2.0', id, error: { code, message } } : null);
  if (msg?.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'invalid request');
  switch (method) {
    case 'initialize': {
      const v = PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'zetaphy-neuro', title: 'ZETAPHY Neuro', version: VERSION },
        instructions: "Neuro is ZETAPHY's open token checker. Use neuro_token_report before telling a user a token is fine; zetaphy_threat_flag for ZETAPHY's on-chain verdict. Results are code facts, not investment advice; never ask users for keys or seed phrases." });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return err(-32602, `unknown tool ${name}`);
      try {
        const r = await callTool(name, params?.arguments ?? {}, deps);
        return ok({ content: [{ type: 'text', text: r.text }], structuredContent: r.data, isError: false });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: e.userFacing ? e.message : `failed: ${String(e?.message ?? e).slice(0, 300)}` }], isError: true });
      }
    }
    default:
      if (method.startsWith('notifications/')) return null;
      return err(-32601, `method not found: ${method}`);
  }
}

// stdio transport: one JSON-RPC message per line
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/zetaphy-mcp')) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
    const out = await handle(msg);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
}
