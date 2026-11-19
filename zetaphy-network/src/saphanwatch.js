// Saphan mainnet checks for the key watch (scripts/key-watch.js, key-watch-mainnet.json `saphan`, docs/KEY-WATCH.md).
// Read only: eth_call, eth_getLogs, eth_getBalance and block headers on the public RPCs; no key, no transaction.
//
// key-watch already alerts on every Paused / Unpaused / Vetoed / GuardianSet / IsmSet / limit / cap event of the
// vaults and synthetics, every CallScheduled of a timelock and every multisig proposal. What an event watch cannot
// see, checked here on each run for every deployed route (saphan-mainnet-state.json):
//   backing          the synthetic's totalSupply on the destination is above what its vault on ZETAPHY holds locked:
//                    ZTPHY that nothing backs exists (a forged mint already paid out)                      CRITICAL
//   forged-mint      a Queued mint on the destination whose source Sent (same nonce, sender, to, amount) is not on
//                    the route's vault on ZETAPHY: a forged message waiting out the mint delay. Veto it before
//                    readyAt (guardian multisig: veto(id) on the synthetic)                                 CRITICAL
//   forged-release   the same the other way: a Queued release on the vault with no matching Sent on the synthetic
//                    (searched back `sourceSearchBlocks` on the destination)                               CRITICAL
//   large            one queued transfer of `largePct` % of that side's daily limit or more                 WARNING
//   near-limit       a side has paid out `nearLimitPct` % of its daily limit today                         WARNING
//   stalled          ZETAPHY's newest block is older than `headMaxAgeMinutes` (the single validator stopped) CRITICAL
//   relayer-gas      the relayer's balance on a chain is under its floor: messages stop being delivered       WARNING
//   neuro-flagged    the sender or the receiver of a queued payout is held in Neuro's ThreatRegistry on ZETAPHY
//                    (isContractHeld): scam-protection says this address is dangerous; veto it before it is ready  CRITICAL
//   unusual-size     learned, not a fixed rule: a transfer `unusualFactor` x the median of the last transfers on that
//                    side (at least `minSamples` of them) and at least 1 % of the daily limit                  WARNING
//   unusual-rate     learned: this run saw many more transfers than the runs before (mean + `rateSigmas` sigma,
//                    at least `minBurst`, after `minSamples` runs)                                               WARNING
// Every CRITICAL alert carries the exact guardian commands (scripts/saphan-guard.js) to paste: veto, then pause.
// Alerts have key-watch's shape ({ key, severity, chain, chainName, title, lines }); its markers keep them from
// being posted twice. The Queued scan has its own cursor per side in state.saphan (the first run takes a baseline).
import { resolve } from 'node:path';
import { Interface, getAddress, formatEther, parseEther, toBeHex, zeroPadValue } from 'ethers';
import * as M from './saphanmainnet.js';

export const EP = new Interface([
  'event Sent(uint256 indexed nonce, address indexed sender, address indexed to, uint256 amount, bytes32 messageId)',
  'event Queued(bytes32 indexed id, uint256 indexed srcNonce, address sender, address indexed to, uint256 amount, uint64 readyAt)',
  'function paused() view returns (bool)',
  'function nonce() view returns (uint256)',
  'function dailyLimit() view returns (uint256)',
  'function paidToday() view returns (uint256)',
  'function locked() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function pending(bytes32) view returns (address to, uint64 readyAt, bool done, bool vetoed, uint256 amount)',
]);
/** Neuro's ThreatRegistry on ZETAPHY (the vault's hold check uses the same view). */
export const THREATS = new Interface(['function isContractHeld(address who) view returns (bool, uint8)']);
const SENT = EP.getEvent('Sent').topicHash, QUEUED = EP.getEvent('Queued').topicHash;
const DEFAULTS = { headMaxAgeMinutes: 15, largePct: 25, nearLimitPct: 80, sourceSearchBlocks: 40_000, maxQueuedBlocksPerRun: 20_000,
  unusualFactor: 10, minSamples: 20, keepSamples: 200, rateSigmas: 4, minBurst: 5 };

