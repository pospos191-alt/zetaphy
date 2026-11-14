// node scripts/mainnet-config.js: writes web/deployments-3659.json (the NFT app's mainnet config) from the mainnet
// launch's public address file, zetaphy-launch/state/3659.contracts.json: the NFT factory and marketplace, the
// ThreatRegistry, the timelock, and `nftCodeKeysProtected` (the app, like the hub, opens only once it is true;
// docs/ZETAPHY-MAINNET-PROCEDURE.md 16.11). test/mainnet.test.js fails while the two files disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NETWORKS } from '../web/lib/network.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LAUNCH_FILE = `${ROOT}../zetaphy-launch/state/3659.contracts.json`;
export const OUT = `${ROOT}web/deployments-3659.json`;
const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** The NFT app's mainnet deployment record from the launch file (throws on anything malformed). */
export function mainnetDeployment(launch) {
  const net = NETWORKS.mainnet;
  if (launch?.chainId !== net.chainId) throw new Error(`the launch file is for chain ${launch?.chainId}, not ${net.chainId}`);
  const { factory, marketplace } = launch.nft ?? {};
  const threatRegistry = launch.contracts?.threatRegistry, governance = launch.contracts?.timelock;
  for (const [k, v] of Object.entries({ factory, marketplace, threatRegistry, governance })) if (!ADDR.test(String(v ?? ''))) throw new Error(`the launch file has no ${k} address`);
  return {
    _comment: 'ZETAPHY mainnet (chain 3659): the NFT contracts the launch deployed (zetaphy-launch/state/3659.contracts.json `nft`; test/mainnet.test.js checks they agree). The app opens only once nftCodeKeysProtected is true (the collections\' code keys protected in the ThreatRegistry by the timelock batch): node scripts/mainnet-config.js copies it from the launch file.',
    network: 'zetaphy-mainnet', chainId: net.chainId, rpc: net.rpc, factory, marketplace, threatRegistry, governance,
    nftCodeKeysProtected: launch.nftCodeKeysProtected === true,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const d = mainnetDeployment(JSON.parse(readFileSync(LAUNCH_FILE, 'utf8')));
  writeFileSync(OUT, `${JSON.stringify(d, null, 2)}\n`);
  console.log(`written ${OUT} (nftCodeKeysProtected: ${d.nftCodeKeysProtected})`);
}
