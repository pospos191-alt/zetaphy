// airdrop-link.html, pure parts (airdrop-link-core.js) against the owner's tooling (zetaphy-network/airdrop/link.js,
// @noble/curves ed25519 with zip215: false, ethers' EIP-55 and base58): the same message, the same accepted and
// refused signatures (tampered, other signer, other chain, non-canonical encodings, S >= L, small-order keys), the
// issue URL's fields are the issue form's ids, and the page's words exist in all 8 languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign as nodeSign, randomBytes } from 'node:crypto';
import { getAddress, hexlify, encodeBase58 as ethersB58 } from 'ethers';
import { ed25519 } from '../../zetaphy-network/node_modules/@noble/curves/ed25519.js';
import { keccak256 } from '../../zetaphy-neuro/src/keccak.js';
import * as core from '../airdrop-link-core.js';
import { verifyLink as toolVerify, linkMessage as toolMessage, sigBytes as toolSig } from '../../zetaphy-network/airdrop/link.js';
import { parseIssue, FIELDS } from '../../zetaphy-network/airdrop/issues.js';
import { LINK } from '../airdrop-link-i18n.js';
import { LANG_CODES } from '../i18n.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(HERE, '..');
const enc = (s) => new TextEncoder().encode(s);
const evm = () => getAddress(hexlify(randomBytes(20)));
function wallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { owner: ethersB58(pub), pub, sign: (m) => new Uint8Array(nodeSign(null, Buffer.from(m), privateKey)) };
}
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const le = (b) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };
const leBytes = (n, len = 32) => Uint8Array.from({ length: len }, (_, i) => Number((n >> BigInt(8 * i)) & 0xffn));

test('base58, EIP-55 and the message are the tooling\'s', () => {
  for (let i = 0; i < 40; i++) {
    const b = randomBytes(32);
    if (i % 4 === 0) b[0] = 0; // leading zero bytes -> leading '1'
    if (i % 8 === 0) b[1] = 0;
    assert.equal(core.encodeBase58(b), ethersB58(b));
    assert.deepEqual(Buffer.from(core.solanaKey(ethersB58(b))), b);
    const a = evm();
    assert.equal(core.checksum(a.toLowerCase(), keccak256), a);
    const w = ethersB58(b);
    assert.equal(core.linkMessage(w, a.toLowerCase(), keccak256), toolMessage(w, a, 3659));
  }
  const w = wallet(), a = evm();
  assert.equal(core.linkMessage(w.owner, a, keccak256), `ZETAPHY airdrop: link ${w.owner} to ${a} on 3659`);
  assert.equal(core.CHAIN_ID, 3659);
  const j = [...a].findIndex((c, i) => i > 1 && /[a-fA-F]/.test(c));
  const flipped = a.slice(0, j) + (a[j] === a[j].toUpperCase() ? a[j].toLowerCase() : a[j].toUpperCase()) + a.slice(j + 1);
  assert.equal(core.evmProblem(flipped, keccak256), 'bad-checksum');
  assert.equal(core.evmProblem(a.toUpperCase().replace('0X', '0x'), keccak256), null);
  assert.equal(core.evmProblem('0x0000000000000000000000000000000000000000', keccak256), 'zero-address');
  assert.equal(core.evmProblem('0x0000000000000000000000000000000000000800', keccak256), 'precompile-or-reserved');
  assert.equal(core.evmProblem('0x000000000000000000000000000000000000dEaD', keccak256), 'known-non-user');
  assert.equal(core.evmProblem('0x12', keccak256), 'bad-address');
  assert.throws(() => core.linkMessage('0OIl', a, keccak256), /bad-solana-address/);
  assert.throws(() => core.linkMessage(w.owner, flipped, keccak256), /bad-checksum/);
});

