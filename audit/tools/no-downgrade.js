#!/usr/bin/env node
// L1-4: no dependency downgrades. Compares the version pins of a base tree with a head tree and fails when any
// version goes DOWN, unless the downgrade is listed (with a reason) in audit/allow-downgrade.txt.
//
// What is compared (each "pin" has a stable key; a key in both trees must not get a lower version):
//   setup:<VAR>                 zetaphy-chain/setup-node.sh shell pins: GO_VERSION, *_VERSION, *_TAG ("v1.2.3" / "1.2.3")
//   gomod:<file>:go             the `go` directive of every go.mod diff embedded in setup-node.sh (evmd/go.mod, go.mod, …)
//   gomod:<file>:toolchain      its `toolchain` directive
//   gomod:<file>:<module>       every require / replace target, read from the NEW side of the embedded diff (context and
//                               "+" lines). A module the base patch pinned that the head patch no longer mentions falls
//                               back to the (older) upstream version: reported as "pin removed" and refused, too.
//   gomod-file:<path>:<module>  plain go.mod files in the repository (if any)
//   workflow:<file>:go-version  `go-version:` pins in .github/workflows/*.yml (the lowest and the highest per file)
//   npm:<lock>:<package>        top-level packages ("node_modules/<name>", not nested) of every package-lock.json
//   cargo:<lock>:<crate>        the highest version of each crate in every Cargo.lock
//
// Usage
//   node audit/tools/no-downgrade.js --base-ref origin/main [--head-ref HEAD]   (reads files with `git show`)
//   node audit/tools/no-downgrade.js --base-dir <dir> --head-dir <dir>          (fixtures, tests)
//   [--allow audit/allow-downgrade.txt] [--json]
// Exit: 0 no downgrade (or every one allowed), 1 a downgrade, 2 usage / read error.
//
// Allowlist lines:  <key> <from> -> <to>  # <reason>   (the reason is required; '*' matches any from/to)
// Node's standard library only.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FIXTURES = 'audit/tools/fixtures/'; // this tool's own test trees
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'target', 'dist', 'vendor', 'out', 'cache']);

// ---------------------------------------------------------------- versions

/** Parses "v1.2.3-rc.1+meta", "1.26.11", "go1.26.11", Go pseudo-versions. null when not a version. */
export function parseVersion(s) {
  if (s == null) return null;
  const m = String(s).trim().replace(/^go(?=\d)/, '').match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return { major: +m[1], minor: +(m[2] ?? 0), patch: +(m[3] ?? 0), pre: m[4] ? m[4].split('.') : [] };
}

/** Semver precedence (pre-releases, incl. Go pseudo-versions, sort before the release). NaN if either is not a version. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return NaN;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : (x.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { const d = BigInt(p) - BigInt(q); if (d) return d < 0n ? -1 : 1; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------- extractors

/** Shell pins of setup-node.sh: VAR="value" for *_VERSION and *_TAG. */
export function setupPins(text) {
  const out = {};
  for (const m of text.matchAll(/^([A-Z][A-Z0-9_]*(?:_VERSION|_TAG))="([^"]+)"/gm)) if (parseVersion(m[2])) out[`setup:${m[1]}`] = m[2];
  return out;
}

