// Browser test: the hub's layout on mainnet, in Thai and English, at 390, 768, 1280 and 1900 px (on a built dist/).
//  - The mainnet notice is said once: the hub's bar above every tab; an app inside the hub shows no second one,
//    and each app opened on its own (its own site) shows its own, exactly once.
//  - Sticky headers (the hub's frame, the explorer's and the swap's own headers, inside the hub and on their own):
//    opaque, painted above the content that scrolls under them, their tab labels never on top of each other.
//  - No sideways page scroll at 390 px; the rail's hover text sits beside its item, never over the next ones.
//  - The wallet's safety box: the three points, folded once read and remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { answer } from './mocknode.mjs';
import { NET_TEXT } from '../network.js';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const exe = process.env.CHROMIUM_PATH || undefined;
const MAINNET = 'https://129-221-199-191.sslip.io';
const WIDTHS = [390, 768, 1280, 1900];
const LANGS = ['th', 'en'];
// every tab of the hub (hub.js TABS) and the apps it shows in frames
const TABS = ['home', 'wallet', 'swap', 'stake', 'earn', 'mine', 'saphan', 'agents', 'offline', 'audit', 'quantum', 'nft', 'explorer', 'neuro', 'ai',
  'analytics', 'defi', 'leaderboard', 'gov', 'immune', 'aichain', 'dev'];
const APPS = { wallet: 'wallet/', swap: 'swap/', explorer: 'explorer/', neuro: 'neuro/web/' };
const APP_LANG = { wallet: ['zetaphy-wallet:lang', (l) => l], swap: ['zetaphy-dex:lang', (l) => l], explorer: ['zetaphy-explorer:lang', (l) => l], neuro: ['neuro-lang', (l) => l] };

