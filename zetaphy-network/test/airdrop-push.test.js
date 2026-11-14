// airdrop/cli.js push-list: the address,score CSV of queries/active-evm-wallets.sql -> the list gov.sh airdrop pushes
// on mainnet (owner decision 2026-11-14, docs/AIRDROP.md "Push airdrop on mainnet"): one EIP-55 0x… per line,
// highest score first, without duplicates, zero / precompile / burn addresses, ZETAPHY module accounts and
// preinstalls, and without contracts on Ethereum (eth_getCode, required).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getAddress, hexlify, randomBytes } from 'ethers';
import { run } from '../airdrop/cli.js';
import { moduleAddress, SYSTEM_ADDRESSES } from '../airdrop/recipients.js';

const addr = () => getAddress(hexlify(randomBytes(20)));
const quiet = () => {};
const withDir = async (f) => { const d = mkdtempSync(join(tmpdir(), 'push-list-')); try { return await f(d); } finally { rmSync(d, { recursive: true, force: true }); } };
// an Ethereum RPC stand-in: eth_getCode is code for the given contracts, an EIP-7702 delegation for the given EOAs
const rpc = (contracts = new Set(), delegated = new Set(), calls = []) => async (_u, init) => {
  const body = JSON.parse(init.body);
  calls.push(body.length);
  return { json: async () => body.map((q) => ({ jsonrpc: '2.0', id: q.id,
    result: contracts.has(q.params[0]) ? '0x6080604052' : delegated.has(q.params[0]) ? `0xef0100${'ab'.repeat(20)}` : '0x' })) };
};

test('module accounts are sha256(name)[:20] (gov = the address gov.sh neuro uses); preinstalls are system addresses', () => {
  assert.equal(moduleAddress('gov'), '0x7b5Fe22B5446f7C62Ea27B8BD71CeF94e03f3dF2');
  assert.ok(SYSTEM_ADDRESSES.has('0xca11bde05977b3631167028862be2a173976ca11'));
  assert.ok(SYSTEM_ADDRESSES.has(moduleAddress('fee_collector').toLowerCase()));
});

test('push-list: cleans, re-checks contracts, sorts by score, cuts at --max; one 0x per line with its sha256', () => withDir(async (d) => {
  const people = Array.from({ length: 8 }, addr);
  const contract = addr(), delegated = addr();
  const rows = [
    'address,score',
    `${people[0]},5`, `${people[1]},90`, `${people[2]},40`,
    `${people[1].toLowerCase()},12`,                               // duplicate (case-insensitive)
    '0x0000000000000000000000000000000000000000,99',               // zero
    '0x0000000000000000000000000000000000000001,99',               // precompile
    '0x000000000000000000000000000000000000dEaD,99',               // burn
    `${moduleAddress('distribution')},99`,                         // ZETAPHY module account
    '0x4e59b44847b379578588920cA78FbF26c0B4956C,99',               // preinstall (CREATE2 proxy)
    `${contract},80`, `${delegated},70`,
    `${people[3]},40`, `${people[4]},3`, `${people[5]},2`,
    'not-an-address,1',
  ];
  const csv = join(d, 'active.csv');
  writeFileSync(csv, rows.join('\n'));
  const calls = [];
  const text = await run(['push-list', csv, '--rpc', 'https://eth.example', '--max', '5', '--batch', '3'], { log: quiet, fetchImpl: rpc(new Set([contract]), new Set([delegated]), calls) });
  assert.equal(typeof text, 'string');
  // score order 90, 70 (EIP-7702-delegated EOA stays), 40, 40 (file order), 5; then 3 and 2 are over --max
  assert.deepEqual(text.trim().split('\n'), [people[1], delegated, people[2], people[3], people[0]]);
  assert.ok(calls.every((n) => n <= 3), 'eth_getCode in batches of --batch');

  const logs = [];
  const out = join(d, 'push.txt');
  const r = await run(['push-list', csv, '--rpc', 'https://eth.example', '--out', out], { log: (s) => logs.push(s), fetchImpl: rpc(new Set([contract])) });
  const lines = readFileSync(out, 'utf8').trim().split('\n');
  assert.equal(r.count, 7);
  assert.equal(lines.length, 7);
  assert.ok(lines.every((l) => /^0x[0-9a-fA-F]{40}$/.test(l) && getAddress(l) === l));
  assert.equal(r.sha256, createHash('sha256').update(readFileSync(out)).digest('hex'));
  assert.deepEqual(r.droppedByReason, { duplicate: 1, 'zero-address': 1, 'precompile-or-reserved': 1, 'known-non-user': 1, 'system-address': 2, 'bad-address': 1, contract: 1 });
  assert.match(logs[0], /push-list: 7 addresses \(10 ZTPHY each = 70 ZTPHY\); dropped 8: .*contracts checked on eth\.example; sha256 of the list [0-9a-f]{64}/);
}));

test('push-list refuses without --rpc (no contract re-check), a bad --max, and stops when the RPC fails', () => withDir(async (d) => {
  const csv = join(d, 'a.csv');
  writeFileSync(csv, `address,score\n${addr()},1\n`);
  await assert.rejects(run(['push-list', csv], { log: quiet }), /--rpc <an Ethereum RPC URL> is required/);
  await assert.rejects(run(['push-list', csv, '--rpc', 'https://x', '--max', '0'], { log: quiet, fetchImpl: rpc() }), /--max/);
  const failing = async () => ({ json: async () => ({ jsonrpc: '2.0', id: 0, error: { message: 'rate limited' } }) });
  await assert.rejects(run(['push-list', csv, '--rpc', 'https://x'], { log: quiet, fetchImpl: failing }), /rate limited/);
}));
