// The runner on ZETAPHY mainnet (chain 3659; the public testnet was shut down on 2026-11-14), through the real
// command line against an in-memory JSON-RPC node at chain id 3659 with NeuroJobs deployed: `node status` works,
// `node start --auto-register` on an unfunded key only waits for its bond (no transaction is sent), a deploy
// (a command whose contracts are not on mainnet) is refused in plain words, and another chain is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRpcChain, serveRpc, ZETA } from './helpers/rpcchain.js';

const run = promisify(execFile);
const CLI = new URL('../cli.js', import.meta.url).pathname;

test('runner on mainnet (3659): status, waits for funds without sending anything; deploys and other chains refused', { timeout: 120_000 }, async () => {
  const c = await createRpcChain({ chainId: 3659, accounts: 2 });
  const jobs = await c.deploy('NeuroJobs', [100n * ZETA, ZETA, ZETA / 10n, 120n, 600n, 3600n, 100n * ZETA]);
  const J = await jobs.getAddress();
  const methods = [];
  const node = await serveRpc({ handle: (m, p) => { methods.push(m); return c.handle(m, p); } }, 18131);
  const other = await createRpcChain({ chainId: 1, accounts: 1 });
  const otherNode = await serveRpc(other, 18132);
  const home = mkdtempSync(join(tmpdir(), 'zetaphy-runner-main-'));
  const env = { ...process.env, ZETAPHY_HOME: home };
  try {
    const cli = (args) => run(process.execPath, [CLI, ...args], { env });
    const status = (await cli(['node', 'status', '--rpc', node.url, '--jobs', J])).stdout;
    const me = /^runner: +(0x[0-9a-fA-F]{40})/m.exec(status)?.[1];
    assert.ok(me, status);
    assert.match(status, /bond: +0\.0 ZETAPHY \(not registered\)/);

    // the service's command: waits for the bond (100 + 0.1 gas), sends nothing
    const p = spawn(process.execPath, [CLI, 'node', 'start', '--auto-register', '--fund-poll', '1', '--rpc', node.url, '--jobs', J], { env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t0 = Date.now();
    while (!/waiting for funds/.test(out) && Date.now() - t0 < 60_000 && p.exitCode == null) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 2500)); // a few more polls
    p.kill();
    assert.match(out, new RegExp(`waiting for funds: send 100\\.1 ZETAPHY \\(or more\\) to ${me}; the bond is 100\\.0 ZETAPHY`), out);
    assert.doesNotMatch(out, /testnet/i);
    assert.ok(!methods.includes('eth_sendRawTransaction') && !methods.includes('eth_sendTransaction'), `nothing sent: ${[...new Set(methods)]}`);
    assert.equal((await jobs.workers(me)).active, false);

    // a deploy makes contracts that are not on mainnet: refused before anything is signed
    await assert.rejects(cli(['deploy', '--rpc', node.url]), (e) => /ZETAPHY mainnet \(chain 3659\).*not on mainnet yet.*refuses to act on mainnet/s.test(e.stderr + e.stdout));
    assert.ok(!methods.includes('eth_sendRawTransaction'));
    // another chain: refused for the runner commands too
    await assert.rejects(cli(['node', 'status', '--rpc', otherNode.url, '--jobs', J]),
      (e) => /that RPC is chain 1, not ZETAPHY mainnet \(3659\) or a local ZETAPHY devnet \(77390\)/.test(e.stderr + e.stdout));
  } finally {
    await node.close();
    await otherNode.close();
    rmSync(home, { recursive: true, force: true });
  }
});
