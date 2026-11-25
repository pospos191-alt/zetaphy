// The Neuro validator (src/neurovalidator.js, scripts/neuro-validator.js): Hyperlane's merkle tree, the checkpoint
// digest (checked by a message-id multisig ISM in a local EVM: our Hyperlane validator + the Neuro validator, 2 of 2),
// the decision (what it refuses), and one pass over a mocked ZETAPHY writing checkpoint files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AbiCoder, Interface, Wallet, concat, getAddress, keccak256, toBeHex, zeroPadValue, solidityPacked, parseEther, id as keccakId } from 'ethers';
import { MerkleTree, ZEROES, decodeMessage, decide, checkpointHash, signedCheckpoint, announcement, EVENTS, b32 } from '../src/neurovalidator.js';
import { pass, storage, setup } from '../scripts/neuro-validator.js';
import { createChain } from './helpers/evm.js';
import { kitArtifacts, validator } from './helpers/hyperlanekit.js';

const VAULT = getAddress('0x' + 'a1'.repeat(20)), SYN = getAddress('0x' + 'b2'.repeat(20)), HOOK = getAddress('0x' + 'c3'.repeat(20));
const MAILBOX = getAddress('0x' + 'd4'.repeat(20)), THREATS = getAddress('0x' + 'e5'.repeat(20)), TOKEN = getAddress('0x' + 'ee'.repeat(20));
const ALICE = getAddress('0x' + '0a'.repeat(20)), BOB = getAddress('0x' + '0b'.repeat(20)), EVE = getAddress('0x' + '0e'.repeat(20));
const ROUTES = [{ name: 'bsc', vault: VAULT, synthetic: SYN, domain: 56, chainId: 56, mintDailyLimit: parseEther('1000000') }];
const neuro = new Wallet(keccak256(solidityPacked(['string'], ['neuro validator test key'])));

const body = ({ nonce = 0n, sender = ALICE, to = BOB, amount = parseEther('10'), src = VAULT, dst = SYN, dstChain = 56 } = {}) =>
  AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'uint256', 'address', 'address', 'uint256', 'uint256', 'address', 'address'], [3659, src, nonce, sender, to, amount, dstChain, dst, TOKEN]);
const message = ({ nonce = 0, sender = VAULT, destination = 56, recipient = SYN, b = body() } = {}) =>
  concat([new Uint8Array([3]), toBeHex(nonce, 4), toBeHex(3659, 4), b32(sender), toBeHex(destination, 4), b32(recipient), b]);
const sentEv = (m, { nonce = 0n, sender = ALICE, to = BOB, amount = parseEther('10'), address = VAULT } = {}) =>
  ({ address, args: { nonce, sender, to, amount, messageId: keccak256(m) } });

test('MerkleTree: the empty root is Hyperlane\'s, and the incremental root equals the full tree for 1..9 leaves', () => {
  assert.equal(new MerkleTree().root(), '0x27ae5ba08d7291c96c8cbddcc148bf48a6d68c7974b94356f53754ef6171d757');
  const leaves = Array.from({ length: 9 }, (_, i) => keccakId(`leaf ${i}`));
  const full = (ls, level, idx) => {
    if (idx * 2 ** level >= ls.length) return ZEROES[level];
    if (level === 0) return ls[idx];
    return keccak256(concat([full(ls, level - 1, 2 * idx), full(ls, level - 1, 2 * idx + 1)]));
  };
  const t = new MerkleTree();
  for (let n = 1; n <= leaves.length; n++) {
    t.insert(leaves[n - 1]);
    assert.equal(t.root(), full(leaves.slice(0, n), 32, 0), `${n} leaves`);
  }
  assert.equal(new MerkleTree(t.toJSON()).root(), t.root(), 'state round-trips');
});

