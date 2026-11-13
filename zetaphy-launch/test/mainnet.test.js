// Unit tests of the mainnet mode (no chain): the chain's identity from chain.json / the pin / the genesis, the deploy
// config's checks, the options and environment refused on mainnet, the keystore and passphrase, and the remote
// signer's check of what it signed. test/mainnet.e2e.js runs the whole deploy and handover on a local chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet, Transaction, parseUnits, ZeroAddress } from 'ethers';
import { main } from '../launch.js';
import { loadChain, readPin, mainnetConfig, mainnetSteps, mainnetPlan, MAINNET_MIN_DELAY } from '../src/mainnet.js';
import { MAINNET_EXCLUDED, ADDED_STEPS, identityChains } from '../src/mainnetall.js';
import { AI_STEPS, AI_ITEMS, HUB_KEYS, hubContracts } from '../src/mainnetai.js';

// every AI-map contract the mainnet deploys (no NeuroOracleSender without ai.mailbox; never HackInsurance)
const AI_CONTRACTS = ['ModelRegistry', 'NeuroScore', 'ModelEpochs', 'SignalBoard', 'FederatedRounds', 'WebAuthnVerifier', 'CosignCommittee', 'ConstitutionChecker', 'AgentRegistry',
  'LabelRegistry', 'VouchRegistry', 'IntentExecutor', 'ForesightRegistry', 'RiskForecasts', 'DetectorPool', 'DataDAO', 'RedBlueArena', 'NeuroAttest', 'NeuroAnchor',
  'WorkerReputation', 'UsefulIssuance', 'UsefulWork', 'BugBounty'];
import { readKeystore, readPassphrase, keystoreSigner, RemoteSigner, checkSigned, checkSignerUrl } from '../src/signer.js';
import { GOV_MODULE } from '../src/steps.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'zetaphy-launch-mainnet-'));
const W = () => Wallet.createRandom().address;
const SHA = 'ab'.repeat(32);

function chainFiles({ evm = 3659, chainId = `zetaphy_${evm}-1`, pinEvm = evm, pinSha = null } = {}) {
  const d = tmp();
  const genesis = JSON.stringify({ chain_id: chainId, app_state: { staking: { params: { bond_denom: 'azetaphy' } }, bank: { denom_metadata: [{ base: 'azetaphy', symbol: 'ZTPHY' }] } } });
  writeFileSync(join(d, 'genesis.json'), genesis);
  const sha = createHash('sha256').update(genesis).digest('hex');
  writeFileSync(join(d, 'chain.json'), JSON.stringify({ chain_id: chainId, evm_chain_id: evm, genesis_sha256: sha, symbol: 'ZTPHY' }));
  writeFileSync(join(d, 'pin.env'), `GENESIS_SHA256=${pinSha ?? sha}\nGENESIS_EVM_CHAIN_ID=${pinEvm}\nPUBLIC_RPC=0\n`);
  return { d, sha, chain: join(d, 'chain.json'), pin: join(d, 'pin.env'), genesis: join(d, 'genesis.json') };
}

function goodConfig(extra = {}) {
  return { governance: 'gov', guardianOwners: [W(), W(), W()], communityFund: W(),
    bridge: { lockbox: '1:0x00000000000000000000000000000000000Bd0C5', tokenName: 'USD Coin (bridged)', tokenSymbol: 'USDC', decimals: 6 },
    bounty: { committee: [W(), W()], threshold: 2, maxPayout: '10', periodCap: '20', fund: '5' }, ...extra };
}

// ---------- the chain ----------

test('the chain from chain.json, or the pin with its genesis; every source must agree', () => {
  const f = chainFiles();
  const c = loadChain({ chain: f.chain });
  assert.equal(c.evmChainId, 3659n);
  assert.equal(c.chainId, 'zetaphy_3659-1');
  assert.equal(c.genesisSha256, f.sha);
  assert.equal(c.symbol, 'ZTPHY');
  assert.equal(loadChain({ pin: f.pin, genesis: f.genesis }).evmChainId, 3659n);
  assert.equal(loadChain({ chain: f.chain, pin: f.pin, genesis: f.genesis }).chainId, 'zetaphy_3659-1');
  assert.throws(() => loadChain({}), /needs the chain it is for: --chain <chain.json>/);
  assert.throws(() => loadChain({ pin: f.pin }), /needs the chain it is for/);
  const p = chainFiles({ pinEvm: 3660 });
  assert.throws(() => loadChain({ chain: p.chain, pin: p.pin }), /disagree on the EVM chain id: chain.json 3659, pin 3660/);
  const s = chainFiles({ pinSha: SHA });
  assert.throws(() => loadChain({ chain: s.chain, pin: s.pin, genesis: s.genesis }), /disagree on the genesis sha256/);
  const g = chainFiles();
  writeFileSync(g.genesis, '{"chain_id":"zetaphy_3659-1","tampered":1}');
  assert.throws(() => loadChain({ chain: g.chain, genesis: g.genesis }), /disagree on the genesis sha256/);
});

test('the testnet\'s ids, and a chain id that does not match its EVM chain id, are refused', () => {
  assert.throws(() => loadChain({ chain: chainFiles({ evm: 77390 }).chain }), /that is the testnet/);
  assert.throws(() => loadChain({ chain: chainFiles({ evm: 3659, chainId: 'zetaphy_77390-1' }).chain }), /that is the testnet|must agree/);
  assert.throws(() => loadChain({ chain: chainFiles({ evm: 3659, chainId: 'zetaphy_3660-1' }).chain }), /must agree/);
  const d = tmp();
  writeFileSync(join(d, 'p.env'), 'GENESIS_SHA256=xyz\n');
  assert.throws(() => readPin(join(d, 'p.env')), /not a pin file/);
});