test('signature formats: base58, 0x-hex and base64 decode as link.js does', () => {
  for (let i = 0; i < 20; i++) {
    const s = randomBytes(64);
    if (i % 3 === 0) s[0] = 0;
    for (const f of [ethersB58(s), `0x${s.toString('hex')}`, s.toString('base64')]) {
      assert.deepEqual(Buffer.from(core.sigBytes(f)), s, f);
      assert.deepEqual(Buffer.from(core.sigBytes(f)), toolSig(f), f);
    }
  }
  for (const f of ['', 'xyz', `0x${'ab'.repeat(63)}`, 'A'.repeat(87) + '=', null]) assert.equal(core.sigBytes(f), null);
  assert.deepEqual(core.signatureOf({ signature: new Uint8Array(64).fill(7) }), new Uint8Array(64).fill(7));
  assert.deepEqual(core.signatureOf(new Uint8Array(64).fill(1)), new Uint8Array(64).fill(1));
  assert.equal(core.signatureOf({ signature: new Uint8Array(63) }), null);
  assert.equal(core.signatureOf(undefined), null);
});

test('verifyLink: the same verdict as zetaphy-network/airdrop/link.js, case by case', async () => {
  const w = wallet(), other = wallet(), a = evm(), b = evm();
  const sigOf = (signer, owner, to, chain = 3659) => ethersB58(signer.sign(enc(`ZETAPHY airdrop: link ${owner} to ${to} on ${chain}`)));
  const good = sigOf(w, w.owner, a);
  const tampered = core.sigBytes(good); tampered[40] ^= 1;
  const highS = core.sigBytes(good); highS.set(leBytes(le(highS.subarray(32)) + L), 32); // S + L: the same point, not canonical
  const cases = [
    [{ solana: w.owner, evm: a, signature: good }, true],
    [{ solana: w.owner, evm: a.toLowerCase(), signature: good }, true],
    [{ solana: w.owner, evm: a, signature: `0x${Buffer.from(core.sigBytes(good)).toString('hex')}` }, true],
    [{ solana: w.owner, evm: a, signature: Buffer.from(core.sigBytes(good)).toString('base64') }, true],
    [{ solana: w.owner, evm: b, signature: good }, false, 'bad-signature'],
    [{ solana: other.owner, evm: a, signature: good }, false, 'bad-signature'],
    [{ solana: w.owner, evm: a, signature: sigOf(other, w.owner, a) }, false, 'bad-signature'],
    [{ solana: w.owner, evm: a, signature: sigOf(w, w.owner, a, 77390) }, false, 'bad-signature'],
    [{ solana: w.owner, evm: a, signature: ethersB58(tampered) }, false, 'bad-signature'],
    [{ solana: w.owner, evm: a, signature: `0x${Buffer.from(highS).toString('hex')}` }, false, 'bad-signature'],
    [{ solana: w.owner, evm: a, signature: 'nope' }, false, 'bad-signature-format'],
    [{ solana: 'x', evm: a, signature: good }, false, 'bad-solana-address'],
    [{ solana: w.owner, evm: '0x0000000000000000000000000000000000000000', signature: good }, false, 'bad-evm-address:zero-address'],
  ];
  for (const [rec, ok, reason] of cases) {
    const mine = await core.verifyLink(rec, keccak256);
    const tool = toolVerify(rec, 3659);
    assert.equal(mine.ok, ok, JSON.stringify(rec));
    assert.equal(tool.ok, ok, `tool: ${JSON.stringify(rec)}`);
    if (!ok) assert.equal(mine.reason, reason);
    else { assert.equal(mine.evm, a); assert.equal(mine.message, toolMessage(w.owner, a, 3659)); }
  }
});

