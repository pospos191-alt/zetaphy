// Browser tests: pick the network a page opens on (src/network.js; the explorer defaults to mainnet).
//   await onTestnet(page)            every page load of `page` (or a context) uses the testnet
//   await onNetwork(page, 'mainnet') the same for mainnet (the default, but explicit)
export const onNetwork = (target, id) => target.addInitScript((n) => { try { localStorage.setItem('zetaphy:network', n); } catch { /* storage blocked */ } }, id);
export const onTestnet = (target) => onNetwork(target, 'testnet');
