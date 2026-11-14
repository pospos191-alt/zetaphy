import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, check, APPS, releaseTag, withRelease, hubConfig, MAINNET_LAUNCH_FILE, MAINNET_AIRDROP_FILE } from '../build.mjs';
import { NETWORKS, withDeployed, hasFeature } from '../network.js';
import { createHash } from 'node:crypto';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');

test('dist/: the hub and every app, with every local script and style present', () => {
  const out = build();
  assert.deepEqual(check(out), []);
  for (const p of Object.keys(APPS)) assert.ok(existsSync(join(out, p)), p);
  for (const p of ['wallet/index.html', 'swap/index.html', 'nft/index.html', 'explorer/index.html', 'neuro/web/index.html', 'hub-config.json']) assert.ok(existsSync(join(out, p)), p);
  for (const p of ['wallet/node_modules', 'wallet/test', 'wallet/src', 'explorer/test', 'swap/vercel.json']) assert.ok(!existsSync(join(out, p)), `not shipped: ${p}`);
  const cfg = JSON.parse(readFileSync(join(out, 'hub-config.json'), 'utf8'));
  assert.match(cfg.node, /^(https:\/\/[^/]+)?$/);
});

test('every tab the hub opens exists in dist/', () => {
  const js = readFileSync(join(HERE, 'hub.js'), 'utf8');
  const srcs = [...js.matchAll(/src: '([a-z/]+)'/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 5);
  for (const s of srcs) assert.ok(existsSync(join(HERE, 'dist', s, 'index.html')), s);
});

test('one name: ZETAPHY (no other brand in the hub)', () => {
  for (const f of ['index.html', 'hub.js', 'hub.css', 'pages.js']) assert.doesNotMatch(readFileSync(join(HERE, f), 'utf8'), /SAWASDEE COIN/);
});

test('headers: frames only from this site; scripts only from this site; Neuro API proxied', () => {
  const v = JSON.parse(readFileSync(join(HERE, 'vercel.json'), 'utf8'));
  const csp = v.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /frame-src 'self'/);
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-(inline|eval)/);
  assert.deepEqual(v.rewrites, [{ source: '/api/:path*', destination: 'https://neuro-api.sawasdeecoin.com/api/:path*' }]);
});

/** validators.js's texts (a classic script): its `const T = {…};` table, evaluated on its own. */
const guideText = () => {
  const js = readFileSync(join(HERE, 'validators.js'), 'utf8');
  const start = js.indexOf('const T = {'), end = js.indexOf('\n};\nconst LANGS', start);
  return new Function(`${js.slice(start, end + 3)}\nreturn T;`)();
};

test('validator guide: shipped, no inline script or style (the hub CSP stays strict), no third-party requests', () => {
  const out = build();
  for (const f of ['validators.html', 'validators.css', 'validators.js', 'validators-gate.js']) assert.ok(existsSync(join(out, f)), f);
  const html = readFileSync(join(HERE, 'validators.html'), 'utf8');
  assert.doesNotMatch(html, /<script>|<style|\sstyle="|\son[a-z]+="/i);
  assert.match(html, /<script src="validators.js"><\/script>/);
  assert.doesNotMatch(html + readFileSync(join(HERE, 'validators.css'), 'utf8'), /fonts\.googleapis|fonts\.gstatic/);
  const T = guideText();
  for (const k of ['hRun', 'hKey', 'keyP', 'hFund', 'fundP', 'hStake', 'stakeP', 'n1', 'n2', 'keysWarn']) assert.ok(T.en[k], k);
});

