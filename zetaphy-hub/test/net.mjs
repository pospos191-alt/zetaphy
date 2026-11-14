// Browser tests: pick the network a page opens on (network.js; mainnet only).
//   await onTestnet(page)            every page load of `page` (or a context) uses the retired testnet's record
//   await onNetwork(page, 'mainnet') saves "zetaphy:network" (mainnet is what every page opens on anyway)
// The public testnet was shut down on 2026-11-14 and visitors only ever get mainnet (a saved "zetaphy:network" or a
// ?network= link changes nothing). onTestnet opens the page on the retired testnet's record instead, for the tests of
// features that are not on mainnet yet (every request mocked): it defines globalThis.__ZETAPHY_TEST_NETWORK before
// the page's scripts run, which no visitor's link or storage can do.
export const onNetwork = (target, id) => target.addInitScript((n) => { try { localStorage.setItem('zetaphy:network', n); } catch { /* storage blocked */ } }, id);
export const onTestnet = (target) => target.addInitScript(() => { globalThis.__ZETAPHY_TEST_NETWORK = 'testnet'; });
