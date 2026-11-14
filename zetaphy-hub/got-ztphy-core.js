// got-ztphy.html ("Did you get ZTPHY?"), pure parts: reading a typed address (0x… or zetaphy1…), the published push
// airdrop list (docs/AIRDROP.md section 7) and its files, and building those files from the owner's push list
// (tools/push-manifest.mjs). keccak (bytes -> 32 bytes) is passed in, as in airdrop-core.js, so the same code runs in
// the page (neuro/src/keccak.js) and in the tests. Nothing here signs or sends anything.
//
// The published list (zetaphy-hub/airdrop-push/, copied into dist/ by build.mjs when manifest.json is there):
//   manifest.json      { chainId: 3659, each: "10", count, sha256, shardPrefixLength, list?: "list.txt" }
//                      sha256 = sha256 of the push list file exactly as gov.sh sent it (sha256sum push.txt)
//   shards/<p>.json    { addresses: ["0x…" lower case] }: every address whose first <shardPrefixLength> hex
//                      characters (after 0x) are <p>
//   list.txt           the push list itself (optional), so anyone can check the sha256 and the count
import { toBech32, toEvm, bech32Decode } from './chainlib.js';
import { checksum } from './airdrop-link-core.js';

export const CHAIN_ID = 3659;
export const MANIFEST = 'airdrop-push/manifest.json';
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const LOWER = /^0x[0-9a-f]{40}$/;

/**
 * A typed address -> { evm (EIP-55), bech32 (zetaphy1…) }, or { error }: 'empty', 'bad' (neither form),
 * 'checksum' (a mixed-case 0x address whose EIP-55 checksum is wrong: most likely a typo).
 */
export function readAddress(raw, keccak) {
  const s = String(raw ?? '').trim();
  if (!s) return { error: 'empty' };
  let evm;
  if (ADDR.test(s)) {
    const body = s.slice(2);
    evm = checksum(s, keccak);
    if (body !== body.toLowerCase() && body !== body.toUpperCase() && evm !== s) return { error: 'checksum' };
  } else if (/^zetaphy1[02-9ac-hj-np-z]{38}$/i.test(s)) {
    try {
      if (bech32Decode(s).hrp !== 'zetaphy') return { error: 'bad' };
      evm = checksum(toEvm(s), keccak);
    } catch { return { error: 'bad' }; }
  } else return { error: 'bad' };
  return { evm, bech32: toBech32(evm) };
}

/** eth_getBalance's answer (hex wei) -> bigint, or null when it is not a quantity. */
export function balanceOf(hex) {
  return typeof hex === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(hex) ? BigInt(hex) : null;
}

/** manifest.json -> its clean form, or null (anything malformed, or another chain: the page then shows the balance only). */
export function cleanManifest(j) {
  if (!j || typeof j !== 'object' || j.chainId !== CHAIN_ID) return null;
  const n = j.shardPrefixLength;
  if (!Number.isSafeInteger(j.count) || j.count < 1 || !/^[0-9a-f]{64}$/.test(String(j.sha256))
    || !Number.isInteger(n) || n < 1 || n > 4 || !/^\d{1,9}$/.test(String(j.each))) return null;
  const list = typeof j.list === 'string' && /^[\w-]{1,40}\.txt$/.test(j.list) ? j.list : null;
  return { chainId: CHAIN_ID, each: String(j.each), count: j.count, sha256: j.sha256, shardPrefixLength: n, list };
}

/** The shard file (relative to airdrop-push/) that holds `evm` if it is on the list. */
export function shardFile(evm, m) {
  if (!ADDR.test(String(evm)) || !m) throw new Error('bad-list');
  return `shards/${evm.toLowerCase().slice(2, 2 + m.shardPrefixLength)}.json`;
}

/** Is `evm` in this shard? Throws on a malformed shard (the page then says the list could not be read). */
export function inShard(shard, evm) {
  const a = shard?.addresses;
  if (!Array.isArray(a) || !a.every((x) => typeof x === 'string' && LOWER.test(x))) throw new Error('bad-list');
  return a.includes(String(evm).toLowerCase());
}

/**
 * The owner's push list (one 0x address per line, as push-list wrote it and gov.sh sent it) -> the files to publish.
 * Every line must be an address (blank lines are skipped, as by gov.sh); a duplicate is refused. `sha256`: of the
 * file's bytes (the caller hashes it). Returns { manifest, shards: { prefix: [lower-case addresses, sorted] } }.
 */
export function buildPushFiles(text, { sha256, each = '10', prefix = 2, list = 'list.txt' } = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(sha256))) throw new Error('sha256: 64 lower-case hex characters');
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 4) throw new Error('prefix: 1 to 4');
  if (!/^\d{1,9}$/.test(String(each))) throw new Error('each: whole ZTPHY');
  const seen = new Set();
  String(text).split('\n').forEach((line, i) => {
    const s = line.replace(/\r$/, '').trim();
    if (!s) return;
    if (!ADDR.test(s)) throw new Error(`line ${i + 1}: not a 0x address`);
    const a = s.toLowerCase();
    if (seen.has(a)) throw new Error(`line ${i + 1}: duplicate ${a}`);
    seen.add(a);
  });
  if (!seen.size) throw new Error('the list is empty');
  const shards = {};
  for (const a of [...seen].sort()) (shards[a.slice(2, 2 + prefix)] ??= []).push(a);
  const manifest = { chainId: CHAIN_ID, each: String(each), count: seen.size, sha256, shardPrefixLength: prefix, ...(list ? { list } : {}) };
  return { manifest, shards };
}
