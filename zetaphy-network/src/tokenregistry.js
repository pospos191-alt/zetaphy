// The ZETAPHY token registry (docs/TOKEN-REGISTRY.md): a token made on ZETAPHY (chain 3659) gets its name, logo and
// a "verified" mark on the explorer and in tokenlist.json once its folder zetaphy-tokens/3659/<address>/ passes these
// checks. No server and no fee: the folder arrives as a pull request and CI re-checks everything against the chain.
//   info.json       name, symbol, decimals, website, description, links, creationTx
//   logo.svg        32x32, static, safe (no script, no external reference)
//   source.json     { compiler, contract, input }: the Solidity standard-JSON input; CI recompiles it
//   signature.json  { signer, signature }: the token's creator (the creationTx sender) or its owner() signs MESSAGE
// Pure functions here; the chain and the compiler are passed in.
import { createHash } from 'node:crypto';
import { getAddress, verifyMessage, Interface } from 'ethers';

export const CHAIN_ID = 3659;
export const ADDR = /^0x[0-9a-fA-F]{40}$/;
/** Names a registry entry may never take: the chain's own coin and well-known tokens (impersonation). */
export const RESERVED = ['ztphy', 'zetaphy', 'bztphy', 'usdt', 'usdc', 'dai', 'weth', 'eth', 'btc', 'wbtc', 'bnb', 'wbnb'];
export const ERC20 = new Interface(['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)', 'function owner() view returns (address)']);

/** The info.json fields, in this order; canonical JSON hashes them so a signature covers exactly this text. */
const FIELDS = ['address', 'name', 'symbol', 'decimals', 'website', 'description', 'creationTx', 'links'];
export const canonical = (info) => JSON.stringify(Object.fromEntries(FIELDS.filter((k) => info[k] !== undefined).map((k) => [k, info[k]])));
export const infoHash = (info) => createHash('sha256').update(canonical(info)).digest('hex');

/** What the creator (or owner) signs: one line per fact, the info's hash at the end (EIP-191 personal_sign). */
export const message = (info, logoSvg) => [
  'ZETAPHY token registry', `chain ${CHAIN_ID}`, `token ${getAddress(info.address)}`, `info sha256 ${infoHash(info)}`,
  `logo sha256 ${createHash('sha256').update(String(logoSvg)).digest('hex')}`].join('\n');

const https = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"'<>]*)?$/i.test(u) && u.length <= 200;

/** info.json problems ([] = fine). `folder` is the address the folder is named after. */
export function checkInfo(info, folder) {
  const p = [];
  if (!info || typeof info !== 'object') return ['info.json is not an object'];
  for (const k of Object.keys(info)) if (!FIELDS.includes(k)) p.push(`unknown field "${k}"`);
  if (!ADDR.test(String(info.address))) p.push('address: 0x + 40 hex');
  else if (folder && getAddress(info.address) !== getAddress(folder)) p.push(`address ${info.address} is not the folder's ${folder}`);
  if (typeof info.name !== 'string' || !/^[\p{L}\p{N} ._()-]{2,40}$/u.test(info.name)) p.push('name: 2-40 letters, digits, space . _ ( ) -');
  if (typeof info.symbol !== 'string' || !/^[A-Za-z0-9]{2,11}$/.test(info.symbol)) p.push('symbol: 2-11 letters or digits');
  const bare = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (RESERVED.some((r) => bare(info.symbol) === r || bare(info.name) === r || bare(info.name).startsWith(r))) p.push(`name or symbol imitates a reserved one (${RESERVED.join(', ')})`);
  if (!Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > 36) p.push('decimals: an integer 0-36');
  if (!https(info.website)) p.push('website: an https:// URL');
  if (typeof info.description !== 'string' || info.description.length < 20 || info.description.length > 500 || /<|>/.test(info.description)) p.push('description: 20-500 characters, no < >');
  if (/\b(guaranteed?|risk[- ]free|100x|1000x|moon)\b/i.test(String(info.description))) p.push('description: no promises of profit');
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(info.creationTx))) p.push('creationTx: the 0x hash of the transaction that created the token');
  if (info.links !== undefined) {
    if (!info.links || typeof info.links !== 'object' || Array.isArray(info.links)) p.push('links: an object');
    else for (const [k, v] of Object.entries(info.links)) {
      if (!['x', 'telegram', 'discord', 'github', 'docs'].includes(k)) p.push(`links.${k}: one of x, telegram, discord, github, docs`);
      if (!https(v)) p.push(`links.${k}: an https:// URL`);
    }
  }
  return p;
}

