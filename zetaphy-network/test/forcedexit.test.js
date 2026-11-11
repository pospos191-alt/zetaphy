// Forced exit (docs/ANTI-ROLLBACK-OFFCHAIN.md, item Q): when ZETAPHY stops or censors and its validators do not sign
// the escape hatch's exit root within FORCE_AFTER, each holder leaves the lockbox with the proof THEY hold: token(X)'s
// balanceOf[holder] in a ZETAPHY state the light client finalized (IAVL + multistore proof, the same proof code as
// proven releases). ZetaphyForcedExit checks it; HyperlaneLockBoxV2.forcedPay pays, pro rata against the last
// heartbeat's supply. The newest finalized height wins, so a stale proof is corrected by a newer one.
// The route is saphansafety.test.js's (one EVM plays both chains); the light client is KitLightClient (the real
// StarkLightClient's STARK / ML-DSA checks are in starkbridge.test.js); the ZETAPHY state is helpers/starkbridge.js
// zetaphyBlock: a real IAVL evm store and multistore.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { AbiCoder, encodeBytes32String, zeroPadValue, getCreateAddress, keccak256, toBeHex, getBytes } from 'ethers';
import { Address } from '@ethereumjs/util';
import { createChain } from './helpers/evm.js';
import { kitArtifacts, messageIdMetadata, validator } from './helpers/hyperlanekit.js';
import { zetaphyBlock } from './helpers/starkbridge.js';
import { exitTree, exitProof } from '../src/saphansafety.js';

const ZETAPHY = 77390;
const SEPOLIA = 11155111;
const CHAIN = 1n;
const Q = 600;
const DELAY = 3600;
const DAY = 86400;
const E = 10n ** 18n;
const ZERO = '0x' + '00'.repeat(20);
const ROUTE_IN = encodeBytes32String('airlock');
const ROUTE_OUT = encodeBytes32String('out');
const AUDIT = ['https://audits.example/saphan.pdf', '0x' + 'a1'.repeat(32)];
const BALANCE_SLOT = 3n; // BridgedToken: name, symbol, totalSupply, balanceOf
const abi = AbiCoder.defaultAbiCoder();
const b32 = (x) => zeroPadValue(x, 32);
const artifact = (n) => JSON.parse(readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), 'utf8'));
const errorsOf = (...names) => names.flatMap((n) => artifact(n).abi.filter((f) => f.type === 'error'));
const withErrors = (name, ...more) => { const x = artifact(name); return { abi: [...x.abi, ...errorsOf(...more)], bytecode: x.bytecode }; };
const HYP = validator(1);
const OURS = [validator(2), validator(3), validator(4)].sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1));

