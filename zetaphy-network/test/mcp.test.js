// zetaphy-mcp/server.js: the MCP protocol (initialize, tools/list, tools/call, errors), each tool with the network
// replaced, and the real stdio transport (a child process, one JSON message per line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handle, callTool, parseFeed, TOOLS, PROTOCOL_VERSIONS } from '../../zetaphy-mcp/server.js';

const A = '0x' + 'ab'.repeat(20);
const SERVER = fileURLToPath(new URL('../../zetaphy-mcp/server.js', import.meta.url));
const summary = { version: 1, chain: 'bsc', address: A, symbol: 'PMOON', level: 'high', checkedAt: '2026-11-28T05:00:00.000Z',
  en: { title: 'High risk', lines: [{ severity: 'high', text: 'Can mint new tokens' }] }, th: { title: 'เสี่ยงสูง', lines: [{ severity: 'high', text: 'สร้างเหรียญเพิ่มได้' }] } };
const fetchOf = (map) => async (url) => {
  const v = map[url];
  if (v === undefined) return { ok: false, status: 404, json: async () => null, text: async () => '' };
  return { ok: true, status: 200, json: async () => v, text: async () => v };
};
const fakeNeuro = { isFlagged: async ({ chainId }) => ({ flagged: chainId === 56, reason: 'unlimited-mint' }), canCheck: async (c) => c !== 'eth',
  requestTx: async ({ chain, address }) => ({ to: '0x5044309622064d21c5D7Ac681f7a4489ca4Ce4fB', data: '0x1c660c1d', value: '0x8ac7230489e80000', chainId: '0xe4b', chain, address }),
  getJob: async (id) => ({ id: BigInt(id), status: 'done', verdict: '0x' + '11'.repeat(32) }) };

test('initialize, tools/list, ping, notifications, unknown methods', async () => {
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'zetaphy-neuro');
  assert.ok(init.result.capabilities.tools);
  assert.equal((await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result.protocolVersion, PROTOCOL_VERSIONS[0], 'an unknown version gets the latest');
  const list = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name), ['neuro_token_report', 'zetaphy_threat_flag', 'neuro_request_check', 'neuro_job', 'neuro_latest_checks']);
  assert.ok(TOOLS.every((t) => t.inputSchema.type === 'object' && t.annotations.readOnlyHint === true), 'every tool is read-only (nothing is signed or sent)');
  assert.deepEqual((await handle({ jsonrpc: '2.0', id: 4, method: 'ping' })).result, {});
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).error.code, -32601);
  assert.equal((await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } })).error.code, -32602);
  assert.equal((await handle({ id: 7, method: 'ping' })).error.code, -32600);
});

test('neuro_token_report: the published summary in English or Thai; no report -> the live link; bad input is a tool error', async () => {
  const fetchImpl = fetchOf({ [`https://neuro.sawasdeecoin.com/reports/bsc/${A}/summary.json`]: summary });
  const r = await callTool('neuro_token_report', { chain: 'bsc', address: A.toUpperCase().replace('0X', '0x') }, { fetchImpl });
  assert.match(r.text, /PMOON .*High risk/);
  assert.match(r.text, /Can mint new tokens/);
  assert.equal(r.data.level, 'high');
  assert.equal(r.data.page, `https://neuro.sawasdeecoin.com/reports/bsc/${A}/`);
  assert.match((await callTool('neuro_token_report', { chain: 'bsc', address: A, lang: 'th' }, { fetchImpl })).text, /เสี่ยงสูง/);
  const none = await callTool('neuro_token_report', { chain: 'base', address: A }, { fetchImpl });
  assert.equal(none.data.reported, false);
  assert.equal(none.data.live, `https://neuro.sawasdeecoin.com/web/?chain=base&address=${A}`);
  // a summary for another token is not trusted
  const wrong = fetchOf({ [`https://neuro.sawasdeecoin.com/reports/bsc/${A}/summary.json`]: { ...summary, address: '0x' + '00'.repeat(20) } });
  assert.equal((await callTool('neuro_token_report', { chain: 'bsc', address: A }, { fetchImpl: wrong })).data.reported, false);
  const bad = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'neuro_token_report', arguments: { chain: 'sol', address: A } } }, { fetchImpl });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /^chain:/);
});

test('ZETAPHY tools: the on-chain flag, the unsigned request transaction, a job', async () => {
  const deps = { neuro: fakeNeuro, fetchImpl: fetchOf({}) };
  const f = await callTool('zetaphy_threat_flag', { chain: 'bsc', address: A }, deps);
  assert.equal(f.data.flagged, true);
  assert.match(f.text, /FLAGGED .*unlimited-mint/);
  assert.equal((await callTool('zetaphy_threat_flag', { chain: 'base', address: A }, deps)).data.flagged, false);
  const t = await callTool('neuro_request_check', { chain: 'bsc', address: A }, deps);
  assert.equal(t.data.transaction.chainId, '0xe4b');
  assert.equal(t.data.feeAzetaphy, (10n ** 19n).toString());
  assert.match(t.text, /signs it in their own wallet/);
  await assert.rejects(callTool('neuro_request_check', { chain: 'eth', address: A }, deps), /does not take eth/);
  const j = await callTool('neuro_job', { jobId: 7 }, deps);
  assert.equal(j.data.status, 'done');
  assert.equal(j.data.id, '7', 'BigInt made JSON-safe');
  await assert.rejects(callTool('neuro_job', { jobId: 0 }, deps), /jobId/);
});

test('neuro_latest_checks: parses Neuro\'s own Atom feed, filters by level, ignores foreign links', async () => {
  const xml = `<?xml version="1.0"?><feed><entry><title>PMOON on BNB Chain: High risk</title><link href="https://neuro.sawasdeecoin.com/reports/bsc/${A}/"/><updated>2026-11-28T00:00:00Z</updated><summary>Can mint &amp; more</summary><category term="high"/></entry>`
    + `<entry><title>X on Base: Low risk</title><link href="https://neuro.sawasdeecoin.com/reports/base/${A}/"/><updated>2026-11-27T00:00:00Z</updated><summary>ok</summary><category term="low"/></entry>`
    + `<entry><title>evil</title><link href="https://evil.example/x"/><category term="high"/></entry></feed>`;
  assert.equal(parseFeed(xml).length, 2);
  assert.equal(parseFeed(xml)[0].summary, 'Can mint & more');
  const fetchImpl = fetchOf({ 'https://neuro.sawasdeecoin.com/reports/feed.xml': xml });
  const r = await callTool('neuro_latest_checks', { level: 'high' }, { fetchImpl, neuro: fakeNeuro });
  assert.equal(r.data.checks.length, 1);
  assert.match(r.text, /PMOON on BNB Chain: High risk/);
});

test('stdio: a real child process answers line by line (initialize, tools/list, a parse error)', async () => {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write((typeof m === 'string' ? m : JSON.stringify(m)) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send('{not json');
  for (let i = 0; i < 100 && lines.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
  child.kill();
  assert.equal(lines.length, 3);
  assert.equal(lines.find((l) => l.id === 1).result.serverInfo.name, 'zetaphy-neuro');
  assert.equal(lines.find((l) => l.id === 2).result.tools.length, 5);
  assert.equal(lines.find((l) => l.id === null).error.code, -32700);
});
