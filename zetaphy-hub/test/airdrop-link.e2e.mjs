// Browser test: airdrop-link.html on a built dist/, served with the site's CSP (vercel.json), with a stand-in Solana
// wallet (window.phantom.solana) whose signMessage really signs with an ed25519 key held by this test, and a stand-in
// EVM wallet. Connect, take the 0x address from the EVM wallet (lower case -> EIP-55), sign, the page verifies, and
// the prefilled GitHub issue URL carries exactly the fields the collector (zetaphy-network/airdrop/issues.js) and
// link.js accept. The wallet is never asked for anything but connect + signMessage; a bad checksum is refused; a
// wallet that signs with another key is refused; no wallet at all says so; Thai; a phone, no sideways scroll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign as nodeSign, randomBytes } from 'node:crypto';
import { getAddress, hexlify, encodeBase58 } from 'ethers';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { build } from '../build.mjs';
import { verifyLink, linkMessage } from '../../zetaphy-network/airdrop/link.js';
import { linksFromIssues, FIELDS } from '../../zetaphy-network/airdrop/issues.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.CHROMIUM_PATH || undefined;
const vercel = JSON.parse(readFileSync(join(HERE, 'vercel.json'), 'utf8'));
const CSP = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;

function key() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { owner: encodeBase58(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')), sign: (bytes) => [...nodeSign(null, Buffer.from(bytes), privateKey)] };
}

/** The stand-in wallets, installed before the page's scripts run. `mode`: 'ok' | 'otherKey' | 'none'. */
const stub = ({ owner, other, evm, mode }) => {
  window.__calls = [];
  if (mode === 'none') return;
  const pk = { toBase58: () => owner, toString: () => owner };
  const record = (m) => (...a) => { window.__calls.push(m); return Promise.reject(new Error(`${m} must never be called`)); };
  window.phantom = { solana: {
    isPhantom: true, publicKey: null,
    connect: async () => { window.__calls.push('connect'); window.phantom.solana.publicKey = pk; return { publicKey: pk }; },
    signMessage: async (bytes, display) => {
      window.__calls.push(`signMessage:${display}`);
      window.__signed = new TextDecoder().decode(bytes);
      const signature = Uint8Array.from(await window.nodeSign(Array.from(bytes)));
      return { signature, publicKey: mode === 'otherKey' ? { toBase58: () => other } : pk };
    },
    signTransaction: record('signTransaction'), signAllTransactions: record('signAllTransactions'), signAndSendTransaction: record('signAndSendTransaction'),
  } };
  window.solana = window.phantom.solana;
  window.ethereum = { request: async ({ method }) => { window.__calls.push(`eth:${method}`); if (method === 'eth_requestAccounts') return [evm.toLowerCase()]; throw new Error(`${method} must never be called`); } };
};

test('airdrop-link.html: connect, EVM address, sign, verify, prefilled GitHub issue (8 languages, phone width)', { timeout: 90_000 }, async () => {
  const dist = build();
  const site = await serve(dist, { headers: { 'Content-Security-Policy': CSP } });
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const holder = key(), stranger = key();
    const evm = getAddress(hexlify(randomBytes(20)));
    const open = async (mode, signer = holder) => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const outside = [];
      page.on('request', (r) => { if (!r.url().startsWith(site.url)) outside.push(r.url()); });
      await page.exposeFunction('nodeSign', (bytes) => signer.sign(bytes));
      await page.addInitScript(stub, { owner: holder.owner, other: stranger.owner, evm, mode });
      await page.goto(`${site.url}airdrop-link.html?lang=en`);
      await page.waitForFunction(() => document.querySelector('h1').textContent.length > 0);
      return { page, ctx, errors, outside };
    };

    // ---- the happy path
    const { page, ctx, errors, outside } = await open('ok');
    assert.match(await page.textContent('#dates'), /2026-11-20 14:00 UTC.*2026-12-04 14:00 UTC/);
    assert.match(await page.textContent('.warn'), /never asks for your recovery phrase/);
    assert.equal(await page.isDisabled('#sign'), true);
    await page.click('#wallets button');
    await page.waitForFunction(() => /Solana wallet:/.test(document.getElementById('solState').textContent));
    assert.match(await page.textContent('#solState'), new RegExp(holder.owner));
    // a mixed-case address with a broken checksum is refused
    const j = [...evm].findIndex((c, i) => i > 1 && /[a-fA-F]/.test(c));
    const flipped = evm.slice(0, j) + (evm[j] === evm[j].toUpperCase() ? evm[j].toLowerCase() : evm[j].toUpperCase()) + evm.slice(j + 1);
    await page.fill('#evm', flipped);
    assert.match(await page.textContent('#evmState'), /checksum/);
    assert.equal(await page.isDisabled('#sign'), true);
    // the EVM wallet gives a lower-case address; the page uses its EIP-55 form
    await page.click('#useEvm');
    await page.waitForFunction((a) => document.getElementById('evm').value === a, evm);
    const message = `ZETAPHY airdrop: link ${holder.owner} to ${evm} on 3659`;
    assert.equal(message, linkMessage(holder.owner, evm, 3659));
    assert.equal(await page.textContent('#message'), message);
    await page.click('#sign');
    await page.waitForFunction(() => !document.getElementById('submit').hidden);
    assert.equal(await page.evaluate(() => window.__signed), message, 'the wallet signed exactly the link message');
    assert.match(await page.textContent('#signState'), /checks out/);
    const sig = await page.inputValue('#sig');
    assert.match(sig, /^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
    const href = await page.getAttribute('#open', 'href');
    const u = new URL(href);
    assert.equal(`${u.origin}${u.pathname}`, 'https://github.com/pospos191-alt/zetaphy/issues/new');
    assert.equal(u.searchParams.get('template'), 'airdrop-link.yml');
    assert.equal(u.searchParams.get('title'), 'ZTPHY airdrop round 1: link a Solana wallet');
    assert.equal(u.searchParams.get('solana'), holder.owner);
    assert.equal(u.searchParams.get('evm'), evm);
    assert.equal(u.searchParams.get('signature'), sig);
    assert.equal(await page.getAttribute('#open', 'target'), '_blank');
    assert.deepEqual(verifyLink({ solana: holder.owner, evm, signature: sig }, 3659), { ok: true, solana: holder.owner, evm });
    // the issue GitHub would create from it goes through the collector
    const body = `### ${FIELDS.solana[0]}\n\n${u.searchParams.get('solana')}\n\n### ${FIELDS.evm[0]}\n\n${u.searchParams.get('evm')}\n\n### ${FIELDS.chain[0]}\n\n3659\n\n### ${FIELDS.signature[0]}\n\n${u.searchParams.get('signature')}\n\n### ${FIELDS.safety[0]}\n\n- [X] I did not share`;
    assert.equal(linksFromIssues([{ number: 1, body, state: 'open', created_at: '2026-11-15T00:00:00Z' }]).count, 1);
    // only connect, eth_requestAccounts and signMessage: never a transaction
    assert.deepEqual(await page.evaluate(() => window.__calls), ['connect', 'eth:eth_requestAccounts', 'signMessage:utf8']);
    // changing the address throws the old signature away
    await page.fill('#evm', getAddress(hexlify(randomBytes(20))));
    assert.equal(await page.isHidden('#submit'), true);
    // every language renders; Thai
    for (const l of ['zh', 'es', 'ko', 'ja', 'ru', 'vi', 'th']) {
      await page.selectOption('#lang', l);
      for (const el of await page.$$('[data-t]')) assert.ok((await el.textContent()).trim().length > 0, `${l}: empty text`);
    }
    assert.equal(await page.textContent('h1'), 'แอร์ดรอป ZTPHY รอบที่ 1: ผูกกระเป๋า Solana ของคุณ');
    assert.equal(await page.evaluate(() => localStorage.getItem('zetaphy-hub:lang')), 'th');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at phone width');
    assert.deepEqual(outside, [], 'no request leaves the site');
    assert.deepEqual(errors.filter((e) => !/Failed to load resource|favicon/.test(e)), []);
    await ctx.close();

    // ---- the wallet signs with another account: refused, no issue link
    const b = await open('otherKey', stranger);
    await b.page.click('#wallets button');
    await b.page.fill('#evm', evm);
    await b.page.click('#sign');
    await b.page.waitForFunction(() => /different account/.test(document.getElementById('signState').textContent));
    assert.equal(await b.page.isHidden('#submit'), true);
    await b.ctx.close();

    // ---- no Solana wallet in this browser
    const c = await open('none');
    await c.page.waitForFunction(() => /No Solana wallet found/.test(document.getElementById('solState').textContent));
    assert.equal(await c.page.$$eval('#wallets button', (x) => x.length), 0);
    await c.page.click('#useEvm');
    assert.match(await c.page.textContent('#evmState'), /No EVM wallet/);
    await c.ctx.close();
  } finally {
    await browser.close();
    await site.close();
  }
});