/** The guardian commands to paste (docs/KEY-WATCH.md "Saphan: unbacked or forged"): veto `id` (if any), then pause both ends. */
export function guardSteps(route, { vetoId = null, vetoChain = 'dest' } = {}) {
  const run = (c) => `read -rs M; export M; node scripts/saphan-guard.js ${c}; unset M`;
  const out = ['**Guardian steps** (Oracle Cloud Shell, `cd ~/zetaphy/zetaphy-network && git pull`; two guardians, any two of the papers A, B, C):', '```bash'];
  if (vetoId) out.push(`# 1. veto it (first guardian proposes, the second confirms with the number printed)`, run(`veto ${vetoId} --route ${route} --chain ${vetoChain}`), run(`confirm <n> --route ${route} --chain ${vetoChain}`));
  out.push(`# ${vetoId ? 2 : 1}. pause both ends`, run(`pause --route ${route} --chain dest`), run(`confirm <n> --route ${route} --chain dest`),
    run(`pause --route ${route} --chain zetaphy`), run(`confirm <n> --route ${route} --chain zetaphy`), `node scripts/saphan-guard.js status --route ${route}`, '```');
  return out;
}

/** The median of a list of bigints (as decimal strings). */
export function median(xs) {
  const v = xs.map((x) => BigInt(x)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!v.length) return 0n;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2n;
}
const day = (now) => new Date(now).toISOString().slice(0, 10);
const z = (n) => formatEther(n);

/** The routes to check: every deployed route whose destination is a chain of the watch config. */
export function saphanRoutes(watchCfg, base, { cfg, st } = {}) {
  const s = watchCfg.saphan;
  if (!s) return [];
  cfg ??= M.loadMainnet(resolve(base, s.configFile));
  st ??= M.loadState(resolve(base, s.stateFile));
  return M.routeNames(cfg).map((name) => ({ name, d: M.deployedRoute(cfg, st, name), R: M.route(cfg, name) }))
    .filter((r) => r.d).map(({ name, d, R }) => ({ name, chain: s.chainOf?.[name] ?? name, vault: getAddress(d.vault), synthetic: getAddress(d.synthetic),
      vaultBlock: d.vaultBlock ?? 0, displayName: R.displayName, threats: cfg.zetaphy?.threats ? getAddress(cfg.zetaphy.threats) : null }));
}

async function read(rpc, to, fn, args = []) {
  const out = await rpc.call({ to, data: EP.encodeFunctionData(fn, args) });
  const r = EP.decodeFunctionResult(fn, out);
  return r.length === 1 ? r[0] : r;
}

/** Sent(nonce) on `addr`, searched from `fromBlock` (or back `back` blocks from the head) in `chunk` steps; null if absent. */
export async function findSent(rpc, addr, nonce, { fromBlock = null, back = 0, head, chunk = 1999 }) {
  const topics = [SENT, zeroPadValue(toBeHex(nonce), 32)];
  if (fromBlock != null && head - fromBlock <= chunk * 4) {
    const logs = await rpc.getLogs({ address: addr, topics, fromBlock, toBlock: head });
    return logs[0] ? EP.parseLog(logs[0]) : null;
  }
  const low = fromBlock ?? Math.max(0, head - back);
  for (let b = head; b >= low; b -= chunk) {
    const a = Math.max(low, b - chunk + 1);
    const logs = await rpc.getLogs({ address: addr, topics, fromBlock: a, toBlock: b });
    if (logs[0]) return EP.parseLog(logs[0]);
  }
  return null;
}

/**
 * One pass. `watch`: the key-watch config (chains with rpc, `saphan` options); `routes`: saphanRoutes();
 * rpcFor(chain) -> a client with call/getLogs/getBlockNumber/getBlock/getBalance. Returns { state, alerts, log }.
 */
