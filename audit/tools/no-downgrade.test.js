// Tests of audit/tools/no-downgrade.js (L1-4: no dependency downgrades), on the fixture tree in
// fixtures/no-downgrade/base and mutated copies of it. Includes the mutation test: each deliberate downgrade
// must make the CLI exit 1, and an allowlist line with a reason must turn exactly that one into "allowed".
//   node --test audit/tools/no-downgrade.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compareVersions, parseVersion, collectPins, dirTree, compare, parseAllowlist, embeddedGoMods, setupPins, npmPins, cargoPins, workflowPins,
} from './no-downgrade.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BASE = join(HERE, 'fixtures/no-downgrade/base');
const SCRIPT = join(HERE, 'no-downgrade.js');
const REPO = join(HERE, '../..');

/** A copy of the base fixture with `edits` ({ path: [from, to] | (text) => text }) applied. */
function head(edits = {}) {
  const dir = mkdtempSync(join(process.env.NO_DOWNGRADE_TMP ?? tmpdir(), 'nodown-'));
  cpSync(BASE, dir, { recursive: true });
  for (const [p, e] of Object.entries(edits)) {
    const f = join(dir, p);
    const t = readFileSync(f, 'utf8');
    const n = typeof e === 'function' ? e(t) : t.replace(e[0], e[1]);
    assert.notEqual(n, t, `edit of ${p} applied`);
    writeFileSync(f, n);
  }
  return dir;
}

function run(headDir, allow) {
  const args = [SCRIPT, '--base-dir', BASE, '--head-dir', headDir];
  if (allow != null) { const f = join(headDir, 'allow.txt'); writeFileSync(f, allow); args.push('--allow', f); }
  else args.push('--allow', join(headDir, 'none.txt'));
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('version order: semver, Go pseudo-versions, go directives, +incompatible', () => {
  const lt = [['1.25.9', '1.26.11'], ['1.26.9', '1.26.11'], ['v0.57.0', 'v0.60.0'], ['v2.0.0-beta.10.0.20260227212600-39d4711b8970', 'v2.11.0'],
    ['v0.0.0-20260312153236-7ab1446f8b90', 'v0.0.0-20260727155853-b88d891fe743'], ['v1.0.0-rc.1', 'v1.0.0'], ['v1.0.0-alpha', 'v1.0.0-alpha.1'],
    ['v1.0.0-alpha.1', 'v1.0.0-beta'], ['v1.0.0-2', 'v1.0.0-11'], ['v4.8.3+incompatible', 'v4.9.0'], ['go1.25', '1.25.1'], ['1.25', '1.25.1']];
  for (const [a, b] of lt) {
    assert.equal(compareVersions(a, b), -1, `${a} < ${b}`);
    assert.equal(compareVersions(b, a), 1, `${b} > ${a}`);
  }
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('v1.2.3+meta', 'v1.2.3'), 0);
  assert.ok(Number.isNaN(compareVersions('latest', '1.0.0')));
  assert.equal(parseVersion('main'), null);
});

test('extractors read every kind of pin from the fixture', () => {
  const t = (p) => readFileSync(join(BASE, p), 'utf8');
  assert.deepEqual(setupPins(t('zetaphy-chain/setup-node.sh')),
    { 'setup:COSMOS_EVM_TAG': 'v0.7.3', 'setup:GO_VERSION': '1.26.11', 'setup:WASMVM_VERSION': 'v3.0.9' });
  const patched = new Set();
  const g = embeddedGoMods(t('zetaphy-chain/setup-node.sh'), patched);
  assert.equal(g['gomod:evmd/go.mod:go'], '1.26.11');
  assert.equal(g['gomod:evmd/go.mod:golang.org/x/net'], 'v0.60.0', 'the new side of the diff');
  assert.equal(g['gomod:evmd/go.mod:golang.org/x/crypto'], 'v0.57.0', 'a hunk that starts inside a require block');
  assert.equal(g['gomod:evmd/go.mod:replace:github.com/syndtr/goleveldb'], 'v1.0.1-0.20210819022825-2ae1ddf74ef7');
  assert.equal(g['gomod:go.mod:github.com/cloudflare/circl'], 'v1.6.3', 'the root go.mod of the patch too');
  assert.ok(patched.has('gomod:evmd/go.mod:golang.org/x/net') && !patched.has('gomod:evmd/go.mod:cosmossdk.io/api'), '+ lines vs context');
  assert.ok(!Object.keys(g).some((k) => k.includes('main.go')), 'only go.mod diffs');
  assert.deepEqual(workflowPins(t('.github/workflows/build.yml'), 'w'), { 'workflow:w:go-version:min': '1.25.14', 'workflow:w:go-version:max': '1.26.11' });
  assert.deepEqual(npmPins(t('app/package-lock.json'), 'l'), { 'npm:l:ethers': '6.17.0', 'npm:l:@noble/hashes': '2.2.0' }, 'top level only');
  assert.deepEqual(cargoPins(t('rust/Cargo.lock'), 'c'), { 'cargo:c:serde': '1.0.228', 'cargo:c:syn': '2.0.106' }, 'highest of each crate');
});

