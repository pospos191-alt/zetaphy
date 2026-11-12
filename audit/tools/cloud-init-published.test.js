// Tests of audit/tools/cloud-init-published.sh (internal review 2026-11-10, Z-05): the setup-node.sh that
// cloud-init.sh pins must really be published (v/<sha256>.sh answers and has that content). A curl stand-in serves
// a fake public repository from a folder; the real check runs in workflow cloud-init-published.yml.
//   node --test audit/tools/cloud-init-published.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./cloud-init-published.sh', import.meta.url));
const PACK = fileURLToPath(new URL('../../zetaphy-chain/pack-cloud-init.sh', import.meta.url));
const REAL_CI = fileURLToPath(new URL('../../zetaphy-chain/cloud-init.sh', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PUB = 'raw.githubusercontent.com/pospos191-alt/zetaphy-chain/main';

function world(setup = 'setup-node.sh v7') {
  const root = mkdtempSync(join(process.env.NO_DOWNGRADE_TMP ?? tmpdir(), 'cipub-'));
  const stubs = join(root, 'stubs'); mkdirSync(stubs);
  const net = join(root, 'net'); mkdirSync(net);
  // curl: -I = HEAD; -o <file>; serves $net/<host>/<path>; STUB_CURL_EXIT forces a network error
  writeFileSync(join(stubs, 'curl'), `#!/usr/bin/env bash
out=""; url=""; head=0
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*I*) head=1; shift;; http*) url="$1"; shift;; *) shift;; esac; done
echo "$head $url" >> "${root}/curl.log"
[ -z "\${STUB_CURL_EXIT:-}" ] || { echo "curl: (\${STUB_CURL_EXIT}) Could not resolve host" >&2; exit "\${STUB_CURL_EXIT}"; }
p="${net}/\${url#https://}"
[ -f "$p" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
[ "$head" = 1 ] && exit 0
if [ -n "$out" ]; then cp "$p" "$out"; else cat "$p"; fi
`);
  chmodSync(join(stubs, 'curl'), 0o755);
  const s = sha(setup);
  const chain = join(root, 'zetaphy-chain'); mkdirSync(chain);
  writeFileSync(join(chain, 'setup-node.sh'), setup);
  // cloud-init.sh exactly as pack-cloud-init.sh writes it, for this setup-node.sh
  const real = readFileSync(REAL_CI, 'utf8');
  writeFileSync(join(chain, 'cloud-init.sh'), real.replaceAll(real.match(/^echo "([0-9a-f]{64})  \$f"/m)[1], s));
  const put = (path, data) => { const p = join(net, path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
  const run = (args = [], env = {}) => {
    const out = join(root, 'gh-output'); writeFileSync(out, '');
    const r = spawnSync('bash', [SCRIPT, '--cloud-init', join(chain, 'cloud-init.sh'), ...args],
      { encoding: 'utf8', env: { PATH: `${stubs}:${process.env.PATH}`, GITHUB_OUTPUT: out, ...env } });
    return { code: r.status, out: r.stdout + r.stderr, gh: Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2))) };
  };
  return { root, chain, put, run, s, setup };
}

test('the test cloud-init.sh has the format pack-cloud-init.sh writes (the parser reads the real one)', () => {
  const pack = readFileSync(PACK, 'utf8');
  assert.match(pack, /url="https:\/\/raw\.githubusercontent\.com\/\$PUBLIC_REPO\/main\/v\/\$sha\.sh"/);
  assert.match(pack, /echo "\$sha {2}\\\$f" \| sha256sum -c --quiet -/);
  const w = world();
  assert.match(readFileSync(join(w.chain, 'cloud-init.sh'), 'utf8'), new RegExp(`/v/${w.s}\\.sh"[\\s\\S]*echo "${w.s}  \\$f" \\| sha256sum -c`));
  rmSync(w.root, { recursive: true });
});

test('published with the pinned content: exit 0, status=published; HEAD first (curl -fsI), then the content', () => {
  const w = world();
  w.put(`${PUB}/v/${w.s}.sh`, w.setup);
  w.put(`${PUB}/setup-node.sh`, w.setup);
  const r = w.run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^published: /m);
  assert.equal(r.gh.status, 'published');
  assert.equal(r.gh.sha, w.s);
  assert.equal(r.gh.url, `https://${PUB}/v/${w.s}.sh`);
  const log = readFileSync(join(w.root, 'curl.log'), 'utf8').trim().split('\n');
  assert.equal(log[0], `1 https://${PUB}/v/${w.s}.sh`);
  assert.doesNotMatch(r.out, /::notice/);
  rmSync(w.root, { recursive: true });
});

