// setup-runner.sh copies only some zetaphy-hub files next to the runner's code: that list must hold every
// hub file zetaphy-network imports (directly or through another hub file), or the runner breaks at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NET = join(dirname(fileURLToPath(import.meta.url)), '..');
const HUB = join(NET, '..', 'zetaphy-hub');

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'test', 'artifacts'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, out); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

function hubImports() {
  const need = new Set();
  const todo = [];
  for (const f of jsFiles(NET)) for (const m of readFileSync(f, 'utf8').matchAll(/['"](?:\.\.\/)+zetaphy-hub\/([\w./-]+\.js)['"]/g)) todo.push(m[1]);
  while (todo.length) {
    const f = todo.pop();
    if (need.has(f)) continue;
    need.add(f);
    const src = readFileSync(join(HUB, f), 'utf8');
    const base = dirname(f) === '.' ? '' : `${dirname(f)}/`;
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([\w./-]+\.js)['"]/g)) todo.push(base + m[1]);
  }
  return [...need].sort();
}

test('setup-runner.sh copies every zetaphy-hub file the network code imports', () => {
  const sh = readFileSync(join(NET, 'setup-runner.sh'), 'utf8');
  const loop = /for f in ([^;]+); do\s*\n\s*cp "\$src\/zetaphy-hub\/\$f"/.exec(sh);
  assert.ok(loop, 'the copy loop is in setup-runner.sh');
  const copied = loop[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean).sort();
  assert.deepEqual(copied, hubImports());
});

test('setup-runner.sh defaults to ZETAPHY mainnet: its public RPC and the NeuroJobs and RewardVault of 3659.contracts.json', () => {
  const sh = readFileSync(join(NET, 'setup-runner.sh'), 'utf8');
  const main = JSON.parse(readFileSync(join(NET, '..', 'zetaphy-launch', 'state', '3659.contracts.json'), 'utf8'));
  const dflt = (v) => new RegExp(`^${v}="\\$\\{ZETAPHY_${v}:-([^}]+)\\}"`, 'm').exec(sh)?.[1];
  assert.equal(dflt('RPC'), 'https://129-221-199-191.sslip.io');
  assert.equal(dflt('JOBS'), main.contracts.neuroJobs);
  assert.equal(dflt('VAULT'), main.contracts.rewardVault);
  assert.doesNotMatch(sh, /sawasdeecoin|77390/, 'no testnet left in the runner installer');
});
