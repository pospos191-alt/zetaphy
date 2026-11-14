// ZETAPHY Saphan MAINNET (ZTPHY ZETAPHY 3659 <-> Base 8453): the config, the plans the owner signs, the pools, the costs,
// and the two contracts with the mainnet caps on one in-process EVM (a test Mailbox and message-id multisig ISM:
// helpers/HyperlaneKit.sol). The whole route on two local chains with real Hyperlane core is scripts/saphan-mainnet-dryrun.js
// (the saphan-mainnet workflow runs it on a fork of Base mainnet).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { AbiCoder, Interface, Wallet, getAddress, getCreateAddress, keccak256, parseUnits, solidityPacked, zeroPadValue } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import * as P from '../src/saphanpool.js';
import { tokenProblems, NATIVE_ERC20 } from '../src/saphan.js';
import { operationId, TIMELOCK } from '../src/timelock.js';
import { KNOWN_TOKENS } from '../../zetaphy-neuro/src/known-tokens.js';
import { plan } from '../scripts/saphan-mainnet.js';
import { poolPlans } from '../scripts/saphan-pool.js';
import { createChain } from './helpers/evm.js';
import { kitArtifacts, tokenKitArtifacts, messageIdMetadata, validator } from './helpers/hyperlanekit.js';

const committed = () => JSON.parse(readFileSync(M.MAINNET_FILE, 'utf8'));
const E = 10n ** 18n;
const U = (x) => parseUnits(String(x), 18);
const A = (i) => new Wallet(keccak256(solidityPacked(['string', 'uint256'], ['saphan mainnet test', i]))).address;
/** A complete config: the committed one with every owner input filled (throwaway addresses). */
function filled(over = (c) => c) {
  const c = committed();
  c.deployer.address = A(1);
  c.validators.zetaphyOrigin = { validators: [A(2), A(3), A(4)], threshold: 2 };
  c.validators.baseOrigin = { mode: 'ours', validators: [A(5), A(6), A(7)], threshold: 2 };
  c.liquidity.baseRecipient = A(8);
  c.liquidity.pools[1].address = A(9);
  return over(c) ?? c;
}
const STATE = { steps: { 'base-roles': { multisig: A(20), timelock: A(21), ism: A(22), syntheticAt: A(23), nonce: 3, fromBlock: 1000 },
  'zetaphy-vault': { vault: A(24), ism: A(25), block: 500 }, 'base-synthetic': { synthetic: A(23), block: 1005 } } };

test('the committed mainnet config is valid, conservative, and lists exactly the owner inputs still missing', () => {
  const c = committed();
  assert.deepEqual(M.mainnetProblems(c), []);
  assert.equal(c.zetaphy.chainId, 3659);
  assert.equal(c.base.chainId, 8453);
  assert.equal(c.zetaphy.timelock, '0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA');
  assert.equal(c.zetaphy.guardian, '0x54EF410b2C7cbec6238fA6d6D9DbAaEABa0F4519');
  assert.equal(c.liquidity.zetaphyMultisig, '0x859872fBaB7ad2C0663DC0253E61Cea628cA15d1');
  // the same addresses the launch published (zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json)
  const launched = JSON.parse(readFileSync(new URL('../../zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json', import.meta.url), 'utf8'));
  assert.equal(launched.timelock.address, c.zetaphy.timelock);
  assert.equal(launched.timelock.proposer, c.zetaphy.govModule);
  assert.equal(launched.guardianMultisig.address, c.zetaphy.guardian);
  assert.deepEqual(launched.guardianMultisig.owners, c.zetaphy.guardianOwners);
  assert.equal(launched.contracts.ThreatRegistry, c.zetaphy.threats);
  assert.deepEqual(M.missingInputs(c).map((m) => m.field).sort(),
    ['deployer.address', 'liquidity.baseRecipient', 'liquidity.pools[1].address', 'validators.baseOrigin.validators', 'validators.zetaphyOrigin.validators']);
  // the owner's pools: 2 x 1,000,000 ZTPHY + 100 stable, 0.0001 USD per ZTPHY; the caps let 2,000,000 cross in one day
  assert.deepEqual(c.liquidity.pools.map((p) => [p.stable, p.ztphyAmount, p.stableAmount]), [['USDC', '1000000', '100'], ['USDT', '1000000', '100']]);
  const L = c.token.limits;
  assert.ok(U(L.mintDailyLimit) >= U('2000000') && U(L.lockCap) >= U('2000000') && U(L.supplyCap) >= U('2000000'));
  assert.ok(U(L.lockCap) <= U('10000000'), 'at most 1% of the supply can ever be out');
  assert.ok(U(L.releaseDailyLimit) < U(L.mintDailyLimit), 'the way back is tighter');
  assert.ok(L.releaseDelay >= 6 * 3600 && L.mintDelay >= 3600);
  assert.equal(c.validators.allowSingleValidator, false);
  assert.deepEqual(M.mainnetProblems(filled()), []);
  assert.deepEqual(M.missingInputs(filled()), []);
});

