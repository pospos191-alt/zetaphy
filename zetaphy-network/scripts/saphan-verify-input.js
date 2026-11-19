#!/usr/bin/env node
// [อ่าน] The files for the free "Verify and Publish" web form of BscScan / BaseScan / Arbiscan, for a route's deployed
// SaphanSyntheticToken (the Etherscan free API leaves BNB Chain and Base out; the web form is free). Read only: it
// reads the creation transaction the deploy recorded (saphan-mainnet-state.json, step <route>-synthetic), checks the
// committed artifact's creation bytecode is exactly what was sent, and writes
//   <out>/<route>-SaphanSyntheticToken.standard-input.json   the "Solidity (Standard-Json-Input)" file to upload
//   <out>/<route>-SaphanSyntheticToken.constructor-args.txt  the ABI-encoded constructor arguments (no 0x)
// and prints every value the form asks for. With --sourcify yes it also submits to Sourcify (free, no key).
//
//   node scripts/saphan-verify-input.js --route bsc [--out verify/] [--sourcify yes]
// env: <ROUTE>_RPC overrides the config's RPC list.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import { providerFor } from './saphan.js';

const ART = JSON.parse(readFileSync(new URL('../artifacts/SaphanSyntheticToken.json', import.meta.url), 'utf8'));
export const EXPLORER = { 56: 'https://bscscan.com', 8453: 'https://basescan.org', 42161: 'https://arbiscan.io', 137: 'https://polygonscan.com' };

/** The creation transaction's input -> the constructor arguments (hex, no 0x), or throws when the bytecode differs. */
export function constructorArgs(txInput, art = ART) {
  const input = String(txInput).toLowerCase();
  const code = String(art.bytecode).toLowerCase().replace(/^0x/, '');
  if (!input.startsWith('0x' + code)) throw new Error('the creation transaction does not start with the committed SaphanSyntheticToken bytecode: wrong artifact or wrong transaction; nothing written');
  const args = input.slice(2 + code.length);
  if (!/^([0-9a-f]{64})+$/.test(args)) throw new Error('constructor arguments are not whole 32-byte words');
  return args;
}

/** Everything the web form needs, from the artifact (no network). */
export function formValues(art = ART) {
  const s = art.input.settings;
  return {
    compilerType: 'Solidity (Standard-Json-Input)',
    compilerVersion: `v${art.solcLongVersion}`,
    license: 'MIT License (MIT)',
    contractName: `${art.sourceName}:${art.contractName}`,
    optimizer: `${s.optimizer.enabled ? 'yes' : 'no'}, ${s.optimizer.runs} runs`,
    evmVersion: s.evmVersion,
  };
}

/** The standard-JSON input with only the synthetic's own source (smaller to upload; the metadata names only it). */
export function standardInput(art = ART) {
  const src = art.input.sources[art.sourceName];
  if (!src) throw new Error(`${art.sourceName} is not in the artifact's input`);
  return { ...art.input, sources: { [art.sourceName]: src } };
}

async function main(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return prepareVerify(o.route ?? 'bsc', o);
}

/** Checks the creation tx against the artifact, writes the form files, prints the form; with o.sourcify 'yes' submits to Sourcify (an
 *  "already verified" answer counts as done). Returns { token, tx, chainId, explorer, sourcify }. */
export async function prepareVerify(name, o = {}) {
  const cfg = M.loadMainnet(), state = M.loadState(), r = M.route(cfg, name);
  const rec = state.steps?.[r.steps.synthetic];
  if (!rec?.synthetic || !rec.tx) throw new Error(`no ${r.steps.synthetic} with a tx in the state file: deploy the route first`);
  const p = await providerFor(process.env[`${name.toUpperCase()}_RPC`] || r.rpc.join(','), r.chainId);
  const tx = await p.getTransaction(rec.tx);
  const rc = await p.getTransactionReceipt(rec.tx);
  if (!tx || !rc || tx.to !== null || getAddress(rc.contractAddress) !== getAddress(rec.synthetic)) throw new Error(`${rec.tx} did not create ${rec.synthetic} on ${r.displayName}`);
  const args = constructorArgs(tx.data);
  const out = o.out ?? 'verify';
  mkdirSync(out, { recursive: true });
  const base = join(out, `${name}-SaphanSyntheticToken`);
  const input = standardInput();
  writeFileSync(`${base}.standard-input.json`, JSON.stringify(input));
  writeFileSync(`${base}.constructor-args.txt`, args + '\n');
  const f = formValues();
  const url = `${EXPLORER[r.chainId] ?? '<explorer>'}/verifyContract?a=${rec.synthetic}`;
  console.log(`checked: ${rec.tx} created ${rec.synthetic} on ${r.displayName} with the committed bytecode`);
  console.log(`wrote ${base}.standard-input.json and ${base}.constructor-args.txt`);
  console.log(`\nthe form (${url}):\n  contract address  ${rec.synthetic}\n  compiler type     ${f.compilerType}\n  compiler version  ${f.compilerVersion}\n  license           ${f.license}`);
  console.log(`  then: upload ${base}.standard-input.json; contract name ${f.contractName}; constructor arguments (ABI-encoded): the line in ${base}.constructor-args.txt`);
  console.log(`  (inside the file: optimizer ${f.optimizer}, evmVersion ${f.evmVersion})`);
  let sourcify = null;
  if (o.sourcify === 'yes') {
    const res = await fetch(`https://sourcify.dev/server/v2/verify/${r.chainId}/${rec.synthetic}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stdJsonInput: input, compilerVersion: ART.solcLongVersion, contractIdentifier: f.contractName, creationTransactionHash: rec.tx }) });
    const body = await res.json().catch(() => ({}));
    sourcify = res.ok ? 'submitted' : body.customCode === 'already_verified' ? 'verified' : `HTTP ${res.status}`;
    console.log(`\nsourcify: HTTP ${res.status} ${body.verificationId ? `job ${body.verificationId} (https://sourcify.dev/server/v2/verify/${body.verificationId})` : JSON.stringify(body).slice(0, 200)}`);
  }
  return { token: getAddress(rec.synthetic), tx: rec.tx, chainId: r.chainId, explorer: EXPLORER[r.chainId] ?? null, sourcify };
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
