// mm-snap build / serve / watch. src/pqtx.js re-exports zetaphy-network/src/pqtx.js;
// an @noble import from outside this folder (pqtx.js) is resolved from this
// package's node_modules (package-lock.json), so the bundle and the manifest
// shasum depend on nothing else in the repo.
import { resolve, sep } from 'path';

const ROOT = __dirname + sep;

const ownNoble = {
  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('own-noble', (factory) => {
      factory.hooks.beforeResolve.tap('own-noble', (data) => {
        if (/^@noble\//.test(data.request) && !(data.context + sep).startsWith(ROOT)) data.context = __dirname;
      });
    });
  },
};

export default {
  input: resolve(__dirname, 'src/index.jsx'),
  server: { port: 8080 },
  polyfills: false,
  // A dependency of @metamask/snaps-sdk feature-checks for Buffer; nothing in the bundle uses it.
  stats: { buffer: false },
  // The vaccine's build-time constants (src/threats.js): the ZETAPHY JSON-RPC (https) the
  // transaction insight asks, the ThreatRegistry there (zero: none, so every insight says
  // "couldn't check"), and the web wallet origin(s) allowed to override both
  // (zetaphy_setThreatSource). ZETAPHY mainnet's public RPC and ThreatRegistry
  // (zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json); the testnet was shut down on 2026-11-14.
  // Change them here, then npm run build and commit snap.manifest.json (shasum).
  environment: {
    ZETAPHY_THREAT_RPC: 'https://129-221-199-191.sslip.io',
    ZETAPHY_THREAT_REGISTRY: '0xaACfc7Cf7148b7AE530c2Ab891D4220E648A2139',
    ZETAPHY_WALLET_ORIGINS: 'https://wallet.sawasdeecoin.com',
  },
  customizeWebpackConfig: (config) => ({ ...config, plugins: [...config.plugins, ownNoble] }),
};
