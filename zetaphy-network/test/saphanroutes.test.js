// ZETAPHY Saphan MAINNET, the other destinations (BNB Smart Chain 56 and Arbitrum One 42161 open, Polygon PoS 137
// prepared but disabled): the per-route config and its refusals, a disabled entry refused everywhere, the PancakeSwap v3
// pool with an 18-decimal stable, the bridge per destination, the agents naming every chain, the costs in each gas token,
// and the contracts of a second route (its own vault) next to Base's on one in-process EVM. test/saphanmainnet.test.js
// keeps the Base route's tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AbiCoder, Wallet, getAddress, getCreateAddress, keccak256, parseUnits, solidityPacked, zeroPadValue } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import * as P from '../src/saphanpool.js';
import { NATIVE_ERC20, tokenProblems } from '../src/saphan.js';
import { TIMELOCK } from '../src/timelock.js';
import { KNOWN_TOKENS } from '../../zetaphy-neuro/src/known-tokens.js';
import { plan, context, stepRoles, stepVault, stepSynthetic } from '../scripts/saphan-mainnet.js';
import { poolPlans } from '../scripts/saphan-pool.js';
import { createChain } from './helpers/evm.js';
import { kitArtifacts, tokenKitArtifacts, messageIdMetadata, validator } from './helpers/hyperlanekit.js';

const committed = () => JSON.parse(readFileSync(M.MAINNET_FILE, 'utf8'));
const U = (x) => parseUnits(String(x), 18);
const A = (i) => new Wallet(keccak256(solidityPacked(['string', 'uint256'], ['saphan routes test', i]))).address;
const OPEN = ['bsc', 'arbitrum'];
/** The committed config with every owner input of every open route filled (throwaway addresses). */
function filled(over = (c) => c) {
  const c = committed();
  c.deployer.address = A(1);
  c.validators.zetaphyOrigin = { validators: [A(2), A(3), A(4)], threshold: 2 };
  for (const [n, i] of [['bsc', 60], ['arbitrum', 70], ['polygon', 80]]) {
    const d = c.destinations[n];
    d.owners = [A(i), A(i + 1), A(i + 2)];
    d.liquidity.recipient = A(i + 3);
    d.funding = { ...d.funding, deployer: '1', relayer: '100' };
  }
  return over(c) ?? c;
}
const steps = (n, base) => ({ [`${n}-roles`]: { multisig: A(base), timelock: A(base + 1), ism: A(base + 2), syntheticAt: A(base + 3), nonce: 3, fromBlock: 9000 + base },
  [`zetaphy-vault-${n}`]: { vault: A(base + 4), ism: A(base + 5), block: 600 + base }, [`${n}-synthetic`]: { synthetic: A(base + 3), block: 9005 + base } });
const STATE = { steps: { 'base-roles': { multisig: A(20), timelock: A(21), ism: A(22), syntheticAt: A(23), nonce: 3, fromBlock: 1000 },
  'zetaphy-vault': { vault: A(24), ism: A(25), block: 500 }, 'base-synthetic': { synthetic: A(23), block: 1005 }, ...steps('bsc', 100), ...steps('arbitrum', 200) } };

