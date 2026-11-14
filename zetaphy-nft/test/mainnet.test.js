// The NFT app on mainnet (chain 3659): its record web/deployments-3659.json agrees with the mainnet launch's public
// address file (zetaphy-launch/state/3659.contracts.json), the wallet constants are network.js's, and the app (like
// the hub) opens only once the collections' code keys are protected (nftCodeKeysProtected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mainnetDeployment, LAUNCH_FILE, OUT } from '../scripts/mainnet-config.js';
import { NETWORKS, nftReady } from '../web/lib/network.js';
import * as W from '../web/lib/wallet.js';

const read = (f) => JSON.parse(readFileSync(f, 'utf8'));

test('web/deployments-3659.json is the launch file\'s NFT factory, marketplace, ThreatRegistry, timelock and flag (node scripts/mainnet-config.js)', () => {
  const launch = read(LAUNCH_FILE);
  const dep = read(OUT);
  assert.deepEqual(dep, mainnetDeployment(launch), 'run node scripts/mainnet-config.js');
  assert.equal(dep.chainId, 3659);
  assert.equal(dep.factory, '0xc0800dBEbFFC80120f5DC0E6f2a603C00F6AF391');
  assert.equal(dep.marketplace, '0x0402d6E7af2912D002EfCa7543eb44A3EB3Bbc14');
  assert.equal(dep.rpc, NETWORKS.mainnet.rpc);
  assert.equal(dep.threatRegistry, NETWORKS.mainnet.contracts.threatRegistry);
  assert.equal(dep.governance, NETWORKS.mainnet.contracts.timelock);
  // the code keys wait for the timelock batch: closed until the flag is set
  assert.equal(dep.nftCodeKeysProtected, launch.nftCodeKeysProtected === true);
  assert.equal(nftReady({ nft: dep, nftCodeKeysProtected: dep.nftCodeKeysProtected }), dep.nftCodeKeysProtected);
  // the flag only from the launch file, and only exactly true
  assert.equal(mainnetDeployment({ ...launch, nftCodeKeysProtected: true }).nftCodeKeysProtected, true);
  assert.equal(mainnetDeployment({ ...launch, nftCodeKeysProtected: 'yes' }).nftCodeKeysProtected, false);
  assert.throws(() => mainnetDeployment({ ...launch, chainId: 77390 }), /not 3659/);
  assert.throws(() => mainnetDeployment({ ...launch, nft: {} }), /no factory/);
  // never a testnet address
  const testnet = read(new URL('../web/deployments.json', import.meta.url));
  for (const k of ['factory', 'marketplace', 'threatRegistry']) assert.notEqual(dep[k].toLowerCase(), testnet[k].toLowerCase(), k);
});

test('the wallet constants are the page network\'s (network.js): mainnet chain 3659, never the testnet\'s 77390', () => {
  const m = NETWORKS.mainnet;
  assert.equal(W.EVM_CHAIN_ID, m.chainId);
  assert.equal(W.EVM_CHAIN_ID_HEX, m.chainIdHex);
  assert.equal(W.CHAIN_ID, m.cosmosChainId);
  assert.equal(W.CHAIN_NAME, m.chainName);
  assert.equal(W.EVM_SYMBOL, m.symbol);
  assert.deepEqual(W.evmChainParams(m.rpc), { chainId: '0xe4b', chainName: 'ZETAPHY', nativeCurrency: { name: 'ZETAPHY', symbol: 'ZTPHY', decimals: 18 }, rpcUrls: [m.rpc] });
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /77390|0x12e4e/, 'app.js names no chain id of its own');
  assert.match(app, /deployments-\$\{NET\.chainId\}\.json/);
  assert.match(app, /nftReady\(\{ nft: S\.dep, nftCodeKeysProtected: S\.dep\.nftCodeKeysProtected \}\)/);
});
