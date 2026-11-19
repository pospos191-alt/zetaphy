#!/usr/bin/env node
// ZTPHY's token pages on explorers (BscScan, BaseScan) in five steps: docs/TOKEN-LISTING.md. Nothing here sends a
// transaction; step 3 signs one message offline with the deployer's keystore.
//
//   node scripts/token-listing.js 1 --route bsc   [อ่าน]  the bytecode on the chain is the committed one; Sourcify (free)
//   node scripts/token-listing.js 2 --route bsc   [เปลี่ยนไฟล์] the explorer's "Verify and Publish" files and form values
//   node scripts/token-listing.js 3 --route bsc   [อ่าน]  sign the explorer's ownership message (paste it; PW env = passphrase)
//   node scripts/token-listing.js 4 --route bsc   [อ่าน]  every field of the explorer's "Token Update" form, ready to paste
//   node scripts/token-listing.js 5 --route bsc   [อ่าน]  the logos and the e-mail are online where the form says they must be
// env: <ROUTE>_RPC (e.g. BSC_RPC=https://bsc-dataseed.bnbchain.org), KEYSTORE (default ~/ztphy-deployer/keystore.json), PW (step 3).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { Wallet, getAddress } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import { prepareVerify, EXPLORER } from './saphan-verify-input.js';

export const LISTING = JSON.parse(readFileSync(new URL('../token-listing.json', import.meta.url), 'utf8'));

/** The ownership message is the explorer's own: it names the explorer, the token and asks to verify ownership; anything else is refused. */
export function isOwnershipMessage(msg, token, host) {
  const m = String(msg ?? '').trim();
  return m.length > 0 && m.length < 400 && !/\n/.test(m) && m.toLowerCase().includes(host.toLowerCase()) && m.toLowerCase().includes(token.toLowerCase()) && /verify/i.test(m) && /owner|creator/i.test(m);
}

/** The Token Update form's fields for a route (public values; text exactly as it is pasted). */
export function tokenInfo(cfg, state, name, listing = LISTING) {
  const r = M.route(cfg, name), L = r.limits, token = state?.steps?.[r.steps.synthetic]?.synthetic;
  const vault = state?.steps?.[r.steps.vault]?.vault;
  if (!token || !vault) throw new Error(`route ${name} is not deployed yet (no synthetic or vault in the state file)`);
  const pool = listing.pools?.[name] ?? null;
  const num = (x) => Number(x).toLocaleString('en-US');
  const sale = [
    'No ICO/IEO and no public token sale.',
    `On ${r.displayName}, ZTPHY exists only by bridging from ZETAPHY mainnet (chain 3659) through Saphan: each token is minted by the bridge and backed one to one by ZTPHY locked in the vault ${getAddress(vault)} on ZETAPHY. Supply on ${r.displayName} is capped at ${num(L.supplyCap)} ZTPHY by the contract (lock cap, daily mint limit, ${Math.round(L.mintDelay / 3600)} h delay, 48 h timelock).`,
    'No token burns.',
    ...(pool ? [`First liquidity: ${pool.dex} ${pool.pair} pool ${pool.address} (${pool.seed}, owner-provided).`] : []),
  ].join('\n');
  return {
    explorer: EXPLORER[r.chainId] ?? null,
    fields: [
      ['Token contract address', getAddress(token)],
      ['Project name', listing.projectName],
      ['Official website', listing.website],
      ['Requester / official e-mail', listing.email],
      ['Logo 32x32 SVG (link)', listing.logo32Svg],
      ['Logo 32x32 PNG (if asked)', listing.logo32Png],
      ['Logo 256x256 PNG (if asked)', listing.logo256Png],
      ['Project sector', listing.sector],
      ['Description', listing.description.replace('{chain}', r.displayName)],
      ['Whitepaper', listing.whitepaper],
      ['GitHub', listing.github],
      ['X (Twitter)', listing.x],
      ['CoinMarketCap / CoinGecko', '(leave empty: not listed)'],
      ['ICO / IEO / burns', sale],
    ],
  };
}