export async function checkSaphan({ watch, routes, rpcFor, state = {}, now = Date.now(), log = () => {} }) {
  const o = { ...DEFAULTS, ...(watch.saphan ?? {}) };
  const sv = structuredClone(state ?? {});
  sv.cursors ??= {};
  const alerts = [];
  const zc = watch.chains.zetaphy;
  if (!zc) return { state: sv, alerts };
  const clients = new Map();
  const client = (key) => { if (!clients.has(key)) clients.set(key, rpcFor(watch.chains[key])); return clients.get(key); };
  const push = (a) => alerts.push(a);
  try {
    const zr = client('zetaphy');
    // ZETAPHY still producing blocks
    let zHead;
    try {
      zHead = await zr.getBlockNumber();
      const blk = await zr.getBlock(zHead);
      const age = (now / 1000 - Number(blk.timestamp)) / 60;
      if (age > o.headMaxAgeMinutes) {
        push({ key: `saphan:stalled:${zHead}`, severity: 'critical', chain: 'zetaphy', chainName: zc.name, title: 'ZETAPHY has stopped producing blocks',
          lines: [`newest block ${zHead} is ${Math.round(age)} minutes old (limit ${o.headMaxAgeMinutes}).`, 'The single validator or its sentry is down: check `sudo systemctl status zetaphyd` on the validator. Bridge messages wait; nothing is lost.'] });
      }
    } catch (e) { log(`saphan: ZETAPHY head: ${e.shortMessage ?? e.message}`); return { state: sv, alerts }; }

    for (const r of routes) {
      const dc = watch.chains[r.chain];
      if (!dc) { log(`saphan: route ${r.name}: no chain ${r.chain} in the watch config`); continue; }
      const dr = client(r.chain);
      let dHead;
      try { dHead = await dr.getBlockNumber(); } catch (e) { log(`saphan: ${r.name}: ${dc.name} unreachable (${e.shortMessage ?? e.message})`); continue; }
      const L = (c) => ({ addr: (a) => (c.explorer ? `[${a}](${c.explorer}/address/${a})` : `\`${a}\``), tx: (h) => (c.explorer ? `[${h.slice(0, 12)}…](${c.explorer}/tx/${h})` : `\`${h}\``) });
      // backing: supply on the destination <= locked in the vault
      let locked, supply, vLimit, vPaid, sLimit, sPaid, sNonce;
      try {
        [locked, vLimit, vPaid] = await Promise.all([read(zr, r.vault, 'locked'), read(zr, r.vault, 'dailyLimit'), read(zr, r.vault, 'paidToday')]);
        [supply, sLimit, sPaid, sNonce] = await Promise.all([read(dr, r.synthetic, 'totalSupply'), read(dr, r.synthetic, 'dailyLimit'), read(dr, r.synthetic, 'paidToday'), read(dr, r.synthetic, 'nonce')]);
      } catch (e) { log(`saphan: ${r.name}: read failed (${e.shortMessage ?? e.message})`); continue; }
      if (supply > locked) {
        push({ key: `saphan:backing:${r.name}:${supply}`, severity: 'critical', chain: r.chain, chainName: dc.name, title: `UNBACKED ZTPHY on ${dc.name}`,
          lines: [`${L(dc).addr(r.synthetic)} totalSupply **${z(supply)}** ZTPHY > ${z(locked)} locked in its vault ${L(zc).addr(r.vault)} on ZETAPHY (+${z(supply - locked)}).`,
            'A forged message was paid out. PAUSE BOTH ENDS NOW with the guardians (docs/KEY-WATCH.md → "Saphan: unbacked or forged"), then find the message.', ...guardSteps(r.name)] });
      }
      for (const [side, limit, paid, c] of [['the vault (releases on ZETAPHY)', vLimit, vPaid, zc], [`the synthetic (mints on ${dc.name})`, sLimit, sPaid, dc]]) {
        if (limit > 0n && paid * 100n >= limit * BigInt(o.nearLimitPct)) {
          push({ key: `saphan:near-limit:${r.name}:${c === zc ? 'vault' : 'synthetic'}:${day(now)}`, severity: 'warning', chain: c === zc ? 'zetaphy' : r.chain, chainName: c.name,
            title: `${r.name} route: ${side} near its daily limit`, lines: [`paid today ${z(paid)} of ${z(limit)} ZTPHY (${Number((paid * 1000n) / limit) / 10} %). More waits for tomorrow (UTC).`] });
        }
      }
      // queued mints on the destination and releases on ZETAPHY since the last run: each must match a Sent on the other end
      for (const side of ['mint', 'release']) {
        const isMint = side === 'mint';
        const rpc = isMint ? dr : zr, at = isMint ? r.synthetic : r.vault, head = isMint ? dHead : zHead, c = isMint ? dc : zc;
        const ck = `${r.name}:${side}`;
        const conf = c.confirmations ?? watch.defaults?.confirmations ?? 2;
        const safe = Math.max(0, head - conf);
        if (sv.cursors[ck] == null) { sv.cursors[ck] = safe; continue; } // baseline
        let from = sv.cursors[ck] + 1;
        if (safe - from + 1 > o.maxQueuedBlocksPerRun) {
          push({ key: `saphan:gap:${ck}:${from}`, severity: 'warning', chain: isMint ? r.chain : 'zetaphy', chainName: c.name, title: `${r.name} route: ${side}s not checked for ${safe - from + 1} blocks`,
            lines: [`The watch fell behind; Queued ${side}s in blocks ${from}–${safe - o.maxQueuedBlocksPerRun} were not checked against their source. Check them by hand (\`pending(id)\`).`] });
          from = safe - o.maxQueuedBlocksPerRun + 1;
        }
        const chunk = c.logChunk ?? watch.defaults?.logChunk ?? 1999;
        sv.learn ??= {};
        const learn = (sv.learn[ck] ??= { amounts: [], runs: 0, mean: 0, m2: 0 });
        let runCount = 0;
        let ok = true;
        for (let a = from; a <= safe && ok; a += chunk) {
          const b = Math.min(safe, a + chunk - 1);
          let logs;
          try { logs = await rpc.getLogs({ address: at, topics: [QUEUED], fromBlock: a, toBlock: b }); } catch (e) { log(`saphan: ${ck}: logs ${a}-${b}: ${e.shortMessage ?? e.message}`); ok = false; break; }
          for (const lg of logs) {
            const q = EP.parseLog(lg).args;
            const amount = q.amount, limit = isMint ? sLimit : vLimit;
            let src = null, err = null;
            try {
              src = isMint ? await findSent(zr, r.vault, q.srcNonce, { fromBlock: r.vaultBlock, head: zHead, chunk: zc.logChunk ?? 1999 })
                : (q.srcNonce >= sNonce ? null : await findSent(dr, r.synthetic, q.srcNonce, { back: o.sourceSearchBlocks, head: dHead, chunk: dc.logChunk ?? 1999 }));
            } catch (e) { err = e.shortMessage ?? e.message; }
            const matches = src && getAddress(src.args.sender) === getAddress(q.sender) && getAddress(src.args.to) === getAddress(q.to) && src.args.amount === amount;
            const where = `${L(c).addr(at)}, tx ${L(c).tx(lg.transactionHash)}`;
            const what = `id \`${q.id}\`, source nonce ${q.srcNonce}, ${z(amount)} ZTPHY from ${q.sender} to ${q.to}, ready at ${new Date(Number(q.readyAt) * 1000).toISOString()}`;
            // Neuro: is either end held in the ThreatRegistry (a flagged scam contract or address)?
            if (r.threats) {
              const held = [];
              for (const [role, a] of [['sender', q.sender], ['receiver', q.to]]) {
                try {
                  const out = await zr.call({ to: r.threats, data: THREATS.encodeFunctionData('isContractHeld', [a]) });
                  const [h, level] = THREATS.decodeFunctionResult('isContractHeld', out);
                  if (h) held.push(`${role} ${a} (level ${level})`);
                } catch (e) { log(`saphan: ${ck}: Neuro check of ${a}: ${e.shortMessage ?? e.message}`); }
              }
              if (held.length) {
                push({ key: `saphan:neuro-flagged:${ck}:${q.id}`, severity: 'critical', chain: isMint ? r.chain : 'zetaphy', chainName: c.name,
                  title: `${r.name} route: queued ${side} involves an address Neuro flags`,
                  lines: [`${what} (${where}).`, `Held in Neuro's ThreatRegistry ${L(zc).addr(r.threats)}: ${held.join('; ')}.`,
                    'Scam protection says this address is dangerous (a drainer, a phishing contract, a stolen-funds wallet). Veto the payout before it is ready unless you know better.',
                    ...guardSteps(r.name, { vetoId: q.id, vetoChain: isMint ? 'dest' : 'zetaphy' })] });
              }
            }
            if (err) {
              push({ key: `saphan:unverified:${ck}:${q.id}`, severity: 'high', chain: isMint ? r.chain : 'zetaphy', chainName: c.name, title: `${r.name} route: queued ${side} could not be checked`,
                lines: [`${what} (${where}).`, `Its source could not be read (${err}). Check it by hand before it is ready; veto it if it has no source.`] });
            } else if (!matches) {
              const back = !isMint && q.srcNonce < sNonce ? ` (searched the last ${o.sourceSearchBlocks} blocks of ${dc.name})` : '';
              push({ key: `saphan:forged:${ck}:${q.id}`, severity: 'critical', chain: isMint ? r.chain : 'zetaphy', chainName: c.name,
                title: `FORGED ${side.toUpperCase()} queued on ${c.name} (${r.name} route)`,
                lines: [`${what} (${where}).`, src ? `The source Sent with that nonce says otherwise: ${z(src.args.amount)} ZTPHY from ${src.args.sender} to ${src.args.to}.` : `No Sent with nonce ${q.srcNonce} on the other end${back}.`,
                  `VETO IT before it is ready: guardian multisig → \`veto(${q.id})\` on ${at}, then pause both ends (docs/KEY-WATCH.md → "Saphan: unbacked or forged").`,
                  ...guardSteps(r.name, { vetoId: q.id, vetoChain: isMint ? 'dest' : 'zetaphy' })] });
            } else {
              const ls = learn.amounts;
              if (limit > 0n && amount * 100n >= limit * BigInt(o.largePct)) {
                push({ key: `saphan:large:${ck}:${q.id}`, severity: 'warning', chain: isMint ? r.chain : 'zetaphy', chainName: c.name, title: `${r.name} route: large ${side} queued`,
                  lines: [`${what} (${where}).`, `${Number((amount * 1000n) / limit) / 10} % of the daily limit; it matches its source Sent. Nothing to do if you expected it.`] });
              } else if (ls.length >= o.minSamples) {
                const med = median(ls);
                if (med > 0n && amount >= med * BigInt(o.unusualFactor) && (limit === 0n || amount * 100n >= limit)) {
                  push({ key: `saphan:unusual-size:${ck}:${q.id}`, severity: 'warning', chain: isMint ? r.chain : 'zetaphy', chainName: c.name, title: `${r.name} route: unusually big ${side}`,
                    lines: [`${what} (${where}).`, `${Number((amount * 10n) / med) / 10} x the median of the last ${ls.length} ${side}s (${z(med)} ZTPHY). It matches its source Sent; a sudden change in how the bridge is used is worth a look.`] });
                }
              }
              ls.push(amount.toString());
              if (ls.length > o.keepSamples) ls.splice(0, ls.length - o.keepSamples);
              runCount++;
            }
          }
          sv.cursors[ck] = b;
        }
        // the rate: transfers per run against the runs before (Welford mean and variance), learned only on full runs
        if (ok) {
          if (learn.runs >= o.minSamples && runCount >= o.minBurst) {
            const sd = Math.sqrt(learn.m2 / Math.max(1, learn.runs - 1));
            if (runCount > learn.mean + o.rateSigmas * sd + 1) {
              push({ key: `saphan:unusual-rate:${ck}:${sv.cursors[ck]}`, severity: 'warning', chain: isMint ? r.chain : 'zetaphy', chainName: c.name, title: `${r.name} route: a burst of ${side}s`,
                lines: [`${runCount} ${side}s queued since the last run; usually ${learn.mean.toFixed(1)} (σ ${sd.toFixed(1)}) over ${learn.runs} runs. All match their source Sent. A burst can be a campaign — or someone draining before a pause: check who is sending.`] });
            }
          }
          learn.runs++;
          const d1 = runCount - learn.mean;
          learn.mean += d1 / learn.runs;
          learn.m2 += d1 * (runCount - learn.mean);
        }
      }
    }
    // the relayer's gas on every chain it pays on
    for (const [key, floor] of Object.entries(o.relayerFloor ?? {})) {
      if (!o.relayer || !watch.chains[key]) continue;
      try {
        const bal = await client(key).getBalance(o.relayer);
        if (bal < parseEther(String(floor))) {
          push({ key: `saphan:relayer-gas:${key}:${day(now)}`, severity: 'warning', chain: key, chainName: watch.chains[key].name, title: `relayer low on gas on ${watch.chains[key].name}`,
            lines: [`relayer ${o.relayer}: ${z(bal)} (floor ${floor}). Below it, bridge messages stop being delivered. Send it gas.`] });
        }
      } catch (e) { log(`saphan: relayer balance on ${key}: ${e.shortMessage ?? e.message}`); }
    }
  } finally { for (const c of clients.values()) c.destroy?.(); }
  return { state: sv, alerts };
}