async function newPage(browser, site, { width, lang }) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === new URL(site.url).origin) return route.continue();
    let a = u.origin === MAINNET ? answer(u.href.replace(u.origin, 'https://rpc.sawasdeecoin.com'), route.request().postData()) : null;
    if (a && a.result === '0x12e4e') a = { ...a, result: '0xe4b' };
    if (a) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(a) });
    return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  await ctx.addInitScript(([l, keys]) => {
    try {
      if (!sessionStorage.getItem('__set')) {
        localStorage.setItem('zetaphy-hub:lang', l);
        for (const [k, v] of keys) localStorage.setItem(k, v);
        sessionStorage.setItem('__set', '1');
      }
    } catch { /* none */ }
  }, [lang, Object.values(APP_LANG).map(([k, f]) => [k, f(lang)])]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

/** How many mainnet notices (network.js .zn-net) are shown in this document. */
const shownNotices = (frame) => frame.evaluate(() => [...document.querySelectorAll('.zn-net')].filter((n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden').length);
const noSideScroll = (frame) => frame.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

/**
 * A sticky header after the page is scrolled: its background is opaque, nothing from the page paints over it
 * (elementFromPoint across its box lands in it), the content right under it is reachable (not covered by it), and
 * its links or tabs do not overlap each other.
 */
async function checkSticky(frame, headerSel, linkSel, what) {
  // enough content to scroll, whatever the mocked node gave the page
  await frame.evaluate(() => { const d = document.createElement('div'); d.className = '__filler'; d.style.height = '3000px'; (document.querySelector('main') ?? document.body).append(d); window.scrollTo(0, 600); });
  await frame.waitForFunction(() => window.scrollY > 0);
  const r = await frame.evaluate(([hs, ls]) => {
    const hd = document.querySelector(hs);
    const box = hd.getBoundingClientRect();
    const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return c === 'transparent' ? 0 : 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    const bg = getComputedStyle(hd).backgroundColor;
    const pts = [];
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const fy of [0.2, 0.5, 0.8]) pts.push([box.left + box.width * fx, box.top + box.height * fy]);
    const covered = pts.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return e && !hd.contains(e); }).length;
    const below = document.elementFromPoint(box.left + box.width / 2, box.bottom + 4);
    const links = [...hd.querySelectorAll(ls)].filter((a) => a.getClientRects().length).map((a) => a.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
      const a = links[i], b = links[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
    }
    return { top: box.top, sticky: getComputedStyle(hd).position, alpha: alpha(bg), bg, covered, belowInHeader: !!below && hd.contains(below), links: links.length, overlaps };
  }, [headerSel, linkSel]);
  assert.equal(r.sticky, 'sticky', `${what}: sticky`);
  assert.ok(Math.abs(r.top) < 1, `${what}: stays on top while scrolled (${r.top})`);
  assert.equal(r.alpha, 1, `${what}: opaque background (${r.bg})`);
  assert.equal(r.covered, 0, `${what}: nothing from the page shows over the header`);
  assert.equal(r.belowInHeader, false, `${what}: the content right under the header is not covered by it`);
  assert.ok(r.links > 2, `${what}: its tabs are shown`);
  assert.equal(r.overlaps, 0, `${what}: no tab label runs into another`);
  await frame.evaluate(() => { document.querySelector('.__filler')?.remove(); window.scrollTo(0, 0); });
}

async function appFrame(page, app) {
  const sel = `#frames iframe[src^="${APPS[app]}"]`;
  await page.waitForSelector(sel, { state: 'attached' });
  const f = await (await page.$(sel)).contentFrame();
  // the hub has dressed the frame (embed.css in, frame shown)
  await page.waitForFunction((s) => { const fr = document.querySelector(s); return fr && fr.style.visibility === '' && fr.contentDocument?.documentElement.classList.contains('hub-embed') && [...fr.contentDocument.styleSheets].some((x) => /embed\.css/.test(x.href ?? '')); }, sel);
  return f;
}

test('the hub on mainnet at 390-1900 px in Thai and English: one notice on every tab, opaque sticky headers, no sideways scroll', { timeout: 600_000 }, async () => {
  const site = await serve(DIST);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    for (const lang of LANGS) for (const width of WIDTHS) {
      const { ctx, page, errors } = await newPage(browser, site, { width, lang });
      const at = `${lang} ${width}px`;
      await page.goto(`${site.url}?tab=home`);
      await page.waitForSelector('#net-note .zn-net-risk');
      for (const id of TABS) {
        await page.evaluate((t) => document.querySelector(`.tab[data-tab="${t}"]`).click(), id);
        await page.waitForFunction((t) => new URL(location.href).searchParams.get('tab') === t, id);
        // the hub's bar: the notice's risk sentence and its link, on every tab, said once in the hub's own page
        assert.ok(await page.isVisible('#net-note .zn-net-risk'), `${at} ${id}: the hub's notice bar`);
        assert.equal(await page.textContent('#net-note .zn-net-risk'), NET_TEXT[lang].risk, `${at} ${id}: the notice's own sentence`);
        assert.ok(await page.isVisible('#net-note a.zn-net-notice'), `${at} ${id}: the notice link`);
        assert.equal(await shownNotices(page.mainFrame()), 1, `${at} ${id}: one notice in the hub's page`);
        if (width === 390) assert.ok(await noSideScroll(page.mainFrame()), `${at} ${id}: no sideways scroll`);
        // the bar is in the frame's grid, above the stage: nothing scrolls under or over it
        const bar = await page.evaluate(() => { const n = document.getElementById('net-note').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return { n: n.bottom, s: s.top }; });
        assert.ok(bar.n <= bar.s + 0.5, `${at} ${id}: the bar sits above the stage`);
        if (APPS[id]) {
          const f = await appFrame(page, id);
          // the app's own notice is in its page (for its own site) but not shown again inside the hub
          await f.waitForFunction(() => document.querySelector('.zn-net'));
          assert.equal(await shownNotices(f), 0, `${at} ${id}: no second notice inside the hub`);
          if (width === 390) assert.ok(await noSideScroll(f), `${at} ${id}: no sideways scroll inside the app`);
          if (id === 'explorer' && (width === 390 || width === 1900)) await checkSticky(f, '.app-header', '.nav a', `${at} explorer in the hub`);
          if (id === 'swap' && (width === 390 || width === 1900)) await checkSticky(f, '.app-header', '.tab', `${at} swap in the hub`);
        }
      }
      // the earn tab's validator guide (validators.html?embed): no second notice in its frame either
      await page.evaluate(() => document.querySelector('.tab[data-tab="earn"]').click());
      const guide = await page.$('#earn-guide-frame');
      if (guide) {
        const g = await guide.contentFrame();
        await g.waitForSelector('#net-gate', { state: 'attached' });
        assert.equal(await shownNotices(g), 0, `${at}: no second notice in the validator guide's frame`);
      }
      assert.deepEqual(errors, [], `${at}: no page errors`);
      await ctx.close();
    }
  } finally { await browser.close(); site.close(); }
});

test('each app on its own (its own site): its notice exactly once, opaque sticky header, no sideways scroll at 390 px', { timeout: 300_000 }, async () => {
  const site = await serve(DIST);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    for (const lang of LANGS) for (const width of WIDTHS) {
      const { ctx, page } = await newPage(browser, site, { width, lang });
      const at = `${lang} ${width}px`;
      for (const [app, path] of Object.entries(APPS)) {
        await page.goto(`${site.url}${path}`);
        await page.waitForSelector('.zn-net');
        assert.equal(await shownNotices(page.mainFrame()), 1, `${at} ${app}: its own notice, once`);
        assert.ok(await page.isVisible('.zn-net .zn-net-risk'), `${at} ${app}: the risk sentence`);
        assert.equal(await page.textContent('.zn-net .zn-net-risk'), NET_TEXT[lang].risk, `${at} ${app}: the notice's own sentence`);
        if (width === 390) assert.ok(await noSideScroll(page.mainFrame()), `${at} ${app}: no sideways scroll`);
        if (width === 390 || width === 1900) {
          if (app === 'explorer') await checkSticky(page.mainFrame(), '.app-header', '.nav a', `${at} explorer`);
          if (app === 'swap') await checkSticky(page.mainFrame(), '.app-header', '.tab', `${at} swap`);
        }
      }
      await ctx.close();
    }
  } finally { await browser.close(); site.close(); }
});

