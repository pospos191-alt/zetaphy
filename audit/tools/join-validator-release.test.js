// How zetaphy-chain/join-validator.sh gets what it runs as root (internal review 2026-11-10, Z-04): setup-node.sh, the
// prebuilt zetaphyd and the script itself come only from a signed release that verify-release.sh accepted, and the
// verifier tools are pinned by SHA-256. Run against a fake "internet" (a curl stand-in serving files from a folder)
// with a gh stand-in that accepts only files the test signed; the real Sigstore check is verify-release.test.js's
// subject (and the VM's, docs/ANTI-ROLLBACK-OFFCHAIN.md).
//   node --test audit/tools/join-validator-release.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHAIN = fileURLToPath(new URL('../../zetaphy-chain/', import.meta.url));
const JV = join(CHAIN, 'join-validator.sh');
const VR = join(CHAIN, 'verify-release.sh');
const RELEASE_YML = fileURLToPath(new URL('../../.github/workflows/release-zetaphyd.yml', import.meta.url));
const REPO = 'pospos191-alt/zetaphy';
const WF = `${REPO}/.github/workflows/release-zetaphyd.yml`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const COMMIT = 'c0ffee'.padEnd(40, '0');
const REF = 'main';

function world() {
  const root = mkdtempSync(join(process.env.NO_DOWNGRADE_TMP ?? tmpdir(), 'jvrel-'));
  const stubs = join(root, 'stubs'); mkdirSync(stubs);
  const net = join(root, 'net'); mkdirSync(net);
  const exe = (name, body) => { writeFileSync(join(stubs, name), `#!/usr/bin/env bash\n${body}\n`); chmodSync(join(stubs, name), 0o755); };
  // curl: -o <file> <url>; serves $net/<host>/<path>, else fails like an HTTP 404 (exit 22)
  exe('curl', `out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; http*) url="$1"; shift;; *) shift;; esac; done
echo "$url" >> "${root}/curl.log"
p="${net}/\${url#https://}"
[ -f "$p" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
if [ -n "$out" ]; then cp "$p" "$out"; else cat "$p"; fi`);
  // gh attestation verify: the identity flags must be the release workflow's on main, the file must be "signed"
  exe('gh', `echo "$*" >> "${root}/gh.log"
[ "$1 $2" = "attestation verify" ] || exit 9
f="$3"
case "$*" in *"--repo ${REPO} --signer-workflow ${WF} --source-ref refs/heads/main"*"--deny-self-hosted-runners"*) ;; *) echo "stub-gh: identity" >&2; exit 1;; esac
grep -q "$(sha256sum "$f" | cut -d' ' -f1)" "${root}/signed" || { echo "stub-gh: no attestation for \${f##*/}" >&2; exit 1; }`);
  writeFileSync(join(root, 'signed'), '');
  // the script under test runs from a folder without verify-release.sh next to it (as from install.sh / a pipe)
  const bin = join(root, 'jv'); mkdirSync(bin);
  copyFileSync(JV, join(bin, 'join-validator.sh'));
  const lib = join(root, 'lib');
  const put = (path, data) => { const p = join(net, path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); return p; };
  put(`raw.githubusercontent.com/${REPO}/${REF}/zetaphy-chain/verify-release.sh`, readFileSync(VR));
  return { root, stubs, net, lib, bin, put };
}

/** A release on the fake GitHub: setup-node.sh at $REF (and at the commit), and the release files. */
function release(w, { setup = 'setup-node.sh v1', seq = 271, commit = COMMIT, sign = true, manifest = {}, legacy = false, binBytes, scripts } = {}) {
  const s = sha(setup);
  const tag = `zetaphyd-${s.slice(0, 12)}`;
  w.put(`raw.githubusercontent.com/${REPO}/${REF}/zetaphy-chain/setup-node.sh`, setup);
  w.put(`raw.githubusercontent.com/${REPO}/${commit}/zetaphy-chain/setup-node.sh`, setup);
  binBytes ??= `ELF fake zetaphyd zetaphy-v5 (${tag})`;
  const m = { schema: 'zetaphy-release/v1', tag, repository: REPO, setup_node_sha256: s, commit, ref: 'refs/heads/main',
    main_commits: seq, commit_time: 1_790_000_000 + seq, upgrades: ['zetaphy-v5'], workflow_run: '1', ...(scripts ? { scripts } : {}), ...manifest };
  const dl = `github.com/${REPO}/releases/download/${tag}`;
  w.put(`${dl}/zetaphyd-linux-amd64`, binBytes);
  const sums = `${sha(binBytes)}  zetaphyd-linux-amd64\n` + (legacy ? '' : `${sha(JSON.stringify(m))}  RELEASE.json\n`);
  w.put(`${dl}/SHA256SUMS`, sums);
  if (!legacy) {
    w.put(`${dl}/RELEASE.json`, JSON.stringify(m));
    w.put(`${dl}/zetaphyd-provenance.sigstore.json`, '{"fake":"bundle"}');
  }
  if (sign) writeFileSync(join(w.root, 'signed'), readFileSync(join(w.root, 'signed'), 'utf8') + [sha(binBytes), sha(sums), sha(JSON.stringify(m))].join('\n') + '\n');
  return { tag, dl, m, binBytes };
}