test('USDC on Base is the address the repository verified (known-tokens), never the one in the brief; USDT is an owner input', () => {
  const known = KNOWN_TOKENS.base.find((t) => t.symbol === 'USDC');
  assert.equal(known.address, M.BASE_USDC);
  assert.equal(committed().liquidity.pools[0].address, M.BASE_USDC);
  assert.equal(KNOWN_TOKENS.base.find((t) => t.symbol === 'USDT'), undefined, 'no USDT on Base in the repository: it stays an owner input');
  assert.equal(committed().liquidity.pools[1].address, null);
  const brief = filled((c) => { c.liquidity.pools[0].address = '0x833589fCD6eDb6E08f4c7C32D29b5Dd5Ac9F4f8E'; });
  assert.ok(M.mainnetProblems(brief).some((p) => /NOT USDC/.test(p)));
  const other = filled((c) => { c.liquidity.pools[0].address = A(30); });
  assert.ok(M.mainnetProblems(other).some((p) => /USDC on Base is 0x833589/.test(p)));
});

test('a validator set with threshold 1 is refused unless the owner flag is set, and then the plan prints the risk', () => {
  const one = filled((c) => { c.validators.zetaphyOrigin = { validators: [A(2)], threshold: 1 }; });
  assert.ok(M.mainnetProblems(one).some((p) => /zetaphyOrigin: threshold 1 \(1-of-1\).*allowSingleValidator/.test(p)));
  const oneOfTwo = filled((c) => { c.validators.baseOrigin = { mode: 'ours', validators: [A(5), A(6)], threshold: 1 }; });
  assert.ok(M.mainnetProblems(oneOfTwo).some((p) => /baseOrigin: threshold 1 \(1-of-2\)/.test(p)));
  const flagged = filled((c) => { c.validators.zetaphyOrigin = { validators: [A(2)], threshold: 1 }; c.validators.allowSingleValidator = true; });
  assert.deepEqual(M.mainnetProblems(flagged), []);
  const risks = M.riskLines(flagged);
  assert.ok(risks.some((r) => /owner flag allowSingleValidator.*ZETAPHY -> Base is 1-of-1: ONE key/.test(r)));
  assert.ok(risks.some((r) => /NOT audited.*afford to lose/.test(r)));
  assert.ok(risks.some((r) => /ONE validator/.test(r)));
  assert.ok(!M.riskLines(filled()).some((r) => /allowSingleValidator/.test(r)));
  // mode hyperlane: Hyperlane's published 3-of-5 for origin Base
  const hyp = filled((c) => { c.validators.baseOrigin = { mode: 'hyperlane', validators: [], threshold: 1 }; });
  assert.deepEqual(M.mainnetProblems(hyp), []);
  assert.deepEqual(M.baseOriginSet(hyp), committed().validators.hyperlaneBaseDefault);
  assert.ok(!M.missingInputs(hyp).some((m) => m.field === 'validators.baseOrigin.validators'));
});