test('the mining page ships with its worker; the validator guide downloads the current release', () => {
  const out = build();
  for (const f of ['mine.js', 'mine-core.js', 'mine-worker.js']) assert.ok(existsSync(join(out, f)), f);
  const want = `zetaphyd-${createHash('sha256').update(readFileSync(join(HERE, '..', 'zetaphy-chain/setup-node.sh'))).digest('hex').slice(0, 12)}`;
  assert.equal(releaseTag(), want, 'the tag release-zetaphyd.yml publishes');
  const html = readFileSync(join(out, 'validators.html'), 'utf8');
  const tags = [...html.matchAll(/releases\/download\/(zetaphyd-[0-9a-f]+)\//g)].map((m) => m[1]);
  assert.ok(tags.length >= 3, 'the download buttons');
  assert.deepEqual([...new Set(tags)], [want]);
  assert.equal(withRelease('a/releases/download/zetaphyd-3008c6775923/x b/releases/download/zetaphyd-3008c6775923/y', 'zetaphyd-000000000000'),
    'a/releases/download/zetaphyd-000000000000/x b/releases/download/zetaphyd-000000000000/y');
  // the worker is a same-origin module (script-src 'self'): no eval, no wasm
  for (const f of ['mine.js', 'mine-core.js', 'mine-worker.js']) assert.doesNotMatch(readFileSync(join(HERE, f), 'utf8'), /\beval\(|new Function|WebAssembly/, f);
});

test('validator guide: joining mainnet as join-validator.sh does it (install.sh validator, key, stake N), no faucet, no testnet; tabs in all 8 languages', () => {
  const html = readFileSync(join(HERE, 'validators.html'), 'utf8');
  const js = readFileSync(join(HERE, 'validators.js'), 'utf8');
  const joinSh = readFileSync(join(HERE, '..', 'zetaphy-chain/join-validator.sh'), 'utf8');
  const tabs = [...html.matchAll(/role="tab" id="t-([a-z]+)" aria-controls="p-\1"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['start', 'stake', 'check', 'fix', 'keys', 'advanced']);
  for (const t of tabs) assert.match(html, new RegExp(`role="tabpanel" id="p-${t}" aria-labelledby="t-${t}"`));
  // the commands are join-validator.sh's own
  assert.match(js, /install\.sh \| sudo MONIKER=';/);
  assert.match(js, /bash -s -- validator`/);
  assert.match(joinSh, /install\.sh \| sudo bash -s -- validator/);
  for (const c of ['sudo zetaphy-validator key', 'sudo zetaphy-validator address', 'sudo zetaphy-validator status', 'sudo zetaphy-validator stake 100', 'sudo zetaphy-validator unjail', 'sudo zetaphy-validator update', 'sudo zetaphy-validator backup', 'sudo zetaphy-validator secure']) {
    assert.ok(html.includes(c), `${c} on the page`);
    const word = c.split(' ')[2];
    assert.match(joinSh, new RegExp(`sudo zetaphy-validator ${word}\\b`), `${word} is a join-validator.sh command`);
  }
  // the chain's facts: mainnet's, as join-validator.sh pins them
  const sha = /MAINNET_GENESIS_SHA256="([0-9a-f]{64})"/.exec(joinSh)[1];
  const peer = /MAINNET_PEER="\$\{MAINNET_PEER:-([^}]+)\}"/.exec(joinSh)[1];
  assert.ok(html.includes(sha), 'the genesis sha256');
  assert.ok(html.includes(peer), 'the sentry');
  assert.ok(html.includes('zetaphy_3659-1') && html.includes('<dd>3659</dd>'));
  // nothing of the testnet's old flow: no faucet form, no auto-stake, no testnet ids or hosts, no import-key
  assert.doesNotMatch(html + js, /vf-form|become-validator|import-key|77390|rpc\.sawasdeecoin\.com|faucet gives|test ZETAPHY|BZTPHY/);
  const T = guideText();
  assert.deepEqual(Object.keys(T).sort(), ['en', 'es', 'ja', 'ko', 'ru', 'th', 'vi', 'zh']);
  const keys = Object.keys(T.en);
  const used = [...html.matchAll(/data-t="([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  for (const k of used) assert.ok(keys.includes(k), `${k} has an English text`);
  for (const [l, t] of Object.entries(T)) {
    assert.deepEqual(Object.keys(t).sort(), [...keys].sort(), `${l}: every key`);
    for (const k of keys) assert.ok(typeof t[k] === 'string' && t[k].trim(), `${l}.${k}`);
    for (const k of ['tab_start', 'tab_stake', 'lede_stake', 'n1', 'n2', 'n4', 'fundP']) assert.notEqual(t[k], l === 'en' ? '' : T.en[k], `${l}.${k} is translated`);
    // real ZTPHY, the single validator, the power cap, in every language
    assert.match(t.fundP, /ZTPHY/, `${l}: fund with ZTPHY`);
    assert.match(t.n2, /3333 bps/, `${l}: the power cap`);
    assert.match(t.n2, /1\/3/, `${l}: 1/3`);
    assert.match(t.lede, /zetaphy_3659-1/, `${l}: mainnet's chain id`);
  }
});

// ------------------------------------------------------------------ hub-config.json `mainnet`
const A = (n) => `0x${n.repeat(40).slice(0, 40)}`;
const launchFile = (contracts, extra = {}) => ({ chainId: 3659, network: 'zetaphy-mainnet', contracts, dex: {}, nft: {}, aiItemsWithContracts: [], skipped: {}, ...extra });

test('mainnet config without the launch file: network.js\'s built-in addresses (contracts.json), nothing of the testnet\'s, only mainnet\'s own features', () => {
  const m = hubConfig({}, { [MAINNET_LAUNCH_FILE]: null, [MAINNET_AIRDROP_FILE]: null }).mainnet;
  const nc = NETWORKS.mainnet.contracts;
  const d = JSON.parse(readFileSync(join(HERE, '..', 'zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json'), 'utf8'));
  assert.equal(m.chainId, 3659);
  assert.equal(m.source, 'network.js');
  assert.deepEqual(m.contracts, { neuroJobs: d.contracts.NeuroJobs, neuroControl: d.contracts.NeuroControl, threatRegistry: d.contracts.ThreatRegistry, threatReports: d.contracts.ThreatReports,
    timelock: d.timelock.address, zetaphyBounty: d.contracts.ZetaphyBounty, guardianMultisig: d.guardianMultisig.address });
  assert.equal(m.contracts.bugBounty, undefined, 'ZetaphyBounty is not useful work\'s BugBounty');
  assert.deepEqual(m.dex, { factory: nc.factory, router: nc.router });
  assert.deepEqual([m.nft, m.features, m.airdrop], [{}, [], undefined]);
  // the repo's real build input: whichever source exists today, never a testnet address
  const real = hubConfig({}).mainnet;
  assert.ok(['network.js', MAINNET_LAUNCH_FILE].includes(real.source));
  const testnet = new Set(Object.values(hubConfig({}).contracts).filter((a) => typeof a === 'string').map((a) => a.toLowerCase()));
  for (const [k, a] of Object.entries(real.contracts)) if (typeof a === 'string') assert.ok(!testnet.has(a.toLowerCase()), `${k}: not a testnet address`);
});

test('mainnet config from zetaphy-launch/state/3659.contracts.json: its addresses win, network.js fills the gaps, deployed features turn on by themselves', () => {
  const files = {
    [MAINNET_LAUNCH_FILE]: launchFile({ neuroJobs: A('1'), timelock: A('2'), timelockBlock: 3114, rewardVault: A('3'), neuroIdentity: A('4'), modelRegistry: A('5'),
      usefulWork: A('6'), bugBounty: A('7'), workerReputation: A('8'), zetaphyBounty: A('9'), guardianMultisig: A('a'), hackInsurance: 'not an address', junk: A('b') },
    { dex: { factory: A('c'), router: A('d'), dlmmFactory: A('e'), dlmmRouter: 'x' }, nft: { factory: A('f'), marketplace: A('0') } }),
    [MAINNET_AIRDROP_FILE]: null,
  };
  const m = hubConfig({}, files).mainnet;
  assert.equal(m.source, MAINNET_LAUNCH_FILE);
  assert.equal(m.contracts.neuroJobs, A('1'), 'the launch file wins');
  assert.equal(m.contracts.neuroControl, NETWORKS.mainnet.contracts.neuroControl, 'a key it lacks keeps network.js\'s');
  assert.equal(m.contracts.timelockBlock, 3114);
  assert.deepEqual([m.contracts.bugBounty, m.contracts.zetaphyBounty, m.contracts.guardianMultisig], [A('7'), A('9'), A('a')]);
  assert.equal(m.contracts.hackInsurance, undefined);
  assert.equal(m.contracts.junk, undefined, 'only hub-config keys');
  assert.deepEqual(m.dex, { factory: A('c'), router: A('d'), dlmmFactory: A('e') });
  assert.deepEqual(m.nft, { factory: A('f'), marketplace: A('0') });
  assert.deepEqual(m.features.sort(), ['aiMap', 'identity', 'rewardVault', 'usefulWork']);
  const net = withDeployed(NETWORKS.mainnet, m.contracts);
  for (const f of ['identity', 'rewardVault', 'aiMap', 'usefulWork']) assert.equal(hasFeature(net, f), true, f);
  assert.equal(hasFeature(net, 'audit'), false);
  // another chain's file (the testnet's launch, a typo) is ignored
  const other = hubConfig({}, { ...files, [MAINNET_LAUNCH_FILE]: launchFile({ neuroJobs: A('1') }, { chainId: 77390 }) }).mainnet;
  assert.deepEqual([other.source, other.contracts.neuroJobs], ['network.js', NETWORKS.mainnet.contracts.neuroJobs]);
  // the testnet's top level is untouched by the mainnet file
  assert.notEqual(hubConfig({}, files).contracts.neuroJobs, A('1'));
});

test('mainnet tabs from the launch file: offline, audit, quantum and immune open once all their contracts are in it; the NFT app only with nftCodeKeysProtected', () => {
  const tabs = { zetaphyCheques: A('1'), offlineOrders: A('2'), offlineCash: A('3'), auditNetwork: A('4'), auditRunners: A('5'), auditJudges: A('6'), auditCertificate: A('7'), quantumRescue: A('8'), immuneRegistry: A('9') };
  const nft = { factory: A('f'), marketplace: A('e') };
  const m = hubConfig({}, { [MAINNET_LAUNCH_FILE]: launchFile(tabs, { nft }), [MAINNET_AIRDROP_FILE]: null }).mainnet;
  for (const [k, a] of Object.entries(tabs)) assert.equal(m.contracts[k], a, k);
  assert.deepEqual(m.features.sort(), ['audit', 'immune', 'offline', 'quantumWallet']);
  assert.deepEqual(m.nft, nft);
  assert.equal(m.nftCodeKeysProtected, false, 'no flag: the NFT app stays closed');
  assert.equal(m.immuneNet.registry, A('9'));
  assert.deepEqual(m.immuneNet.mirrors, []);
  assert.equal(m.immuneNet.feedUrl, null, 'never the testnet\'s feed');
  const net = withDeployed(NETWORKS.mainnet, m.contracts, m);
  for (const f of ['offline', 'audit', 'quantumWallet', 'immune']) assert.equal(hasFeature(net, f), true, f);
  assert.equal(hasFeature(net, 'nft'), false);
  // one contract missing: that tab stays "not on mainnet yet"
  const { offlineCash: _c, immuneRegistry: _i, ...fewer } = tabs;
  const m2 = hubConfig({}, { [MAINNET_LAUNCH_FILE]: launchFile(fewer), [MAINNET_AIRDROP_FILE]: null }).mainnet;
  assert.deepEqual(m2.features.sort(), ['audit', 'quantumWallet']);
  assert.equal(m2.immuneNet, null);
  // the flag the launch's contracts step writes once the collections' code keys are protected
  const m3 = hubConfig({}, { [MAINNET_LAUNCH_FILE]: launchFile({}, { nft, nftCodeKeysProtected: true }), [MAINNET_AIRDROP_FILE]: null }).mainnet;
  assert.equal(m3.nftCodeKeysProtected, true);
  assert.ok(m3.features.includes('nft'));
  assert.equal(hasFeature(withDeployed(NETWORKS.mainnet, m3.contracts, m3), 'nft'), true);
  // the flag without the NFT contracts, or not exactly true: nothing
  for (const extra of [{ nftCodeKeysProtected: true }, { nft, nftCodeKeysProtected: 'yes' }]) {
    const x = hubConfig({}, { [MAINNET_LAUNCH_FILE]: launchFile({}, extra), [MAINNET_AIRDROP_FILE]: null }).mainnet;
    assert.ok(!x.features.includes('nft'), JSON.stringify(extra));
  }
  // the repo's own file: the NFT code keys wait for the timelock batch
  const real = hubConfig({}).mainnet;
  assert.equal(real.nftCodeKeysProtected, false);
  assert.ok(!real.features.includes('nft'));
});

test('the airdrop card: round 1 shows on mainnet once deployments/airdrop-3659.json names its distributor; the testnet keeps airdrop-77390.json', () => {
  const none = { [MAINNET_LAUNCH_FILE]: null, [MAINNET_AIRDROP_FILE]: null, 'zetaphy-network/deployments/airdrop-77390.json': null };
  const c0 = hubConfig({}, none);
  assert.equal(c0.mainnet.contracts.airdropDistributor, undefined);
  assert.ok(!c0.mainnet.features.includes('airdrop'));
  const c1 = hubConfig({}, { ...none, [MAINNET_AIRDROP_FILE]: { chainId: 3659, contracts: { airdropDistributor: A('d') }, list: 'https://example.org/round1/' } });
  assert.equal(c1.mainnet.contracts.airdropDistributor, A('d'));
  assert.deepEqual(c1.mainnet.airdrop, { list: 'https://example.org/round1/' });
  assert.ok(c1.mainnet.features.includes('airdrop'));
  assert.equal(hasFeature(withDeployed(NETWORKS.mainnet, c1.mainnet.contracts), 'airdrop'), true);
  assert.equal(c1.contracts.airdropDistributor, undefined, 'the mainnet round never reaches the testnet\'s config');
  assert.equal(c1.airdrop, undefined);
  // wrong chain, a bad address or a bad list URL
  assert.equal(hubConfig({}, { ...none, [MAINNET_AIRDROP_FILE]: { chainId: 77390, contracts: { airdropDistributor: A('d') } } }).mainnet.contracts.airdropDistributor, undefined);
  assert.equal(hubConfig({}, { ...none, [MAINNET_AIRDROP_FILE]: { chainId: 3659, contracts: { airdropDistributor: '0x12' } } }).mainnet.contracts.airdropDistributor, undefined);
  assert.equal(hubConfig({}, { ...none, [MAINNET_AIRDROP_FILE]: { chainId: 3659, contracts: { airdropDistributor: A('d') }, list: 'javascript:alert(1)' } }).mainnet.airdrop, undefined);
  // the testnet's round: its own file, the top level only
  const t = hubConfig({}, { ...none, 'zetaphy-network/deployments/airdrop-77390.json': { chainId: 77390, contracts: { airdropDistributor: A('e') }, list: './airdrop/' } });
  assert.deepEqual([t.contracts.airdropDistributor, t.airdrop?.list, t.mainnet.contracts.airdropDistributor], [A('e'), './airdrop/', undefined]);
});

test('the hub on mainnet reads hub-config.json `mainnet` (hub.js mainnetConfig), the Agents tab opens for the airdrop card alone', () => {
  const hub = readFileSync(join(HERE, 'hub.js'), 'utf8');
  assert.match(hub, /HUB = mainnetConfig\(raw\); NET = withDeployed\(NET, HUB\.contracts, HUB\)/);
  assert.match(hub, /\{ id: 'agents', [^}]*feature: 'agents', also: \['airdrop'\] \}/);
  assert.match(readFileSync(join(HERE, 'agents.js'), 'utf8'), /if \(!hasFeature\(net, 'agents'\)\)[\s\S]{0,400}hasFeature\(net, 'airdrop'\)[\s\S]{0,200}airdropCard\(ctx\)/);
  const built = JSON.parse(readFileSync(join(build(), 'hub-config.json'), 'utf8'));
  assert.equal(built.mainnet.chainId, 3659);
  assert.ok(Array.isArray(built.mainnet.features));
});