function run(w, cmd = 'download', env = {}, { stdin, script = join(w.bin, 'join-validator.sh') } = {}) {
  const args = stdin ? ['-s', '--', cmd] : [script, cmd];
  const r = spawnSync('bash', args, { encoding: 'utf8', input: stdin,
    env: { PATH: `${w.stubs}:${process.env.PATH}`, HOME: w.root, LIB: w.lib, STATE: join(w.root, 'state'), ARCH: 'amd64',
      RECORD_FILE: join(w.root, 'record.json'), ZETAPHYD: join(w.root, 'installed-zetaphyd'), SELF_BIN: join(w.root, 'zetaphy-validator'),
      VERIFIER: 'gh', NODE_USER: 'no-such-user-zetaphy-test', ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const has = (w, f) => existsSync(join(w.lib, f));

test('a signed release is verified before anything is kept: signature (gh, release workflow on main), hashes, setup-node.sh', () => {
  const w = world();
  const { tag, binBytes } = release(w);
  const r = run(w);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`release ${tag}, zetaphyd-linux-amd64: Sigstore signature and SHA-256 ok`));
  assert.match(r.out, /VERIFIED zetaphyd-linux-amd64/);
  assert.equal(readFileSync(join(w.lib, 'zetaphyd-linux-amd64'), 'utf8'), binBytes);
  assert.equal(readFileSync(join(w.lib, 'setup-node.sh'), 'utf8'), 'setup-node.sh v1');
  assert.ok(has(w, 'RELEASE.json') && has(w, 'SHA256SUMS') && has(w, 'zetaphyd-provenance.sigstore.json'));
  assert.ok(!has(w, 'incoming'), 'the staging folder is gone');
  assert.equal(sha(readFileSync(join(w.lib, 'verify-release.sh'))), sha(readFileSync(VR)), 'the pinned verifier');
  const gh = readFileSync(join(w.root, 'gh.log'), 'utf8').trim().split('\n');
  assert.equal(gh.length, 3, 'binary, SHA256SUMS and RELEASE.json');
  for (const l of gh) assert.match(l, new RegExp(`--source-digest ${COMMIT} --bundle `));
  rmSync(w.root, { recursive: true });
});

test('refused, nothing kept: tampered binary, unsigned files, a release of a fork, an older release than the installed one', () => {
  const w = world();
  const cases = [
    [() => { const { dl } = release(w, { setup: 'a' }); w.put(`${dl}/zetaphyd-linux-amd64`, 'evil'); }, {}, /sha256 .* SHA256SUMS says/],
    [() => release(w, { setup: 'b', sign: false }), {}, /no valid attestation[\s\S]*did not verify/],
    [() => release(w, { setup: 'c', manifest: { repository: 'mallory/zetaphy' } }), {}, /built from mallory\/zetaphy/],
    [() => { writeFileSync(join(w.root, 'record.json'), JSON.stringify({ main_commits: 300, commit: 'f'.repeat(40), upgrades: [] })); release(w, { setup: 'd', seq: 280 }); }, {}, /#280 on main is older than the installed #300/],
  ];
  for (const [mk, env, re] of cases) {
    rmSync(w.lib, { recursive: true, force: true });
    mk();
    const r = run(w, 'download', env);
    assert.equal(r.code, 1, `${re}\n${r.out}`);
    assert.match(r.out, re);
    assert.match(r.out, /refused, nothing was installed/);
    for (const f of ['zetaphyd-linux-amd64', 'setup-node.sh', 'RELEASE.json']) assert.ok(!has(w, f), `${f} not kept (${re})`);
    rmSync(join(w.root, 'record.json'), { force: true });
  }
  rmSync(w.root, { recursive: true });
});

test('a refused release is checked again on every try but its binary is downloaded once (the timer retries every minute)', () => {
  const w = world();
  const { dl } = release(w, { sign: false });
  const bins = () => readFileSync(join(w.root, 'curl.log'), 'utf8').split('\n').filter((l) => l.endsWith(`${dl}/zetaphyd-linux-amd64`)).length;
  assert.equal(run(w).code, 1);
  assert.equal(run(w).code, 1);
  assert.equal(bins(), 1);
  assert.equal(readFileSync(join(w.root, 'gh.log'), 'utf8').trim().split('\n').length, 2, 'verified (and refused) both times');
  // the cached copy must still match SHA256SUMS: a changed cache file is not used
  const cache = join(w.lib, 'cache'); const [f] = spawnSync('ls', [cache], { encoding: 'utf8' }).stdout.trim().split('\n');
  writeFileSync(join(cache, f), 'evil');
  assert.equal(run(w).code, 1);
  assert.equal(bins(), 2);
  rmSync(w.root, { recursive: true });
});

test('no signed release (an old unsigned one, or none): refused; ALLOW_UNVERIFIED_INSTALL=1 is a logged exception', () => {
  const w = world();
  release(w, { legacy: true });
  let r = run(w);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no signed release zetaphyd-[0-9a-f]{12} .*RELEASE\.json missing.*refused, nothing was installed/s);
  assert.ok(!has(w, 'setup-node.sh') && !has(w, 'zetaphyd-linux-amd64'));
  r = run(w, 'download', { ALLOW_UNVERIFIED_INSTALL: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARNING: UNVERIFIED install on purpose/);
  assert.match(r.out, /SHA-256 only, NOT signature-checked/);
  assert.match(readFileSync(join(w.root, 'state', 'unverified-installs.log'), 'utf8'), /UNVERIFIED install on purpose .*no signed release/);
  // no release at all for this setup-node.sh
  w.put(`raw.githubusercontent.com/${REPO}/${REF}/zetaphy-chain/setup-node.sh`, 'setup-node.sh with no release');
  rmSync(w.lib, { recursive: true });
  r = run(w);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no signed release .*refused/s);
  r = run(w, 'download', { ALLOW_UNVERIFIED_INSTALL: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /building from source, unchecked/);
  rmSync(w.root, { recursive: true });
});

test('the verifier tools are pinned: another verify-release.sh at the ref, or another cosign, is refused', () => {
  const w = world();
  release(w);
  w.put(`raw.githubusercontent.com/${REPO}/${REF}/zetaphy-chain/verify-release.sh`, '#!/bin/bash\necho VERIFIED\n');
  let r = run(w);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /verify-release\.sh at pospos191-alt\/zetaphy@main is not the one this script pins/);
  assert.ok(!has(w, 'verify-release.sh') && !has(w, 'zetaphyd-linux-amd64'));
  // run from a checkout: the verify-release.sh next to the script is used when it is the pinned one
  r = run(w, 'download', {}, { script: JV });
  assert.equal(r.code, 0, r.out);
  // cosign (the default verifier) must be the pinned build
  rmSync(w.lib, { recursive: true });
  w.put(`raw.githubusercontent.com/${REPO}/${REF}/zetaphy-chain/verify-release.sh`, readFileSync(VR));
  w.put('github.com/sigstore/cosign/releases/download/v3.1.4/cosign-linux-amd64', '#!/bin/bash\nexit 0\n');
  r = run(w, 'download', { VERIFIER: '' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /cosign v3\.1\.4 does not match its pinned SHA-256: refused/);
  assert.ok(!existsSync(join(w.lib, 'bin', 'cosign')) && !has(w, 'zetaphyd-linux-amd64'));
  rmSync(w.root, { recursive: true });
});

test('RELEASE_TAG pins a release; its setup-node.sh comes from the commit the signed RELEASE.json names', () => {
  const w = world();
  const old = release(w, { setup: 'setup-node.sh old', commit: 'a'.repeat(40) });
  release(w, { setup: 'setup-node.sh new' }); // $REF now has the newer one
  const r = run(w, 'download', { RELEASE_TAG: old.tag });
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(join(w.lib, 'setup-node.sh'), 'utf8'), 'setup-node.sh old');
  assert.match(readFileSync(join(w.root, 'curl.log'), 'utf8'), new RegExp(`/${'a'.repeat(40)}/zetaphy-chain/setup-node.sh`));
  assert.equal(run(w, 'download', { RELEASE_TAG: 'v1; rm -rf /' }).code, 1);
  rmSync(w.root, { recursive: true });
});

test('through a pipe, zetaphy-validator is the copy whose SHA-256 the signed release names, never an unchecked download', () => {
  const w = world();
  const body = '#!/bin/bash\necho "zetaphy-validator at the release commit"\n';
  release(w, { scripts: { 'join-validator.sh': sha(body), 'verify-release.sh': sha(readFileSync(VR)) } });
  assert.equal(run(w).code, 0);
  const stdin = readFileSync(JV, 'utf8');
  const self = join(w.root, 'zetaphy-validator');
  w.put(`raw.githubusercontent.com/${REPO}/${COMMIT}/zetaphy-chain/join-validator.sh`, 'tampered');
  let r = run(w, 'self-install', {}, { stdin });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /does not match the SHA-256 the signed release names/);
  assert.ok(!existsSync(self));
  w.put(`raw.githubusercontent.com/${REPO}/${COMMIT}/zetaphy-chain/join-validator.sh`, body);
  r = run(w, 'self-install', {}, { stdin });
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(self, 'utf8'), body);
  // a release without the field: nothing from the network, a clear message
  rmSync(self);
  const m = JSON.parse(readFileSync(join(w.lib, 'RELEASE.json'), 'utf8')); delete m.scripts;
  writeFileSync(join(w.lib, 'RELEASE.json'), JSON.stringify(m));
  r = run(w, 'self-install', {}, { stdin });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /the release names no signed copy of it/);
  assert.ok(!existsSync(self));
  // from a file, the file itself
  r = run(w, 'self-install');
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(self, 'utf8'), readFileSync(JV, 'utf8'));
  rmSync(w.root, { recursive: true });
});