test('the config refuses what would weaken the route', () => {
  const cases = [
    [(c) => { c.base.threshold = 1; }, /base.threshold: 2/],
    [(c) => { c.base.timelockDelay = 3600; }, /base.timelockDelay/],
    [(c) => { c.zetaphy.timelockDelay = 86400; }, /zetaphy.timelockDelay/],
    [(c) => { c.zetaphy.chainId = 77390; }, /zetaphy: chainId/],
    [(c) => { c.base.domain = 84532; }, /base: chainId and domain/],
    [(c) => { c.token.limits.supplyCap = '3000000'; }, /supplyCap: at most lockCap/],
    [(c) => { c.token.limits.lockCap = '20000000'; c.token.limits.supplyCap = '20000000'; }, /at most 1% of the supply/],
    [(c) => { c.token.limits.mintDailyLimit = '1000000'; }, /the pools need 2000000.0 ZTPHY/],
    [(c) => { c.token.limits.mintDelay = 60; }, /mintDelay/],
    [(c) => { c.token.address = A(40); }, /native coin's ERC-20/],
    [(c) => { c.liquidity.baseRecipient = c.liquidity.zetaphyMultisig; }, /a Safe ON BASE/],
    [(c) => { c.liquidity.baseRecipient = c.zetaphy.guardianOwners[0]; }, /a Safe ON BASE/],
    [(c) => { c.zetaphy.govModuleBech32 = 'zetaphy1' + 'q'.repeat(38); }, /not the bech32 of zetaphy.govModule/],
    [(c) => { c.liquidity.feeTier = 2500; }, /feeTier/],
    [(c) => { c.liquidity.pools[0].ztphyAmount = '0'; }, /ztphyAmount/],
    [(c) => { c.validators.zetaphyOrigin.validators.push(c.validators.zetaphyOrigin.validators[0]); }, /a validator twice/],
    [(c) => { c.network = 'testnet'; }, /network/],
  ];
  for (const [f, re] of cases) assert.ok(M.mainnetProblems(filled(f)).some((p) => re.test(p)), `expected ${re}: ${M.mainnetProblems(filled(f)).join(' | ')}`);
  const f = join(mkdtempSync(join(tmpdir(), 'saphan-mainnet-')), 'cfg.json');
  writeFileSync(f, JSON.stringify(filled((c) => { c.base.threshold = 1; })));
  assert.throws(() => M.loadMainnet(f), /base.threshold/);
  rmSync(dirname(f), { recursive: true });
});

test('the Hyperlane core config hands every owner to the ZETAPHY timelock and trusts the configured Base-origin set', () => {
  const y = M.coreConfigYaml(filled());
  const tl = '0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA';
  for (const k of ['owner', '  owner', '  beneficiary']) assert.ok(y.split('\n').filter((l) => l.startsWith(`${k}:`)).every((l) => l.includes(tl)), k);
  assert.equal(y.split('\n').filter((l) => /owner:|beneficiary:/.test(l)).length, 5);
  assert.match(y, /type: domainRoutingIsm[\s\S]*base:[\s\S]*messageIdMultisigIsm[\s\S]*threshold: 2/);
  const vs = [...y.matchAll(/- "(0x[0-9a-f]{40})"/g)].map((m) => m[1]);
  assert.deepEqual(vs, [A(5), A(6), A(7)].map((a) => a.toLowerCase()).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)));
  assert.match(y, /protocolFee: "0"/);
  assert.throws(() => M.coreConfigYaml(committed()), /no validators yet/);
});

test('the route table feeds the testnet deploy code unchanged: a valid token entry, our validators, the Base roles', () => {
  const core = { mailbox: A(50), merkleTreeHook: A(51), validatorAnnounce: A(52), staticMessageIdMultisigIsmFactory: A(53) };
  const t = M.routeTable(filled(), core);
  assert.deepEqual(tokenProblems({ ...t }), []);
  assert.equal(t.zetaphy.chainId, 3659);
  assert.equal(t.zetaphy.mailbox, core.mailbox);
  assert.equal(t.tokens.ztphy.address, NATIVE_ERC20);
  assert.deepEqual(t.tokens.ztphy.destinations, ['base']);
  assert.deepEqual(t.zetaphyValidators, { validators: [A(2), A(3), A(4)], threshold: 2 });
  assert.deepEqual(t.chains.base.validators, [A(5), A(6), A(7)]);
  assert.equal(t.origin.timelockDelay, 172800);
  assert.throws(() => M.routeTable(filled(), null), /core step first/);
});