let sk;
function safetyKit() {
  if (sk) return sk;
  const file = 'SafetyKit.sol';
  const input = { language: 'Solidity', sources: { [file]: { content: readFileSync(new URL(`./helpers/${file}`, import.meta.url), 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  sk = Object.fromEntries(Object.entries(out.contracts[file]).map(([n, x]) => [n, { abi: x.abi, bytecode: '0x' + x.evm.bytecode.object }]));
  return sk;
}

let c, kit, zMailbox;
const a = (n) => c.acct[n].toString();
const eth = (addr) => c.balance(Address.fromString(addr));
const mailboxArt = () => ({ abi: [...kit.KitMailbox.abi, ...errorsOf('HyperlaneLockBoxV2', 'HyperlaneLane', 'BridgeAirlock')], bytecode: kit.KitMailbox.bytecode });

async function route() {
  const r = {};
  r.mailbox = await c.deployRaw(mailboxArt(), [SEPOLIA], 'gov');
  r.guard = await c.deploy('BridgeGuard', [a('gov')], 'gov');
  await r.guard.send('gov', 'createToken', ['ETH from Sepolia (bridged, testnet)', 'sepETH', 18]);
  r.token = await r.guard.call('token');
  r.airlock = await c.deploy('BridgeAirlock', [r.guard.address, ROUTE_IN, a('gov'), 2, Q], 'gov');
  r.hypIsm = await c.deployRaw(kit.KitMessageIdMultisigIsm, [[HYP.address], 1], 'gov');
  r.lane = await c.deploy('HyperlaneLane', [r.airlock.address, a('gov'), zMailbox.address, SEPOLIA, '0x' + '00'.repeat(32), 0, ZERO, r.hypIsm.address], 'gov');
  r.ourIsm = await c.deployRaw(kit.KitMessageIdMultisigIsm, [OURS.map((w) => w.address), 2], 'odeploy');
  const lbAt = getCreateAddress({ from: a('odeploy'), nonce: await c.nonce('odeploy') });
  r.outbox = await c.deployRaw(withErrors('HyperlaneOutbox', 'BridgeGuard'), [r.guard.address, ROUTE_OUT, zMailbox.address, SEPOLIA, CHAIN, b32(lbAt), ZERO], 'gov');
  r.lockbox = await c.deploy('HyperlaneLockBoxV2', [r.mailbox.address, ZETAPHY, CHAIN, b32(r.lane.address), b32(r.outbox.address), ZERO,
    r.ourIsm.address, a('gov'), a('guardian'), 50n * E, DELAY], 'odeploy');
  await r.lane.send('gov', 'setConfig', [zMailbox.address, SEPOLIA, b32(r.lockbox.address), CHAIN, r.lockbox.address]);
  await r.airlock.send('gov', 'setLane', [r.lane.address, true]);
  await r.airlock.send('gov', 'setLane', [a('lane2'), true]);
  await r.guard.send('gov', 'setAudit', AUDIT);
  await r.guard.send('gov', 'setRoute', [ROUTE_IN, r.airlock.address, 100n * E, true]);
  await r.guard.send('gov', 'setOutboundRoute', [ROUTE_OUT, r.outbox.address, 100n * E, true]);
  r.cp = await c.deployRaw(withErrors('SaphanCheckpointer'), [zMailbox.address, SEPOLIA, b32(r.lockbox.address), r.token], 'gov');
  await r.lockbox.send('gov', 'setCheckpointer', [b32(r.cp.address)]);
  // the forced exit: light client (finality on this chain), the proof functions, token(X) and its balanceOf slot
  r.lc = await c.deployRaw(safetyKit().KitLightClient, [], 'gov');
  r.proofs = await c.deploy('ZetaphyBridgeInbox', [r.lc.address, CHAIN, r.token, ZERO, r.token, a('gov'), ZERO, 0n], 'gov');
  r.fe = await c.deployRaw(withErrors('ZetaphyForcedExit', 'HyperlaneLockBoxV2'), [r.lc.address, r.proofs.address, r.lockbox.address, r.token, BALANCE_SLOT, 3 * DAY], 'gov');
  return r;
}
const lastMessage = (mb) => mb.call('lastMessage');
async function relayIn(r) { const m = await lastMessage(r.mailbox); return zMailbox.send('relayer', 'process', [messageIdMetadata(m, [HYP]), m]); }
async function relayOut(r, signers = OURS.slice(0, 2)) { const m = await lastMessage(zMailbox); return r.mailbox.send('relayer', 'process', [messageIdMetadata(m, signers), m]); }

/** who locks `amount` on X and it is minted to them on ZETAPHY. */
async function bridgeIn(r, who, amount) {
  const fee = await r.lockbox.call('quoteLock', [a(who), amount]);
  await r.lockbox.send(who, 'lock', [a(who), amount], amount + fee);
  const n = (await r.lockbox.call('nonce')) - 1n;
  await relayIn(r);
  const t = [CHAIN, r.lockbox.address, n, a(who), a(who), amount];
  await r.airlock.send('lane2', 'attest', t);
  c.advance(Q);
  await r.airlock.send('relayer', 'release', t);
}

/** A heartbeat (carries token(X)'s supply on ZETAPHY now). */
async function beat(r) { c.advance(3600); await r.cp.send('relayer', 'beat', []); await relayOut(r); }

/** ZETAPHY's state at `height` with these token(X) balances; the light client finalizes it unless final === false. */
async function zetaphyState(r, height, balances, { final = true, salt = `s${height}` } = {}) {
  const slots = Object.entries(balances).map(([who, v]) => ({ address: r.token, slot: BigInt(keccak256(abi.encode(['address', 'uint256'], [a(who), BALANCE_SLOT]))), value: toBeHex(v, 32) }));
  const blk = zetaphyBlock({ chainId: 'zetaphy_77390-1', height, slots, salt });
  if (final) await r.lc.send('gov', 'set', [height, '0x' + Buffer.from(blk.appHash).toString('hex')]);
  return (who) => {
    const { iavl, storeOps } = blk.prove(r.token, BigInt(keccak256(abi.encode(['address', 'uint256'], [a(who), BALANCE_SLOT]))));
    const op = (o) => ['0x' + Buffer.from(o.prefix).toString('hex'), '0x' + Buffer.from(o.suffix).toString('hex')];
    return ['0x' + Buffer.from(iavl.leafPrefix).toString('hex'), iavl.path.map(op), storeOps.map(op)];
  };
}

beforeEach(async () => {
  c = await createChain(['gov', 'guardian', 'alice', 'bob', 'carol', 'attacker', 'relayer', 'lane2', 'odeploy', 'watcher']);
  kit = kitArtifacts();
  zMailbox = await c.deployRaw(mailboxArt(), [ZETAPHY], 'gov');
});

/** alice 3 and bob 1 bridged in; a heartbeat says supply 4; then ZETAPHY goes silent. */
async function stopped() {
  const r = await route();
  await r.lockbox.send('gov', 'setForcedExit', [r.fe.address]);
  await bridgeIn(r, 'alice', 3n * E);
  await bridgeIn(r, 'bob', E);
  await beat(r);
  assert.equal(await r.lockbox.call('zetaphySupply'), 4n * E);
  return r;
}

test('setForcedExit: governance only, never once escaping (it cannot be swapped when holders need it)', async () => {
  const r = await route();
  await assert.rejects(r.lockbox.send('attacker', 'setForcedExit', [a('attacker')]), /NotGovernance/);
  await r.lockbox.send('gov', 'setForcedExit', [r.fe.address]);
  c.advance(14 * DAY + 1);
  assert.equal(await r.lockbox.call('escaping'), true);
  await assert.rejects(r.lockbox.send('gov', 'setForcedExit', [a('gov')]), /Escaping/);
  await assert.rejects(r.lockbox.send('attacker', 'forcedPay', [a('attacker'), E]), /NotForcedExit/, 'only the forced exit contract');
});

test('forced exit: validators silent past FORCE_AFTER; each holder proves its own balance at a finalized height and is paid once', async () => {
  const r = await stopped();
  const proof = await zetaphyState(r, 500, { alice: 3n * E, bob: E });
  await assert.rejects(r.fe.send('alice', 'prove', [a('alice'), 500, 3n * E, proof('alice')]), /NotEscaping/, 'ZETAPHY is still alive');
  c.advance(14 * DAY + 1);
  assert.equal(await r.lockbox.call('escaping'), true);
  await assert.rejects(r.fe.send('alice', 'prove', [a('alice'), 500, 3n * E, proof('alice')]), /TooSoon/, 'the validators get FORCE_AFTER to sign an exit root first');
  c.advance(7 * DAY);
  // wrong balance, wrong account, unfinalized height: refused
  await assert.rejects(r.fe.send('alice', 'prove', [a('alice'), 500, 4n * E, proof('alice')]), /BadStateProof/);
  await assert.rejects(r.fe.send('attacker', 'prove', [a('attacker'), 500, 3n * E, proof('alice')]), /BadStateProof/, "alice's proof is not the attacker's");
  await assert.rejects(r.fe.send('alice', 'prove', [a('alice'), 499, 3n * E, proof('alice')]), /Unknown|BadStateProof|revert/, 'a height the light client never finalized');
  await r.fe.send('alice', 'prove', [a('alice'), 500, 3n * E, proof('alice')]);
  await r.fe.send('watcher', 'prove', [a('bob'), 500, E, proof('bob')]);   // anyone may prove for anyone: the money only goes to bob
  await assert.rejects(r.fe.send('alice', 'finalize', [a('alice')]), /TooSoon/, 'the challenge window');
  c.advance(3 * DAY);
  const before = await c.balance('alice');
  await r.fe.send('watcher', 'finalize', [a('alice')]);
  assert.equal((await c.balance('alice')) - before, 3n * E, 'fully backed: paid in full');
  await assert.rejects(r.fe.send('watcher', 'finalize', [a('alice')]), /Paid/);
  await assert.rejects(r.fe.send('alice', 'prove', [a('alice'), 600, 3n * E, proof('alice')]), /Paid/);
  const bobBefore = await c.balance('bob');
  await r.fe.send('watcher', 'finalize', [a('bob')]);
  assert.equal((await c.balance('bob')) - bobBefore, E);
  assert.equal(await r.lockbox.call('forced'), true);
  assert.equal(await r.lockbox.call('locked'), 0n);
  assert.equal(await r.lockbox.call('forcedOwed'), 4n * E);
});

test('after the first forced payout no exit root counts (and an exit root first closes the forced path)', async () => {
  const r = await stopped();
  c.advance(21 * DAY + 1);
  const proof = await zetaphyState(r, 500, { alice: 3n * E });
  await r.fe.send('alice', 'prove', [a('alice'), 500, 3n * E, proof('alice')]);
  c.advance(3 * DAY);
  await r.fe.send('alice', 'finalize', [a('alice')]);
  const owed = [[a('bob'), 4n * E]];
  const { root, total } = exitTree(owed);
  const d = await r.lockbox.call('exitDigest', [root, total]);
  await assert.rejects(r.lockbox.send('relayer', 'submitExitRoot', [root, total, OURS.slice(0, 2).map((w) => w.signMessageSync(getBytes(d)))]), /ExitDone/);
  await assert.rejects(r.lockbox.send('bob', 'escape', [4n * E, exitProof(owed, a('bob'))]), /NotEscaping/);
  await assert.rejects(beat(r), /ExitDone|revert/, 'nothing from ZETAPHY counts any more');

  // the other order: the validators' exit root came in time -> the forced path is closed
  const r2 = await stopped();
  c.advance(14 * DAY + 1);
  const o2 = [[a('alice'), 3n * E], [a('bob'), E]];
  const t2 = exitTree(o2);
  const d2 = await r2.lockbox.call('exitDigest', [t2.root, t2.total]);
  await r2.lockbox.send('relayer', 'submitExitRoot', [t2.root, t2.total, OURS.slice(0, 2).map((w) => w.signMessageSync(getBytes(d2)))]);
  c.advance(7 * DAY);
  const p2 = await zetaphyState(r2, 500, { alice: 3n * E });
  await r2.fe.send('alice', 'prove', [a('alice'), 500, 3n * E, p2('alice')]);
  c.advance(3 * DAY);
  await assert.rejects(r2.fe.send('alice', 'finalize', [a('alice')]), /ExitDone/);
});

test('rollback / stale proof: a later finalized height replaces an earlier one (anyone); an earlier one cannot replace a later one', async () => {
  const r = await stopped();
  c.advance(21 * DAY + 1);
  // at height 500 alice had 3; by height 700 she had sent 2 to carol (her old proof would overclaim)
  const s500 = await zetaphyState(r, 500, { alice: 3n * E, bob: E });
  const s700 = await zetaphyState(r, 700, { alice: E, bob: E, carol: 2n * E });
  await r.fe.send('alice', 'prove', [a('alice'), 500, 3n * E, s500('alice')]);
  await r.fe.send('watcher', 'prove', [a('alice'), 700, E, s700('alice')]);      // the correction, by anyone with the newer state
  await assert.rejects(r.fe.send('alice', 'prove', [a('alice'), 500, 3n * E, s500('alice')]), /NotNewer/);
  await assert.rejects(r.fe.send('alice', 'prove', [a('alice'), 700, E, s700('alice')]), /NotNewer/);
  await r.fe.send('carol', 'prove', [a('carol'), 700, 2n * E, s700('carol')]);
  await r.fe.send('bob', 'prove', [a('bob'), 700, E, s700('bob')]);
  c.advance(3 * DAY);
  for (const who of ['alice', 'carol', 'bob']) {
    const b0 = await c.balance(who);
    await r.fe.send('watcher', 'finalize', [a(who)]);
    assert.equal((await c.balance(who)) - b0, { alice: E, carol: 2n * E, bob: E }[who]);
  }
  assert.equal(await r.lockbox.call('locked'), 0n);
});

test('the cap: never more owed in all than the last heartbeat\'s supply; pro rata when the backing is short', async () => {
  const r = await stopped();
  c.advance(21 * DAY + 1);
  // a (forged-looking but finalized) state that owes more than the supply: the lockbox refuses the overflow
  const s = await zetaphyState(r, 900, { alice: 3n * E, attacker: 2n * E, bob: E });
  await r.fe.send('alice', 'prove', [a('alice'), 900, 3n * E, s('alice')]);
  await r.fe.send('attacker', 'prove', [a('attacker'), 900, 2n * E, s('attacker')]);
  c.advance(3 * DAY);
  await r.fe.send('watcher', 'finalize', [a('alice')]);
  await assert.rejects(r.fe.send('watcher', 'finalize', [a('attacker')]), /OverSupply/, 'only 1 of the 4 supply is left');
  assert.equal(await r.lockbox.call('forcedOwed'), 3n * E);
  // pro rata: the backing short of the supply the last heartbeat reported (here: a release paid out after that
  // heartbeat, the chain silent since; the lockbox holds 1, the heartbeat said 2)
  const r2 = await route();
  await r2.lockbox.send('gov', 'setForcedExit', [r2.fe.address]);
  await bridgeIn(r2, 'alice', 2n * E);
  await beat(r2);
  await r2.outbox.send('alice', 'send', [a('bob'), E]);
  await relayOut(r2);
  const m = await lastMessage(zMailbox);
  c.advance(DELAY);
  await r2.lockbox.send('relayer', 'claim', [keccak256('0x' + m.slice(2 + 77 * 2))]);
  assert.equal(await r2.lockbox.call('locked'), E);
  const supply = await r2.lockbox.call('zetaphySupply');
  c.advance(21 * DAY + 1);
  const st = await zetaphyState(r2, 50, { alice: E });
  await r2.fe.send('alice', 'prove', [a('alice'), 50, E, st('alice')]);
  c.advance(3 * DAY);
  const b0 = await c.balance('alice');
  await r2.fe.send('watcher', 'finalize', [a('alice')]);
  const paid = (await c.balance('alice')) - b0;
  assert.equal(supply, 2n * E, 'the last heartbeat reported 2 on ZETAPHY; the lockbox holds 1');
  assert.equal(paid, E / 2n, 'owed 1 x pool 1 / supply 2');
});

test('a zero balance closes the claim without a payout; an account proven twice at the same height is refused', async () => {
  const r = await stopped();
  c.advance(21 * DAY + 1);
  const s = await zetaphyState(r, 10, { carol: 0n, alice: 3n * E });
  await r.fe.send('carol', 'prove', [a('carol'), 10, 0n, s('carol')]);
  c.advance(3 * DAY);
  const ev = await r.fe.send('carol', 'finalize', [a('carol')]);
  assert.equal(ev.find((e) => e?.name === 'Finalized').args.paid, 0n);
  assert.equal(await r.lockbox.call('forced'), false, 'nothing paid: forced mode not even started');
  await assert.rejects(r.fe.send('carol', 'finalize', [a('bob')]), /NoClaim/);
  assert.ok((await eth(r.lockbox.address)) >= 4n * E);
});

// ---- the holder's own proof: an eth_getProof answer (ICS23 protobuf, as cosmos/evm returns it) -> prove() ----

const pbVar = (n) => { const out = []; let v = BigInt(n); while (v >= 0x80n) { out.push(Number(v & 0x7fn) | 0x80); v >>= 7n; } out.push(Number(v)); return Uint8Array.from(out); };
const cat = (...p) => Uint8Array.from(p.flatMap((x) => [...x]));
const fBytes = (n, b) => cat(pbVar((n << 3) | 2), pbVar(b.length), b);
const fVar = (n, v) => (v ? cat(pbVar(n << 3), pbVar(v)) : new Uint8Array());
/** ICS23 CommitmentProof { exist: ExistenceProof { key, value, leaf, path } } bytes. */
function ics23({ key, value, leaf, path }) {
  const leafB = cat(fVar(1, leaf.hash), fVar(2, leaf.prehashKey), fVar(3, leaf.prehashValue), fVar(4, leaf.length), fBytes(5, leaf.prefix));
  const pathB = path.map((o) => fBytes(4, cat(fVar(1, 1), fBytes(2, o.prefix), fBytes(3, o.suffix))));
  return '0x' + Buffer.from(fBytes(1, cat(fBytes(1, key), fBytes(2, value), fBytes(3, leafB), ...pathB))).toString('hex');
}

test('the proof the wallet keeps: eth_getProof (ICS23 ops) at a certified block -> forcedExitArgs -> prove() pays the holder', async () => {
  const { forcedExitArgs, balanceSlot, decodeExistenceProof } = await import('../src/forcedexit.js');
  const { storageKey, buildIavl, multistoreRoot, multistoreProof } = await import('../src/starkbridge/index.js');
  const r = await stopped();
  c.advance(21 * DAY + 1);
  const slot = balanceSlot(a('alice'));
  const value = getBytes(toBeHex(3n * E, 32));
  const entries = [{ key: storageKey(r.token, BigInt(slot)), value }, { key: storageKey(r.token, 2n), value: getBytes(toBeHex(4n * E, 32)) }];
  const evm = buildIavl(entries, 41);
  const stores = { acc: new Uint8Array(32).fill(1), bank: new Uint8Array(32).fill(2), evm: evm.root, zetaphypq: new Uint8Array(32).fill(3) };
  const appHash = multistoreRoot(stores);
  await r.lc.send('gov', 'set', [42, '0x' + Buffer.from(appHash).toString('hex')]);
  const p = evm.prove(storageKey(r.token, BigInt(slot)));
  const IAVL_LEAF = { hash: 1, prehashKey: 0, prehashValue: 1, length: 1 };
  const answer = { // what the wallet stored (eth_getProof(token, [slot], 42))
    address: r.token, balance: '0x0', storageProof: [{ key: slot, value: toBeHex(3n * E), proof: [
      ics23({ key: p.key, value: p.value, leaf: { ...IAVL_LEAF, prefix: p.leafPrefix }, path: p.path }),
      ics23({ key: new TextEncoder().encode('evm'), value: evm.root, leaf: { hash: 1, prehashKey: 0, prehashValue: 1, length: 1, prefix: Uint8Array.of(0) }, path: multistoreProof(stores, 'evm') }),
    ] }],
  };
  assert.equal(decodeExistenceProof(answer.storageProof[0].proof[1]).path.length, multistoreProof(stores, 'evm').length);
  const args = forcedExitArgs({ proof: answer, height: 42, holder: a('alice'), token: r.token });
  assert.equal(args[2], 3n * E);
  await r.fe.send('watcher', 'prove', args);
  // wrong holder / token / a tampered balance are caught before anything is sent
  assert.throws(() => forcedExitArgs({ proof: answer, height: 42, holder: a('bob'), token: r.token }), /not balanceOf/);
  assert.throws(() => forcedExitArgs({ proof: answer, height: 42, holder: a('alice'), token: a('gov') }), /IAVL proof is for key/);
  assert.throws(() => forcedExitArgs({ proof: { ...answer, storageProof: [{ ...answer.storageProof[0], value: toBeHex(9n * E) }] }, height: 42, holder: a('alice'), token: r.token }), /IAVL proof says/);
  c.advance(3 * DAY);
  const b0 = await c.balance('alice');
  await r.fe.send('watcher', 'finalize', [a('alice')]);
  assert.equal((await c.balance('alice')) - b0, 3n * E);
});