// ---------- the deploy config ----------

test('the deploy config: defaults, 48 h at least, placeholders, typos, secrets and the deployer in a role refused', () => {
  const me = W();
  const c = mainnetConfig(goodConfig(), { deployer: me });
  assert.equal(c.governance, GOV_MODULE);
  assert.equal(c.timelockDelay, MAINNET_MIN_DELAY);
  assert.equal(c.bounty.timelock, MAINNET_MIN_DELAY);
  assert.equal(c.executorMode, 'open');
  assert.equal(c.neuro.bond, '100');
  const bad = (patch, re) => assert.throws(() => mainnetConfig({ ...goodConfig(), ...patch }, { deployer: me }), re);
  bad({ timelockDelay: 86400 }, /timelockDelay: a whole number from 172800/);
  bad({ bounty: { committee: [W(), W()], maxPayout: '1', periodCap: '1', timelock: 3600 } }, /bounty.timelock: a whole number from 172800/);
  bad({ governance: '0x1111111111111111111111111111111111111111' }, /placeholder/);
  bad({ communityFund: me }, /communityFund: the deployer .* may hold no role/);
  bad({ guardianOwners: [me, W()] }, /guardianOwners: the deployer/);
  bad({ governance: me }, /governance: the deployer/);
  bad({ guardianOwners: [W()] }, /at least guardianThreshold/);
  bad({ guardian: W() }, /guardian .* or guardianOwners .*, not both/);
  bad({ governance: undefined }, /governance: "gov"/);
  bad({ guardianOwners: undefined }, /guardian 0x<emergency multisig> or guardianOwners/);
  bad({ governanse: 'gov' }, /unknown key "governanse"/);
  bad({ deployerPrivateKey: '0x' + '1'.repeat(64) }, /refusing to store a field named like a secret|unknown key/);
  bad({ bridge: { ...goodConfig().bridge, tokenName: 'USD Coin (bridged, testnet)' } }, /a mainnet token is not named "test"/);
  bad({ bridge: { ...goodConfig().bridge, dailyLimit: '5000' } }, /bridge.dailyLimit: whole tokens, 1 to 1000/);
  bad({ bridge: { ...goodConfig().bridge, lockbox: '0x00000000000000000000000000000000000Bd0C5' } }, /bridge.lockbox: <source chain id>:0x<LockBox>/);
  bad({ bounty: { committee: [W()], maxPayout: '1', periodCap: '1' } }, /bounty.committee: at least bounty.threshold/);
  bad({ bounty: { committee: [me, W()], maxPayout: '1', periodCap: '1' } }, /bounty.committee: the deployer/);
  bad({ timelockExecutor: 'me' }, /timelockExecutor/);
});

test('the deploy config of the added systems: defaults, placeholders, bounds and the deployer in a role refused', () => {
  const me = W();
  const c = mainnetConfig(goodConfig(), { deployer: me });
  assert.equal(c.identity, null, 'no identity section: the identity step is skipped');
  assert.deepEqual(c.vault, { validators: null, validatorsShare: 0 });
  assert.deepEqual(c.compute, { minAgreed: 1 });
  assert.equal(c.nft.feeBps, 100);
  assert.equal(c.nft.feeRecipient, c.communityFund);
  assert.equal(c.dlmm.feeTo, null);
  assert.deepEqual(c.oracle, { relayers: [], relayerThreshold: 1, twapMinSpacing: 60, pythZetaFeed: null });
  assert.equal(c.proposalDeposit, '10000');
  assert.equal(c.proposalDepositWei, '10000000000000000000000');
  const i = mainnetConfig(goodConfig({ identity: { web: 'https://neuro.zetaphy.org/web/' } }), { deployer: me }).identity;
  assert.deepEqual(i, { web: 'https://neuro.zetaphy.org/web/', image: '', minAgreed: 1, claimQuorum: 3, claimMinAgreed: 5, claimDelay: 259200 });
  const feeTo = W();
  assert.equal(mainnetConfig(goodConfig({ dex: { feeTo } })).dlmm.feeTo, feeTo, 'the DLMM fee follows the DEX one by default');
  const bad = (patch, re) => assert.throws(() => mainnetConfig({ ...goodConfig(), ...patch }, { deployer: me }), re);
  bad({ identity: {} }, /identity.web: the Neuro web page/);
  bad({ identity: { web: 'https://neuro.example/web/' } }, /identity.web: .* is a placeholder/);
  bad({ identity: { web: 'https://neuro.example.org/web/' } }, /is a placeholder/);
  bad({ identity: { web: 'http://neuro.zetaphy.org/web/' } }, /identity.web: the Neuro web page/);
  bad({ identity: { web: 'https://neuro.zetaphy.org/web/', image: 'https://x.invalid/a.png' } }, /identity.image: .* is a placeholder/);
  bad({ identity: { web: 'https://neuro.zetaphy.org/web/', claimDelay: 60 } }, /identity.claimDelay: a whole number from 3600/);
  bad({ identity: { web: 'https://neuro.zetaphy.org/web/', webb: 1 } }, /unknown key "webb"/);
  bad({ vault: { validatorsShare: 30 } }, /vault.validatorsShare: only with vault.validators/);
  bad({ vault: { validators: W(), validatorsShare: 100 } }, /vault.validatorsShare: a whole number from 1 to 99/);
  bad({ vault: { validators: '0x2222222222222222222222222222222222222222' } }, /vault.validators: .* is a placeholder/);
  bad({ vault: { validators: me } }, /vault.validators: the deployer/);
  bad({ compute: { minAgreed: 0 } }, /compute.minAgreed: a whole number from 1/);
  bad({ dlmm: { feeTo: me } }, /dlmm.feeTo: the deployer/);
  bad({ nft: { feeBps: 600 } }, /nft.feeBps: a whole number from 0 to 500/);
  bad({ nft: { feeRecipient: me } }, /nft.feeRecipient: the deployer/);
  bad({ oracle: { relayers: [me] } }, /oracle.relayers: the deployer/);
  bad({ oracle: { relayers: [W()], relayerThreshold: 2 } }, /oracle.relayerThreshold: a whole number from 1 to 1/);
  bad({ oracle: { pythZetaFeed: '0x' + 'f'.repeat(64) } }, /oracle.pythZetaFeed: .*not a placeholder/);
  bad({ oracle: { pythZetaFeed: '0x1234' } }, /oracle.pythZetaFeed/);
  bad({ proposalDeposit: 'lots' }, /proposalDeposit: an amount of coins/);
  bad({ stable: { reserve: '100' } }, /unknown key "stable"/);
});

