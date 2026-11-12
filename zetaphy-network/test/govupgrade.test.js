// zetaphy-chain/gov.sh propose-upgrade: the checks added after the 2026-10-29 testnet stop at block 123343
// (the release with the "zetaphy-v5" handler was installed before the vote passed). Stand-ins for curl
// (serves the real setup-node.sh) and zetaphyd (a script; "having a handler" = the name appears in it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GOV = new URL('../../zetaphy-chain/gov.sh', import.meta.url).pathname;
const SETUP = new URL('../../zetaphy-chain/setup-node.sh', import.meta.url).pathname;

function chain({ binaryKnows = [], releaseBuilt = true, force = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'zetaphy-govupg-'));
  const exe = (name, body) => { writeFileSync(join(d, name), `#!/bin/bash\n${body}\n`); chmodSync(join(d, name), 0o755); };
  exe('curl', `
for a in "$@"; do case "$a" in -fsSIL) exit ${releaseBuilt ? 0 : 22} ;; esac; done
out=""; prev=""; url=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; case "$a" in http*) url="$a" ;; esac; prev="$a"; done
case "$url" in
  */SHA256SUMS) printf '%s  zetaphyd-linux-amd64\n%s  zetaphyd-linux-arm64\n' ${'a'.repeat(64)} ${'b'.repeat(64)} ;;
  *) if [ -n "$out" ]; then cp ${SETUP} "$out"; else cat ${SETUP}; fi ;;
esac`);
  exe('zetaphyd', `# handlers in this stand-in binary: ${binaryKnows.join(' ')}
case "$*" in
  *" status"*|status*) echo '{"sync_info":{"latest_block_height":"1000"}}' ;;
  *"module-account gov"*) echo '{"account":{"value":{"address":"zetaphy10d07y265gmmuvt4z0w9aw880jnsr700jxqk2t7"}}}' ;;
  *"gov proposals"*) n=$(cat ${d}/n 2>/dev/null || echo 0); echo $((n+1)) > ${d}/n; [ "$n" = 0 ] && echo '{"proposals":[{"id":"2"}]}' || echo '{"proposals":[{"id":"3"}]}' ;;
  *"submit-proposal"*) f=""; prev=""; for a in "$@"; do [ "$prev" = submit-proposal ] && f="$a"; prev="$a"; done; [ -n "$f" ] && cp "$f" ${d}/proposal.json; echo '{"code":0,"txhash":"AB"}' ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac`);
  const run = (...args) => {
    const r = spawnSync('bash', [GOV, 'propose-upgrade', ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...(force ? { FORCE: '1' } : {}), ZETAPHYD: join(d, 'zetaphyd'), PATH: `${d}:${process.env.PATH}`, NODE_HOME: d, KEYS_DIR: d },
    });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  return { run, dir: d };
}

test('the 2026-10-29 case: the binary already has "zetaphy-v5", which may run early: allowed, with the right advice', () => {
  const r = chain({ binaryKnows: ['zetaphy-v5'] }).run('zetaphy-v5', '1500', 'v5');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /may install zetaphyd-[0-9a-f]{12} any time before block 1500/);
  assert.match(r.out, /the chain does not stop/);
  assert.match(r.out, /proposal 3 submitted/);
});

test('a handler that may not run early, already in the running binary: refused (it would stop the chain)', () => {
  const r = chain({ binaryKnows: ['zetaphy-v4'] }).run('zetaphy-v4', '1500', 'v4');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /already has the "zetaphy-v4" handler, and "zetaphy-v4" may not run early/);
  assert.doesNotMatch(r.out, /submitted/);
});

test('an old binary without the handler: allowed, and told the chain stops at the height until nodes update', () => {
  const r = chain({ binaryKnows: [] }).run('zetaphy-v4', '1500', 'v4');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /keep the current binary until block 1500, where the chain stops/);
});

test('no release on main has the handler: refused', () => {
  const r = chain().run('zetaphy-v99', '1500', 'nothing');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no release on main has an upgrade handler named "zetaphy-v99"/);
});

test('the release is not built yet: refused', () => {
  const r = chain({ releaseBuilt: false }).run('zetaphy-v5', '1500', 'v5');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /is not built yet/);
});

test('FORCE=1 skips the checks', () => {
  const r = chain({ releaseBuilt: false }).run('zetaphy-v99', '1500', 'x');
  assert.equal(r.code, 1);
  const f = chain({ releaseBuilt: false, force: true }).run('zetaphy-v99', '1500', 'x');
  assert.equal(f.code, 0, f.out);
  assert.match(f.out, /FORCE=1: upgrade checks skipped/);
});

test('the plan pins the release binaries (Plan.Info, cosmovisor format)', () => {
  const c = chain({ binaryKnows: ['zetaphy-v5'] });
  const r = c.run('zetaphy-v5', '1500', 'v5');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /the plan pins: .*linux\/amd64.*a{64}/);
  const p = JSON.parse(readFileSync(join(c.dir, 'proposal.json'), 'utf8'));
  const info = JSON.parse(p.messages[0].plan.info);
  assert.match(info.binaries['linux/amd64'], new RegExp(`/zetaphyd-linux-amd64\\?checksum=sha256:${'a'.repeat(64)}$`));
  assert.match(info.binaries['linux/arm64'], new RegExp(`/zetaphyd-linux-arm64\\?checksum=sha256:${'b'.repeat(64)}$`));
});
