// The identity commands on either ZETAPHY network (mainnet 3659, the testnet 77390): ZETAPHY's entry in the chain
// list, the registry's deploy arguments, signed messages and their source chain all take the chain id of the
// connected RPC (or --chain-id), never a fixed 77390. The runner and job commands take mainnet too (NeuroJobs is
// deployed there); every other CLI command stays on a local devnet and refuses mainnet in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// a throwaway home: the commands keep their key and settings there
const HOME = mkdtempSync(join(tmpdir(), 'zetaphy-idnet-'));
process.env.ZETAPHY_HOME = HOME;
const { neuroChainsFor, NEURO_CHAINS, chainArgs, ZETAPHY_EVM_CHAIN_IDS } = await import('../src/identity.js');
const { identityCommand, evmChainId, IDENTITY_CHAINS } = await import('../src/identitycli.js');
const { verifyMessage } = await import('../src/neuromsg.js');
const { wrongChainMessage, RUNNER_CHAINS, MAINNET_RPC } = await import('../cli.js');
test.after(() => rmSync(HOME, { recursive: true, force: true }));

const REGISTRY = `0x${'12'.repeat(20)}`;

test('neuroChainsFor: ZETAPHY under the chain the registry is deployed on (mainnet 3659 -> eip155:3659), the rest unchanged', () => {
  const m = neuroChainsFor(3659n);
  assert.equal(m.zetaphy.caip2, 'eip155:3659');
  assert.equal(m.zetaphy.rule, NEURO_CHAINS.zetaphy.rule);
  for (const k of Object.keys(NEURO_CHAINS).filter((x) => x !== 'zetaphy')) assert.deepEqual(m[k], NEURO_CHAINS[k], k);
  assert.deepEqual(neuroChainsFor(77390), NEURO_CHAINS, 'the testnet: the list as it always was');
  assert.equal(NEURO_CHAINS.zetaphy.caip2, 'eip155:77390', 'the shared list is not changed');
  const [keys, caip2s, rules] = chainArgs(m);
  assert.deepEqual([keys[0], caip2s[0], rules.length], ['zetaphy', 'eip155:3659', keys.length]);
  assert.deepEqual(ZETAPHY_EVM_CHAIN_IDS, { mainnet: 3659n, testnet: 77390n });
  assert.deepEqual(IDENTITY_CHAINS, [3659n, 77390n]);
  assert.throws(() => neuroChainsFor(0), /not an EVM chain id/);
});

test('evmChainId: --chain-id when given (no RPC), else the connected RPC\'s', async () => {
  const never = async () => { throw new Error('no RPC should be asked'); };
  assert.equal(await evmChainId({ 'chain-id': '3659' }, {}, never), 3659n);
  await assert.rejects(evmChainId({ 'chain-id': 'mainnet' }, {}, never), /--chain-id must be a whole number/);
  const rpc = async () => ({ getNetwork: async () => ({ chainId: 3659n }) });
  assert.equal(await evmChainId({}, { rpc: 'https://x' }, rpc), 3659n);
});

test('the identity commands ask cli.js for an RPC on either ZETAPHY network', async () => {
  const asked = [];
  const stop = Object.assign(new Error('stop'), { stop: true });
  const connectRpc = async (_s, o) => { asked.push(['rpc', o]); throw stop; };
  const connect = async (_s, o) => { asked.push(['signer', o]); throw stop; };
  const base = { opt: {}, env: {}, write: () => {}, s: { rpc: 'https://x' }, connect, connectRpc };
  await assert.rejects(identityCommand({ ...base, group: 'identity', cmd: 'get', rest: ['zetaphy', `0x${'ab'.repeat(20)}`] }), /stop/);
  await assert.rejects(identityCommand({ ...base, group: 'identity', cmd: 'register', rest: ['zetaphy', `0x${'ab'.repeat(20)}`] }), /stop/);
  await assert.rejects(identityCommand({ ...base, group: 'deploy-identity', cmd: undefined, rest: [], opt: { web: 'https://neuro.example/web/' } }), /stop/);
  assert.deepEqual(asked.map(([k, o]) => [k, o.chains]), [['rpc', IDENTITY_CHAINS], ['signer', IDENTITY_CHAINS], ['signer', IDENTITY_CHAINS]]);
});