test('the upgrade timer never takes the unverified exception, whatever its environment says', () => {
  const w = world();
  const s = w.stubs;
  writeFileSync(join(s, 'journalctl'), '#!/bin/bash\necho \'ERR UPGRADE "zetaphy-v9" NEEDED at height: 100: module=x/upgrade\'\n'); chmodSync(join(s, 'journalctl'), 0o755);
  writeFileSync(join(s, 'zetaphyd'), '#!/bin/bash\necho \'{"sync_info":{"latest_block_height":"99"}}\'\n'); chmodSync(join(s, 'zetaphyd'), 0o755);
  writeFileSync(join(s, 'fake-update'), `#!/bin/bash\necho "allow=\${ALLOW_UNVERIFIED_INSTALL-unset}" >> ${w.root}/update.log\n`); chmodSync(join(s, 'fake-update'), 0o755);
  const r = run(w, 'upgrade-watch', { ALLOW_UNVERIFIED_INSTALL: '1', JOURNALCTL: join(s, 'journalctl'), ZETAPHYD: join(s, 'zetaphyd'),
    UPGRADE_CMD: join(s, 'fake-update'), NODE_HOME: w.root, KEYS_DIR: w.root });
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(join(w.root, 'update.log'), 'utf8').trim(), 'allow=unset');
  rmSync(w.root, { recursive: true });
});