test('decodeMessage reads a version-3 Hyperlane message', () => {
  const m = message({ nonce: 7 });
  const d = decodeMessage(m);
  assert.deepEqual([d.version, d.nonce, d.origin, d.destination], [3, 7, 3659, 56]);
  assert.equal(getAddress('0x' + d.sender.slice(26)), VAULT);
  assert.equal(d.id, keccak256(m));
});

test('decide: signs only a vault message that matches its Sent event, within the limit, from and to addresses Neuro does not hold', () => {
  const ok = message();
  const D = (m, sent, held) => decide(decodeMessage(m), { routes: ROUTES, origin: 3659, sent, held });
  assert.deepEqual(D(ok, [sentEv(ok)]), { sign: true, route: 'bsc', to: BOB, amount: parseEther('10') });
  assert.match(D(message({ sender: EVE }), []).reason, /not from a Saphan vault/);
  assert.match(D(message({ recipient: EVE }), []).reason, /not the synthetic/);
  assert.match(D(message({ destination: 8453 }), []).reason, /to domain 8453/);
  assert.match(D(ok, []).reason, /no Sent event of the vault/);
  assert.match(D(ok, [sentEv(ok, { address: EVE })]).reason, /no Sent event of the vault/);
  assert.match(D(ok, [sentEv(ok, { amount: parseEther('11') })]).reason, /disagree/);
  const big = message({ b: body({ amount: parseEther('2000000') }) });
  assert.match(D(big, [sentEv(big, { amount: parseEther('2000000') })]).reason, /above the bsc daily mint limit/);
  const forged = message({ b: body({ dst: EVE }) });
  assert.match(D(forged, [sentEv(forged)]).reason, /another source, destination or chain/);
  const held = D(ok, [sentEv(ok)], { [BOB.toLowerCase()]: true });
  assert.equal(held.sign, false);
  assert.equal(held.wait, true);
  assert.match(held.reason, /Neuro holds the receiver/);
});

test('a 2-of-2 message-id multisig ISM (our Hyperlane validator + the Neuro validator) accepts both signatures and refuses one', async () => {
  const c = await createChain(['gov']);
  const kit = kitArtifacts();
  const sentry = validator(1);
  const vs = [sentry.address, neuro.address].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const ism = await c.deployRaw(kit.KitMessageIdMultisigIsm, [vs, 2], 'gov');
  const m = message();
  const root = keccakId('a root'), index = 4;
  const cp = signedCheckpoint(neuro, { origin: 3659, merkleTreeHook: HOOK, root, index, messageId: keccak256(m) });
  assert.equal(cp.value.checkpoint.merkle_tree_hook_address, b32(HOOK));
  assert.equal(cp.value.message_id, keccak256(m));
  const sentrySig = sentry.signMessageSync(Buffer.from(checkpointHash({ origin: 3659, merkleTreeHook: HOOK, root, index, messageId: keccak256(m) }).slice(2), 'hex'));
  const sigs = vs.map((v) => (v === neuro.address ? cp.serialized_signature : sentrySig));
  const iface = new Interface(kit.KitMessageIdMultisigIsm.abi);
  const meta = concat([zeroPadValue(HOOK, 32), root, toBeHex(index, 4), ...sigs]);
  assert.equal(await c.callAt(ism.address, iface, 'verify', [meta, m]), true);
  // the sentry's key alone (a stolen key) is not enough
  const one = concat([zeroPadValue(HOOK, 32), root, toBeHex(index, 4), sentrySig]);
  await assert.rejects(() => c.callAt(ism.address, iface, 'verify', [one, m]));
  // the r/s/v form Hyperlane's agents store
  assert.match(cp.signature.r, /^0x[0-9a-f]+$/);
  assert.ok([27, 28].includes(cp.signature.v));
});

