// scripts/token-listing.js: the five steps' pure parts (docs/TOKEN-LISTING.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwnershipMessage, tokenInfo, onlineChecks, LISTING } from '../scripts/token-listing.js';
import * as M from '../src/saphanmainnet.js';

const TOKEN = '0x68aa0f0144605024eCe1aDccFCC1626352779569';

test('step 3 signs only the explorer\'s ownership message for this token', () => {
  const ok = `[bscscan.com 19/11/2026 16:30:00] I, hereby verify that I am the owner/creator of the address [${TOKEN}]`;
  assert.equal(isOwnershipMessage(ok, TOKEN, 'bscscan.com'), true);
  assert.equal(isOwnershipMessage(ok.toLowerCase(), TOKEN, 'bscscan.com'), true);
  for (const bad of ['', 'hello', ok.replace('bscscan.com', 'evil.example'), ok.replace(TOKEN, '0x' + '11'.repeat(20)), ok.replace('verify', 'approve'),
    `${ok}\nand transfer everything`, 'x'.repeat(500) + ok]) assert.equal(isOwnershipMessage(bad, TOKEN, 'bscscan.com'), false, bad.slice(0, 60));
  assert.equal(isOwnershipMessage(ok, TOKEN, 'basescan.org'), false, 'another explorer\'s message is refused');
});

test('step 4: the BSC form from the config and the state, with the facts on-chain (vault, cap, delay, pool)', () => {
  const t = tokenInfo(M.loadMainnet(), M.loadState(), 'bsc');
  const f = Object.fromEntries(t.fields);
  assert.equal(t.explorer, 'https://bscscan.com');
  assert.equal(f['Token contract address'], TOKEN);
  assert.equal(f['Requester / official e-mail'], 'zetaphy.chain@sawasdeecoin.com');
  assert.equal(f['Logo 32x32 SVG (link)'], 'https://app.sawasdeecoin.com/zetaphy-32.svg');
  assert.match(f.Description, /bridged to BNB Smart Chain by Saphan/);
  assert.match(f['ICO / IEO / burns'], /^No ICO\/IEO and no public token sale\./);
  assert.match(f['ICO / IEO / burns'], /vault 0xFA8F7a89A1f870bDFC03740FbF687e931B0b384A/);
  assert.match(f['ICO / IEO / burns'], /capped at 1,000,000 ZTPHY .* 1 h delay/);
  assert.match(f['ICO / IEO / burns'], /PancakeSwap v3 ZTPHY\/USDT pool 0xB4D4eE5f2C173B483D494EE481496754cE230f88/);
  for (const [, v] of t.fields) assert.doesNotMatch(v, /\b(the first|best|most|guaranteed?|profits?)\b/i, "the form forbids unproven claims");
  // Base: deployed, no pool yet: no pool line
  const b = Object.fromEntries(tokenInfo(M.loadMainnet(), M.loadState(), 'base').fields);
  assert.doesNotMatch(b['ICO / IEO / burns'], /First liquidity/);
  assert.match(b.Description, /bridged to Base/);
});

test('step 5: the logos and the e-mail must really be online', async () => {
  const pages = {
    [LISTING.logo32Svg]: { status: 200, type: 'image/svg+xml', body: '<svg viewBox="0 0 512 512" width="32" height="32"></svg>' },
    [LISTING.logo32Png]: { status: 200, type: 'image/png', body: '' },
    [LISTING.logo256Png]: { status: 200, type: 'image/png', body: '' },
    [LISTING.emailListedAt]: { status: 200, type: 'text/html', body: `<a href="mailto:${LISTING.email}">${LISTING.email}</a>` },
    [LISTING.website]: { status: 200, type: 'text/html', body: '' },
  };
  const get = async (u) => pages[u] ?? { status: 404, type: '', body: '' };
  assert.ok((await onlineChecks(get)).every((x) => x[1]));
  pages[LISTING.logo32Svg] = { status: 200, type: 'image/svg+xml', body: '<svg width="32" height="32"><animate/></svg>' };
  pages[LISTING.emailListedAt] = { status: 200, type: 'text/html', body: 'no address here' };
  const bad = (await onlineChecks(get)).filter((x) => !x[1]).map((x) => x[0]);
  assert.deepEqual(bad, ['logo 32x32 SVG online', `the e-mail is listed on ${LISTING.emailListedAt}`]);
});
