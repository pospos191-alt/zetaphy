// The validator guide (validators.html) is about joining the testnet: its one command syncs a testnet node, takes
// test coins from the faucet and stakes them. ZETAPHY mainnet runs one validator operated by the project and has no
// faucet, so on mainnet (network.js) the guide shows the network badge and "not on mainnet yet".
import { activeNetwork, hasFeature, networkBadge, notOnMainnetBox, watchNetwork } from './network.js';

const net = activeNetwork();
if (!hasFeature(net, 'validators')) {
  watchNetwork(window);
  const wrap = document.querySelector('.wrap');
  const header = wrap?.querySelector('header');
  for (const n of [...(wrap?.children ?? [])]) if (n !== header) n.hidden = true;
  for (const f of document.querySelectorAll('form')) f.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
  const box = document.createElement('div');
  box.id = 'net-gate';
  (header ?? document.body.firstElementChild)?.after(box);
  const lang = () => document.documentElement.lang || 'en';
  const draw = () => box.replaceChildren(networkBadge(document, { lang: lang(), net }), notOnMainnetBox(document, { lang: lang(), feature: 'validators' }));
  draw();
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}
