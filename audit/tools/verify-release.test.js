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
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

function world() {
  const root = mkdtempSync(join(process.env.NO_DOWNGRADE_TMP ?? tmpdir(), 'vrel-'));
  const bin = join(root, 'bin'); mkdirSync(bin);
  // only the tools the script needs (a runner's real gh / cosign in /usr/bin must not be found)
  const tools = join(root, 'tools'); mkdirSync(tools);
  for (const t of ['bash', 'sh', 'env', 'sha256sum', 'jq', 'awk', 'sed', 'grep', 'sort', 'cut', 'date', 'mkdir', 'mv', 'comm', 'tail', 'dirname', 'uname', 'cat', 'head', 'mktemp', 'rm', 'stat']) {
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
[ "$want_repo$want_wf$want_ref$want_hosted" = 1111 ] || { echo "stub-gh: no attestation matched the identity flags" >&2; exit 1; }
[ -z "$digest" ] || [ "$digest" = "\${SIGNED_COMMIT:-${COMMIT}}" ] || { echo "stub-gh: source digest $digest does not match" >&2; exit 1; }
grep -q "$(sha256sum "$f" | cut -d' ' -f1)" "${root}/signed" || { echo "stub-gh: no attestation for \${f##*/}" >&2; exit 1; }
`;
  writeFileSync(join(bin, 'gh'), gh); chmodSync(join(bin, 'gh'), 0o755);
  // cosign stub: a version (COSIGN_STUB_VERSION, default v3.1.4) with v3's and v2's bundle handling, and cosign's
  // size limit for a checked file (STUB_DEFAULT_LIMIT bytes when COSIGN_MAX_ATTACHMENT_SIZE is unset; a plain number
  // there is bytes, 512MiB / other units count as large enough here)
  const cosign = `#!/usr/bin/env bash
v="\${COSIGN_STUB_VERSION:-v3.1.4}"
[ "$1" = version ] && { printf '  ______   ______\\nGitVersion:    %s\\nGitCommit:     0000\\n' "$v"; exit 0; }
echo "$*" >> "${root}/cosign.log"
echo "COSIGN_MAX_ATTACHMENT_SIZE=\${COSIGN_MAX_ATTACHMENT_SIZE-<unset>}" >> "${root}/cosign.env"
f="\${!#}"
case "$v $*" in
  v3*"--new-bundle-format"*) echo "WARNING: --new-bundle-format is deprecated: the new bundle format is the only one" >&2 ;;
  v2*"--new-bundle-format"*) ;;
  v2*) echo "Error: bundle: unknown format (old bundle expected)" >&2; exit 1 ;;
esac
size=$(stat -c %s "$f")
lim="\${COSIGN_MAX_ATTACHMENT_SIZE:-\${STUB_DEFAULT_LIMIT:-134217728}}"
[[ "$lim" =~ ^[0-9]+$ ]] || lim=536870912
[ "$size" -le "$lim" ] || { echo "Error: size of layer ($size) exceeded the limit ($lim)" >&2; echo "error during command execution: size of layer ($size) exceeded the limit ($lim)" >&2; exit 1; }
case "$*" in *"--certificate-identity https://github.com/${WF}@refs/heads/main"*"--certificate-github-workflow-sha ${COMMIT}"*) ;; *) echo "Error: failed to verify certificate identity: no matching CertificateIdentity found" >&2; exit 1;; esac
grep -q "$(sha256sum "$f" | cut -d' ' -f1)" "${root}/signed" || { echo "Error: none of the attestations matched the digest of \${f##*/}" >&2; exit 1; }
`;
  writeFileSync(join(bin, 'cosign'), cosign); chmodSync(join(bin, 'cosign'), 0o755);
  // curl stub (the newest published release's RELEASE.json): logs the URL, serves $root/latest.json if it exists,
  // else fails like an unreachable host
  const curl = `#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; --max-time|--max-filesize) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