test('the committed routes: Base, BSC and Arbitrum One open, Polygon PoS prepared but disabled; every address as verified', () => {
  const c = committed();
  assert.deepEqual(M.mainnetProblems(c), []);
  assert.deepEqual(M.routeNames(c), ['base', 'bsc', 'arbitrum']);
  assert.deepEqual(M.routeNames(c, { all: true }), ['base', 'bsc', 'arbitrum', 'polygon']);
  assert.equal(c.destinations.polygon.enabled, false);
  for (const n of ['bsc', 'arbitrum']) assert.equal(c.destinations[n].enabled, true);
  const b = M.route(c, 'bsc'), a = M.route(c, 'arbitrum'), p = M.route(c, 'polygon');
  assert.deepEqual([b.chainId, b.domain, b.nativeToken.symbol], [56, 56, 'BNB']);
  assert.deepEqual([a.chainId, a.domain, a.nativeToken.symbol], [42161, 42161, 'ETH']);
  assert.deepEqual([p.chainId, p.domain, p.nativeToken.symbol], [137, 137, 'POL']);
  // hyperlane-registry 099d9d2a chains/<chain>/addresses.yaml
  assert.deepEqual(b.core, { mailbox: '0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4', merkleTreeHook: '0xFDb9Cd5f9daAA2E4474019405A328a88E7484f26', validatorAnnounce: '0x7024078130D9c2100fEA474DAD009C2d1703aCcd',
    staticMessageIdMultisigIsmFactory: '0x4B1d8352E35e3BDE36dF5ED2e73C24E35c4a96b7', interchainGasPaymaster: '0x78E25e7f84416e69b9339B0A6336EB6EFfF6b451' });
  assert.equal(a.core.mailbox, '0x979Ca5202784112f4738403dBec5D0F3B9daabB9');
  assert.equal(p.core.mailbox, '0x5d934f4e2f797775e53561bB72aca21ba36B96BB');
  // Hyperlane's published sets (hyperlane-monorepo 5db7d808 multisigIsm.ts): BSC 4 of 6, Arbitrum 3 of 5, Polygon 2 of 3
  assert.deepEqual([b.hyperlaneDefault.threshold, b.hyperlaneDefault.validators.length], [4, 6]);
  assert.deepEqual([a.hyperlaneDefault.threshold, a.hyperlaneDefault.validators.length], [3, 5]);
  assert.deepEqual([p.hyperlaneDefault.threshold, p.hyperlaneDefault.validators.length], [2, 3]);
  assert.deepEqual(M.originSet(c, 'bsc'), c.destinations.bsc.hyperlaneDefault);
  // PancakeSwap v3 on BSC (pancake-v3-contracts 98684794 deployments/bscMainnet.json); Uniswap v3 on Arbitrum (sdk-core baff6d3c)
  assert.deepEqual([b.liquidity.dex, b.liquidity.factory, b.liquidity.positionManager], ['pancakeswap-v3', '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865', '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364']);
  assert.deepEqual([a.liquidity.dex, a.liquidity.factory, a.liquidity.positionManager], ['uniswap-v3', '0x1F98431c8aD98523631AE4a59f267346ea31F984', '0xC36442b4a4522E871399CD717aBDD847Ab11FE88']);
  // the stables agree with the repository's own verified list (zetaphy-neuro known-tokens.js)
  const known = (chain, sym) => KNOWN_TOKENS[chain].find((t) => t.symbol === sym).address;
  assert.equal(b.liquidity.verifiedTokens.USDT.address, known('bsc', 'USDT'));
  assert.equal(b.liquidity.verifiedTokens.USDC.address, known('bsc', 'USDC'));
  assert.equal(a.liquidity.verifiedTokens.USDC.address, known('arbitrum', 'USDC'));
  assert.equal(b.liquidity.verifiedTokens.USDT.decimals, 18);
  assert.equal(b.liquidity.verifiedTokens.USDC.decimals, 18);
  assert.equal(a.liquidity.verifiedTokens.USDC.decimals, 6);
  // the default pools: 500,000 ZTPHY + 50 stable (USDT on BSC, native USDC on Arbitrum and Polygon), 0.0001 USD per ZTPHY, 1% tier
  for (const [r, sym] of [[b, 'USDT'], [a, 'USDC'], [p, 'USDC']]) {
    assert.deepEqual(r.liquidity.pools.map((x) => [x.stable, x.ztphyAmount, x.stableAmount]), [[sym, '500000', '50']]);
    assert.equal(r.liquidity.feeTier, 10000);
    assert.equal(r.liquidity.recipient, null, 'the Safe is an owner input per chain (the same address as on Base is not assumed)');
    assert.equal(r.owners, null);
    assert.deepEqual(r.ownersSuggested, c.zetaphy.guardianOwners);
  }
  // the open routes' vaults together stay under 1% of the supply
  const sum = M.routeNames(c).reduce((s, n) => s + U(M.route(c, n).limits.lockCap), 0n);
  assert.ok(sum <= U('10000000'), `${sum}`);
  assert.deepEqual(M.mainnetProblems(filled()), []);
  assert.deepEqual(M.missingInputs(filled()), []);
});