test('opening: the gov proposal schedules vault.unpause() on the ZETAPHY timelock; the Base multisig proposes the same to its timelock', () => {
  const c = filled(), p = M.openPlan(c, STATE);
  const msg = p.zetaphy.proposal.messages[0];
  assert.equal(msg['@type'], '/zetaphy.pq.v1.MsgEVMCall');
  assert.equal(msg.Sender, 'zetaphy10d07y265gmmuvt4z0w9aw880jnsr700jvr86lj');
  assert.equal(msg.To, c.zetaphy.timelock);
  assert.equal(p.zetaphy.proposal.deposit, `${10000n * E}azetaphy`);
  const sched = TIMELOCK.decodeFunctionData('schedule', '0x' + Buffer.from(msg.Data, 'base64').toString('hex'));
  assert.equal(sched[0], STATE.steps['zetaphy-vault'].vault);
  assert.equal(sched[2], M.ENDPOINT.encodeFunctionData('unpause'));
  assert.equal(sched[5], 172800n);
  assert.equal(p.zetaphy.operationId, operationId({ target: sched[0], data: sched[2], salt: sched[4] }));
  const ex = TIMELOCK.decodeFunctionData('execute', p.zetaphy.execute);
  assert.equal(ex[4], sched[4]);
  const prop = M.MULTISIG.decodeFunctionData('propose', p.base.proposeSchedule);
  assert.equal(prop[0], STATE.steps['base-roles'].timelock);
  const bs = TIMELOCK.decodeFunctionData('schedule', prop[2]);
  assert.equal(bs[0], STATE.steps['base-synthetic'].synthetic);
  assert.equal(bs[2], M.ENDPOINT.encodeFunctionData('unpause'));
  assert.equal(TIMELOCK.decodeFunctionData('execute', M.MULTISIG.decodeFunctionData('propose', p.base.proposeExecute)[2])[0], bs[0]);
  assert.notEqual(p.zetaphy.salt, p.base.salt);
  assert.throws(() => M.openPlan(c, { steps: {} }), /not deployed yet/);
});

test('pause: each guardian multisig proposes pause() on its end; a veto names the payout id', () => {
  const p = M.pausePlan(filled(), STATE, { veto: '0x' + 'ab'.repeat(32) });
  assert.equal(p.zetaphy.multisig, '0x54EF410b2C7cbec6238fA6d6D9DbAaEABa0F4519');
  assert.deepEqual([...M.MULTISIG.decodeFunctionData('propose', p.zetaphy.pause.propose)].map(String), [STATE.steps['zetaphy-vault'].vault, '0', M.ENDPOINT.encodeFunctionData('pause')]);
  assert.equal(M.MULTISIG.decodeFunctionData('propose', p.base.pause.propose)[0], STATE.steps['base-synthetic'].synthetic);
  assert.equal(p.base.multisig, STATE.steps['base-roles'].multisig);
  assert.equal(M.ENDPOINT.decodeFunctionData('veto', p.zetaphy.veto.data)[0], '0x' + 'ab'.repeat(32));
});

test('the relayer relays only the vault -> Base and the synthetic -> ZETAPHY; the agent config names both chains', () => {
  const c = filled();
  const w = M.relayerWhitelist(c, STATE);
  assert.deepEqual(w.map((x) => [x.originDomain, x.destinationDomain]), [[3659, 8453], [8453, 3659]]);
  assert.equal(w[0].senderAddress, zeroPadValue(STATE.steps['zetaphy-vault'].vault, 32).toLowerCase());
  const env = M.relayerEnv(c, STATE);
  assert.ok(env.includes('HYP_RELAYCHAINS=zetaphy,base'));
  assert.ok(env.includes('HYP_CHAINS_BASE_INDEX_FROM=1000'));
  assert.ok(!env.join('\n').match(/KEY|SIGNER/));
  const ac = M.agentConfig(c, { mailbox: A(50), merkleTreeHook: A(51), validatorAnnounce: A(52) }, { zFrom: 7, baseFrom: 1000 });
  assert.equal(ac.chains.zetaphy.domainId, 3659);
  assert.equal(ac.chains.zetaphy.index.from, 7);
  assert.equal(ac.chains.zetaphy.interchainGasPaymaster, '0x' + '00'.repeat(20));
  assert.equal(ac.chains.base.mailbox, c.base.mailbox);
  assert.equal(ac.chains.base.index.from, 1000);
  assert.ok(!JSON.stringify(ac).match(/"key"|privateKey|signer/i));
});