echo "$url" >> "${root}/curl.log"
[ -f "${root}/latest.json" ] || { echo "curl: (6) Could not resolve host" >&2; exit 6; }
cat "${root}/latest.json" > "$out"
`;
  writeFileSync(join(bin, 'curl'), curl); chmodSync(join(bin, 'curl'), 0o755);
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
    main_commits: seq, commit_time: NOW - 5 * DAY - 3600 + seq, upgrades, workflow_run: '1', ...manifest };
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

test('anti-rollback without a record: every upgrade handler name in the installed binary must be in the new release (Z-49)', () => {
  const w = world();
  const installed = (text) => { writeFileSync(join(w.root, 'installed-zetaphyd'), text); chmodSync(join(w.root, 'installed-zetaphyd'), 0o755); };
  installed('ELF ... "zetaphy-v2" ... zetaphy-v6 ...');
  let r = verify(w, release(w, { name: 'a' }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lacks: zetaphy-v6/);
  installed('ELF zetaphy-v1 zetaphy-v4'); // zetaphy-v1 is the genesis version, not a handler: it does not count
  r = verify(w, release(w, { name: 'b' }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /compared with the upgrade handler names in .*\(zetaphy-v4\)/);
  // the full list, not only the highest zetaphy-vN: a release that drops a named handler or one in the middle
  installed('ELF zetaphy-firewall zetaphy-guard zetaphy-v2 zetaphy-v3 zetaphy-v4 zetaphy-v5');
  r = verify(w, release(w, { name: 'noguard', upgrades: ['zetaphy-firewall', 'zetaphy-v2', 'zetaphy-v3', 'zetaphy-v4', 'zetaphy-v5'] }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lacks: zetaphy-guard/);
  r = verify(w, release(w, { name: 'nov4', upgrades: ['zetaphy-firewall', 'zetaphy-guard', 'zetaphy-v2', 'zetaphy-v3', 'zetaphy-v5'] }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lacks: zetaphy-v4 \(/);
  r = verify(w, release(w, { name: 'nofw', upgrades: ['zetaphy-guard', 'zetaphy-v2', 'zetaphy-v3', 'zetaphy-v4', 'zetaphy-v5', 'zetaphy-v6'] }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lacks: zetaphy-firewall/, 'a newer vN does not make up for a missing named handler');
  installed('ELF zetaphy-firewall zetaphy-guard zetaphy-shield zetaphy-v2 zetaphy-v5');
  r = verify(w, release(w, { name: 'noshield', upgrades: ['zetaphy-firewall', 'zetaphy-guard', 'zetaphy-v2', 'zetaphy-v3', 'zetaphy-v4', 'zetaphy-v5'] }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lacks: zetaphy-shield/);
  r = verify(w, release(w, { name: 'all', upgrades: ['zetaphy-firewall', 'zetaphy-guard', 'zetaphy-shield', 'zetaphy-v2', 'zetaphy-v3', 'zetaphy-v4', 'zetaphy-v5'] }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /carries every upgrade handler of the installed release/);
  r = verify(w, release(w, { name: 'nov4-allowed', upgrades: ['zetaphy-firewall', 'zetaphy-guard', 'zetaphy-shield', 'zetaphy-v5'] }), [], { ALLOW_ROLLBACK: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /lacks: zetaphy-v2 .*ALLOW_ROLLBACK=1: accepted on purpose/);
  rmSync(w.root, { recursive: true });
});

test('cosign path (no gh): verifies the shipped bundle against the workflow identity on main at the commit', () => {
  const w = world();
  rmSync(join(w.bin, 'gh'));
  const d = release(w);
  const r = verify(w, d);
  assert.equal(r.code, 0, r.out);
  const log = readFileSync(join(w.root, 'cosign.log'), 'utf8');
  assert.match(log, /verify-blob-attestation --bundle .*zetaphyd-provenance\.sigstore\.json --type slsaprovenance1/);
  assert.doesNotMatch(log, /--new-bundle-format/, 'cosign v3: the deprecated flag is not passed');
  assert.doesNotMatch(r.out, /deprecated/);
  assert.match(log, /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
  rmSync(join(d, 'zetaphyd-provenance.sigstore.json'));
  assert.match(verify(w, d).out, /cosign needs the bundle/);
  rmSync(join(w.bin, 'cosign'));
  const n = verify(w, d);
  assert.equal(n.code, 2, 'no verifier installed');
  assert.match(n.out, /missing tool: gh .* or cosign/);
  rmSync(w.root, { recursive: true });
});

test('no RELEASE.json is always refused: no unsigned path (ALLOW_UNSIGNED is gone), so deleting it cannot skip the rollback check (Z-49)', () => {
  const w = world();
  assert.equal(verify(w, release(w, { name: 'new', seq: 300 }), ['--record']).code, 0);
  rmSync(join(w.root, 'gh.log'));
  const d = release(w, { name: 'old', seq: 280 });
  assert.equal(verify(w, d).code, 1, 'older: refused');
  rmSync(join(w.root, 'gh.log'));
  rmSync(join(d, 'RELEASE.json'));
  for (const env of [{}, { ALLOW_UNSIGNED: '1' }, { ALLOW_UNSIGNED: '1', ALLOW_ROLLBACK: '1' }]) {
    const r = verify(w, d, ['--record'], env);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /REFUSED: no RELEASE.json .*there is no unsigned path/);
    assert.doesNotMatch(r.out, /VERIFIED/);
  }
  assert.ok(!existsSync(join(w.root, 'gh.log')), 'refused before any signature check');
  assert.equal(JSON.parse(readFileSync(join(w.root, 'record.json'), 'utf8')).main_commits, 300, 'the record is untouched');
  rmSync(w.root, { recursive: true });
});

test('freshness: an old release warns (REQUIRE_FRESH=1 refuses); a newer published release warns; offline works (Z-49)', () => {
  const w = world();
  const LATEST = `https://github.com/${REPO}/releases/latest/download/RELEASE.json`;
  // offline (curl cannot reach the host): only the age; a fresh release passes without warnings
  let r = verify(w, release(w, { name: 'fresh', seq: 300 }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok {4}release age 5 days \(at most 60\)/);
  assert.match(r.out, /could not read the newest published release .*only the age was checked/);
  assert.doesNotMatch(r.out, /WARN/);
  assert.equal(readFileSync(join(w.root, 'curl.log'), 'utf8').trim(), LATEST);
  // old: a warning; with REQUIRE_FRESH=1 a refusal
  const old = release(w, { name: 'aged', seq: 301, manifest: { commit_time: NOW - 90 * DAY } });
  r = verify(w, old);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARN {2}this release's commit is 90 days old \(more than 60\)/);
  r = verify(w, old, [], { MAX_RELEASE_AGE_DAYS: '120' });
  assert.doesNotMatch(r.out, /WARN/);
  r = verify(w, old, [], { REQUIRE_FRESH: '1' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /REFUSED: this release's commit is 90 days old .*REQUIRE_FRESH=1/);
  assert.equal(verify(w, old, [], { MAX_RELEASE_AGE_DAYS: 'x' }).code, 2);
  // the newest published release is further along main: someone may be withholding it
  const latest = (seq, repository = REPO) => writeFileSync(join(w.root, 'latest.json'), JSON.stringify({ schema: 'zetaphy-release/v1', repository, tag: 'zetaphyd-0123456789ab', main_commits: seq }));
  latest(350);
  const mid = release(w, { name: 'mid', seq: 320 });
  r = verify(w, mid);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARN {2}a newer release is published: zetaphyd-0123456789ab \(#350 on main; this one is #320\)/);
  r = verify(w, mid, [], { REQUIRE_FRESH: '1' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /REFUSED: a newer release is published/);
  latest(320);
  r = verify(w, mid, [], { REQUIRE_FRESH: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /the newest published release \(zetaphyd-0123456789ab, #320\) is not further along main/);
  // a file that is not this repository's release record is ignored (no warning, no trust)
  latest(999, 'mallory/zetaphy');
  r = verify(w, mid, [], { REQUIRE_FRESH: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /could not read the newest published release/);
  // OFFLINE=1: not looked up at all; LATEST_RELEASE_URL: another place
  rmSync(join(w.root, 'curl.log'));
  r = verify(w, mid, [], { OFFLINE: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OFFLINE=1: the newest published release was not looked up/);
  assert.ok(!existsSync(join(w.root, 'curl.log')));
  latest(350);
  verify(w, mid, [], { LATEST_RELEASE_URL: 'https://mirror.example/RELEASE.json' });
  assert.equal(readFileSync(join(w.root, 'curl.log'), 'utf8').trim(), 'https://mirror.example/RELEASE.json');
  // no curl at all: still verifies
  rmSync(join(w.bin, 'curl'));
  r = verify(w, mid);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no curl: the newest published release was not looked up/);
  rmSync(w.root, { recursive: true });
});

test('start-guard revert: --mark-refused keeps the refused release as the floor (no downgrade path) and refuses it again; a newer release passes', () => {
  const w = world();
  const bin = join(w.root, 'installed-zetaphyd');
  const rec = () => JSON.parse(readFileSync(join(w.root, 'record.json'), 'utf8'));
  const markRefused = () => {
    const r = spawnSync('bash', [SCRIPT, '--mark-refused', '--installed-bin', bin, '--record-file', join(w.root, 'record.json')],
      { encoding: 'utf8', env: { PATH: `${w.bin}:${w.tools}`, HOME: w.root } });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  // nothing recorded yet: nothing to mark
  assert.equal(markRefused().code, 1);
  // the previous release (#300) runs and is recorded; then #310 is installed and recorded
  const prev = release(w, { name: 'prev', seq: 300 });
  assert.equal(verify(w, prev, ['--record']).code, 0);
  writeFileSync(bin, readFileSync(join(prev, 'zetaphyd-linux-amd64'))); chmodSync(bin, 0o755);
  const bad = release(w, { name: 'bad', seq: 310 });
  assert.equal(verify(w, bad, ['--record']).code, 0);
  writeFileSync(bin, readFileSync(join(bad, 'zetaphyd-linux-amd64')));
  // no revert happened (the recorded binary runs): refused, nothing marked
  let r = markRefused();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no revert happened/);
  // the start guard refused #310 and the node went back to the previous binary
  writeFileSync(bin, readFileSync(join(prev, 'zetaphyd-linux-amd64')));
  r = markRefused();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /marked .* \(#310\) as refused by the start guard; the floor stays at #310/);
  assert.equal(rec().main_commits, 310, 'the floor is not lowered');
  assert.equal(rec().refused.length, 1);
  assert.equal(rec().running_binary_sha256, sha(readFileSync(join(prev, 'zetaphyd-linux-amd64'))));
  assert.equal(markRefused().code, 0, 'marking twice is harmless');
  assert.equal(rec().refused.length, 1);
  // the refused release is not taken again (RETRY_REFUSED=1 on purpose); the older previous one is still a rollback
  r = verify(w, bad);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /start guard refused this release before/);
  r = verify(w, bad, [], { RETRY_REFUSED: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RETRY_REFUSED=1: tried again on purpose/);
  r = verify(w, release(w, { name: 'older', seq: 305 }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /#305 on main is older than the installed #310/);
  r = verify(w, prev);
  assert.equal(r.code, 1, 'the running previous release cannot be re-recorded as the floor either');
  // a fixed, newer release passes and becomes the floor; the refusal history stays
  const FIX = 'f1'.repeat(20); // a newer release is another commit
  r = verify(w, release(w, { name: 'fix', seq: 320, commit: FIX }), ['--record'], { SIGNED_COMMIT: FIX });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /runs its previous binary after a start-guard revert; the floor stays at the refused #310/);
  assert.equal(rec().main_commits, 320);
  assert.equal(rec().refused[0].main_commits, 310);
  assert.equal(rec().running_binary_sha256, undefined);
  rmSync(w.root, { recursive: true });
});

test('usage errors exit 2', () => {
  const w = world();
  assert.equal(spawnSync('bash', [SCRIPT], { encoding: 'utf8' }).status, 2);
  assert.equal(verify(w, release(w), ['--arch', 'mips']).code, 2);
  assert.equal(verify(w, release(w, { name: 'r2' }), ['--repo', 'bad repo']).code, 2);
  rmSync(w.root, { recursive: true });
});

test('cosign: a binary over cosign\'s own 128 MiB limit verifies (the script raises the limit), unless the caller set one', () => {
  const w = world();
  rmSync(join(w.bin, 'gh'));
  const d = release(w);
  // the stub's "cosign default" is 10 bytes here, so every test file is over it, as the real binary is over 128 MiB
  let r = verify(w, d, [], { STUB_DEFAULT_LIMIT: '10' });
  assert.equal(r.code, 0, r.out);
  const env = readFileSync(join(w.root, 'cosign.env'), 'utf8').trim().split('\n');
  assert.equal(env.length, 3);
  for (const l of env) assert.equal(l, 'COSIGN_MAX_ATTACHMENT_SIZE=512MiB');
  // the caller's own (too small) value is kept, and cosign's reason is shown with the refusal
  r = verify(w, d, [], { STUB_DEFAULT_LIMIT: '10', COSIGN_MAX_ATTACHMENT_SIZE: '5' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /cosign exited 1; its last lines:/);
  assert.match(r.out, /\| Error: size of layer \(\d+\) exceeded the limit \(5\)/);
  assert.match(r.out, /REFUSED: zetaphyd-linux-amd64: the bundle's signature does not verify/);
  assert.doesNotMatch(r.out, /VERIFIED/);
  rmSync(w.root, { recursive: true });
});

test('cosign version: v3 gets no --new-bundle-format (deprecated there), v2.x still gets it; COSIGN_TRUSTED_ROOT is passed on', () => {
  const w = world();
  rmSync(join(w.bin, 'gh'));
  const d = release(w);
  let r = verify(w, d, [], { COSIGN_STUB_VERSION: 'v3.1.4' });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(readFileSync(join(w.root, 'cosign.log'), 'utf8'), /--new-bundle-format/);
  rmSync(join(w.root, 'cosign.log'));
  for (const v of ['v2.4.3', 'v2.5.3']) {
    r = verify(w, d, [], { COSIGN_STUB_VERSION: v });
    assert.equal(r.code, 0, `${v}: ${r.out}`);
    const log = readFileSync(join(w.root, 'cosign.log'), 'utf8').trim().split('\n');
    for (const l of log) assert.match(l, /--bundle \S+ --new-bundle-format --type slsaprovenance1/, `${v}: ${l}`);
    rmSync(join(w.root, 'cosign.log'));
  }
  // an unreadable version is taken as v3 (the current one)
  r = verify(w, d, [], { COSIGN_STUB_VERSION: 'devel' });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(readFileSync(join(w.root, 'cosign.log'), 'utf8'), /--new-bundle-format/);
  rmSync(join(w.root, 'cosign.log'));
  writeFileSync(join(w.root, 'trusted_root.json'), '{}');
  r = verify(w, d, [], { COSIGN_TRUSTED_ROOT: join(w.root, 'trusted_root.json') });
  assert.equal(r.code, 0, r.out);
  assert.match(readFileSync(join(w.root, 'cosign.log'), 'utf8'), new RegExp(`--trusted-root ${join(w.root, 'trusted_root.json')} --type`));
  assert.equal(verify(w, d, [], { COSIGN_TRUSTED_ROOT: join(w.root, 'missing.json') }).code, 2);
  rmSync(w.root, { recursive: true });
});

test('a refusal shows the verifier\'s own last lines (gh and cosign), a success prints none of them', () => {
  const w = world();
  let r = verify(w, release(w, { name: 'ok' }));
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /stub-gh|its last lines/);
  r = verify(w, release(w, { name: 'nosig', sign: ['sums', 'manifest'] }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /gh exited 1; its last lines:\n {2}\| stub-gh: no attestation for zetaphyd-linux-amd64/);
  rmSync(join(w.bin, 'gh'));
  r = verify(w, release(w, { name: 'cos-nosig', sign: ['bin', 'manifest'] }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /cosign exited 1; its last lines:\n {2}\| Error: none of the attestations matched the digest of SHA256SUMS/);
  assert.match(r.out, /REFUSED: SHA256SUMS:/);
  rmSync(w.root, { recursive: true });
});