test('the rail\'s hover text: beside its item, only on hover or keyboard focus; the wallet\'s safety box folds once read', { timeout: 120_000 }, async () => {
  const site = await serve(DIST);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const { ctx, page } = await newPage(browser, site, { width: 1900, lang: 'th' });
    await page.goto(`${site.url}?tab=explorer`);
    await page.waitForSelector('#net-note .zn-net-risk');
    for (const id of ['wallet', 'explorer']) {
      await page.hover(`.side .tab[data-tab="${id}"]`);
      await page.waitForSelector('#tip:not([hidden])');
      const r = await page.evaluate((t) => {
        const tip = document.getElementById('tip').getBoundingClientRect();
        const tabs = [...document.querySelectorAll('.side .tab')].map((a) => a.getBoundingClientRect());
        const hit = tabs.filter((b) => tip.left < b.right && b.left < tip.right && tip.top < b.bottom && b.top < tip.bottom).length;
        const me = document.querySelector(`.side .tab[data-tab="${t}"]`).getBoundingClientRect();
        return { hit, beside: tip.left >= me.right };
      }, id);
      assert.equal(r.hit, 0, `${id}: the hover text covers no rail item`);
      assert.ok(r.beside, `${id}: beside its item`);
      await page.mouse.move(1000, 600);
      await page.waitForSelector('#tip', { state: 'hidden' });
    }
    // a click focuses the tab but does not keep its hover text open
    await page.click('.side .tab[data-tab="wallet"]');
    await page.mouse.move(1000, 600);
    await page.waitForSelector('#tip', { state: 'hidden' });
    // keyboard focus shows it
    await page.focus('.side .tab[data-tab="swap"]');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#tip:not([hidden])');
    await ctx.close();

    // the wallet's safety box: the three points open on a first visit; folded, it stays folded
    const w = await newPage(browser, site, { width: 390, lang: 'th' });
    await w.page.goto(`${site.url}wallet/`);
    await w.page.waitForSelector('#warning');
    assert.equal(await w.page.getAttribute('#warning', 'open'), '', 'open on the first visit');
    assert.equal(await w.page.locator('#warning li').count(), 3);
    for (const li of await w.page.locator('#warning li').all()) assert.ok((await li.textContent()).length < 80, 'each point is short');
    await w.page.click('#warning summary');
    assert.equal(await w.page.getAttribute('#warning', 'open'), null);
    await w.page.waitForFunction(() => localStorage.getItem('zetaphy-wallet:warn-read') === '1');
    await w.page.reload();
    await w.page.waitForSelector('#warning');
    assert.equal(await w.page.getAttribute('#warning', 'open'), null, 'folded once read, remembered');
    assert.match(await w.page.textContent('#warning'), /seed/, 'the points are still there, one click away');
    await w.page.click('#warning summary');
    assert.ok(await w.page.isVisible('#warning li >> nth=1'));
    await w.ctx.close();
  } finally { await browser.close(); site.close(); }
});