/** go.mod directives: go, toolchain, require and replace targets. `lines`: the file's lines (no diff markers). */
export function goModPins(lines, prefix, patched) {
  const out = {};
  let block = null;
  let plus = false;
  for (const item of lines) {
    const raw = typeof item === 'string' ? item : item.t;
    plus = typeof item === 'string' ? false : item.plus;
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    let m;
    if (block) {
      if (line === ')') { block = null; continue; }
      take(block, line);
      continue;
    }
    if ((m = line.match(/^(require|replace)\s*\($/))) { block = m[1]; continue; }
    if ((m = line.match(/^go\s+(\S+)$/))) { put(`${prefix}:go`, m[1]); continue; }
    if ((m = line.match(/^toolchain\s+(\S+)$/))) { put(`${prefix}:toolchain`, m[1].replace(/^go/, '')); continue; }
    if ((m = line.match(/^(require|replace)\s+(.+)$/))) take(m[1], m[2]);
  }
  function put(k, v) { out[k] = v; if (plus && patched) patched.add(k); }
  function take(kind, l) {
    let m;
    if (kind === 'replace') {
      if ((m = l.match(/^(\S+)(?:\s+\S+)?\s+=>\s+(\S+)\s+(\S+)$/))) put(`${prefix}:replace:${m[1]}`, m[3]);
      return; // a replace by a local path has no version
    }
    if ((m = l.match(/^(\S+)\s+(\S+)$/)) && parseVersion(m[2])) put(`${prefix}:${m[1]}`, m[2]);
  }
  return out;
}

/** Every go.mod diff embedded in a script (git diff format): the new side of its hunks. `patched` collects the keys
 *  the patch itself sets ("+" lines), as opposed to unchanged upstream context. */
export function embeddedGoMods(text, patched = new Set()) {
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^diff --git a\/(\S*go\.mod) b\/(\S*go\.mod)$/);
    if (!m) continue;
    const file = m[2];
    const body = [];
    for (i++; i < lines.length && !lines[i].startsWith('diff --git ') && !/^[A-Z_]+$/.test(lines[i]); i++) {
      const l = lines[i];
      if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('index ') || l.startsWith('@@')) { if (l.startsWith('@@')) body.push({ t: ')', plus: false }); continue; }
      if (l.startsWith('+') || l.startsWith(' ')) body.push({ t: l.slice(1), plus: l[0] === '+' });
      else if (l === '') body.push({ t: '', plus: false });
    }
    i--;
    // a hunk may start inside a require ( … ) block: lines that look like "module version" are requires there
    const fixed = [];
    let inBlock = false;
    for (const l of body) {
      const t = l.t.replace(/\/\/.*$/, '').trim();
      if (/^(require|replace)\s*\($/.test(t)) inBlock = true;
      else if (t === ')') { if (!inBlock) continue; inBlock = false; }
      else if (!inBlock && /^\S+\s+v\S+$/.test(t) && !/^(go|toolchain|module|require|replace|exclude|retract|godebug)\s/.test(t)) { fixed.push({ t: `require ${t}`, plus: l.plus }); continue; }
      fixed.push(l);
    }
    Object.assign(out, goModPins(fixed, `gomod:${file}`, patched));
  }
  return out;
}

/** `go-version:` pins of one workflow file: the lowest and the highest. */
export function workflowPins(text, file) {
  const vs = [...text.matchAll(/^\s*go-version:\s*['"]?([0-9][0-9A-Za-z.\-]*)['"]?\s*$/gm)].map((m) => m[1]).filter(parseVersion);
  if (!vs.length) return {};
  vs.sort(compareVersions);
  return { [`workflow:${file}:go-version:min`]: vs[0], [`workflow:${file}:go-version:max`]: vs[vs.length - 1] };
}

/** Top-level packages of a package-lock.json (lockfileVersion 2/3 "packages", or v1 "dependencies"). */
export function npmPins(text, file) {
  let j;
  try { j = JSON.parse(text); } catch { return {}; }
  const out = {};
  if (j.packages) {
    for (const [p, v] of Object.entries(j.packages)) {
      const m = p.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/);
      if (m && v.version && parseVersion(v.version) && !v.link) out[`npm:${file}:${m[1]}`] = v.version;
    }
  } else if (j.dependencies) {
    for (const [n, v] of Object.entries(j.dependencies)) if (v.version && parseVersion(v.version)) out[`npm:${file}:${n}`] = v.version;
  }
  return out;
}

/** The highest version of each crate in a Cargo.lock. */
export function cargoPins(text, file) {
  const out = {};
  for (const m of text.matchAll(/\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g)) {
    const k = `cargo:${file}:${m[1]}`;
    if (!out[k] || compareVersions(m[2], out[k]) > 0) out[k] = m[2];
  }
  return out;
}

// ---------------------------------------------------------------- trees

/** A tree: list() -> repo-relative paths (posix), read(path) -> text or null. */
export function dirTree(root) {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (SKIP_DIRS.has(n)) continue;
      const p = join(d, n);
      const st = statSync(p);
      const rel = relative(root, p).split(sep).join('/');
      if (rel.startsWith(FIXTURES)) continue;
      if (st.isDirectory()) walk(p); else files.push(rel);
    }
  };
  if (existsSync(root)) walk(root);
  return { list: () => files, read: (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return null; } } };
}

export function gitTree(ref, cwd = process.cwd()) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const files = git('ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean)
    .filter((p) => !p.split('/').some((s) => SKIP_DIRS.has(s)) && !p.startsWith(FIXTURES));
  return { list: () => files, read: (p) => { try { return git('show', `${ref}:${p}`); } catch { return null; } } };
}

const isGoMod = (p) => /(^|\/)go\.mod$/.test(p);
const isWorkflow = (p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p);
const isNpmLock = (p) => /(^|\/)package-lock\.json$/.test(p);
const isCargoLock = (p) => /(^|\/)Cargo\.lock$/.test(p);