test('a disabled entry (Polygon) is refused by every deploy, open and agent step; enabled with its inputs it plans like the others', async () => {
  const c = filled();
  assert.throws(() => M.enabledRoute(c, 'polygon'), /route polygon is disabled/);
  assert.ok(!M.missingInputs(committed()).some((m) => m.chain === 'polygon'), 'a disabled route lists no missing inputs');
  assert.ok(M.missingInputs(committed(), { all: true }).some((m) => m.chain === 'polygon'));
  const ctx = context({ cfg: c, state: { steps: {} }, core: { mailbox: A(50), merkleTreeHook: A(51), validatorAnnounce: A(52), staticMessageIdMultisigIsmFactory: A(53) }, stateFile: '/dev/null' });
  for (const f of [stepRoles, stepVault, stepSynthetic]) await assert.rejects(f(ctx, { route: 'polygon' }), /route polygon is disabled/);
  const st = { steps: { ...STATE.steps, ...steps('polygon', 300) } };
  assert.throws(() => M.openPlan(c, st, { route: 'polygon' }), /disabled/);
  assert.throws(() => M.agentConfig(c, { mailbox: A(50) }, { routes: ['polygon'], from: { polygon: 1 } }), /disabled/);
  assert.ok(!M.relayerWhitelist(c, st).some((w) => w.destinationDomain === 137 || w.originDomain === 137), 'the relayer never relays a disabled route');
  assert.ok(!plan(c, st).steps.some((s) => s.route === 'polygon'));
  assert.equal(M.costEstimate(c).routes.polygon, undefined);
  assert.ok(poolPlans(c, st, { route: 'polygon' }).warnings.some((w) => /disabled/.test(w)));
  // the same entry enabled, with its inputs filled: a valid route
  const on = filled((x) => { x.destinations.polygon.enabled = true; });
  assert.deepEqual(M.mainnetProblems(on), []);
  assert.deepEqual(M.missingInputs(on), []);
  assert.deepEqual(M.routeNames(on), ['base', 'bsc', 'arbitrum', 'polygon']);
  const pp = plan(on, st);
  assert.deepEqual(pp.problems, []);
  assert.deepEqual(pp.steps.filter((s) => s.route === 'polygon').map((s) => [s.id, s.state]),
    [['polygon-roles', 'done'], ['zetaphy-vault-polygon', 'done'], ['polygon-synthetic', 'done'], ['verify-polygon', 'todo'], ['open-polygon', 'todo']]);
  assert.ok(pp.costs.routes.polygon.rows.filter((r) => r.chain === 'polygon').every((r) => r.cost.endsWith(' POL')));
  const x = poolPlans(on, st, { route: 'polygon', deadline: 2_000_000_000 });
  assert.deepEqual(x.warnings, []);
  assert.equal(x.pools[0].batch.chainId, '137');
  assert.equal(x.pools[0].txs[2].to, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88');
  assert.equal(M.openPlan(on, st, { route: 'polygon' }).destination.multisig, st.steps['polygon-roles'].multisig);
  // an explicit boolean only
  assert.ok(M.mainnetProblems(filled((y) => { y.destinations.polygon.enabled = 'no'; })).some((p) => /polygon.enabled: true or false/.test(p)));
});

test('the BSC route refuses what would weaken it (and Base is checked as before)', () => {
  const B = 'destinations.bsc';
  const cases = [
    [(c) => { c.destinations.bsc.threshold = 1; }, new RegExp(`${B}.threshold: 2`)],
    [(c) => { c.destinations.bsc.owners = [A(60)]; }, new RegExp(`${B}.threshold: 2..number of owners`)],
    [(c) => { c.destinations.bsc.owners = [A(60), A(60)]; }, /an owner twice/],
    [(c) => { c.destinations.bsc.timelockDelay = 3600; }, new RegExp(`${B}.timelockDelay`)],
    [(c) => { c.destinations.bsc.chainId = 8453; c.destinations.bsc.domain = 8453; }, /chainId: 8453 is also base's/],
    [(c) => { c.destinations.bsc.domain = 3659; }, /domain: 3659 is ZETAPHY's/],
    [(c) => { c.destinations.bsc.hyperlane.mailbox = null; }, new RegExp(`${B}.hyperlane.mailbox: not a 0x address`)],
    [(c) => { c.destinations.bsc.rpc = ['http://bsc.example']; }, new RegExp(`${B}.rpc: https`)],
    [(c) => { c.destinations.bsc.nativeToken.decimals = 8; }, /nativeToken/],
    [(c) => { c.destinations.bsc.liquidity.feeTier = 3000; }, /feeTier: 100, 500, 2500, 10000 \(PancakeSwap v3/],
    [(c) => { c.destinations.bsc.liquidity.dex = 'sushiswap'; }, /liquidity.dex/],
    [(c) => { c.destinations.bsc.liquidity.pools[0].address = A(90); }, /USDT on BNB Smart Chain is 0x55d398326f99059fF775485246999027B3197955/],
    [(c) => { c.destinations.bsc.liquidity.pools[0].decimals = 6; }, /USDT on BNB Smart Chain has 18 decimals/],
    [(c) => { c.destinations.bsc.liquidity.recipient = c.zetaphy.guardianOwners[0]; }, /a Safe ON BNB SMART CHAIN/],
    [(c) => { c.destinations.bsc.liquidity.recipient = c.liquidity.zetaphyMultisig; }, /a Safe ON BNB SMART CHAIN/],
    [(c) => { c.destinations.bsc.limits.supplyCap = '2000000'; }, new RegExp(`${B}.limits.supplyCap: at most lockCap`)],
    [(c) => { c.destinations.bsc.limits.mintDailyLimit = '100000'; }, /the pools need 500000.0 ZTPHY on BNB Smart Chain/],
    [(c) => { c.destinations.bsc.limits.releaseDelay = 60; }, /releaseDelay/],
    [(c) => { c.destinations.bsc.limits.lockCap = '7000000'; c.destinations.bsc.limits.supplyCap = '7000000'; }, /open routes together: 10500000.0 ZTPHY, at most 1% of the supply/],
    [(c) => { c.destinations.bsc.originValidators = { mode: 'ours', validators: [A(91)], threshold: 1 }; }, /originValidators: threshold 1 \(1-of-1\)/],
    [(c) => { c.destinations.bsc.hyperlaneDefault = null; }, /needs destinations.bsc.hyperlaneDefault/],
    [(c) => { c.destinations.bsc.funding.deployer = '-1'; }, /funding.deployer: an amount of BNB/],
    [(c) => { c.destinations.bsc.costs.gasGwei = 'cheap'; }, /costs.gasGwei: a number/],
    [(c) => { c.destinations.base = { ...c.destinations.bsc }; }, /destinations.base: Base is configured at the top level/],
    [(c) => { c.destinations.BSC2 = { ...c.destinations.bsc, chainId: 97, domain: 97 }; }, /a route name of 2-20 letters/],
  ];
  for (const [f, re] of cases) { const p = M.mainnetProblems(filled(f)); assert.ok(p.some((x) => re.test(x)), `expected ${re}: ${p.join(' | ')}`); }
  // a PancakeSwap tier that Uniswap does not have is fine on BSC; the same tier on Base is refused
  assert.deepEqual(M.mainnetProblems(filled((c) => { c.destinations.bsc.liquidity.feeTier = 2500; })), []);
  assert.ok(M.mainnetProblems(filled((c) => { c.liquidity.feeTier = 2500; })).some((p) => /liquidity.feeTier/.test(p)));
  // USDC on BSC (Binance-Peg, 18 decimals) is accepted as an alternative stable
  const usdc = filled((c) => { c.destinations.bsc.liquidity.pools = [{ stable: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, stableAmount: '50', ztphyAmount: '500000' }]; });
  assert.deepEqual(M.mainnetProblems(usdc), []);
  // a missing BSC input never blocks a Base step (step ids are matched exactly)
  for (const m of M.missingInputs(committed()).filter((x) => x.chain === 'bsc')) assert.ok(!m.blocks.split(/[\s,()]+/).some((s) => ['base-roles', 'zetaphy-vault', 'base-synthetic'].includes(s)), m.blocks);
});

test('PancakeSwap v3 pool math: per-DEX tick spacing and full range; an 18-decimal stable at exactly 0.0001 USD', () => {
  assert.deepEqual(P.fullRange(2500, 'pancakeswap-v3'), { tickLower: -887250, tickUpper: 887250, tickSpacing: 50 });
  assert.deepEqual(P.fullRange(10000, 'pancakeswap-v3'), { tickLower: -887200, tickUpper: 887200, tickSpacing: 200 });
  assert.deepEqual(P.fullRange(10000), P.fullRange(10000, 'uniswap-v3'));
  assert.throws(() => P.fullRange(2500), /fee tier 2500/);
  assert.throws(() => P.fullRange(3000, 'pancakeswap-v3'), /PancakeSwap v3/);
  assert.throws(() => P.fullRange(500, 'curve'), /dex curve/);
  // 500,000 ZTPHY and 50 USDT, both 18 decimals: the raw ratio is exactly 10,000, so sqrtPriceX96 is exact either way round
  const Z = U('500000'), S = U('50');
  assert.equal(P.sqrtPriceX96(S, Z), 100n * P.Q96);                   // USDT is token0: 10,000 ZTPHY per USDT
  assert.equal(P.sqrtPriceX96(Z, S), P.Q96 / 100n);                   // ZTPHY is token0: 0.0001 USDT per ZTPHY (floor)
  assert.equal(P.Q96 % 100n, 36n, '2^96 / 100 is not whole: the floor is within 1 wei of the price');
  // compared with a 6-decimal stable (Base, Arbitrum): the same human price, a 10^6 different raw ratio
  assert.equal(P.sqrtPriceX96(Z, 50n * 10n ** 6n), P.isqrt((50n * 10n ** 6n << 192n) / Z));
  assert.notEqual(P.sqrtPriceX96(Z, 50n * 10n ** 6n), P.sqrtPriceX96(Z, S));
});

test('the BSC pool plan: PancakeSwap v3 position manager, 18-decimal USDT, the owner price, full range, 1% minimums, a Safe batch for chain 56', () => {
  const c = filled(), syn = STATE.steps['bsc-synthetic'].synthetic, npm = c.destinations.bsc.liquidity.positionManager, usdt = '0x55d398326f99059fF775485246999027B3197955';
  for (const fee of [10000, 2500]) {
    const cf = filled((x) => { x.destinations.bsc.liquidity.feeTier = fee; });
    const x = poolPlans(cf, STATE, { route: 'bsc', deadline: 2_000_000_000 });
    assert.deepEqual(x.warnings, []);
    assert.equal(x.pools.length, 1);
    const p = x.pools[0];
    assert.equal(p.dex, 'pancakeswap-v3');
    assert.equal(p.stableDecimals, 18);
    assert.equal(p.price, 0.0001);
    assert.deepEqual(p.txs.map((t) => t.to), [syn, usdt, npm, npm]);
    assert.match(p.txs[0].what, /PancakeSwap v3 position manager/);
    assert.deepEqual([...P.ERC20.decodeFunctionData('approve', p.txs[0].data)].map(String), [npm, String(U('500000'))]);
    assert.deepEqual([...P.ERC20.decodeFunctionData('approve', p.txs[1].data)].map(String), [npm, String(U('50'))]);
    const cr = P.NPM.decodeFunctionData('createAndInitializePoolIfNecessary', p.txs[2].data);
    assert.ok(BigInt(cr[0]) < BigInt(cr[1]));
    assert.equal(cr[2], BigInt(fee));
    const usdtFirst = BigInt(usdt) < BigInt(syn);
    assert.equal(cr[3], usdtFirst ? 100n * P.Q96 : P.Q96 / 100n, 'exactly 0.0001 USDT per ZTPHY');
    const [m] = P.NPM.decodeFunctionData('mint', p.txs[3].data);
    const { tickLower, tickUpper } = P.fullRange(fee, 'pancakeswap-v3');
    assert.deepEqual([m.tickLower, m.tickUpper], [BigInt(tickLower), BigInt(tickUpper)]);
    assert.equal(m.recipient, c.destinations.bsc.liquidity.recipient);
    assert.deepEqual(usdtFirst ? [m.amount0Desired, m.amount1Desired] : [m.amount1Desired, m.amount0Desired], [U('50'), U('500000')]);
    assert.equal(m.amount0Min, (m.amount0Desired * 99n) / 100n);
    assert.equal(m.amount1Min, (m.amount1Desired * 99n) / 100n);
    assert.equal(p.batch.chainId, '56');
    assert.equal(p.batch.transactions.length, 4);
    assert.ok(p.impacts[0].movePct > 30, 'thin: $50 a side');
  }
  // the token order flips with the synthetic's address; the price stays 0.0001
  for (const ztphy of ['0x' + '00'.repeat(19) + '01', '0x' + 'ff'.repeat(20)]) {
    const p = poolPlans(c, STATE, { route: 'bsc', ztphy }).pools[0];
    const sp = BigInt(p.sqrtPriceX96), raw = (Number(sp) / 2 ** 96) ** 2;
    const usdPerZtphy = p.token0 === getAddress(ztphy) ? raw : 1 / raw;    // 18 and 18 decimals: raw = human
    assert.ok(Math.abs(usdPerZtphy - 0.0001) < 1e-15, `${usdPerZtphy}`);
  }
  // the committed BSC pool still builds (placeholders for the Safe) and warns that the Safe is missing
  const y = poolPlans(committed(), STATE, { route: 'bsc' });
  assert.ok(y.warnings.some((w) => /destinations.bsc.liquidity.recipient \(the Safe on BNB Smart Chain\) is not set/.test(w)));
  // Arbitrum: Uniswap v3 with 6-decimal native USDC
  const ar = poolPlans(c, STATE, { route: 'arbitrum' }).pools[0];
  assert.equal(ar.stableAddress, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
  assert.equal(ar.price, 0.0001);
  assert.equal(ar.batch.chainId, '42161');
});

test('the bridge per destination: the liquidity multisig locks into THAT route\'s vault for THAT route\'s Safe', () => {
  const c = filled();
  const hex = (m) => '0x' + Buffer.from(m.Data, 'base64').toString('hex');
  for (const n of ['base', ...OPEN]) {
    const S = M.route(c, n).steps, b = P.bridgePlan(c, STATE, n);
    const vault = STATE.steps[S.vault].vault, safe = M.route(c, n).liquidity.recipient;
    assert.equal(b.vault, vault);
    assert.equal(b.recipient, safe);
    const msgs = b.unsigned.body.messages;
    assert.equal(msgs[0].To, NATIVE_ERC20);
    assert.deepEqual([...P.ERC20.decodeFunctionData('approve', hex(msgs[0]))].map(String), [vault, b.total]);
    assert.equal(msgs[1].To, vault);
    const total = M.route(c, n).liquidity.pools.reduce((s, p) => s + U(p.ztphyAmount), 0n);
    assert.equal(b.total, String(total));
    assert.equal(b.claim.to, STATE.steps[S.synthetic].synthetic);
  }
  assert.equal(P.bridgePlan(c, STATE, 'bsc').total, String(U('500000')));
  assert.notEqual(P.bridgePlan(c, STATE, 'bsc').vault, P.bridgePlan(c, STATE, 'base').vault);
  assert.throws(() => P.bridgePlan(committed(), STATE, 'bsc'), /destinations.bsc.liquidity.recipient \(the Safe on BNB Smart Chain\)/);
  assert.throws(() => P.bridgePlan(c, { steps: { ...STATE.steps, 'zetaphy-vault-bsc': undefined } }, 'bsc'), /zetaphy-vault-bsc/);
});

test('route table, opening and pause per route: the deploy code gets the BSC chain, its own vault, synthetic, multisig and timelock', () => {
  const c = filled(), core = { mailbox: A(50), merkleTreeHook: A(51), validatorAnnounce: A(52), staticMessageIdMultisigIsmFactory: A(53) };
  const t = M.routeTable(c, core, 'bsc');
  assert.deepEqual(tokenProblems({ ...t }), []);
  assert.deepEqual(t.tokens.ztphy.destinations, ['bsc']);
  assert.equal(t.chains.bsc.mailbox, c.destinations.bsc.hyperlane.mailbox);
  assert.equal(t.chains.bsc.threshold, 4);
  assert.deepEqual(t.origin.owners, c.destinations.bsc.owners);
  assert.equal(t.tokens.ztphy.limits.lockCap, '1000000');
  const o = M.openPlan(c, STATE, { route: 'bsc' }), ob = M.openPlan(c, STATE);
  assert.equal(o.bsc, o.destination);
  const sched = TIMELOCK.decodeFunctionData('schedule', '0x' + Buffer.from(o.zetaphy.proposal.messages[0].Data, 'base64').toString('hex'));
  assert.equal(sched[0], STATE.steps['zetaphy-vault-bsc'].vault);
  assert.match(o.zetaphy.proposal.title, /ZTPHY -> BNB Smart Chain/);
  assert.equal(M.MULTISIG.decodeFunctionData('propose', o.bsc.proposeSchedule)[0], STATE.steps['bsc-roles'].timelock);
  assert.equal(o.bsc.chainId, 56);
  assert.notEqual(o.zetaphy.salt, ob.zetaphy.salt);
  assert.notEqual(o.zetaphy.operationId, ob.zetaphy.operationId);
  const pz = M.pausePlan(c, STATE, { route: 'bsc', veto: '0x' + 'cd'.repeat(32) });
  assert.equal(pz.zetaphy.multisig, c.zetaphy.guardian, 'the same guardian multisig guards every vault on ZETAPHY');
  assert.equal(M.MULTISIG.decodeFunctionData('propose', pz.zetaphy.pause.propose)[0], STATE.steps['zetaphy-vault-bsc'].vault);
  assert.equal(pz.bsc.multisig, STATE.steps['bsc-roles'].multisig);
  assert.deepEqual(pz.bsc.owners, c.destinations.bsc.owners);
  assert.throws(() => M.openPlan(c, { steps: { ...STATE.steps, 'bsc-synthetic': undefined } }, { route: 'bsc' }), /bsc-synthetic/);
});

test('the agents: one relayer for every deployed route (whitelisted to the vaults and synthetics), the agent config names every chain', () => {
  const c = filled();
  const w = M.relayerWhitelist(c, STATE);
  assert.deepEqual(w.map((x) => [x.originDomain, x.destinationDomain]), [[3659, 8453], [8453, 3659], [3659, 56], [56, 3659], [3659, 42161], [42161, 3659]]);
  const senders = new Set(w.map((x) => x.senderAddress));
  const ours = ['zetaphy-vault', 'base-synthetic', 'zetaphy-vault-bsc', 'bsc-synthetic', 'zetaphy-vault-arbitrum', 'arbitrum-synthetic']
    .map((k) => zeroPadValue(STATE.steps[k].vault ?? STATE.steps[k].synthetic, 32).toLowerCase());
  assert.deepEqual([...senders].sort(), [...ours].sort(), 'only our vaults and synthetics');
  // each vault sends only to its own chain
  assert.equal(w.find((x) => x.senderAddress === zeroPadValue(STATE.steps['zetaphy-vault-bsc'].vault, 32).toLowerCase()).destinationDomain, 56);
  const env = M.relayerEnv(c, STATE);
  assert.ok(env.includes('HYP_RELAYCHAINS=zetaphy,base,bsc,arbitrum'));
  assert.ok(env.includes('HYP_CHAINS_BASE_INDEX_FROM=1000'));
  assert.ok(env.includes(`HYP_CHAINS_BSC_INDEX_FROM=${STATE.steps['bsc-roles'].fromBlock}`));
  assert.ok(env.includes(`HYP_CHAINS_ARBITRUM_INDEX_FROM=${STATE.steps['arbitrum-roles'].fromBlock}`));
  assert.ok(env.every((l) => /^HYP_(RELAYCHAINS|WHITELIST|CHAINS_[A-Z]+_INDEX_(FROM|CHUNK)|GASPAYMENTENFORCEMENT)=/.test(l)), 'only lines setup-agents-mainnet.sh accepts');
  assert.ok(!env.join('\n').match(/KEY|SIGNER/));
  // only the deployed routes are relayed
  const baseOnly = { steps: Object.fromEntries(Object.entries(STATE.steps).filter(([k]) => ['base-roles', 'zetaphy-vault', 'base-synthetic'].includes(k))) };
  assert.ok(M.relayerEnv(c, baseOnly).includes('HYP_RELAYCHAINS=zetaphy,base'));
  const core = { mailbox: A(50), merkleTreeHook: A(51), validatorAnnounce: A(52) };
  const ac = M.agentConfig(c, core, { zFrom: 7, from: { base: 1000, bsc: 9100, arbitrum: 9200 }, rpc: { bsc: ['https://bsc.example.org'] } });
  assert.deepEqual(Object.keys(ac.chains), ['zetaphy', 'base', 'bsc', 'arbitrum']);
  assert.deepEqual([ac.chains.bsc.chainId, ac.chains.bsc.domainId, ac.chains.bsc.nativeToken.symbol], [56, 56, 'BNB']);
  assert.equal(ac.chains.bsc.mailbox, c.destinations.bsc.hyperlane.mailbox);
  assert.equal(ac.chains.bsc.blocks.reorgPeriod, 'finalized');
  assert.equal(ac.chains.bsc.index.from, 9100);
  assert.deepEqual(ac.chains.bsc.rpcUrls, [{ http: 'https://bsc.example.org' }], 'owner-overridable RPC');
  assert.deepEqual(ac.chains.arbitrum.rpcUrls.map((x) => x.http), c.destinations.arbitrum.rpc, 'default: the public list');
  assert.equal(ac.chains.base.index.from, 1000);
  assert.equal(ac.chains.zetaphy.index.from, 7);
  assert.ok(!JSON.stringify(ac).match(/"key"|privateKey|signer/i));
  // three chains (ZETAPHY, Base, BSC) when only BSC is given a start block
  assert.deepEqual(Object.keys(M.agentConfig(c, core, { baseFrom: 1000, from: { bsc: 9100 } }).chains), ['zetaphy', 'base', 'bsc']);
  assert.throws(() => M.agentConfig(c, core, { routes: ['base', 'bsc'], from: { base: 1 } }), /no start block for bsc/);
  // the agents script accepts every configured chain and caps the relayer's memory by the number of chains
  const sh = readFileSync(new URL('../../zetaphy-chain/hyperlane/mainnet/setup-agents-mainnet.sh', import.meta.url), 'utf8');
  assert.match(sh, /VALIDATE_ORIGINS/);
  assert.match(sh, /MEM_RELAYER_PER_CHAIN/);
});

test('costs: each route in its own gas token (BNB on BSC) at its gwei input; the funding inputs are checked against it', () => {
  const c = filled();
  const a = M.costEstimate(c), b = M.costEstimate(c, { gwei: { bsc: '0.2' } });
  assert.deepEqual(Object.keys(a.routes), ['bsc', 'arbitrum']);
  const x = a.routes.bsc;
  assert.equal(x.native, 'BNB');
  assert.equal(x.inputs.gasGwei, '0.1');
  for (const r of x.rows) assert.ok(r.cost.endsWith(r.chain === 'zetaphy' ? ' ZTPHY' : ' BNB'), r.cost);
  assert.ok(x.rows.some((r) => r.chain === 'bsc' && /PancakeSwap|pool/.test(r.what)));
  assert.equal(Number(b.routes.bsc.totals.native), 2 * Number(x.totals.native), 'no L1 fee on BSC: linear in the gwei');
  assert.equal(Number(b.routes.bsc.totals.relayerFloatNative), 2 * Number(x.totals.relayerFloatNative));
  assert.equal(b.routes.arbitrum.totals.native, a.routes.arbitrum.totals.native, 'another route\'s gwei does not move');
  assert.equal(a.totals.baseEth, b.totals.baseEth, 'Base is unchanged');
  assert.equal(a.routes.arbitrum.native, 'ETH');
  assert.ok(Number(x.recommend.deployerAmount) > 0 && Number(x.recommend.relayerAmount) >= Number(c.destinations.bsc.costs.relayerFloor));
  assert.deepEqual(x.warnings, []);
  const low = M.costEstimate(filled((y) => { y.destinations.bsc.funding.deployer = '0.0001'; })).routes.bsc;
  assert.ok(low.warnings.some((w) => /funding.deployer 0.0001 BNB is below the recommended/.test(w)));
  assert.ok(Number(a.totals.allRoutesZetaphyZtphy) > Number(a.totals.zetaphyZtphy));
  // the plan shows the costs of every open route
  assert.deepEqual(Object.keys(plan(c, STATE).costs.routes), ['bsc', 'arbitrum']);
});

// ---------------------------------------------------------------- two routes on one in-process EVM: Base's vault and BSC's vault

test('a second route on the contracts: BSC has its own vault with its own caps; neither route can release or mint through the other', async () => {
  const ZETAPHY = 3659, BASE = 8453, BSC = 56, CHAIN = 1n, ZERO = '0x' + '00'.repeat(20);
  const b32 = (x) => zeroPadValue(x, 32);
  const idOf = (m) => keccak256('0x' + m.slice(2 + 77 * 2));
  const art = (n) => JSON.parse(readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), 'utf8'));
  const sorted = (ws) => ws.sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1));
  const OURS = sorted([validator(41), validator(42)]), BASEV = sorted([validator(43), validator(44)]), BSCV = sorted([validator(45), validator(46)]);
  const ch = await createChain(['gov', 'guardian', 'bgov', 'bguardian', 'sgov', 'sguardian', 'liq', 'safe', 'bscsafe', 'relayer', 'zdeploy', 'bdeploy', 'sdeploy']);
  const a = (n) => ch.acct[n].toString();
  const kit = kitArtifacts(), tk = tokenKitArtifacts(), cfg = committed();
  const errs = ['ZetaphyTokenVault', 'SaphanSyntheticToken'].flatMap((n) => art(n).abi.filter((f) => f.type === 'error'));
  const mb = { abi: [...kit.KitMailbox.abi, ...errs], bytecode: kit.KitMailbox.bytecode };
  const zMailbox = await ch.deployRaw(mb, [ZETAPHY], 'gov'), bMailbox = await ch.deployRaw(mb, [BASE], 'gov'), sMailbox = await ch.deployRaw(mb, [BSC], 'gov');
  const token = await ch.deployRaw(tk.KitToken, ['ZTPHY (test)', 'ZTPHY', 18], 'gov');
  await token.send('gov', 'mint', [a('liq'), U('5000000')]);
  const conf = (o) => [o.mailbox, o.remoteDomain, CHAIN, b32(o.remote), ZERO, token.address, o.ism, o.gov, o.guardian, o.limit, o.delay];
  /** One route as the tool deploys it: the vault on ZETAPHY (origin ISM: that chain's set), the synthetic there (our set). */
  async function deployRoute(name, domain, mailbox, originSet, deployer, gov, guardian) {
    const L = M.route(cfg, name).limits;
    const zIsm = await ch.deployRaw(kit.KitMessageIdMultisigIsm, [originSet.map((w) => w.address), 2], 'gov');
    const dIsm = await ch.deployRaw(kit.KitMessageIdMultisigIsm, [OURS.map((w) => w.address), 2], 'gov');
    const synAt = getCreateAddress({ from: a(deployer), nonce: await ch.nonce(deployer) });
    const vault = await ch.deploy('ZetaphyTokenVault', [conf({ mailbox: zMailbox.address, remoteDomain: domain, remote: synAt, ism: zIsm.address, gov: a('gov'), guardian: a('guardian'),
      limit: U(L.releaseDailyLimit), delay: L.releaseDelay }), 18, U(L.lockCap), ZERO], 'zdeploy');
    const syn = await ch.deploy('SaphanSyntheticToken', ['ZTPHY (bridged from ZETAPHY)', 'ZTPHY', 18, conf({ mailbox: mailbox.address, remoteDomain: ZETAPHY, remote: vault.address,
      ism: dIsm.address, gov: a(gov), guardian: a(guardian), limit: U(L.mintDailyLimit), delay: L.mintDelay }), U(L.supplyCap)], deployer);
    assert.equal(syn.address.toLowerCase(), synAt.toLowerCase());
    await vault.send('gov', 'unpause');
    await syn.send(gov, 'unpause');
    return { vault, syn, L, mailbox };
  }
  const base = await deployRoute('base', BASE, bMailbox, BASEV, 'bdeploy', 'bgov', 'bguardian');
  const bsc = await deployRoute('bsc', BSC, sMailbox, BSCV, 'sdeploy', 'sgov', 'sguardian');
  assert.notEqual(base.vault.address, bsc.vault.address);
  const lockAndMint = async (r, to, amount, { claim = true } = {}) => {
    await token.send('liq', 'approve', [r.vault.address, amount]);
    await r.vault.send('liq', 'lock', [a(to), amount]);
    const m = await zMailbox.call('lastMessage');
    await r.mailbox.send('relayer', 'process', [messageIdMetadata(m, OURS), m]);
    if (claim) { ch.advance(r.L.mintDelay); await r.syn.send('relayer', 'claim', [idOf(m)]); }
    return m;
  };
  // the BSC pool's 500,000 ZTPHY cross in one lock; the Base pool's as well; each vault holds its own
  await lockAndMint(bsc, 'bscsafe', U('500000'));
  await lockAndMint(base, 'safe', U('500000'));
  assert.equal(await bsc.syn.call('balanceOf', [a('bscsafe')]), U('500000'));
  assert.equal(await bsc.vault.call('locked'), U('500000'));
  assert.equal(await base.vault.call('locked'), U('500000'));
  // a lock message for BSC cannot be delivered on Base (the synthetic there only takes the Base vault)
  await token.send('liq', 'approve', [bsc.vault.address, U('1')]);
  await bsc.vault.send('liq', 'lock', [a('bscsafe'), U('1')]);
  const toBsc = await zMailbox.call('lastMessage');
  await assert.rejects(bMailbox.send('relayer', 'process', [messageIdMetadata(toBsc, OURS), toBsc]));
  await sMailbox.send('relayer', 'process', [messageIdMetadata(toBsc, OURS), toBsc]);
  // BSC's caps: lockCap 1,000,000 (Base's 2,500,000 does not apply to it)
  await token.send('liq', 'approve', [bsc.vault.address, U('600000')]);
  await assert.rejects(bsc.vault.send('liq', 'lock', [a('bscsafe'), U('600000')]), /OverCap/);
  // the way back from BSC: signed by BSC's origin set, released only by BSC's vault, after 6 h, within 250,000 a day
  await bsc.syn.send('bscsafe', 'sendBack', [a('liq'), U('200000')]);
  const back = await sMailbox.call('lastMessage');
  await assert.rejects(zMailbox.send('relayer', 'process', [messageIdMetadata(back, BASEV), back]), 'Base\'s validators do not sign for BSC');
  await assert.rejects(zMailbox.send('relayer', 'process', [messageIdMetadata(back, OURS), back]), 'our ZETAPHY-origin set does not sign BSC -> ZETAPHY');
  await zMailbox.send('relayer', 'process', [messageIdMetadata(back, BSCV), back]);
  await assert.rejects(bsc.vault.send('relayer', 'claim', [idOf(back)]), /NotReady/);
  ch.advance(bsc.L.releaseDelay);
  await bsc.vault.send('relayer', 'claim', [idOf(back)]);
  assert.equal(await bsc.vault.call('locked'), U('300001'));
  // a validly signed BSC-origin message aimed at the Base vault is refused (wrong origin domain for that vault)
  const body = AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'uint256', 'address', 'address', 'uint256', 'uint256', 'address', 'address'],
    [CHAIN, bsc.syn.address, 1n, a('bscsafe'), a('bscsafe'), U('1000'), CHAIN, base.vault.address, token.address]);
  const cross = solidityPacked(['uint8', 'uint32', 'uint32', 'bytes32', 'uint32', 'bytes32', 'bytes'], [3, 99, BSC, b32(bsc.syn.address), ZETAPHY, b32(base.vault.address), body]);
  await assert.rejects(zMailbox.send('relayer', 'process', [messageIdMetadata(cross, BASEV), cross]));
  await assert.rejects(zMailbox.send('relayer', 'process', [messageIdMetadata(cross, BSCV), cross]));
  assert.equal(await base.vault.call('locked'), U('500000'), 'the Base vault is untouched by BSC');
  // the guardian pauses one route without the other; only governance opens
  await bsc.vault.send('guardian', 'pause');
  await bsc.syn.send('sguardian', 'pause');
  await token.send('liq', 'approve', [bsc.vault.address, U('1')]);
  await assert.rejects(bsc.vault.send('liq', 'lock', [a('bscsafe'), U('1')]), /IsPaused/);
  await assert.rejects(bsc.syn.send('bscsafe', 'sendBack', [a('liq'), U('1')]), /IsPaused/);
  await assert.rejects(bsc.vault.send('guardian', 'unpause'), /NotGovernance/);
  await lockAndMint(base, 'safe', U('1'));
  assert.equal(await base.syn.call('balanceOf', [a('safe')]), U('500001'), 'Base keeps working while BSC is paused');
});