test('mainnet.example.json: every key is known; its placeholders (addresses, the Neuro web host) are refused until replaced', () => {
  const ex = JSON.parse(readFileSync(new URL('../mainnet.example.json', import.meta.url), 'utf8'));
  assert.throws(() => mainnetConfig(ex), /placeholder/);
  // with real values in place of the placeholders it is accepted as it stands, every added section included
  const real = JSON.parse(JSON.stringify(ex).replace(/0x(\d)\1{39}/g, () => W()).replace('https://neuro.example/web/', 'https://neuro.zetaphy.org/web/'));
  const c = mainnetConfig(real);
  assert.equal(c.identity.web, 'https://neuro.zetaphy.org/web/');
  assert.equal(c.nft.feeBps, 100);
  assert.equal(c.proposalDeposit, '10000');
  const noWeb = JSON.parse(JSON.stringify(real));
  noWeb.identity.web = ex.identity.web;
  assert.throws(() => mainnetConfig(noWeb), /identity.web: https:\/\/neuro.example\/web\/ is a placeholder/);
});

test('the mainnet steps: the gate-8 set, the handover, then the rest of the testnet\'s systems, a check last; no testnet-only contract', () => {
  const names = mainnetSteps().map((s) => s.name);
  assert.deepEqual(names, ['guardian', 'neuro', 'threats', 'reports', 'bridge', 'dex', 'bounty', 'wire', 'timelock', 'handover',
    'identity', 'vault', 'pq', 'compute', 'dlmm', 'nft', 'oracle', 'protect', 'proposal', ...AI_STEPS, 'contracts', 'verify']);
  // the testnet-only steps do not exist on mainnet: each is listed in the plan as skipped, with its reason
  for (const t of ['stable', 'configs', 'snap', 'skill']) {
    assert.ok(!names.includes(t), t);
    assert.ok(MAINNET_EXCLUDED.some(([n, why]) => n === t && why.length > 10), `${t} has a "skipped on mainnet" reason`);
  }
  // the added steps come after the handover (the deployer has no timelock role left by then)
  for (const t of ADDED_STEPS) assert.ok(names.indexOf(t) > names.indexOf('handover') && names.indexOf(t) < names.indexOf('verify'), t);
  const me = W();
  const ctx = { address: me, symbol: 'ZTPHY', evmChainId: 3659n, mainnet: mainnetConfig(goodConfig({ identity: { web: 'https://neuro.zetaphy.org/web/' } })), guardianOwners: [W(), W()], guardianThreshold: 2, governance: GOV_MODULE, timelockDelay: MAINNET_MIN_DELAY, dexWnative: 'deploy' };
  const all = mainnetSteps().flatMap((s) => s.plan(ctx, {}).deploys.map((d) => d.name));
  assert.deepEqual(all, ['SimpleMultisig', 'NeuroControl', 'NeuroJobs', 'ThreatRegistry', 'ThreatReports', 'BridgeGuard', 'BridgeAirlock', 'NeuroLane', 'WZETAPHY', 'ZetaphyFactory', 'ZetaphyRouter', 'ZetaphyBounty', 'ZetaphyTimelock',
    'NeuroIdentity', 'NeuroValidation', 'RewardVault', 'QuantumWalletFactory', 'ComputeMarket', 'ZetaphyDlmmFactory', 'ZetaphyDlmmRouter', 'NFTFactory', 'NFTMarketplace', 'TwapRecorder', 'ZetaphyPythRelay', 'ZetaphyOracle',
    ...AI_CONTRACTS]);
  for (const n of all) assert.doesNotMatch(n, /^Test|StableGateway|Faucet|HackInsurance/, n);
  const bridge = mainnetSteps().find((s) => s.name === 'bridge').plan(ctx, {});
  assert.ok(bridge.calls.some((c) => /enabled = false\)  CLOSED/.test(c)));
});