/** Every pin of a tree. Non-enumerable `patched`: the embedded go.mod keys the chain patch itself sets. */
export function collectPins(tree) {
  const pins = {};
  const patched = new Set();
  Object.defineProperty(pins, 'patched', { value: patched, enumerable: false });
  const setup = tree.read('zetaphy-chain/setup-node.sh');
  if (setup != null) Object.assign(pins, setupPins(setup), embeddedGoMods(setup, patched));
  for (const p of tree.list()) {
    const want = isGoMod(p) || isWorkflow(p) || isNpmLock(p) || isCargoLock(p);
    if (!want) continue;
    const t = tree.read(p);
    if (t == null) continue;
    if (isGoMod(p)) Object.assign(pins, goModPins(t.split('\n'), `gomod-file:${p}`));
    else if (isWorkflow(p)) Object.assign(pins, workflowPins(t, p));
    else if (isNpmLock(p)) Object.assign(pins, npmPins(t, p));
    else Object.assign(pins, cargoPins(t, p));
  }
  return pins;
}

// ---------------------------------------------------------------- allowlist + compare

/** Allowlist entries: { key, from, to, reason }. Lines without a reason are errors. */
export function parseAllowlist(text) {
  const entries = [], errors = [];
  for (const [i, raw] of (text ?? '').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s*->\s*(\S+)\s*#\s*(\S.*)$/);
    if (!m) { errors.push(`allowlist line ${i + 1}: expected "<key> <from> -> <to>  # <reason>": ${line}`); continue; }
    entries.push({ key: m[1], from: m[2], to: m[3], reason: m[4].trim() });
  }
  return { entries, errors };
}

const allowed = (allow, f) => allow.find((e) => e.key === f.key && (e.from === '*' || e.from === f.from) && (e.to === '*' || e.to === (f.to ?? '(removed)')));

/** Downgrades from base to head: [{ key, from, to, kind: 'downgrade'|'pin removed', allowedBy? }]. */
export function compare(base, head, allow = []) {
  const findings = [];
  for (const [key, from] of Object.entries(base)) {
    const to = head[key];
    if (to === undefined) {
      // only a pin of the chain patch falls back to something older when it disappears; elsewhere a removed
      // dependency is just gone
      // (a line that was only unchanged upstream context in the base patch stays upstream's: not a finding)
      const patchedPin = key.startsWith('setup:') || (key.startsWith('gomod:') && (!base.patched || base.patched.has(key)));
      if (patchedPin) findings.push({ key, from, to: null, kind: 'pin removed' });
      continue;
    }
    const c = compareVersions(to, from);
    if (c < 0) findings.push({ key, from, to, kind: 'downgrade' });
  }
  for (const f of findings) { const a = allowed(allow, f); if (a) f.allowedBy = a.reason; }
  return findings;
}

// ---------------------------------------------------------------- CLI

function main(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const baseRef = arg('--base-ref'), headRef = arg('--head-ref'), baseDir = arg('--base-dir'), headDir = arg('--head-dir');
  const allowPath = arg('--allow') ?? 'audit/allow-downgrade.txt';
  if (!(baseRef || baseDir)) { console.error('usage: no-downgrade.js (--base-ref <ref> [--head-ref <ref>] | --base-dir <d> --head-dir <d>) [--allow <file>] [--json]'); return 2; }
  let base, head, allowText;
  try {
    base = collectPins(baseDir ? dirTree(baseDir) : gitTree(baseRef));
    head = collectPins(headDir ? dirTree(headDir) : headRef ? gitTree(headRef) : dirTree(process.cwd()));
    allowText = existsSync(allowPath) ? readFileSync(allowPath, 'utf8') : '';
  } catch (e) { console.error(`no-downgrade: ${e.message}`); return 2; }
  const { entries, errors } = parseAllowlist(allowText);
  if (errors.length) { console.error(errors.join('\n')); return 2; }
  const findings = compare(base, head, entries);
  const bad = findings.filter((f) => !f.allowedBy);
  if (argv.includes('--json')) console.log(JSON.stringify({ pins: { base: Object.keys(base).length, head: Object.keys(head).length }, findings }, null, 2));
  else {
    console.log(`no-downgrade: ${Object.keys(base).length} base pins, ${Object.keys(head).length} head pins compared`);
    for (const f of findings) console.log(`${f.allowedBy ? 'ALLOWED' : 'FAIL   '} ${f.kind}: ${f.key} ${f.from} -> ${f.to ?? '(removed)'}${f.allowedBy ? `  (${f.allowedBy})` : ''}`);
    if (bad.length) console.log(`\n${bad.length} downgrade(s). Move the version back up, or add a line to ${allowPath}:\n  <key> <from> -> <to>  # <why this downgrade is safe>  (reviewed in the PR)`);
    else console.log('no downgrades');
  }
  return bad.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
export { main };