test('no change, or upgrades only: exit 0', () => {
  for (const edits of [{}, {
    'zetaphy-chain/setup-node.sh': (s) => s.replace('GO_VERSION="1.26.11"', 'GO_VERSION="1.26.12"').replace('+\tgolang.org/x/net v0.60.0', '+\tgolang.org/x/net v0.61.0'),
    'app/package-lock.json': ['"version": "6.17.0"', '"version": "6.18.0"'],
    'rust/Cargo.lock': ['1.0.228', '1.0.229'],
  }]) {
    const d = head(edits);
    const r = run(d);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no downgrades/);
    rmSync(d, { recursive: true });
  }
});

// The mutation test: every one of these deliberate downgrades must fail the check.
const MUTATIONS = {
  'GO_VERSION':              [{ 'zetaphy-chain/setup-node.sh': ['GO_VERSION="1.26.11"', 'GO_VERSION="1.25.9"'] }, 'setup:GO_VERSION 1.26.11 -> 1.25.9'],
  'COSMOS_EVM_TAG':          [{ 'zetaphy-chain/setup-node.sh': ['COSMOS_EVM_TAG="v0.7.3"', 'COSMOS_EVM_TAG="v0.7.2"'] }, 'setup:COSMOS_EVM_TAG v0.7.3 -> v0.7.2'],
  'evmd go directive':       [{ 'zetaphy-chain/setup-node.sh': ['+go 1.26.11', '+go 1.26.9'] }, 'gomod:evmd/go.mod:go 1.26.11 -> 1.26.9'],
  'evmd require':            [{ 'zetaphy-chain/setup-node.sh': ['+\tgolang.org/x/net v0.60.0', '+\tgolang.org/x/net v0.59.0'] }, 'gomod:evmd/go.mod:golang.org/x/net v0.60.0 -> v0.59.0'],
  'evmd indirect':           [{ 'zetaphy-chain/setup-node.sh': ['+\tgolang.org/x/crypto v0.57.0 // indirect', '+\tgolang.org/x/crypto v0.43.0 // indirect'] }, 'gomod:evmd/go.mod:golang.org/x/crypto v0.57.0 -> v0.43.0'],
  'pseudo-version':          [{ 'zetaphy-chain/setup-node.sh': ['golang.org/x/exp v0.0.0-20260727155853-b88d891fe743', 'golang.org/x/exp v0.0.0-20250101000000-aaaaaaaaaaaa'] }, 'golang.org/x/exp'],
  'replace target':          [{ 'zetaphy-chain/setup-node.sh': ['goleveldb v1.0.1-0.20210819022825-2ae1ddf74ef7', 'goleveldb v1.0.0'] }, 'replace:github.com/syndtr/goleveldb'],
  'patch line dropped':      [{ 'zetaphy-chain/setup-node.sh': ['+\tgolang.org/x/net v0.60.0\n', ''] }, 'pin removed: gomod:evmd/go.mod:golang.org/x/net'],
  'root go.mod':             [{ 'zetaphy-chain/setup-node.sh': ['+\tgithub.com/cloudflare/circl v1.6.3', '+\tgithub.com/cloudflare/circl v1.6.1'] }, 'gomod:go.mod:github.com/cloudflare/circl'],
  'workflow go-version':     [{ '.github/workflows/build.yml': ["go-version: '1.26.11'", "go-version: '1.25.14'"] }, 'go-version:max 1.26.11 -> 1.25.14'],
  'package-lock top level':  [{ 'app/package-lock.json': ['"node_modules/ethers": { "version": "6.17.0" }', '"node_modules/ethers": { "version": "6.16.0" }'] }, 'npm:app/package-lock.json:ethers 6.17.0 -> 6.16.0'],
  'Cargo.lock':              [{ 'rust/Cargo.lock': ['2.0.106', '2.0.100'] }, 'cargo:rust/Cargo.lock:syn 2.0.106 -> 2.0.100'],
};

