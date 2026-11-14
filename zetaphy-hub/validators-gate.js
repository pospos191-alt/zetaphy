// The validator guide (validators.html) is about joining ZETAPHY mainnet (zetaphy-chain/join-validator.sh): the
// network badge and the mainnet's risk line go above it. On a network where joining as a validator is not open
// (network.js feature `validators`), the guide is hidden and says "not on mainnet yet" instead.
import { activeNetwork, hasFeature, networkBadge, notOnMainnetBox, watchNetwork } from './network.js';

const net = activeNetwork();
const open = hasFeature(net, 'validators');
watchNetwork(window);
const wrap = document.querySelector('.wrap');
const header = wrap?.querySelector('header');
if (!open) {
  for (const n of [...(wrap?.children ?? [])]) if (n !== header) n.hidden = true;
  for (const f of document.querySelectorAll('form')) f.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
}
const box = document.createElement('div');
box.id = 'net-gate';
(header ?? document.body.firstElementChild)?.after(box);
const lang = () => document.documentElement.lang || 'en';
const draw = () => box.replaceChildren(networkBadge(document, { lang: lang(), net }), ...(open ? [] : [notOnMainnetBox(document, { lang: lang(), feature: 'validators' })]));
draw();
new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
