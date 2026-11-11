// Tests of zetaphy-chain/verify-release.sh (L1-3) against fake release directories. The Sigstore check itself is
// done by `gh attestation verify` / `cosign verify-blob-attestation`; here they are stubs that record their
// arguments and "verify" only what the test says was signed by the right workflow, so the test checks that the
// script asks for exactly the right identity (repo, workflow file, refs/heads/main, the commit of RELEASE.json,
// GitHub-hosted runners) and refuses when any piece is off. A real signature can only be checked in CI / on the VM
// after a signed release exists (docs/ANTI-ROLLBACK-OFFCHAIN.md).
//   node --test audit/tools/verify-release.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../zetaphy-chain/verify-release.sh', import.meta.url));
const REPO = 'pospos191-alt/zetaphy';
const WF = `${REPO}/.github/workflows/release-zetaphyd.yml`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const COMMIT = 'c0ffee'.padEnd(40, '0');

function world() {
  const root = mkdtempSync(join(process.env.NO_DOWNGRADE_TMP ?? tmpdir(), 'vrel-'));
  const bin = join(root, 'bin'); mkdirSync(bin);
  // only the tools the script needs (a runner's real gh / cosign in /usr/bin must not be found)
  const tools = join(root, 'tools'); mkdirSync(tools);
  for (const t of ['bash', 'sh', 'env', 'sha256sum', 'jq', 'awk', 'sed', 'grep', 'sort', 'cut', 'date', 'mkdir', 'mv', 'comm', 'tail', 'dirname', 'uname', 'cat', 'head']) {
    const p = spawnSync('bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
    if (p) symlinkSync(p, join(tools, t));
  }
  // gh stub: logs its arguments; verifies when the file's sha256 is in $root/signed and the identity flags are right
  const gh = `#!/usr/bin/env bash
echo "$*" >> "${root}/gh.log"
[ "$1 $2" = "attestation verify" ] || exit 9
f="$3"; shift 3
want_repo=0; want_wf=0; want_ref=0; want_hosted=0; digest=""
while [ $# -gt 0 ]; do case "$1" in
  --repo) [ "$2" = "${REPO}" ] && want_repo=1; shift 2;;
  --signer-workflow) [ "$2" = "\${SIGNER_WORKFLOW:-${WF}}" ] && want_wf=1; shift 2;;
  --source-ref) [ "$2" = "\${SIGNED_REF:-refs/heads/main}" ] && want_ref=1; shift 2;;
  --source-digest) digest="$2"; shift 2;;
  --deny-self-hosted-runners) want_hosted=1; shift;;
  *) shift;; esac; done
[ "$want_repo$want_wf$want_ref$want_hosted" = 1111 ] || exit 1
[ -z "$digest" ] || [ "$digest" = "\${SIGNED_COMMIT:-${COMMIT}}" ] || exit 1
grep -q "$(sha256sum "$f" | cut -d' ' -f1)" "${root}/signed" || exit 1
`;
  writeFileSync(join(bin, 'gh'), gh); chmodSync(join(bin, 'gh'), 0o755);
  const cosign = `#!/usr/bin/env bash
echo "$*" >> "${root}/cosign.log"
f="\${!#}"
case "$*" in *"--certificate-identity https://github.com/${WF}@refs/heads/main"*"--certificate-github-workflow-sha ${COMMIT}"*) ;; *) exit 1;; esac
grep -q "$(sha256sum "$f" | cut -d' ' -f1)" "${root}/signed" || exit 1
`;
  writeFileSync(join(bin, 'cosign'), cosign); chmodSync(join(bin, 'cosign'), 0o755);
  writeFileSync(join(root, 'signed'), '');
  return { root, bin, tools };
}

/** A release directory: binary, RELEASE.json, SHA256SUMS, bundle; `sign` lists which files the stub accepts. */
function release(w, { name = 'rel', seq = 271, commit = COMMIT, upgrades = ['zetaphy-firewall', 'zetaphy-v2', 'zetaphy-v3', 'zetaphy-v4', 'zetaphy-v5'],
  binBytes, setup = 'setup-node.sh v1', sign = ['bin', 'sums', 'manifest'], manifest = {}, sums } = {}) {
  const d = join(w.root, name); mkdirSync(d);
  binBytes ??= `ELF fake zetaphyd zetaphy-v5 (${name})`;
  writeFileSync(join(d, 'zetaphyd-linux-amd64'), binBytes);
  const s = sha(setup);
  const m = { schema: 'zetaphy-release/v1', tag: `zetaphyd-${s.slice(0, 12)}`, repository: REPO, setup_node_sha256: s, commit, ref: 'refs/heads/main',
    main_commits: seq, commit_time: 1_790_000_000 + seq, upgrades, workflow_run: '1', ...manifest };
  writeFileSync(join(d, 'RELEASE.json'), JSON.stringify(m));
  writeFileSync(join(d, 'SHA256SUMS'), sums ?? `${sha(binBytes)}  zetaphyd-linux-amd64\n${sha(JSON.stringify(m))}  RELEASE.json\n`);
  writeFileSync(join(d, 'zetaphyd-provenance.sigstore.json'), '{"fake":"bundle"}');
  writeFileSync(join(w.root, `${name}.setup.sh`), setup);
  const files = { bin: 'zetaphyd-linux-amd64', sums: 'SHA256SUMS', manifest: 'RELEASE.json' };
  for (const k of sign) writeFileSync(join(w.root, 'signed'), readFileSync(join(w.root, 'signed'), 'utf8') + sha(readFileSync(join(d, files[k]))) + '\n');
  return d;
}

function verify(w, dir, args = [], env = {}) {
  const r = spawnSync('bash', [SCRIPT, '--dir', dir, '--arch', 'amd64', '--installed-bin', join(w.root, 'installed-zetaphyd'),
    '--record-file', join(w.root, 'record.json'), ...args],
  { encoding: 'utf8', env: { PATH: `${w.bin}:${w.tools}`, HOME: w.root, ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('a correctly signed release passes (gh): hashes, signature identity bound to repo + workflow + main + commit; --record writes the record', () => {
  const w = world();
  const d = release(w);
  const r = verify(w, d, ['--setup', join(w.root, 'rel.setup.sh'), '--record']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /VERIFIED zetaphyd-linux-amd64/);
  assert.match(r.out, /first install/);
  const log = readFileSync(join(w.root, 'gh.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 3, 'binary, SHA256SUMS and RELEASE.json each checked');
  for (const l of log) {
    for (const want of [`--repo ${REPO}`, `--signer-workflow ${WF}`, '--source-ref refs/heads/main', `--source-digest ${COMMIT}`, '--deny-self-hosted-runners', '--bundle ']) assert.ok(l.includes(want), `${want} in: ${l}`);
  }
  const rec = JSON.parse(readFileSync(join(w.root, 'record.json'), 'utf8'));
  assert.equal(rec.main_commits, 271);
  assert.equal(rec.binary_sha256, sha('ELF fake zetaphyd zetaphy-v5 (rel)'));
  rmSync(w.root, { recursive: true });
});

test('refusals: tampered binary, missing SHA256SUMS line, unsigned file, wrong workflow / ref / commit, wrong repo or ref in RELEASE.json, wrong setup-node.sh', () => {
  const w = world();
  const cases = [
    [() => { const d = release(w, { name: 'tamper' }); writeFileSync(join(d, 'zetaphyd-linux-amd64'), 'evil'); return d; }, {}, [], /sha256 .* SHA256SUMS says/],
    [() => release(w, { name: 'noline', sums: `${sha('x')}  RELEASE.json\n` }), {}, [], /SHA256SUMS has no single line for zetaphyd-linux-amd64/],
    [() => release(w, { name: 'dupline', sums: `${sha('ELF fake zetaphyd zetaphy-v5 (dupline)')}  zetaphyd-linux-amd64\n${sha('ELF fake zetaphyd zetaphy-v5 (dupline)')}  zetaphyd-linux-amd64\n` }), {}, [], /no single line/],
    [() => release(w, { name: 'unsigned-bin', sign: ['sums', 'manifest'] }), {}, [], /zetaphyd-linux-amd64: no valid attestation/],
    [() => release(w, { name: 'unsigned-sums', sign: ['bin', 'manifest'] }), {}, [], /SHA256SUMS: no valid attestation/],
    [() => release(w, { name: 'otherwf' }), { SIGNER_WORKFLOW: `${REPO}/.github/workflows/evil.yml` }, [], /no valid attestation/],
    [() => release(w, { name: 'otherref' }), { SIGNED_REF: 'refs/heads/feature' }, [], /no valid attestation/],
    [() => release(w, { name: 'othercommit' }), { SIGNED_COMMIT: 'b'.repeat(40) }, [], /no valid attestation/],
    [() => release(w, { name: 'fork', manifest: { repository: 'mallory/zetaphy' } }), {}, [], /built from mallory\/zetaphy/],
    [() => release(w, { name: 'branch', manifest: { ref: 'refs/heads/dev' } }), {}, [], /built from refs\/heads\/dev/],
    [() => release(w, { name: 'tag', manifest: { tag: 'zetaphyd-000000000000' } }), {}, [], /tag does not match/],
    [() => release(w, { name: 'setup' }), {}, ['--setup', '/dev/null'], /this release was built from/],
  ];
  for (const [mk, env, args, re] of cases) {
    const r = verify(w, mk(), args, env);
    assert.equal(r.code, 1, `refused (${re}):\n${r.out}`);
    assert.match(r.out, re);
    assert.doesNotMatch(r.out, /VERIFIED/);
  }
  rmSync(w.root, { recursive: true });
});

test('anti-rollback: an older release (position on main, or fewer upgrade handlers) is refused; ALLOW_ROLLBACK=1 accepts it on purpose', () => {
  const w = world();
  assert.equal(verify(w, release(w, { name: 'new', seq: 300 }), ['--record']).code, 0);
  let r = verify(w, release(w, { name: 'old', seq: 280, commit: COMMIT }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /#280 on main is older than the installed #300/);
  r = verify(w, release(w, { name: 'rewritten', seq: 300, commit: COMMIT, manifest: { commit: COMMIT } }));
  assert.equal(r.code, 0, 'the same release again (re-install) is fine');
  r = verify(w, release(w, { name: 'less', seq: 301, upgrades: ['zetaphy-v2', 'zetaphy-v3'] }));
  assert.equal(r.code, 1);
  assert.match(r.out, /upgrade handler\(s\) this one lacks: zetaphy-firewall zetaphy-v4 zetaphy-v5/);
  r = verify(w, release(w, { name: 'old2', seq: 280 }), ['--record'], { ALLOW_ROLLBACK: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ALLOW_ROLLBACK=1: accepted on purpose/);
  assert.equal(JSON.parse(readFileSync(join(w.root, 'record.json'), 'utf8')).main_commits, 280, 'the deliberate rollback is now the installed release');
  assert.equal(verify(w, release(w, { name: 'newer', seq: 301 })).code, 0, 'a newer one passes');
  rmSync(w.root, { recursive: true });
});

test('anti-rollback without a record: the highest zetaphy-vN in the installed binary must be in the new release', () => {
  const w = world();
  writeFileSync(join(w.root, 'installed-zetaphyd'), 'ELF ... "zetaphy-v2" ... zetaphy-v6 ...'); chmodSync(join(w.root, 'installed-zetaphyd'), 0o755);
  let r = verify(w, release(w, { name: 'a' }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lacks: zetaphy-v6/);
  writeFileSync(join(w.root, 'installed-zetaphyd'), 'ELF zetaphy-v1 zetaphy-v4'); // a stray lower string does not matter
  r = verify(w, release(w, { name: 'b' }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /installed up to zetaphy-v4, this release up to zetaphy-v5/);
  rmSync(w.root, { recursive: true });
});

test('cosign path (no gh): verifies the shipped bundle against the workflow identity on main at the commit', () => {
  const w = world();
  rmSync(join(w.bin, 'gh'));
  const d = release(w);
  const r = verify(w, d);
  assert.equal(r.code, 0, r.out);
  const log = readFileSync(join(w.root, 'cosign.log'), 'utf8');
  assert.match(log, /verify-blob-attestation --bundle .*zetaphyd-provenance\.sigstore\.json --new-bundle-format --type slsaprovenance1/);
  assert.match(log, /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
  rmSync(join(d, 'zetaphyd-provenance.sigstore.json'));
  assert.match(verify(w, d).out, /cosign needs the bundle/);
  rmSync(join(w.bin, 'cosign'));
  const n = verify(w, d);
  assert.equal(n.code, 2, 'no verifier installed');
  assert.match(n.out, /missing tool: gh .* or cosign/);
  rmSync(w.root, { recursive: true });
});

test('a release from before signing (no RELEASE.json) is refused unless ALLOW_UNSIGNED=1, which still checks the binary attestation', () => {
  const w = world();
  const d = release(w);
  rmSync(join(d, 'RELEASE.json'));
  let r = verify(w, d);
  assert.equal(r.code, 1);
  assert.match(r.out, /no RELEASE.json/);
  r = verify(w, d, [], { ALLOW_UNSIGNED: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no rollback check/);
  const log = readFileSync(join(w.root, 'gh.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 1, 'only the binary');
  assert.ok(!existsSync(join(w.root, 'record.json')));
  assert.equal(verify(w, d, ['--record'], { ALLOW_UNSIGNED: '1' }).code, 1, 'no record from an unsigned release');
  rmSync(w.root, { recursive: true });
});

test('usage errors exit 2', () => {
  const w = world();
  assert.equal(spawnSync('bash', [SCRIPT], { encoding: 'utf8' }).status, 2);
  assert.equal(verify(w, release(w), ['--arch', 'mips']).code, 2);
  assert.equal(verify(w, release(w, { name: 'r2' }), ['--repo', 'bad repo']).code, 2);
  rmSync(w.root, { recursive: true });
});