test('costs: itemised, Base gas scales with the gwei, ZETAPHY at its 1 gwei floor; the plan prints them', () => {
  const c = filled();
  const a = M.costEstimate(c, { baseGasGwei: '0.02' }), b = M.costEstimate(c, { baseGasGwei: '0.04' });
  assert.ok(a.rows.length >= 10);
  for (const r of a.rows) assert.ok(r.cost.endsWith(r.chain === 'zetaphy' ? 'ZTPHY' : 'ETH'));
  const core = a.rows.find((r) => /Hyperlane core/.test(r.what));
  assert.equal(core.cost, `${Number(M.GAS.zetaphy.core) / 1e9} ZTPHY`);
  const l1 = Number(c.costs.baseL1FeeEth) * 4;
  assert.ok(Math.abs((Number(b.totals.baseEth) - l1) - 2 * (Number(a.totals.baseEth) - l1)) < 1e-12);
  assert.equal(Number(b.totals.relayerFloatEth), 2 * Number(a.totals.relayerFloatEth));
  assert.ok(Number(a.totals.zetaphyZtphy) < 1, 'ZETAPHY gas is cheap at 1 gwei');
  const p = plan(c, STATE);
  assert.deepEqual(p.problems, []);
  assert.equal(p.steps.find((s) => s.id === 'zetaphy-vault').state, 'done');
  assert.equal(p.steps.find((s) => s.id === 'core').state, 'todo');
  for (const s of p.steps) assert.match(s.label, /^\[(อ่าน|เปลี่ยนไฟล์|เปลี่ยนเชน|เปลี่ยนการตั้งค่า)\]$/);
});

test('pool math: integer sqrt, the full range, the price the amounts set, how thin $100 a side is', () => {
  for (const n of [0n, 1n, 2n, 15n, 16n, 17n, 10n ** 40n + 12345n, 2n ** 255n]) { const r = P.isqrt(n); assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n); }
  assert.deepEqual(P.fullRange(10000), { tickLower: -887200, tickUpper: 887200, tickSpacing: 200 });
  assert.deepEqual(P.fullRange(3000), { tickLower: -887220, tickUpper: 887220, tickSpacing: 60 });
  // 1,000,000 ZTPHY (18 decimals) and 100 USDC (6 decimals): 0.0001 USDC per ZTPHY, whichever token sorts first
  const Z = U('1000000'), S = 100n * 10n ** 6n;
  for (const [a0, a1, d0, d1] of [[S, Z, 6, 18], [Z, S, 18, 6]]) {
    const sp = P.sqrtPriceX96(a0, a1);
    const raw = (Number(sp) / 2 ** 96) ** 2;                    // token1 per token0, raw units
    const human = raw * 10 ** (d0 - d1);                       // token1 per token0, whole tokens
    const ztphyPerStable = d0 === 6 ? human : 1 / human;
    assert.ok(Math.abs(ztphyPerStable - 10000) / 10000 < 1e-9, `${ztphyPerStable}`);
  }
  const i10 = P.priceImpact({ stable: '100', ztphy: '1000000', buyUsd: 10, feeTier: 10000 });
  const i50 = P.priceImpact({ stable: '100', ztphy: '1000000', buyUsd: 50, feeTier: 10000 });
  assert.ok(Math.abs(i10.movePct - 20.8) < 0.1, `${i10.movePct}`);
  assert.ok(Math.abs(i50.movePct - 123.5) < 0.1, `${i50.movePct}`);
  assert.ok(i10.priceBefore === 0.0001 && i10.ztphyOut > 90000 && i10.ztphyOut < 91000);
});