test('msg sign on mainnet: the envelope names chain 3659 and eip155:3659, and verifies only against that chain', async () => {
  let out = '';
  const code = await identityCommand({ group: 'msg', cmd: 'sign', rest: ['hello'], opt: { identity: REGISTRY, from: '7', payload: '{"name":"runner"}', 'chain-id': '3659' },
    env: {}, write: (t) => { out += t; }, s: {}, connect: null, connectRpc: async () => { throw new Error('--chain-id given: no RPC'); } });
  assert.equal(code, 0);
  const env = JSON.parse(out);
  assert.equal(env.domain.chainId, '3659');
  assert.equal(env.message.sourceChain, 'eip155:3659');
  const ok = { isRunner: async () => false, isOperator: async () => true, isRegistryHeld: async () => false };
  assert.equal((await verifyMessage(out, { expect: { chainId: 3659n, registry: REGISTRY }, ...ok })).ok, true);
  assert.equal((await verifyMessage(out, { expect: { chainId: 77390n, registry: REGISTRY }, ...ok })).ok, false, 'not valid on the testnet');
  // without --chain-id: the RPC's chain id
  out = '';
  await identityCommand({ group: 'msg', cmd: 'sign', rest: ['hello'], opt: { identity: REGISTRY, from: '7', payload: '{"name":"runner"}' }, env: {}, write: (t) => { out += t; }, s: { rpc: 'https://x' },
    connect: null, connectRpc: async (_s, o) => { assert.deepEqual(o.chains, IDENTITY_CHAINS); return { getNetwork: async () => ({ chainId: 77390n }) }; } });
  assert.deepEqual([JSON.parse(out).domain.chainId, JSON.parse(out).message.sourceChain], ['77390', 'eip155:77390']);
});

test('a command whose contracts are not on mainnet stays on a local devnet: mainnet is refused in plain words', () => {
  const m = wrongChainMessage(3659n);
  assert.match(m, /ZETAPHY mainnet \(chain 3659\)/);
  assert.match(m, /contracts that are not on mainnet yet/);
  assert.match(m, /refuses to act on mainnet/);
  assert.match(m, /a local ZETAPHY devnet \(77390\) only/);
  assert.match(m, /testnet was shut down on 2026-11-14/);
  assert.doesNotMatch(m, /sawasdeecoin/);
  assert.equal(wrongChainMessage(1n), 'that RPC is chain 1, not a local ZETAPHY devnet (77390)');
  assert.equal(wrongChainMessage(5n, [3659n, 77390n]), 'that RPC is chain 5, not ZETAPHY mainnet (3659) or a local ZETAPHY devnet (77390)');
});

test('the runner and job commands act on mainnet (NeuroJobs is deployed there) or a devnet, nothing else', () => {
  assert.deepEqual(RUNNER_CHAINS, [3659n, 77390n]);
  assert.equal(MAINNET_RPC, 'https://129-221-199-191.sslip.io');
  assert.equal(wrongChainMessage(1n, RUNNER_CHAINS), 'that RPC is chain 1, not ZETAPHY mainnet (3659) or a local ZETAPHY devnet (77390)');
  const cli = readFileSync(new URL('../cli.js', import.meta.url), 'utf8');
  for (const head of ["group === 'node' && cmd === 'start'", "group === 'node' && cmd === 'status'", "group === 'node' && cmd === 'register'",
    "group === 'job' && cmd === 'get'", "group === 'gate'"]) {
    const at = cli.indexOf(head);
    assert.ok(at > 0, head);
    assert.match(cli.slice(at, at + 1200), /connect\(s, \{ chains: RUNNER_CHAINS \}\)/, `${head} takes mainnet`);
  }
  // deploys make new contracts: a local devnet only (the default)
  for (const head of ["group === 'deploy') {", "group === 'deploy-control'", "group === 'deploy-pq'"]) {
    const at = cli.indexOf(head);
    assert.ok(at > 0, head);
    assert.match(cli.slice(at, at + 200), /connect\(s, \{ needJobs: false \}\)/, `${head} stays devnet only`);
  }
});