test('announcement: the digest ValidatorAnnounce signs over (domain, mailbox, "HYPERLANE_ANNOUNCEMENT", location)', () => {
  const a = announcement(neuro, { mailbox: MAILBOX, validatorAnnounce: HOOK, domain: 3659, storageLocation: 'gs://bucket/neuro' });
  const dh = keccak256(solidityPacked(['uint32', 'bytes32', 'string'], [3659, b32(MAILBOX), 'HYPERLANE_ANNOUNCEMENT']));
  assert.equal(a.inner, keccak256(solidityPacked(['bytes32', 'string'], [dh, 'gs://bucket/neuro'])));
  assert.equal(a.file.value.storage_location, 'gs://bucket/neuro');
  assert.equal(a.file.value.validator, neuro.address);
});

// ---------------------------------------------------------------- one pass over a mocked ZETAPHY

function mockZetaphy() {
  const z = { head: 100, leaves: [], receipts: {}, held: new Set(), lie: false };
  const tree = () => { const t = new MerkleTree(); for (const l of z.leaves) t.insert(l.id); return t; };
  const HOOKI = new Interface(['function root() view returns (bytes32)', 'function count() view returns (uint32)']);
  const TI = new Interface(['function isContractHeld(address) view returns (bool, uint8)']);
  z.p = {
    getBlockNumber: async () => z.head,
    getLogs: async ({ fromBlock, toBlock }) => z.leaves.filter((l) => l.block >= fromBlock && l.block <= toBlock).map((l, _i) => ({
      address: HOOK, blockNumber: l.block, transactionHash: l.tx, ...EVENTS.encodeEventLog('InsertedIntoTree', [l.id, l.index]) })),
    getTransactionReceipt: async (h) => ({ logs: z.receipts[h] ?? [] }),
    call: async (tx) => {
      if (getAddress(tx.to) === THREATS) { const [a] = TI.decodeFunctionData('isContractHeld', tx.data); return TI.encodeFunctionResult('isContractHeld', [z.held.has(getAddress(a)), 0]); }
      const fn = HOOKI.parseTransaction({ data: tx.data }).name;
      const t = tree();
      return HOOKI.encodeFunctionResult(fn, [fn === 'root' ? (z.lie ? keccakId('other') : t.root()) : t.count]);
    },
  };
  z.dispatch = (block, m, { sent = true, to = BOB } = {}) => {
    const id = keccak256(m), tx = keccakId(`tx ${z.leaves.length}`);
    z.leaves.push({ id, index: z.leaves.length, block, tx });
    const logs = [{ address: MAILBOX, ...EVENTS.encodeEventLog('Dispatch', [VAULT, 56, b32(SYN), m]) }];
    if (sent) logs.push({ address: VAULT, ...EVENTS.encodeEventLog('Sent', [0n, ALICE, to, parseEther('10'), id]) });
    z.receipts[tx] = logs;
    return id;
  };
  return z;
}