test('the added systems: every admin is the existing timelock (in the constructor, or one step in the same step); never the deployer', () => {
  const me = W(), timelock = W(), jobs = W(), reg = W(), guardian = W();
  const o = { timelock, neuroJobs: jobs, threatRegistry: reg, guardianMultisig: guardian, dex: { contracts: { wnative: W() } } };
  const ctx = { address: me, symbol: 'ZTPHY', evmChainId: 3659n, dexWnative: o.dex.contracts.wnative,
    mainnet: mainnetConfig(goodConfig({ identity: { web: 'https://neuro.zetaphy.org/web/' }, vault: { validators: W(), validatorsShare: 20 }, oracle: { relayers: [W(), W()], relayerThreshold: 2 } })) };
  const steps = Object.fromEntries(mainnetSteps().map((s) => [s.name, s]));
  const plan = (n) => steps[n].plan(ctx, o);
  const arg = (n, contract, i) => plan(n).deploys.find((d) => d.name === contract).args[i];
  // the constructor takes the admin: the timelock from the first block
  assert.equal(arg('vault', 'RewardVault', 0), timelock);
  assert.deepEqual(arg('vault', 'RewardVault', 1), [[jobs, 8000, true], [ctx.mainnet.vault.validators, 2000, false]]);
  assert.equal(arg('dlmm', 'ZetaphyDlmmFactory', 0), timelock);
  assert.equal(arg('dlmm', 'ZetaphyDlmmRouter', 1), o.dex.contracts.wnative);
  assert.equal(arg('nft', 'NFTMarketplace', 0), timelock);
  assert.equal(arg('nft', 'NFTMarketplace', 1), ctx.mainnet.communityFund, 'the fee goes to the community fund by default');
  assert.equal(arg('nft', 'NFTMarketplace', 3), reg);
  assert.equal(arg('oracle', 'ZetaphyPythRelay', 0), timelock);
  assert.deepEqual(arg('oracle', 'ZetaphyPythRelay', 1), ctx.mainnet.oracle.relayers);
  // the deployer configures first, then the one-step transfer in the same step
  assert.equal(arg('oracle', 'ZetaphyOracle', 0), me);
  assert.match(plan('oracle').calls[0], new RegExp(`setGuardian\\(${guardian}, true\\)`));
  assert.match(plan('oracle').calls.at(-1), /ZetaphyOracle\.setGovernance\(ZetaphyTimelock\)  one step/);
  assert.match(plan('identity').calls.at(-1), /NeuroIdentity\.setAdmin\(ZetaphyTimelock\)  one step/);
  // runner bars and the chain list: ZETAPHY's own entry is this chain, never the testnet's
  assert.equal(arg('identity', 'NeuroIdentity', 5), jobs);
  assert.ok(arg('identity', 'NeuroIdentity', 3).includes('eip155:3659'));
  assert.ok(!arg('identity', 'NeuroIdentity', 3).includes('eip155:77390'));
  const [keys, caip2s] = identityChains(3659n);
  assert.equal(caip2s[keys.indexOf('zetaphy')], 'eip155:3659');
  assert.equal(arg('identity', 'NeuroValidation', 1), jobs);
  assert.equal(arg('compute', 'ComputeMarket', 0), jobs);
  // nothing in any added plan names the deployer in a constructor, except the oracle for its configuring calls
  const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x));
  for (const n of ADDED_STEPS) for (const d of plan(n).deploys) if (d.name !== 'ZetaphyOracle') assert.ok(!json(d.args).includes(me), `${d.name}: no deployer in its arguments`);
  // the DLMM set-up and the NFT code keys need the timelock itself: the proposal step, not the deployer
  assert.match(plan('dlmm').calls[0], /^\(proposal\)/);
  assert.match(plan('nft').calls[0], /^\(proposal\) ThreatRegistry\.setProtected/);
  // no identity section: the step is skipped with its reason
  const plain = { ...ctx, mainnet: mainnetConfig(goodConfig()) };
  assert.match(steps.identity.when(plain, { steps: {} }), /no "identity" in the deploy config/);
});

test('an added step refuses to run before the handover (the timelock it hands its roles to)', async () => {
  const ctx = { address: W(), evmChainId: 3659n, mainnet: mainnetConfig(goodConfig({ identity: { web: 'https://neuro.zetaphy.org/web/' } })), log: () => {} };
  const state = { steps: { neuro: { doneAt: 'x', out: { neuroJobs: W() } } } };
  for (const n of ['identity', 'vault', 'pq', 'compute', 'dlmm', 'nft', 'oracle']) {
    await assert.rejects(mainnetSteps().find((s) => s.name === n).run(ctx, state), /the handover has not run yet/, n);
  }
  await assert.rejects(mainnetSteps().find((s) => s.name === 'proposal').run(ctx, state), /the handover has not run yet/);
});