for (const [name, [edits, want]] of Object.entries(MUTATIONS)) {
  test(`mutation: a deliberate downgrade fails (${name})`, () => {
    const d = head(edits);
    const r = run(d);
    assert.equal(r.code, 1, `exit 1 expected:\n${r.out}`);
    assert.ok(r.out.includes(want), `names it (${want}):\n${r.out}`);
    assert.match(r.out, /FAIL/);
    rmSync(d, { recursive: true });
  });
}

test('the allowlist: a reviewed line with a reason allows exactly that downgrade; no reason is a usage error', () => {
  const d = head({ ...MUTATIONS.GO_VERSION[0], ...MUTATIONS['package-lock top level'][0] });
  let r = run(d, 'setup:GO_VERSION 1.26.11 -> 1.25.9  # 1.26.11 miscompiles on arm64 (go.dev/issue/0), back once fixed\n');
  assert.equal(r.code, 1, 'the npm downgrade is still not allowed');
  assert.match(r.out, /ALLOWED downgrade: setup:GO_VERSION/);
  assert.match(r.out, /FAIL {4}downgrade: npm:app\/package-lock.json:ethers/);
  r = run(d, '# reviewed\nsetup:GO_VERSION * -> *  # reason one\nnpm:app/package-lock.json:ethers 6.17.0 -> 6.16.0 # reason two\n');
  assert.equal(r.code, 0, r.out);
  r = run(d, 'setup:GO_VERSION 1.26.11 -> 1.25.9\n');
  assert.equal(r.code, 2, 'a line without a reason');
  assert.match(r.out, /expected/);
  r = run(d, 'setup:GO_VERSION 1.26.11 -> 1.25.8  # wrong target version\n');
  assert.equal(r.code, 1, 'from/to must match');
  rmSync(d, { recursive: true });
  assert.deepEqual(parseAllowlist('a 1 -> 2 # because').entries, [{ key: 'a', from: '1', to: '2', reason: 'because' }]);
});

test('compare(): context lines that fall out of the patch are not findings; patched pins are', () => {
  const base = { 'gomod:x:a': 'v1.0.0', 'gomod:x:b': 'v2.0.0', 'npm:l:gone': '1.0.0' };
  Object.defineProperty(base, 'patched', { value: new Set(['gomod:x:b']), enumerable: false });
  const f = compare(base, {}, []);
  assert.deepEqual(f.map((x) => x.key), ['gomod:x:b']);
});

test('the shipped allowlist is empty (no reviewed downgrades) and parses', () => {
  const t = readFileSync(join(REPO, 'audit/allow-downgrade.txt'), 'utf8');
  const { entries, errors } = parseAllowlist(t);
  assert.deepEqual(errors, []);
  assert.deepEqual(entries, []);
});

test('the real repository against itself: pins of setup-node.sh, workflows and lock files are all found; no downgrade', { skip: !gitOk() && 'no git' }, () => {
  const pins = collectPins(dirTree(REPO));
  const keys = Object.keys(pins);
  assert.ok(pins['setup:GO_VERSION'], 'GO_VERSION');
  assert.ok(keys.some((k) => k.startsWith('gomod:evmd/go.mod:github.com/cosmos/cosmos-sdk')), 'evmd go.mod requires');
  assert.ok(keys.some((k) => k.startsWith('workflow:.github/workflows/release-zetaphyd.yml:go-version')), 'workflow go-version');
  assert.ok(keys.some((k) => k.startsWith('npm:zetaphy-wallet/package-lock.json:')), 'package-lock');
  assert.ok(keys.some((k) => k.startsWith('cargo:Cargo.lock:')), 'Cargo.lock');
  assert.ok(!keys.some((k) => k.includes('audit/tools/fixtures/')), 'the fixtures are not part of the repository scan');
  assert.deepEqual(compare(pins, pins, []), []);
});

function gitOk() { try { execFileSync('git', ['--version']); return true; } catch { return false; } }
