#!/usr/bin/env node
// Publishes the push airdrop's recipient list for got-ztphy.html ("Did you get ZTPHY?"), after the airdrop
// (docs/AIRDROP.md section 7, docs/OUTREACH.md). Reads the list gov.sh sent (one 0x address per line) and writes:
//   <out>/manifest.json   chain 3659, ZTPHY each, count, sha256 of the list file (the same as `sha256sum push.txt`)
//   <out>/shards/<p>.json the addresses by their first hex characters (the page loads one small file per check)
//   <out>/list.txt        the list itself, byte for byte, so anyone can check the sha256 and the count
//
//   node tools/push-manifest.mjs ~/push.txt [--each 10] [--prefix 2] [--out airdrop-push] [--no-list]
//
// <out> defaults to zetaphy-hub/airdrop-push/, which build.mjs ships when manifest.json is there. Public data only:
// addresses that already received coins on a public chain. Nothing here reads or needs a key.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildPushFiles } from '../got-ztphy-core.js';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Writes the files; returns the manifest. */
export function writePushFiles(listFile, { out = join(HERE, 'airdrop-push'), each = '10', prefix = 2, withList = true } = {}) {
  const bytes = readFileSync(listFile);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { manifest, shards } = buildPushFiles(bytes.toString('utf8'), { sha256, each, prefix, list: withList ? 'list.txt' : null });
  rmSync(join(out, 'shards'), { recursive: true, force: true });
  mkdirSync(join(out, 'shards'), { recursive: true });
  for (const [p, addresses] of Object.entries(shards)) writeFileSync(join(out, 'shards', `${p}.json`), `${JSON.stringify({ addresses })}\n`);
  if (withList) writeFileSync(join(out, 'list.txt'), bytes);
  else rmSync(join(out, 'list.txt'), { force: true });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
  const each = opt('--each', '10');
  const prefix = Number(opt('--prefix', '2'));
  const out = resolve(opt('--out', join(HERE, 'airdrop-push')));
  const withList = !args.includes('--no-list');
  const file = args.filter((a) => a !== '--no-list')[0];
  if (!file) { console.error('usage: node tools/push-manifest.mjs <push.txt> [--each 10] [--prefix 2] [--out dir] [--no-list]'); process.exit(2); }
  try {
    const m = writePushFiles(file, { out, each, prefix, withList });
    console.log(`push-manifest: ${m.count} addresses, ${m.each} ZTPHY each, sha256 ${m.sha256}\n  written to ${out}`);
  } catch (e) { console.error(`push-manifest: ${e.message}`); process.exit(1); }
}
