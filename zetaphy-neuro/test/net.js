// Browser tests: pick the network a page opens on (web/network.js; the Neuro page defaults to mainnet, where the federated rounds are "testnet only for now").
//   await onTestnet(page)            every page load of `page` (or a context) uses the testnet
//   await onNetwork(page, 'mainnet') the same for mainnet (the default, but explicit)
export const onNetwork = (target, id) => target.addInitScript((n) => { try { localStorage.setItem('zetaphy:network', n); } catch { /* storage blocked */ } }, id);
export const onTestnet = (target) => onNetwork(target, 'testnet');