test('the plan of a resume after the gate-8 set: only the added steps, their contracts, the skipped testnet-only steps', async () => {
  const me = W();
  const provider = { getFeeData: async () => ({ gasPrice: 10n ** 9n }), estimateGas: async () => { throw new Error('no chain here'); } };
  const ctx = { address: me, symbol: 'ZTPHY', evmChainId: 3659n, provider, dexWnative: W(), dlmmPresets: { 1: [1, 50, 2000, 30, 600, 5000, 100000, true] },
    mainnet: mainnetConfig(goodConfig({ bridge: undefined, identity: { web: 'https://neuro.zetaphy.org/web/' } })), governance: GOV_MODULE, timelockDelay: MAINNET_MIN_DELAY,
    handover: true, guardianOwners: [W(), W()], guardianThreshold: 2 };
  const done = (out) => ({ doneAt: '2026-11-13T00:00:00Z', ...(out ? { out } : {}) });
  const state = { steps: { guardian: done({ guardianMultisig: W() }), neuro: done({ neuroControl: W(), neuroJobs: W() }), threats: done({ threatRegistry: W() }), reports: done({ threatReports: W() }),
    dex: done({ dex: { contracts: { factory: W(), router: W(), wnative: ctx.dexWnative } } }), bounty: done({ zetaphyBounty: W() }), wire: done(), timelock: done({ timelock: W() }), handover: done(), verify: done() } };
  const plan = await mainnetPlan(ctx, state, mainnetSteps());
  const text = plan.lines.join('\n');
  assert.deepEqual(plan.todo, ['identity', 'vault', 'pq', 'compute', 'dlmm', 'nft', 'oracle', 'protect', 'proposal', ...AI_STEPS, 'contracts']);
  for (const c of ['NeuroIdentity', 'NeuroValidation', 'RewardVault', 'QuantumWalletFactory', 'ComputeMarket', 'ZetaphyDlmmFactory', 'ZetaphyDlmmRouter', 'NFTFactory', 'NFTMarketplace', 'TwapRecorder', 'ZetaphyPythRelay', 'ZetaphyOracle']) {
    assert.match(text, new RegExp(`deploy ${c}\\(`), c);
  }
  for (const c of ['SimpleMultisig', 'NeuroControl', 'ZetaphyTimelock', 'ZetaphyBounty']) assert.doesNotMatch(text, new RegExp(`deploy ${c}\\(`), `${c} is not deployed again`);
  assert.doesNotMatch(text, /deploy (TestStable|StableGateway|TestToken|WZETAPHY)/);
  assert.match(text, new RegExp(`deploy RewardVault\\(governance=${state.steps.timelock.out.timelock}, shares=\\[\\[${state.steps.neuro.out.neuroJobs}, 10000, true\\]\\]\\)`));
  assert.match(text, /✓ handover: done .*; checked again on-chain/);
  assert.match(text, /- stable: skipped on mainnet \(test USDC\/USDT/);
  assert.match(text, /- snap: skipped on mainnet/);
  assert.match(text, /- bridge: skipped \(no "bridge" in the deploy config/);
  assert.match(text, new RegExp(`total: ${12 + AI_CONTRACTS.length} contract\\(s\\)`));
  assert.match(text, /- hackInsurance: skipped on mainnet \(HackInsurance is testnet only/);
  assert.match(text, /- neuroOracleSender: skipped on mainnet \(no Hyperlane Mailbox/);
  assert.match(text, /deploy FederatedRounds\(governance=0x[0-9a-fA-F]{40}, start=<the block 14400 after the deploy>/);
  assert.match(text, /deploy UsefulWork\(governance=0x[0-9a-fA-F]{40}, reputation=<WorkerReputation>, issuance=<UsefulIssuance>, p=\{stampBits: 22/);
});

// ---------- options and environment ----------

const run = (argv, env = {}) => main(argv, { ...env }, () => {});

test('mainnet refuses a plain key, keys in the environment, --devnet, --redo and testnet options', async () => {
  const f = chainFiles();
  const d = tmp();
  writeFileSync(join(d, 'cfg.json'), JSON.stringify(goodConfig()));
  const M = ['--network', 'mainnet', '--rpc', 'http://127.0.0.1:1', '--chain', f.chain, '--deploy-config', join(d, 'cfg.json')];
  await assert.rejects(run([...M, '--key-file', join(d, 'k')]), /--key-file is refused on mainnet/);
  await assert.rejects(run([...M, '--devnet']), /--devnet is refused on mainnet/);
  await assert.rejects(run([...M, '--redo']), /--redo is refused on mainnet/);
  await assert.rejects(run([...M, '--governance', 'gov']), /not a mainnet option: .* from --deploy-config/);
  await assert.rejects(run([...M, '--stable-testnet-price', '0.01']), /not a mainnet option/);
  for (const k of ['ZETAPHY_DEPLOYER_KEY', 'ZETAPHY_DEPLOYER_KEY_FILE', 'ZETAPHY_PASSPHRASE']) {
    await assert.rejects(run([...M, '--keystore', join(d, 'ks.json')], { [k]: 'x' }), new RegExp(`${k} is set: refused on mainnet`));
  }
  await assert.rejects(run([...M]), /--keystore <encrypted keystore JSON> or as --remote-signer/);
  await assert.rejects(run([...M, '--remote-signer', 'http://10.0.0.5:8550', '--signer-address', W()]), /http:\/\/ on 127.0.0.1 \/ localhost only/);
  await assert.rejects(run([...M, '--remote-signer', 'http://127.0.0.1:8550']), /needs --signer-address/);
  await assert.rejects(run(['--network', 'main']), /--network: mainnet/);
});

test('the testnet launch is unchanged and takes no mainnet option', async () => {
  await assert.rejects(run(['--rpc', 'http://127.0.0.1:1', '--keystore', 'x.json']), /--keystore is for --network mainnet/);
  await assert.rejects(run(['--rpc', 'http://127.0.0.1:1', '--chain', 'c.json']), /--chain is for --network mainnet/);
  await assert.rejects(run(['--rpc', 'http://127.0.0.1:1', '--confirm-chain', '3659']), /--confirm-chain is for --network mainnet/);
});

/** A JSON-RPC stand-in that answers eth_chainId and records every method it was asked. */
async function fakeRpc(chainIdHex) {
  const seen = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (x) => { b += x; });
    req.on('end', () => {
      const r = JSON.parse(b);
      const one = (q) => { seen.push(q.method); return { jsonrpc: '2.0', id: q.id, ...(q.method === 'eth_chainId' ? { result: chainIdHex } : { error: { code: -32601, message: 'not here' } }) }; };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(Array.isArray(r) ? r.map(one) : one(r)));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() };
}

test('an RPC whose eth_chainId is not the configured chain is refused before anything else is asked or signed', async () => {
  const f = chainFiles();
  const d = tmp();
  writeFileSync(join(d, 'cfg.json'), JSON.stringify(goodConfig()));
  const w = Wallet.createRandom();
  writeFileSync(join(d, 'ks.json'), await w.encrypt('pw'), { mode: 0o600 });
  for (const answer of ['0x12e4e' /* 77390, the testnet */, '0xe4c' /* 3660 */]) {
    const rpc = await fakeRpc(answer);
    try {
      await assert.rejects(run(['--network', 'mainnet', '--rpc', rpc.url, '--chain', f.chain, '--deploy-config', join(d, 'cfg.json'), '--keystore', join(d, 'ks.json'), '--dry-run']),
        new RegExp(`the RPC is EVM chain ${BigInt(answer)}, not zetaphy_3659-1 \\(EVM 3659\\).*refused, nothing signed`));
      assert.deepEqual([...new Set(rpc.seen)], ['eth_chainId'], 'nothing but eth_chainId was asked');
    } finally { rpc.close(); }
  }
});

// ---------- keystore and passphrase ----------

test('the keystore: its address is read without the passphrase; a plain key or a readable file is refused', async () => {
  const d = tmp();
  const w = Wallet.createRandom();
  writeFileSync(join(d, 'ks.json'), await w.encrypt('right'), { mode: 0o600 });
  const ks = readKeystore(join(d, 'ks.json'));
  assert.equal(ks.address, w.address);
  const s = await keystoreSigner(ks, 'right', null);
  assert.equal(s.address, w.address);
  await assert.rejects(keystoreSigner(ks, 'wrong', null), /passphrase is wrong/);
  writeFileSync(join(d, 'plain.key'), w.privateKey + '\n', { mode: 0o600 });
  assert.throws(() => readKeystore(join(d, 'plain.key')), /a plain private key is refused on mainnet/);
  chmodSync(join(d, 'ks.json'), 0o644);
  assert.throws(() => readKeystore(join(d, 'ks.json')), /can be read by other users/);
  writeFileSync(join(d, 'other.json'), '{"hello":1}', { mode: 0o600 });
  assert.throws(() => readKeystore(join(d, 'other.json')), /not an Ethereum keystore/);
});

test('the passphrase: one line from standard input with --passphrase-stdin; no terminal and no stdin flag is refused', async () => {
  assert.equal(await readPassphrase({ fromStdin: true, input: Readable.from(['secret pass\nignored\n']) }), 'secret pass');
  await assert.rejects(readPassphrase({ fromStdin: true, input: Readable.from(['']) }), /no passphrase on standard input/);
  await assert.rejects(readPassphrase({ input: Readable.from(['x\n']) }), /no terminal to ask the keystore passphrase on/);
});

// ---------- the remote signer ----------

/** A remote signer stand-in: signs what it is asked with `key`, after `tamper` changed the request. */
function fakeSigner(key, tamper = (q) => q) {
  const calls = [];
  const fetchImpl = async (_url, { body }) => {
    const r = JSON.parse(body);
    calls.push(r.method);
    let result;
    if (r.method === 'eth_accounts') result = [key.address];
    else {
      const q = tamper({ ...r.params[0] });
      const t = Transaction.from({ type: Number(q.type), chainId: BigInt(q.chainId), nonce: Number(q.nonce), to: q.to ?? null, value: BigInt(q.value), data: q.data, gasLimit: BigInt(q.gas),
        maxFeePerGas: BigInt(q.maxFeePerGas), maxPriorityFeePerGas: BigInt(q.maxPriorityFeePerGas) });
      t.signature = key.signingKey.sign(t.unsignedHash);
      result = r.method === 'account_signTransaction' ? { raw: t.serialized, tx: {} } : t.serialized;
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: r.id, result }) };
  };
  return { fetchImpl, calls };
}

const TX = () => Transaction.from({ type: 2, chainId: 3659n, nonce: 7, to: '0x00000000000000000000000000000000000Bd0C5', value: 5n, data: '0x1234', gasLimit: 100000n,
  maxFeePerGas: parseUnits('2', 'gwei'), maxPriorityFeePerGas: parseUnits('1', 'gwei') });

test('remote signer: the signed transaction is checked field by field against what was asked', async () => {
  const key = Wallet.createRandom();
  const ok = fakeSigner(key);
  const s = new RemoteSigner('http://127.0.0.1:8550', key.address, null, { chainId: 3659n, fetchImpl: ok.fetchImpl });
  assert.equal(await s.holds(), true);
  const raw = await s.signTransaction(TX());
  const t = Transaction.from(raw);
  assert.equal(t.from, key.address);
  assert.equal(t.chainId, 3659n);
  const clef = new RemoteSigner('http://127.0.0.1:8550', key.address, null, { chainId: 3659n, method: 'account_signTransaction', fetchImpl: fakeSigner(key).fetchImpl });
  assert.equal(Transaction.from(await clef.signTransaction(TX())).from, key.address);
  const refused = async (tamper, re, k = key) => {
    const f = fakeSigner(k, tamper);
    const r = new RemoteSigner('http://127.0.0.1:8550', key.address, null, { chainId: 3659n, fetchImpl: f.fetchImpl });
    await assert.rejects(r.signTransaction(TX()), re);
  };
  await refused((q) => ({ ...q, to: '0x000000000000000000000000000000000000dEaD' }), /not the one asked for \(to 0x000000000000000000000000000000000000dEaD/);
  await refused((q) => ({ ...q, chainId: '0x12e4e' }), /chain id 77390, not 3659/);
  await refused((q) => ({ ...q, value: '0x64' }), /value 100, not 5/);
  await refused((q) => ({ ...q, data: '0xdeadbeef' }), /other calldata/);
  await refused((q) => ({ ...q, nonce: '0x8' }), /nonce 8, not 7/);
  await refused((q) => ({ ...q, maxFeePerGas: '0x' + parseUnits('50', 'gwei').toString(16) }), /higher fees than asked/);
  await refused((q) => q, /signed by 0x[0-9a-fA-F]{40}, not/, Wallet.createRandom());
  await assert.rejects(s.signTransaction(Transaction.from({ ...TX().toJSON(), chainId: 1n })), /chain id 1, not 3659/);
  await assert.rejects(s.signMessage('x'), /transactions only/);
  assert.throws(() => checkSigned('0x1234', {}, { address: key.address, chainId: 3659n }), /not a signed transaction/);
  assert.throws(() => checkSignerUrl('http://example.org:8550'), /on 127.0.0.1/);
  assert.equal(checkSignerUrl('https://signer.example.org'), 'https://signer.example.org');
});

// ---------- the AI map's contracts (src/mainnetai.js) ----------

test('the AI map: every "notDeployed" / "practice" item\'s contract is deployed, or skipped on mainnet with a reason', async () => {
  const { ITEMS, statusOf } = await import('../../zetaphy-hub/flow.js');
  const steps = Object.fromEntries(mainnetSteps().map((s) => [s.name, s]));
  const ctx = { address: W(), symbol: 'ZTPHY', evmChainId: 3659n, mainnet: mainnetConfig(goodConfig()) };
  const o = { timelock: W(), neuroJobs: W(), threatRegistry: W(), guardianMultisig: W(), rewardVault: W() };
  const planned = new Set(AI_STEPS.flatMap((n) => steps[n].plan(ctx, o).deploys.map((d) => d.key)));
  const skipped = new Map(AI_STEPS.flatMap((n) => steps[n].plan(ctx, o).skipped ?? []));
  // bugBounty: the useful-work BugBounty (zetaphy-hub/work.js calls its functions); ZetaphyBounty keeps its own key
  const have = new Set([...planned, 'zetaphyBounty']);
  for (const [id, it] of Object.entries(ITEMS)) {
    if (!['notDeployed', 'practice'].includes(it.s) || !it.needs) continue;
    for (const k of it.needs) assert.ok(have.has(k) || skipped.has(k), `item ${id} needs ${k}: neither deployed nor skipped`);
    for (const k of it.needs) assert.ok(HUB_KEYS.includes(k), `${k} is a hub-config key`);
    for (const k of it.needs) assert.ok(AI_ITEMS[k]?.includes(Number(id)), `AI_ITEMS lists item ${id} for ${k}`);
  }
  assert.match(skipped.get('hackInsurance'), /testnet only/);
  assert.match(skipped.get('neuroOracleSender'), /no Hyperlane Mailbox/);
  // with every planned address in hub-config, the map shows those items as working
  const fake = Object.fromEntries([...planned].map((k) => [k, W()]));
  const h = hubContracts(ctx, { ...o, ...fake });
  for (const id of h.aiItemsWithContracts) assert.equal(statusOf(ITEMS[id], h.contracts), ITEMS[id].needs.every((k) => h.contracts[k]) ? 'live' : ITEMS[id].s, `item ${id}`);
  for (const id of [1, 3, 6, 9, 14, 15, 16, 19, 23, 24, 25, 26, 27, 29, 34, 35, 2, 5, 7, 10, 17, 30]) assert.equal(statusOf(ITEMS[id], h.contracts), 'live', `item ${id} works with these addresses`);
  for (const id of [18, 28, 32]) assert.notEqual(statusOf(ITEMS[id], h.contracts), 'live', `item ${id} stays not deployed`);
  // a mailbox in the config deploys NeuroOracleSender (items 18 and 28)
  const withMb = { ...ctx, mainnet: mainnetConfig(goodConfig({ ai: { mailbox: W() } })) };
  assert.ok(steps.aiassist.plan(withMb, o).deploys.some((d) => d.name === 'NeuroOracleSender'));
});

test('the AI contracts: the timelock in the constructor, or the deployer for its set-up calls then one step to the timelock; the guardian multisig', () => {
  const me = W(), timelock = W(), jobs = W(), reg = W(), guardian = W(), vault = W();
  const ctx = { address: me, symbol: 'ZTPHY', evmChainId: 3659n, mainnet: mainnetConfig(goodConfig({ ai: { committee: [W(), W(), W()], threshold: 2 } })) };
  const o = { timelock, neuroJobs: jobs, threatRegistry: reg, guardianMultisig: guardian, rewardVault: vault };
  const steps = Object.fromEntries(mainnetSteps().map((s) => [s.name, s]));
  const d = (n, c) => steps[n].plan(ctx, o).deploys.find((x) => x.name === c);
  const calls = (n) => steps[n].plan(ctx, o).calls.join('\n');
  for (const [n, c] of [['aimodels', 'NeuroScore'], ['aimodels', 'FederatedRounds'], ['aiagents', 'CosignCommittee'], ['aiagents', 'LabelRegistry'], ['aimarkets', 'RiskForecasts'],
    ['aimarkets', 'DetectorPool'], ['aimarkets', 'DataDAO'], ['aimarkets', 'RedBlueArena'], ['usefulwork', 'UsefulIssuance']]) assert.equal(d(n, c).args[0], timelock, `${c}: the timelock in the constructor`);
  assert.equal(d('aiassist', 'NeuroAttest').args[1], timelock);
  assert.equal(d('aiagents', 'VouchRegistry').args[1], timelock);
  // set up by the deployer, then handed over in the same step
  for (const [n, c] of [['aimodels', 'ModelRegistry'], ['aimodels', 'ModelEpochs'], ['aiagents', 'AgentRegistry'], ['aimarkets', 'ForesightRegistry'], ['usefulwork', 'WorkerReputation']]) {
    assert.equal(d(n, c).args[0], me, c);
    assert.match(calls(n), new RegExp(`${c}\\.setGovernance\\(ZetaphyTimelock\\)  one step`), c);
  }
  assert.equal(d('usefulwork', 'UsefulWork').args[0], me);
  assert.equal(d('usefulwork', 'BugBounty').args[3], me);
  assert.match(calls('usefulwork'), /UsefulWork\.setPaused\(true\)[\s\S]*UsefulWork\.setGuardian\(the guardian multisig\)[\s\S]*BugBounty\.setPaused\(true\)[\s\S]*BugBounty\.setGovernance\(ZetaphyTimelock\)/);
  assert.match(calls('aimodels'), /ModelRegistry\.setGuardian\(the guardian multisig, true\)/);
  assert.match(calls('aimodels'), /ModelEpochs\.setGuardian\(the guardian multisig, true\)/);
  assert.match(calls('aiagents'), /AgentRegistry\.setChecker\(ConstitutionChecker, true\)/);
  assert.match(calls('aimarkets'), /ForesightRegistry\.setResolver\(RiskForecasts, true\)/);
  // wiring: NeuroJobs, the ThreatRegistry, the RewardVault (UsefulIssuance's overflow), the committee from the config
  assert.equal(d('aimarkets', 'RiskForecasts').args[1], reg);
  assert.equal(d('aiassist', 'NeuroAttest').args[0], jobs);
  assert.equal(d('usefulwork', 'UsefulIssuance').args[1], vault);
  assert.equal(d('usefulwork', 'BugBounty').args[0], jobs);
  assert.deepEqual(d('aiagents', 'CosignCommittee').args.slice(1), [ctx.mainnet.ai.committee, 2n]);
  assert.equal(d('aimarkets', 'DataDAO').args[1], timelock, 'no poster in the config: the timelock posts');
  assert.equal(d('usefulwork', 'WorkerReputation').args[2], ZeroAddress, 'no NeuroIdentity in the state: no identity link');
  // the deployer is a constructor argument only where it governs for the set-up calls
  const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x));
  const setup = ['ModelRegistry', 'ModelEpochs', 'AgentRegistry', 'ForesightRegistry', 'WorkerReputation', 'UsefulWork', 'BugBounty'];
  for (const n of AI_STEPS) for (const x of steps[n].plan(ctx, o).deploys) if (!setup.includes(x.name)) assert.ok(!json(x.args).includes(me), `${x.name}: no deployer in its arguments`);
});

test('the deploy config section "ai": defaults, the deployer in no AI role, placeholders refused', () => {
  const me = W();
  const c = mainnetConfig(goodConfig(), { deployer: me }).ai;
  assert.deepEqual(c.committee, []);
  assert.equal(c.threshold, 1);
  assert.equal(c.agentBond, '10');
  assert.equal(c.hubHost, 'app.sawasdeecoin.com');
  assert.equal(c.mailbox, null);
  assert.equal(c.usefulWork.issuance, true);
  assert.equal(c.fl.commitBlocks, 72000);
  const bad = (patch, re) => assert.throws(() => mainnetConfig({ ...goodConfig(), ai: patch }, { deployer: me }), re);
  bad({ committee: [me] }, /ai.committee: the deployer/);
  bad({ poster: me }, /ai.poster: the deployer/);
  bad({ usefulWork: { feeder: me } }, /ai.usefulWork.feeder: the deployer/);
  bad({ committee: [W()], threshold: 2 }, /ai.threshold: a whole number from 1 to 1/);
  bad({ hubHost: 'hub.example.org' }, /ai.hubHost/);
  bad({ hubHost: 'https://app.sawasdeecoin.com' }, /ai.hubHost/);
  bad({ mailbox: '0x3333333333333333333333333333333333333333' }, /ai.mailbox: .* is a placeholder/);
  bad({ usefulWork: { issuance: 'yes' } }, /ai.usefulWork.issuance: true or false/);
  bad({ mint: true }, /unknown key "mint"/);
});

test('an AI step refuses to run before the handover', async () => {
  const ctx = { address: W(), evmChainId: 3659n, mainnet: mainnetConfig(goodConfig()), log: () => {} };
  for (const n of AI_STEPS) await assert.rejects(mainnetSteps().find((s) => s.name === n).run(ctx, { steps: {} }), /the handover has not run yet/, n);
});