test('not published: an error and exit 1 on main / schedule; a warning and exit 0 with --warn (pull requests)', () => {
  const w = world();
  let r = w.run();
  assert.equal(r.code, 1, r.out);
  assert.equal(r.gh.status, 'missing');
  assert.match(r.out, /::error title=setup-node\.sh not published for cloud-init::.*is not published .*404.*publish v\/[0-9a-f]{64}\.sh .* first, then merge/);
  r = w.run(['--warn']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.gh.status, 'missing');
  assert.match(r.out, /::warning title=setup-node\.sh not published for cloud-init::.*Before merging: publish/);
  assert.doesNotMatch(r.out, /::error/);
  rmSync(w.root, { recursive: true });
});

test('published with other content (a changed v/<sha>.sh) is refused like a missing one', () => {
  const w = world();
  w.put(`${PUB}/v/${w.s}.sh`, 'something else');
  const r = w.run();
  assert.equal(r.code, 1, r.out);
  assert.equal(r.gh.status, 'mismatch');
  assert.match(r.out, /published with SHA-256 [0-9a-f]{64}, not the pinned/);
  assert.equal(w.run(['--warn']).code, 0);
  rmSync(w.root, { recursive: true });
});

test('a network error is "could not check" (exit 3, warning), never "published" and never "missing"', () => {
  const w = world();
  w.put(`${PUB}/v/${w.s}.sh`, w.setup);
  const r = w.run([], { STUB_CURL_EXIT: '6' });
  assert.equal(r.code, 3, r.out);
  assert.equal(r.gh.status, 'unreachable');
  assert.match(r.out, /::warning title=cloud-init pin not checked::could not reach/);
  rmSync(w.root, { recursive: true });
});

test('notes: the public latest setup-node.sh is older than the pin; the checkout\'s setup-node.sh differs from the pin', () => {
  const w = world();
  w.put(`${PUB}/v/${w.s}.sh`, w.setup);
  w.put(`${PUB}/setup-node.sh`, 'setup-node.sh v6');
  writeFileSync(join(w.chain, 'setup-node.sh'), 'setup-node.sh v8 (not packed yet)');
  const r = w.run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /::notice title=public setup-node\.sh is another version::/);
  assert.match(r.out, /::notice title=cloud-init\.sh pins another setup-node\.sh::.*run zetaphy-chain\/pack-cloud-init\.sh/);
  rmSync(w.root, { recursive: true });
});

test('usage: no pin in the file, or a URL naming another file than the checked SHA-256', () => {
  const w = world();
  writeFileSync(join(w.root, 'empty.sh'), '#!/bin/bash\n');
  assert.equal(spawnSync('bash', [SCRIPT, '--cloud-init', join(w.root, 'empty.sh')]).status, 2);
  assert.equal(spawnSync('bash', [SCRIPT, '--cloud-init', join(w.root, 'missing.sh')]).status, 2);
  const ci = readFileSync(join(w.chain, 'cloud-init.sh'), 'utf8');
  writeFileSync(join(w.chain, 'cloud-init.sh'), ci.replace(`/v/${w.s}.sh`, `/v/${'e'.repeat(64)}.sh`));
  const r = w.run();
  assert.equal(r.code, 1, r.out);
  assert.equal(r.gh.status, 'mismatch');
  assert.match(r.out, /downloads e{64}\.sh but checks SHA-256/);
  rmSync(w.root, { recursive: true });
});