/** Step 5's checks on fetched pages: [label, ok, detail]. `get(url)` returns { status, type, body }. */
export async function onlineChecks(get, listing = LISTING) {
  const out = [];
  const svg = await get(listing.logo32Svg);
  out.push(['logo 32x32 SVG online', svg.status === 200 && /svg/.test(svg.type) && /width="32" height="32"/.test(svg.body) && !/<animate|<script|<image/.test(svg.body), `${svg.status} ${svg.type}`]);
  for (const [label, url] of [['logo 32x32 PNG online', listing.logo32Png], ['logo 256x256 PNG online', listing.logo256Png]]) {
    const x = await get(url);
    out.push([label, x.status === 200 && /png/.test(x.type), `${x.status} ${x.type}`]);
  }
  const page = await get(listing.emailListedAt);
  out.push([`the e-mail is listed on ${listing.emailListedAt}`, page.status === 200 && page.body.includes(listing.email), `${page.status}`]);
  const site = await get(listing.website);
  out.push(['the website answers over https', site.status === 200, `${site.status}`]);
  return out;
}

const fetchGet = async (url) => {
  try { const r = await fetch(url, { redirect: 'follow' }); return { status: r.status, type: r.headers.get('content-type') ?? '', body: await r.text() }; } catch (e) { return { status: 0, type: '', body: '', error: e.message }; }
};

async function main(argv) {
  const step = argv[0], o = {};
  for (let i = 1; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  const name = o.route ?? 'bsc';
  const cfg = M.loadMainnet(), state = M.loadState(), r = M.route(cfg, name);
  const token = state?.steps?.[r.steps.synthetic]?.synthetic;
  const host = (EXPLORER[r.chainId] ?? '').replace('https://', '');
  if (step === '1' || step === '2') {
    const v = await prepareVerify(name, { out: o.out ?? `${homedir()}/verify`, sourcify: step === '1' ? 'yes' : 'no' });
    if (step === '1') console.log(`\nstep 1 ${v.sourcify === 'verified' || v.sourcify === 'submitted' ? 'OK' : 'NOT DONE'}: ${v.token} on ${r.displayName}; next: open ${v.explorer}/address/${v.token}#code: a green tick means step 2 is done already`);
    else console.log(`\nstep 2: fill ${v.explorer}/verifyContract?a=${v.token} with the values above, then step 3`);
  } else if (step === '3') {
    if (!process.env.PW) throw new Error('PW is not set: read -rs PW; export PW (the deployer passphrase), then run step 3 again');
    console.log(`open ${EXPLORER[r.chainId]}/verifyAddress/${token}, owner ${cfg.deployer.address}, "sign message manually"; paste the message here, then Enter:`);
    const rl = createInterface({ input: process.stdin });
    const msg = await new Promise((res) => rl.once('line', (l) => { rl.close(); res(l.trim()); }));
    if (!isOwnershipMessage(msg, token, host)) throw new Error(`STOP: that is not ${host}'s ownership message for ${token}; nothing signed`);
    const w = await Wallet.fromEncryptedJson(readFileSync(process.env.KEYSTORE || `${homedir()}/ztphy-deployer/keystore.json`, 'utf8'), process.env.PW.trim());
    if (getAddress(w.address) !== getAddress(cfg.deployer.address)) throw new Error(`the keystore is ${w.address}, not the deployer ${cfg.deployer.address}`);
    console.log(`signer    ${w.address}\nsignature ${await w.signMessage(msg)}\npaste the signature into the form, Verify Ownership, then step 4`);
  } else if (step === '4') {
    const t = tokenInfo(cfg, state, name);
    console.log(`the form: ${t.explorer}/tokenupdate (or the link after step 3)\n`);
    for (const [k, v] of t.fields) console.log(`== ${k}\n${v}\n`);
    console.log('one request per token: sending it again only delays it. Then step 5.');
  } else if (step === '5') {
    const res = await onlineChecks(fetchGet);
    for (const [label, ok, d] of res) console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} (${d})`);
    console.log(res.every((x) => x[1]) ? '\nstep 5 OK: everything the form points to is online. The explorer answers by e-mail in days to weeks.' : '\nfix the FAIL lines before (or right after) sending the form');
    if (!res.every((x) => x[1])) process.exitCode = 1;
  } else {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