test('pass: rebuilds the tree, signs the real transfer, refuses a forged one, holds a Neuro-flagged one until it is lifted', async () => {
  const z = mockZetaphy();
  const dir = mkdtempSync(join(tmpdir(), 'neuro-validator-'));
  const store = storage(`file://${dir}`);
  const conf = { origin: 3659, mailbox: MAILBOX, merkleTreeHook: HOOK, threats: THREATS, routes: ROUTES };
  const real = message({ nonce: 0 });
  z.dispatch(10, real);
  z.dispatch(11, message({ nonce: 1, b: body({ nonce: 1n, to: EVE }) }), { sent: false }); // no vault Sent: forged path
  const flagged = message({ nonce: 2, b: body({ to: EVE }) });
  z.dispatch(12, flagged, { to: EVE });
  z.held.add(EVE);
  let r = await pass({ p: z.p, conf, wallet: neuro, store, state: null, chunk: 4 });
  assert.deepEqual(r.signed, [0]);
  assert.deepEqual(r.refused.map((x) => x.index), [1]);
  assert.deepEqual(r.waiting, [2]);
  const cp = JSON.parse(readFileSync(join(dir, 'checkpoint_0_with_id.json'), 'utf8'));
  assert.equal(cp.value.message_id, keccak256(real));
  assert.equal(cp.value.checkpoint.index, 0);
  assert.equal(readFileSync(join(dir, 'checkpoint_latest_index.json'), 'utf8'), '0');
  assert.ok(!existsSync(join(dir, 'checkpoint_1_with_id.json')));
  // Neuro lifts the hold: the waiting message is signed on the next pass, with its own root
  z.held.delete(EVE);
  z.head = 101;
  r = await pass({ p: z.p, conf, wallet: neuro, store, state: r.state });
  assert.deepEqual(r.signed, [2]);
  assert.equal(readFileSync(join(dir, 'checkpoint_latest_index.json'), 'utf8'), '2');
  // a node that answers a different root than the events: nothing signed
  z.lie = true;
  z.dispatch(102, message({ nonce: 3, b: body({ nonce: 3n }) }));
  z.head = 103;
  await assert.rejects(() => pass({ p: z.p, conf, wallet: neuro, store, state: r.state }), /not the hook's/);
});

test('setup reads the mainnet routes, the core addresses and Neuro\'s registry from the committed config', () => {
  const s = setup();
  assert.equal(s.origin, 3659);
  assert.deepEqual(s.routes.map((r) => [r.name, r.domain]), [['base', 8453], ['bsc', 56]]);
  assert.ok(s.threats && s.merkleTreeHook && s.validatorAnnounce && s.mailbox);
});

test('saphan-ism: the new set keeps every current validator, adds the Neuro one, needs 2+; the plan schedules exactly setInterchainSecurityModule on the synthetic', async () => {
  const { newSet, ismPlan } = await import('../scripts/saphan-ism.js');
  const M = await import('../src/saphanmainnet.js');
  const cfg = M.loadMainnet(), st = M.loadState();
  const cur = cfg.validators.zetaphyOrigin.validators;
  const s = newSet(cur, neuro.address);
  assert.equal(s.threshold, 2);
  assert.deepEqual([...s.validators].sort(), [...cur.map(getAddress), neuro.address].sort());
  assert.ok(BigInt(s.validators[0]) < BigInt(s.validators[1]), 'sorted, as the factory wants');
  assert.throws(() => newSet(cur, cur[0]), /already a validator/);
  assert.throws(() => newSet(cur, neuro.address, 1), /--threshold/);
  assert.throws(() => newSet(cur, neuro.address, 3), /--threshold/);
  const ism = getAddress('0x' + '15'.repeat(20));
  for (const route of ['bsc', 'base']) {
    const p = ismPlan(cfg, st, { route, ism, ...s });
    const d = M.deployedRoute(cfg, st, route);
    const TLI = new Interface(['function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)']);
    const sch = TLI.parseTransaction({ data: p.schedule });
    assert.equal(getAddress(sch.args.target), getAddress(d.synthetic));
    assert.equal(sch.args.data, new Interface(['function setInterchainSecurityModule(address)']).encodeFunctionData('setInterchainSecurityModule', [ism]));
    assert.equal(Number(sch.args.delay), 172800);
    const pr = M.MULTISIG.parseTransaction({ data: p.proposeSchedule });
    assert.equal(getAddress(pr.args[0]), getAddress(d.timelock));
    assert.equal(pr.args[2], p.schedule);
  }
});

test('pass asks the node for at most 2000 blocks per eth_getLogs (the node refuses wider ranges)', async () => {
  const { pass, LOG_CHUNK } = await import('../scripts/neuro-validator.js');
  assert.equal(LOG_CHUNK, 2000);
  const ranges = [];
  const p = { getBlockNumber: async () => 10_001, getLogs: async (f) => { ranges.push(f.toBlock - f.fromBlock + 1); throw new Error('stop after the first range'); } };
  await assert.rejects(() => pass({ p, conf: { merkleTreeHook: '0x' + '11'.repeat(20) }, state: null }), /stop/);
  assert.deepEqual(ranges, [2000]);
  await assert.rejects(() => pass({ p, conf: {}, state: null, chunk: 5000 }), /at most 2000/);
});

test('saphan-ism status: finds the hook leaf for a checkpoint in ranges the node accepts (at most 2000 blocks), newest first', async () => {
  const { findLeaf, LOG_CHUNK } = await import('../scripts/saphan-ism.js');
  const HOOK = '0x' + 'af'.repeat(20), TOPIC = '0x253a3a04cab70d47c1504809242d9350cd81627b4f1d50753e159cf8cd76ed33';
  const leaves = [{ block: 120, id: '0x' + '11'.repeat(32), index: 0 }, { block: 7_345, id: '0x' + '22'.repeat(32), index: 1 }, { block: 9_990, id: '0x' + '33'.repeat(32), index: 2 }];
  const asked = [];
  const p = {
    getBlockNumber: async () => 10_000,
    getLogs: async ({ address, topics, fromBlock, toBlock }) => {
      if (toBlock - fromBlock + 1 > LOG_CHUNK) throw new Error('maximum [from, to] blocks distance: 2000');
      assert.equal(address, HOOK); assert.deepEqual(topics, [TOPIC]);
      asked.push([fromBlock, toBlock]);
      return leaves.filter((l) => l.block >= fromBlock && l.block <= toBlock).map((l) => ({ data: l.id + l.index.toString(16).padStart(64, '0') }));
    },
  };
  assert.deepEqual(await findLeaf(p, HOOK, 1), { id: leaves[1].id, index: 1 });
  assert.deepEqual(await findLeaf(p, HOOK, 0, { parallel: 1 }), { id: leaves[0].id, index: 0 });
  assert.equal(await findLeaf(p, HOOK, 9), null, 'an index the hook never inserted');
  assert.ok(asked.every(([a, b]) => b - a + 1 <= LOG_CHUNK && a >= 0));
  assert.deepEqual(asked[0], [8_001, 10_000], 'newest range first');
  await assert.rejects(findLeaf(p, HOOK, 0, { chunk: 5000 }), /at most 2000/);
});

test('pass on gs:// storage: the latest index is also written as "gcsLatestIndexKey", and the relayer\'s objects at the bucket root, where Hyperlane reads them', async () => {
  const z = mockZetaphy();
  const writes = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.startsWith('http://metadata.google.internal/')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    const name = /"name":"([^"]+)"/.exec(init.body)[1];
    const body = String(init.body).split('\r\n\r\n')[2].split('\r\n--')[0];
    writes.push([name, body]);
    return { ok: true, text: async () => '' };
  };
  const store = storage('gs://zetaphy-neuro-test/neuro', { fetchImpl });
  assert.equal(store.kind, 'gs');
  const conf = { origin: 3659, mailbox: MAILBOX, merkleTreeHook: HOOK, threats: THREATS, routes: ROUTES };
  z.dispatch(10, message({ nonce: 0 }));
  const r = await pass({ p: z.p, conf, wallet: neuro, store, state: null, chunk: 4 });
  assert.deepEqual(r.signed, [0]);
  // in the folder (what the tools and auditors read), and the objects Hyperlane's relayer reads also at the bucket root:
  // it parses "gs://bucket/folder" as the bucket with no folder
  assert.deepEqual(writes.map(([n]) => n), ['neuro/checkpoint_0_with_id.json', 'checkpoint_0_with_id.json', 'neuro/checkpoint_latest_index.json', 'neuro/gcsLatestIndexKey', 'gcsLatestIndexKey']);
  assert.equal(writes[1][1], writes[0][1], 'the root copy is the same signed checkpoint');
  assert.equal(writes[4][1], '0');
  assert.equal(storage(`file://${mkdtempSync(join(tmpdir(), 'nv-'))}`).kind, 'file');
});