test('the pool plan: approvals, create at the owner price, mint full range to the Safe with 1% minimums; a Safe batch per pool', () => {
  const c = filled(), syn = STATE.steps['base-synthetic'].synthetic;
  const x = poolPlans(c, STATE, { deadline: 2_000_000_000 });
  assert.equal(x.pools.length, 2);
  for (const p of x.pools) {
    assert.equal(p.txs.length, 4);
    assert.deepEqual(p.txs.map((t) => t.to), [syn, p.stableAddress, c.liquidity.uniswapV3.positionManager, c.liquidity.uniswapV3.positionManager]);
    assert.deepEqual([...P.ERC20.decodeFunctionData('approve', p.txs[0].data)].map(String), [c.liquidity.uniswapV3.positionManager, String(U('1000000'))]);
    const cr = P.NPM.decodeFunctionData('createAndInitializePoolIfNecessary', p.txs[2].data);
    assert.ok(BigInt(cr[0]) < BigInt(cr[1]));
    assert.equal(cr[2], 10000n);
    assert.equal(String(cr[3]), p.sqrtPriceX96);
    const [m] = P.NPM.decodeFunctionData('mint', p.txs[3].data);
    assert.equal(m.recipient, c.liquidity.baseRecipient);
    assert.equal(m.tickLower, -887200n);
    assert.equal(m.amount0Min, (m.amount0Desired * 99n) / 100n);
    assert.equal(m.deadline, 2_000_000_000n);
    assert.equal(p.batch.chainId, '8453');
    assert.equal(p.batch.transactions.length, 4);
    assert.ok(Math.abs(p.price - 0.0001) < 1e-12);
    assert.equal(p.impacts.length, 2);
  }
  assert.deepEqual(x.warnings, []);
  // USDT not set: no calldata, a warning to verify it on basescan, the price and impact still shown
  const y = poolPlans(committed(), STATE, {});
  assert.ok(y.warnings.some((w) => /USDT.*basescan/.test(w)));
  assert.equal(y.pools[1].missing, 'address');
  assert.ok(y.pools[1].impacts[0].movePct > 20);
});

test('the bridge for the pools: one Cosmos tx of two MsgEVMCall from the liquidity multisig, approve + lock 2,000,000 ZTPHY for the Safe', () => {
  const c = filled(), b = P.bridgePlan(c, STATE);
  assert.equal(b.total, String(U('2000000')));
  assert.equal(b.sender, M.zetaphyBech32(c.liquidity.zetaphyMultisig));
  const msgs = b.unsigned.body.messages;
  assert.equal(msgs.length, 2);
  assert.ok(msgs.every((m) => m['@type'] === '/zetaphy.pq.v1.MsgEVMCall' && m.Sender === b.sender && m.Value === '0'));
  const hex = (m) => '0x' + Buffer.from(m.Data, 'base64').toString('hex');
  assert.equal(msgs[0].To, NATIVE_ERC20);
  assert.deepEqual([...P.ERC20.decodeFunctionData('approve', hex(msgs[0]))].map(String), [STATE.steps['zetaphy-vault'].vault, String(U('2000000'))]);
  assert.equal(msgs[1].To, STATE.steps['zetaphy-vault'].vault);
  assert.deepEqual([...new Interface(['function lock(address,uint256)']).decodeFunctionData('lock', hex(msgs[1]))].map(String), [c.liquidity.baseRecipient, String(U('2000000'))]);
  assert.equal(b.unsigned.auth_info.fee.amount[0].denom, 'azetaphy');
  assert.equal(BigInt(b.unsigned.auth_info.fee.amount[0].amount), BigInt(b.unsigned.auth_info.fee.gas_limit) * 10n ** 9n);
  assert.throws(() => P.bridgePlan(committed(), STATE), /baseRecipient/);
  assert.throws(() => P.bridgePlan(c, { steps: {} }), /no ZetaphyTokenVault/);
});

// ---------------------------------------------------------------- the contracts with the mainnet caps (one in-process EVM)