test('strict ed25519: random keys and messages, and malformed points, agree with @noble/curves (zip215: false)', async () => {
  for (let i = 0; i < 25; i++) {
    const sk = ed25519.utils.randomSecretKey();
    const pk = ed25519.getPublicKey(sk);
    const m = randomBytes(1 + (i * 7) % 90);
    const s = ed25519.sign(m, sk);
    assert.equal(await core.ed25519Verify(s, m, pk), true);
    const s2 = s.slice(); s2[i % 64] ^= 1 << (i % 8);
    assert.equal(await core.ed25519Verify(s2, m, pk), ed25519.verify(s2, m, pk, { zip215: false }));
  }
  const P = 2n ** 255n - 19n;
  const sk = ed25519.utils.randomSecretKey(), pk = ed25519.getPublicKey(sk), m = enc('x');
  const s = ed25519.sign(m, sk);
  const smallOrder = [leBytes(1n), leBytes(0n), leBytes(P - 1n), leBytes(1n | (1n << 255n))]; // identity, order-4 / order-2 points, x=0 with sign bit
  const nonCanonical = [leBytes(P + 1n), leBytes(2n ** 255n - 1n)]; // y >= p
  for (const pub of [...smallOrder, ...nonCanonical, leBytes(2n)]) {
    assert.equal(await core.ed25519Verify(s, m, pub), ed25519.verify(s, m, pub, { zip215: false }), Buffer.from(pub).toString('hex'));
    const r = s.slice(); r.set(pub, 0); // the same encodings as R
    assert.equal(await core.ed25519Verify(r, m, pk), ed25519.verify(r, m, pk, { zip215: false }));
  }
  // a small-order public key with S = 0 and R = identity satisfies the cofactored equation: both refuse (A small order)
  const id = leBytes(1n);
  const forged = new Uint8Array(64); forged.set(id, 0);
  assert.equal(await core.ed25519Verify(forged, m, id), false);
  assert.equal(ed25519.verify(forged, m, id, { zip215: false }), false);
});

test('the issue URL fills the form\'s fields; the collector reads them back', () => {
  const yml = readFileSync(join(ROOT, '.github', 'ISSUE_TEMPLATE', 'airdrop-link.yml'), 'utf8');
  const ids = [...yml.matchAll(/^\s+id:\s*(\S+)/gm)].map((m) => m[1]);
  for (const id of ['solana', 'evm', 'chain', 'signature', 'safety']) assert.ok(ids.includes(id), id);
  assert.match(yml, new RegExp(`^title: "${core.ISSUE_TITLE}"`, 'm'));
  const w = wallet(), a = evm();
  const sig = ethersB58(w.sign(enc(core.linkMessage(w.owner, a, keccak256))));
  const u = new URL(core.issueUrl({ solana: w.owner, evm: a, signature: sig }));
  assert.equal(u.origin + u.pathname, 'https://github.com/pospos191-alt/zetaphy/issues/new');
  assert.equal(u.searchParams.get('template'), 'airdrop-link.yml');
  assert.equal(u.searchParams.get('solana'), w.owner);
  assert.equal(u.searchParams.get('evm'), a);
  assert.equal(u.searchParams.get('signature'), sig);
  // the labels the collector looks for are the form's labels
  for (const f of Object.values(FIELDS)) assert.ok(yml.includes(`label: ${f[0]}`), f[0]);
  const body = `### ${FIELDS.solana[0]}\n\n${w.owner}\n\n### ${FIELDS.evm[0]}\n\n${a}\n\n### ${FIELDS.chain[0]}\n\n3659\n\n### ${FIELDS.signature[0]}\n\n${sig}\n\n### ${FIELDS.safety[0]}\n\n- [X] x`;
  assert.deepEqual(parseIssue(body), { solana: w.owner, evm: a, chainId: '3659', signature: sig, confirmed: true });
});

test('the page\'s words: every key in all 8 languages; the dates are round 1\'s', () => {
  assert.deepEqual(Object.keys(LINK).sort(), [...LANG_CODES].sort());
  const keys = Object.keys(LINK.en);
  for (const l of LANG_CODES) for (const k of keys) assert.ok(typeof LINK[l][k] === 'string' && LINK[l][k].trim(), `${l}.${k}`);
  for (const l of LANG_CODES) for (const k of keys) {
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join();
    assert.equal(ph(LINK[l][k]), ph(LINK.en[k]), `${l}.${k} placeholders`);
  }
  assert.equal(core.SNAPSHOT, '2026-11-20T14:00:00Z');
  assert.equal(core.DEADLINE, '2026-12-04T14:00:00Z');
  const src = readFileSync(join(HERE, 'airdrop-link.js'), 'utf8') + readFileSync(join(HERE, 'airdrop-link-core.js'), 'utf8');
  assert.doesNotMatch(src, /signTransaction|signAndSendTransaction|sendTransaction|eth_sendTransaction|eth_sign\b|personal_sign/);
  const html = readFileSync(join(HERE, 'airdrop-link.html'), 'utf8');
  assert.doesNotMatch(html, /<script>|<style|\sstyle="|\son[a-z]+="/i);
  assert.doesNotMatch(html, /type="password"|seed|mnemonic/i);
});