/** logo.svg problems: 32x32, small, static, nothing that runs or loads. */
export function checkLogo(svg) {
  const s = String(svg ?? ''), p = [];
  if (s.length > 20000) p.push(`logo.svg is ${s.length} bytes (at most 20000)`);
  const head = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b([^>]*)>/i.exec(s);
  if (!head) return [...p, 'logo.svg does not start with <svg>'];
  if (!/\bwidth="32(?:px)?"/.test(head[1]) || !/\bheight="32(?:px)?"/.test(head[1])) p.push('logo.svg: width="32" height="32" on <svg>');
  if (/<script|<foreignObject|<image|<iframe|<embed|<object|<animate|<set\b|javascript:|data:/i.test(s)) p.push('logo.svg: no script, embedded images, animation or data: URLs');
  if (/\son[a-z]+\s*=/i.test(s)) p.push('logo.svg: no event attributes (onload=…)');
  if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(s) || /url\(\s*['"]?(?!#)/i.test(s)) p.push('logo.svg: only #local references');
  return p;
}

/** Runtime bytecode vs the compiler's deployedBytecode: 'full' (identical, metadata too), 'partial' (only the metadata
 *  hash differs) or null. Immutables are masked at the compiler's immutableReferences. */
export function bytecodeMatch(onchainHex, compiledHex, immutableRefs = {}) {
  const a = Buffer.from(String(onchainHex).replace(/^0x/, ''), 'hex'), b = Buffer.from(String(compiledHex).replace(/^0x/, ''), 'hex');
  if (!a.length || a.length !== b.length) return null;
  const on = Buffer.from(a);
  for (const refs of Object.values(immutableRefs)) for (const { start, length } of refs) on.fill(0, start, start + length), b.fill(0, start, start + length);
  if (on.equals(b)) return 'full';
  const meta = (x) => (x.length >= 2 ? x.readUInt16BE(x.length - 2) + 2 : 0); // CBOR metadata + its 2-byte length
  const ma = meta(on), mb = meta(b);
  if (ma === mb && ma < on.length && on.subarray(0, on.length - ma).equals(b.subarray(0, b.length - mb))) return 'partial';
  return null;
}

/** The creation transaction's input starts with the compiled creation code; the runtime's metadata blob (it sits inside
 *  the creation code) is masked so a 'partial' match still checks every constructor byte. */
export function creationMatch(txData, bytecodeHex, deployedHex) {
  const d = Buffer.from(String(txData).replace(/^0x/, ''), 'hex'), b = Buffer.from(String(bytecodeHex).replace(/^0x/, ''), 'hex');
  const r = Buffer.from(String(deployedHex).replace(/^0x/, ''), 'hex');
  if (d.length < b.length || !b.length) return false;
  const head = Buffer.from(d.subarray(0, b.length)), want = Buffer.from(b);
  const ml = r.length >= 2 ? r.readUInt16BE(r.length - 2) + 2 : 0;
  if (ml > 2 && ml < r.length) {
    const blob = r.subarray(r.length - ml), at = want.indexOf(blob);
    if (at >= 0) { want.fill(0, at, at + ml); head.fill(0, at, at + ml); }
  }
  return head.equals(want);
}

/** The signature is by `allowed` (the creator, or owner()) over message(info, logo). */
export function checkSignature(info, logoSvg, sig, allowed) {
  if (!sig || !ADDR.test(String(sig.signer)) || !/^0x[0-9a-fA-F]{130}$/.test(String(sig.signature))) return ['signature.json: { signer, signature }'];
  let who;
  try { who = verifyMessage(message(info, logoSvg), sig.signature); } catch { return ['signature.json: not a valid signature'] }
  if (getAddress(who) !== getAddress(sig.signer)) return [`signature.json: signed by ${who}, not the signer ${sig.signer}`];
  if (!allowed.map(getAddress).includes(getAddress(who))) return [`signature.json: ${who} is neither the creator nor the owner (${allowed.join(', ')})`];
  return [];
}

/** Every check of one entry against the chain. chain: { code(a), tx(h), receipt(h), call(to, data) };
 *  compile(source) -> { deployedBytecode, immutableReferences }. Returns { ok, problems, match, signer }. */
export async function checkEntry(entry, chain, compile) {
  const { folder, info, logo, source, signature } = entry;
  const problems = [...checkInfo(info, folder), ...checkLogo(logo)];
  if (problems.length) return { ok: false, problems };
  const token = getAddress(info.address);
  const code = await chain.code(token);
  if (!code || code === '0x') return { ok: false, problems: [`${token} has no code on chain ${CHAIN_ID}`] };
  const [tx, rc] = await Promise.all([chain.tx(info.creationTx), chain.receipt(info.creationTx)]);
  if (!tx || !rc || !rc.contractAddress || getAddress(rc.contractAddress) !== token) problems.push(`creationTx ${info.creationTx} did not create ${token}`);
  const read = async (fn) => { try { return ERC20.decodeFunctionResult(fn, await chain.call(token, ERC20.encodeFunctionData(fn)))[0]; } catch { return null; } };
  const [name, symbol, decimals, owner] = await Promise.all(['name', 'symbol', 'decimals', 'owner'].map(read));
  if (name !== info.name) problems.push(`name(): the token says "${name}", info.json "${info.name}"`);
  if (symbol !== info.symbol) problems.push(`symbol(): the token says "${symbol}", info.json "${info.symbol}"`);
  if (decimals == null || Number(decimals) !== info.decimals) problems.push(`decimals(): the token says ${decimals}, info.json ${info.decimals}`);
  let match = null;
  if (!source || typeof source.contract !== 'string' || !source.input?.sources) problems.push('source.json: { compiler, contract: "path.sol:Name", input: <standard JSON> }');
  else {
    try {
      const c = await compile(source);
      match = bytecodeMatch(code, c.deployedBytecode, c.immutableReferences);
      if (!match) problems.push(`source.json: ${source.contract} compiled with ${source.compiler} is not the code at ${token}`);
      // the creation code too (the constructor sets supply, owner, names): the creationTx input starts with it
      else if (c.bytecode && tx?.data && !creationMatch(tx.data, c.bytecode, c.deployedBytecode))
        problems.push(`source.json: the creationTx input does not start with ${source.contract}'s creation code (another constructor)`);
    } catch (e) { problems.push(`source.json: does not compile (${String(e.message).slice(0, 200)})`); }
  }
  const allowed = [tx?.from, owner].filter((a) => ADDR.test(String(a)) && !/^0x0{40}$/i.test(a));
  problems.push(...checkSignature(info, logo, signature, allowed));
  return { ok: problems.length === 0, problems, match, signer: signature?.signer ?? null };
}

/** tokenlist.json (the Uniswap token list format) from the accepted entries [{ info, match }]. */
export function tokenList(entries, { version = { major: 1, minor: 0, patch: 0 }, timestamp, logoBase = 'https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/zetaphy-tokens/3659' } = {}) {
  return {
    name: 'ZETAPHY token registry', timestamp, version, keywords: ['zetaphy', 'verified'],
    logoURI: 'https://app.sawasdeecoin.com/zetaphy-256.png',
    tokens: entries.map(({ info }) => ({ chainId: CHAIN_ID, address: getAddress(info.address), name: info.name, symbol: info.symbol, decimals: info.decimals,
      logoURI: `${logoBase}/${getAddress(info.address)}/logo.svg` })).sort((x, y) => x.symbol.localeCompare(y.symbol) || x.address.localeCompare(y.address)),
  };
}