const ZETAPHY = 3659, BASE = 8453, CHAIN = 1n;
const ZERO = '0x' + '00'.repeat(20);
const b32 = (x) => zeroPadValue(x, 32);
const art = (n) => JSON.parse(readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), 'utf8'));
const OURS = [validator(31), validator(32)].sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1));
const BASEV = [validator(33), validator(34)].sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1));
let ch, kit, R;
const a = (n) => ch.acct[n].toString();
const idOf = (m) => keccak256('0x' + m.slice(2 + 77 * 2));

beforeEach(async () => {
  ch = await createChain(['gov', 'guardian', 'bgov', 'bguardian', 'liq', 'safe', 'relayer', 'attacker', 'zdeploy', 'bdeploy']);
  kit = kitArtifacts();
  const tk = tokenKitArtifacts();
  const L = committed().token.limits;
  const errs = ['ZetaphyTokenVault', 'SaphanSyntheticToken'].flatMap((n) => art(n).abi.filter((f) => f.type === 'error'));
  const mb = { abi: [...kit.KitMailbox.abi, ...errs], bytecode: kit.KitMailbox.bytecode };
  R = { L };
  R.zMailbox = await ch.deployRaw(mb, [ZETAPHY], 'gov');
  R.bMailbox = await ch.deployRaw(mb, [BASE], 'gov');
  R.token = await ch.deployRaw(tk.KitToken, ['ZTPHY (test)', 'ZTPHY', 18], 'gov');
  await R.token.send('gov', 'mint', [a('liq'), U('3000000')]);
  const zIsm = await ch.deployRaw(kit.KitMessageIdMultisigIsm, [BASEV.map((w) => w.address), 2], 'gov');
  const bIsm = await ch.deployRaw(kit.KitMessageIdMultisigIsm, [OURS.map((w) => w.address), 2], 'gov');
  const synAt = getCreateAddress({ from: a('bdeploy'), nonce: await ch.nonce('bdeploy') });
  const cfg = (o) => [o.mailbox, o.remoteDomain, CHAIN, b32(o.remote), ZERO, R.token.address, o.ism, o.gov, o.guardian, o.limit, o.delay];
  R.vault = await ch.deploy('ZetaphyTokenVault', [cfg({ mailbox: R.zMailbox.address, remoteDomain: BASE, remote: synAt, ism: zIsm.address, gov: a('gov'), guardian: a('guardian'),
    limit: U(L.releaseDailyLimit), delay: L.releaseDelay }), 18, U(L.lockCap), ZERO], 'zdeploy');
  R.syn = await ch.deploy('SaphanSyntheticToken', ['ZTPHY (bridged from ZETAPHY)', 'ZTPHY', 18, cfg({ mailbox: R.bMailbox.address, remoteDomain: ZETAPHY, remote: R.vault.address,
    ism: bIsm.address, gov: a('bgov'), guardian: a('bguardian'), limit: U(L.mintDailyLimit), delay: L.mintDelay }), U(L.supplyCap)], 'bdeploy');
  assert.equal(R.syn.address.toLowerCase(), synAt.toLowerCase());
  await R.vault.send('gov', 'unpause');
  await R.syn.send('bgov', 'unpause');
});

async function lockAndMint(amount, { claim = true } = {}) {
  await R.token.send('liq', 'approve', [R.vault.address, amount]);
  await R.vault.send('liq', 'lock', [a('safe'), amount]);
  const m = await R.zMailbox.call('lastMessage');
  await R.bMailbox.send('relayer', 'process', [messageIdMetadata(m, OURS), m]);
  if (claim) { ch.advance(R.L.mintDelay); await R.syn.send('relayer', 'claim', [idOf(m)]); }
  return m;
}

test('mainnet caps on the contracts: the pools\' 2,000,000 ZTPHY cross in one day; lockCap, supplyCap and the daily mint limit hold', async () => {
  await assert.rejects(R.vault.send('liq', 'lock', [a('safe'), 0n]));
  await lockAndMint(U('2000000'));
  assert.equal(await R.syn.call('balanceOf', [a('safe')]), U('2000000'));
  const m2 = await lockAndMint(U('500000'), { claim: false });
  ch.advance(R.L.mintDelay);
  await assert.rejects(R.syn.send('relayer', 'claim', [idOf(m2)]), /OverLimit/);                   // 2,000,000 already minted today
  ch.advance(86400);
  await R.syn.send('relayer', 'claim', [idOf(m2)]);
  assert.equal(await R.syn.call('totalSupply'), U(R.L.supplyCap));
  await R.token.send('liq', 'approve', [R.vault.address, E]);
  await assert.rejects(R.vault.send('liq', 'lock', [a('safe'), E]), /OverCap/);                      // lockCap 2,500,000
});

