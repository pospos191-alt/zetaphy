#!/usr/bin/env node
// The ZETAPHY token registry in 5 steps (docs/TOKEN-REGISTRY.md): a token made on ZETAPHY gets its name, logo and a
// "verified" mark on the explorer and in zetaphy-tokens/tokenlist.json. Free; nothing here sends a transaction.
//
//   node scripts/token-registry.js 1 <token>                                [อ่าน] what the chain says about the token
//   node scripts/token-registry.js 2 <token> --input std.json --contract src/My.sol:My [--compiler v0.8.26+commit.8a97fa7a]
//                                                                           [อ่าน] the source compiles to the code on chain
//   node scripts/token-registry.js 3 <token> --info info.json --logo logo.svg [--keystore k.json]   (PW env = passphrase)
//                                                                           [อ่าน] the creator / owner signs the entry (offline)
//   node scripts/token-registry.js 4 <token> --info info.json --logo logo.svg --input std.json --contract … --signature sig.json
//                                                                           [เปลี่ยนไฟล์] writes zetaphy-tokens/3659/<token>/ (then a pull request)
//   node scripts/token-registry.js 5 [<token>|all]                          [อ่าน] every check, as CI runs it; `list` rewrites tokenlist.json
// env: ZETAPHY_RPC (default https://rpc.sawasdeecoin.com).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JsonRpcProvider, Wallet, getAddress } from 'ethers';
import * as R from '../src/tokenregistry.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DIR = join(ROOT, 'zetaphy-tokens', String(R.CHAIN_ID));
const require = createRequire(import.meta.url);
const say = (...a) => console.log(...a);

export function chainOf(rpc = process.env.ZETAPHY_RPC || 'https://rpc.sawasdeecoin.com') {
  const p = new JsonRpcProvider(rpc, R.CHAIN_ID, { staticNetwork: true });
  return { code: (a) => p.getCode(a), tx: (h) => p.getTransaction(h), receipt: (h) => p.getTransactionReceipt(h), call: (to, data) => p.call({ to, data }) };
}