test('pins in step: join-validator.sh pins this verify-release.sh; the release workflow writes the script hashes it reads', () => {
  const jv = readFileSync(JV, 'utf8');
  const pin = jv.match(/^VERIFY_RELEASE_SHA256="([0-9a-f]{64})"$/m);
  assert.ok(pin, 'VERIFY_RELEASE_SHA256 in join-validator.sh');
  assert.equal(pin[1], sha(readFileSync(VR)), 'after changing verify-release.sh, set VERIFY_RELEASE_SHA256 in join-validator.sh to its sha256sum');
  assert.match(jv, /^COSIGN_VERSION="v\d+\.\d+\.\d+"$/m);
  assert.match(jv, /^COSIGN_SHA256_amd64="[0-9a-f]{64}"$/m);
  assert.match(jv, /^COSIGN_SHA256_arm64="[0-9a-f]{64}"$/m);
  const yml = readFileSync(RELEASE_YML, 'utf8');
  assert.match(yml, /scripts: \{"join-validator\.sh": \$jv, "verify-release\.sh": \$vr\}/);
  assert.match(yml, /sha256sum zetaphy-chain\/join-validator\.sh/);
  assert.match(jv, /\.scripts\["join-validator\.sh"\]/);
  assert.doesNotMatch(jv, /curl[^\n]*join-validator\.sh" -o "\$SELF_BIN"/, 'no unchecked self download');
});