test('mainnet caps on the contracts: a release waits 6 h and the daily release limit; guardians pause at once, only governance opens', async () => {
  await lockAndMint(U('2000000'));
  await R.syn.send('safe', 'sendBack', [a('liq'), U('300000')]);                                  // more than one day's release
  const m = await R.bMailbox.call('lastMessage');
  await assert.rejects(R.zMailbox.send('relayer', 'process', [messageIdMetadata(m, OURS), m]));     // our ZETAPHY-origin validators do not sign Base -> ZETAPHY
  await R.zMailbox.send('relayer', 'process', [messageIdMetadata(m, BASEV), m]);
  await assert.rejects(R.vault.send('relayer', 'claim', [idOf(m)]), /NotReady/);
  ch.advance(R.L.releaseDelay);
  await assert.rejects(R.vault.send('relayer', 'claim', [idOf(m)]), /OverLimit/);                   // 300,000 > 250,000 a day: waits for governance (docs: send back at most the daily limit)
  await R.syn.send('safe', 'sendBack', [a('liq'), U('200000')]);
  const m2 = await R.bMailbox.call('lastMessage');
  await R.zMailbox.send('relayer', 'process', [messageIdMetadata(m2, BASEV), m2]);
  ch.advance(R.L.releaseDelay);
  await R.vault.send('relayer', 'claim', [idOf(m2)]);
  assert.equal(await R.vault.call('locked'), U('1800000'));
  // pause: the guardian of each end, at once; a guardian cannot open
  await R.vault.send('guardian', 'pause');
  await R.syn.send('bguardian', 'pause');
  await R.token.send('liq', 'approve', [R.vault.address, E]);
  await assert.rejects(R.vault.send('liq', 'lock', [a('safe'), E]), /IsPaused/);
  await assert.rejects(R.syn.send('safe', 'sendBack', [a('liq'), E]), /IsPaused/);
  await assert.rejects(R.vault.send('guardian', 'unpause'), /NotGovernance/);
  await assert.rejects(R.syn.send('attacker', 'pause'), /NotGuardian/);
  await R.vault.send('gov', 'unpause');
  await R.vault.send('liq', 'lock', [a('safe'), E]);
});

test('mainnet route on the contracts: a forged message (validly signed, wrong sender) and a mint signed by the wrong set are refused', async () => {
  const body = AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'uint256', 'address', 'address', 'uint256', 'uint256', 'address', 'address'],
    [CHAIN, R.syn.address, 99n, a('attacker'), a('attacker'), U('1000'), CHAIN, R.vault.address, R.token.address]);
  const forged = solidityPacked(['uint8', 'uint32', 'uint32', 'bytes32', 'uint32', 'bytes32', 'bytes'], [3, 77, BASE, b32(a('attacker')), ZETAPHY, b32(R.vault.address), body]);
  await assert.rejects(R.zMailbox.send('relayer', 'process', [messageIdMetadata(forged, BASEV), forged]), /WrongSender/);
  await R.token.send('liq', 'approve', [R.vault.address, E]);
  await R.vault.send('liq', 'lock', [a('safe'), E]);
  const m = await R.zMailbox.call('lastMessage');
  await assert.rejects(R.bMailbox.send('relayer', 'process', [messageIdMetadata(m, BASEV), m]));    // the Base-origin set cannot mint on Base
  await assert.rejects(R.bMailbox.send('relayer', 'process', [messageIdMetadata(m, [OURS[0]]), m])); // 1 of 2
  await R.bMailbox.send('relayer', 'process', [messageIdMetadata(m, OURS), m]);
  assert.equal(await R.syn.call('received'), 1n);
});