/** Compiles source.json with the exact compiler it names (the bundled solc when it is that version, else downloaded). */
export async function compile(source) {
  let solc = require('solc');
  const want = String(source.compiler ?? '').replace(/^v/, '');
  if (want && !solc.version().startsWith(want)) solc = await new Promise((res, rej) => solc.loadRemoteVersion(`v${want}`, (e, s) => (e ? rej(e) : res(s))));
  const [file, name] = String(source.contract).split(':');
  const input = { ...source.input, settings: { ...source.input.settings, outputSelection: { [file]: { [name]: ['evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage ?? e.message).join('; '));
  const c = out.contracts?.[file]?.[name];
  if (!c) throw new Error(`${source.contract} is not in the compiler's output`);
  return { bytecode: '0x' + c.evm.bytecode.object, deployedBytecode: '0x' + c.evm.deployedBytecode.object, immutableReferences: c.evm.deployedBytecode.immutableReferences ?? {} };
}

export function readEntry(folder) {
  const d = join(DIR, folder), j = (f) => JSON.parse(readFileSync(join(d, f), 'utf8'));
  return { folder, info: j('info.json'), logo: readFileSync(join(d, 'logo.svg'), 'utf8'), source: j('source.json'), signature: j('signature.json') };
}
export const folders = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => R.ADDR.test(f)) : []);

const argsOf = (argv) => { const o = { _: [] }; for (let i = 0; i < argv.length; i++) argv[i].startsWith('--') ? (o[argv[i].slice(2)] = argv[++i]) : o._.push(argv[i]); return o; };
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));

async function main(argv) {
  const o = argsOf(argv), step = o._[0], token = o._[1];
  const chain = chainOf();
  if (step === '1') {
    const t = getAddress(token), code = await chain.code(t);
    if (code === '0x') throw new Error(`${t} has no code on ZETAPHY (chain ${R.CHAIN_ID})`);
    const read = async (fn) => { try { return R.ERC20.decodeFunctionResult(fn, await chain.call(t, R.ERC20.encodeFunctionData(fn)))[0]; } catch { return null; } };
    const [name, symbol, decimals, supply, owner] = await Promise.all(['name', 'symbol', 'decimals', 'totalSupply', 'owner'].map(read));
    say(`token     ${t} (${(code.length - 2) / 2} bytes of code)\nname      ${name}\nsymbol    ${symbol}\ndecimals  ${decimals}\nsupply    ${supply}\nowner()   ${owner ?? '(none)'}`);
    const taken = folders().includes(t);
    say(taken ? 'already in the registry: step 5 re-checks it' : 'next: step 2 with the standard-JSON input you compiled it from (Remix: "Compile" → "Compilation details", Hardhat: artifacts/build-info, Foundry: forge verify-contract --show-standard-json-input)');
  } else if (step === '2') {
    const source = { compiler: o.compiler ?? 'v0.8.26+commit.8a97fa7a', contract: o.contract, input: json(o.input) };
    const c = await compile(source);
    const m = R.bytecodeMatch(await chain.code(getAddress(token)), c.deployedBytecode, c.immutableReferences);
    say(m ? `MATCH (${m}): ${o.contract} compiled with ${source.compiler} is the code at ${getAddress(token)}. Next: step 3` : 'NO MATCH: another compiler version, optimizer setting, or source; nothing to sign yet');
    if (!m) process.exitCode = 1;
  } else if (step === '3') {
    if (!process.env.PW) throw new Error('PW is not set: read -rs PW; export PW (the passphrase of the creator\'s or owner\'s keystore)');
    const info = json(o.info), logo = readFileSync(o.logo, 'utf8');
    const p = [...R.checkInfo(info, token), ...R.checkLogo(logo)];
    if (p.length) throw new Error(`fix these first:\n  - ${p.join('\n  - ')}`);
    const w = await Wallet.fromEncryptedJson(readFileSync(o.keystore, 'utf8'), process.env.PW.trim());
    const msg = R.message(info, logo);
    say(`signing as ${w.address}:\n${msg}\n`);
    writeFileSync('signature.json', JSON.stringify({ signer: w.address, signature: await w.signMessage(msg) }, null, 2) + '\n');
    say('wrote signature.json (it reveals nothing secret). Next: step 4');
  } else if (step === '4') {
    const t = getAddress(token), d = join(DIR, t);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'info.json'), JSON.stringify(json(o.info), null, 2) + '\n');
    writeFileSync(join(d, 'logo.svg'), readFileSync(o.logo, 'utf8'));
    writeFileSync(join(d, 'source.json'), JSON.stringify({ compiler: o.compiler ?? 'v0.8.26+commit.8a97fa7a', contract: o.contract, input: json(o.input) }) + '\n');
    writeFileSync(join(d, 'signature.json'), JSON.stringify(json(o.signature), null, 2) + '\n');
    const r = await R.checkEntry(readEntry(t), chain, compile);
    if (!r.ok) { say(`wrote ${d}, but it would be refused:\n  - ${r.problems.join('\n  - ')}`); process.exitCode = 1; return; }
    say(`wrote ${d}: every check passes (${r.match} match, signed by ${r.signer}).\nNext: node scripts/token-registry.js list (adds it to tokenlist.json), then a pull request with the folder and tokenlist.json. CI runs step 5; once merged the explorer shows it.`);
  } else if (step === '5' || step === 'list') {
    const list = !token || token === 'all' ? folders() : [getAddress(token)];
    let bad = 0; const ok = [];
    for (const f of list) {
      const e = readEntry(f), r = await R.checkEntry(e, chain, compile);
      say(`${r.ok ? 'OK  ' : 'FAIL'} ${f} ${e.info.symbol}${r.ok ? ` (${r.match} match, signed by ${r.signer})` : `\n  - ${r.problems.join('\n  - ')}`}`);
      if (r.ok) ok.push({ info: e.info, match: r.match }); else bad++;
    }
    if (step === 'list') {
      const prev = existsSync(join(DIR, '..', 'tokenlist.json')) ? json(join(DIR, '..', 'tokenlist.json')) : null;
      const v = prev?.version ?? { major: 1, minor: 0, patch: 0 };
      const next = R.tokenList(ok, { version: { ...v, minor: v.minor + 1 }, timestamp: new Date().toISOString() });
      if (prev && JSON.stringify(prev.tokens) === JSON.stringify(next.tokens)) say(`zetaphy-tokens/tokenlist.json is current (${next.tokens.length} token(s))`);
      else { writeFileSync(join(DIR, '..', 'tokenlist.json'), JSON.stringify(next, null, 2) + '\n'); say(`wrote zetaphy-tokens/tokenlist.json (${next.tokens.length} token(s))`); }
    }
    if (!list.length) say('no entries yet');
    if (bad) process.exitCode = 1;
  } else {
    say(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n'));
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
