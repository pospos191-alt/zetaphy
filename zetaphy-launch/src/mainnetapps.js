// The hub's offline, audit, quantum and immune tabs' contracts on mainnet (docs/ZETAPHY-MAINNET-PROCEDURE.md 16.11),
// after the AI map's steps and before `contracts`, by the same `launch.js --network mainnet --resume`. Deployed as the
// testnet tooling deploys them (zetaphy-network/src/offlinedeploy.js, auditnetops.js `zetaphy deploy-audit`,
// frontierdeploy.js FRONTIER_STEPS), with the mainnet launch's rules:
//   - every governance role is the existing ZetaphyTimelock, in the constructor (none of these contracts needs a set-up
//     call by the deployer first); the ones with no owner at all (the offline contracts, AuditRunners) have nothing to
//     hand over; none of them has a guardian or a pause, and none starts paused on the testnet either;
//   - nothing mints; every contract that holds user funds has its own way back out (a cheque channel's payer withdraws
//     the remainder after the close, an offline-cash issuer reclaims expired notes and bonds, an audit sponsor reclaims
//     an unused pool, an escrow in QuantumRescue is claimed by its account);
//   - each contract is saved in the state the moment it is deployed (state.steps.<step>.partial), so a step that stops
//     half way resumes with the same contracts. The audit network is four contracts whose first one takes the other
//     three's addresses, computed from the deployer's next nonces (as `zetaphy deploy-audit`): the step saves that nonce
//     before its first transaction and a resume finishes the four at those addresses.
// Skipped on mainnet, with the reason in the plan (APP_EXCLUDED, and ImmuneBroadcaster without a Hyperlane Mailbox).

import { Contract, getAddress, getCreateAddress, Interface, ZeroAddress } from 'ethers';
import { outputs } from './runner.js';
import { art, NET, signer, same } from './steps.js';
import { later, dep, deployOne } from './plan.js';
import { NETWORK_PARAMS, JUDGE_PARAMS, LEVELS } from '../../zetaphy-network/src/auditnetops.js';
import { FRONTIER_DEFAULTS, SECURITY_PRECOMPILE } from '../../zetaphy-network/src/frontierdeploy.js';

export const APP_STEPS = ['offline', 'auditnet', 'qrescue', 'immune'];

/** The hub-config.json `contracts` keys these steps fill (zetaphy-hub/build.mjs HUB_CONTRACT_KEYS). */
export const APP_HUB_KEYS = ['zetaphyCheques', 'offlineOrders', 'offlineCash', 'auditNetwork', 'auditRunners', 'auditJudges', 'auditCertificate', 'quantumRescue', 'immuneRegistry', 'immuneBroadcaster'];

/** Not deployed on mainnet whatever the config says, and why (printed in the plan, written to the contracts file). */
export const APP_EXCLUDED = [
  ['immuneVaccines', 'ImmuneVaccines says TESTNET ONLY in its own source, and one of its three confirmations is HackInsurance, which is not on mainnet'],
  ['immuneMirror', 'ImmuneMirror lives on each other chain (that chain\'s Mailbox and our ISM), not on ZETAPHY'],
  ['pqSettlement', 'not a contract the hub calls (the Quantum tab uses QuantumRescue only); the testnet record keeps it for the settlement prototype'],
  ['circuitBreaker', 'self-healing (docs/future/self-healing.md), not part of the immune tab: guardian bonds from runners, left for its own step'],
];
const NO_MAILBOX = 'no Hyperlane Mailbox on this chain (deploy config ai.mailbox): ImmuneBroadcaster sends flags to the other chains\' mirrors through one';

/** The deploy-config section `apps` (all optional). `addr`, `int`, `only`: src/mainnet.js's checkers. */
export function appsConfig(raw, { only, addr, int }, { communityFund }) {
  const a = only(raw ?? {}, ['auditTreasury', 'auditRunnerMinAgreed', 'rescueMaturity', 'immuneMinAgreed'], 'apps');
  return {
    auditTreasury: a.auditTreasury == null ? communityFund : addr(a.auditTreasury, 'apps.auditTreasury'),
    auditRunnerMinAgreed: int(a.auditRunnerMinAgreed ?? 1, 'apps.auditRunnerMinAgreed', 1, 2 ** 32 - 1),
    rescueMaturity: int(a.rescueMaturity ?? FRONTIER_DEFAULTS.rescueMaturity, 'apps.rescueMaturity', 1, 10_000_000),
    immuneMinAgreed: int(a.immuneMinAgreed ?? FRONTIER_DEFAULTS.immuneMinAgreed, 'apps.immuneMinAgreed', 2, 255),
  };
}
export const appsRoleHolders = (apps) => [['apps.auditTreasury', [apps.auditTreasury]]];

const LABEL = { timelock: 'ZetaphyTimelock', neuroJobs: 'NeuroJobs', threatRegistry: 'ThreatRegistry', router: 'the DEX router', workerReputation: 'WorkerReputation',
  auditNetwork: 'AuditNetwork', auditRunners: 'AuditRunners (the deployer\'s nonce + 1)', auditJudges: 'AuditJudges (nonce + 2)', auditCertificate: 'AuditCertificate (nonce + 3)',
  immuneRegistry: 'ImmuneRegistry' };
const refs = (o, r) => new Proxy({}, { get: (_t, k) => r[k] ?? o[k] ?? later(LABEL[k] ?? k) });
const TL = 'governance = the ZetaphyTimelock in the constructor';

const CONTRACT = { zetaphyCheques: 'ZetaphyCheques', offlineOrders: 'ZetaphyOfflineOrders', offlineCash: 'ZetaphyOfflineCash', auditNetwork: 'AuditNetwork', auditRunners: 'AuditRunners',
  auditJudges: 'AuditJudges', auditCertificate: 'AuditCertificate', quantumRescue: 'QuantumRescue', immuneRegistry: 'ImmuneRegistry', immuneBroadcaster: 'ImmuneBroadcaster' };

/** Every contract of each step: { key, name, args(R), note }. R reads this step's addresses, then the state's. */
function specs(ctx) {
  const a = ctx.mainnet.apps;
  const mailbox = ctx.mainnet.ai?.mailbox ?? null;
  return {
    offline: [
      { key: 'zetaphyCheques', name: 'ZetaphyCheques', args: () => [], note: 'no owner, no fee, no setting; a channel\'s payer withdraws the remainder after the close' },
      { key: 'offlineOrders', name: 'ZetaphyOfflineOrders', args: (R) => [R.router], note: 'no owner; orders swap on the ZETAPHY DEX router' },
      { key: 'offlineCash', name: 'ZetaphyOfflineCash', args: () => [], note: 'no owner; native coin only; ML-DSA-44 holders (precompile 0x…0900); issuers reclaim expired notes and bonds' },
    ],
    auditnet: [
      { key: 'auditNetwork', name: 'AuditNetwork', args: (R) => [R.timelock, a.auditTreasury, R.$workerReputation, R.auditRunners, R.auditJudges, R.auditCertificate, { ...NETWORK_PARAMS }],
        note: `${TL}; treasury ${a.auditTreasury} (post-certificate slashes, lost appeal bonds); its three partners at the deployer's next nonces` },
      { key: 'auditRunners', name: 'AuditRunners', args: (R) => [R.auditNetwork, R.neuroJobs, R.$workerReputation, a.auditRunnerMinAgreed], note: 'no owner: three bonded NeuroJobs runners per request' },
      { key: 'auditJudges', name: 'AuditJudges', args: (R) => [R.auditNetwork, R.$workerReputation, R.timelock, { ...JUDGE_PARAMS }], note: TL },
      { key: 'auditCertificate', name: 'AuditCertificate', args: (R) => [R.auditNetwork, R.auditRunners, R.auditJudges, R.timelock, { ...LEVELS }], note: TL },
    ],
    qrescue: [
      { key: 'quantumRescue', name: 'QuantumRescue', args: (R) => [SECURITY_PRECOMPILE, R.timelock, BigInt(a.rescueMaturity)],
        note: `${TL}; Q-day read from the chain's security precompile; a commitment counts ${a.rescueMaturity} blocks later` },
    ],
    immune: [
      { key: 'immuneRegistry', name: 'ImmuneRegistry', args: (R) => [R.neuroJobs, R.threatRegistry, a.immuneMinAgreed, R.timelock],
        note: `${TL}; flags only from ${a.immuneMinAgreed} agreeing NeuroJobs runners (governance can only protect keys, never flag)` },
      ...(mailbox ? [{ key: 'immuneBroadcaster', name: 'ImmuneBroadcaster', args: (R) => [R.immuneRegistry, mailbox, R.timelock], note: `${TL}; no mirror until governance adds one (setReceiver)` }] : []),
    ],
  };
}

const DESCRIBE = {
  offline: 'offline trading: ZetaphyCheques, ZetaphyOfflineOrders (on the DEX router), ZetaphyOfflineCash — no owner (the hub\'s Offline tab)',
  auditnet: 'the open audit network: AuditNetwork, AuditRunners, AuditJudges, AuditCertificate — governance the timelock (the hub\'s Audit tab, audit.html)',
  qrescue: 'QuantumRescue: post-quantum rescue commitments — governance the timelock (the hub\'s Quantum tab)',
  immune: 'the immune network: ImmuneRegistry (ImmuneBroadcaster with a Mailbox) — governance the timelock (the hub\'s Immunity tab)',
};

function afterHandover(state) {
  const o = outputs(state);
  if (!o.timelock || !state.steps.handover?.doneAt) throw new Error('the handover has not run yet: the timelock and handover steps come first (this step hands its contracts to that timelock)');
  return o;
}
/** The state's outputs as these steps read them (the DEX router under `router`, a missing WorkerReputation as zero). */
const view = (o) => ({ ...o, router: o.dex?.contracts?.router, $workerReputation: o.workerReputation ?? ZeroAddress });

/** WorkerReputation.setReporter calls only the timelock can make (the audit network reports to it once a vote adds them). */
export function auditReporterCalls(o) {
  if (!o.workerReputation || !o.auditNetwork) return [];
  const i = new Interface(NET('WorkerReputation').abi);
  return [['AuditNetwork', o.auditNetwork], ['AuditRunners', o.auditRunners]].filter(([, a]) => a)
    .map(([n, a]) => ({ what: `WorkerReputation.setReporter(${n} ${a}, true)`, to: getAddress(o.workerReputation), data: i.encodeFunctionData('setReporter', [a, true]) }));
}

export function appPlans() {
  const out = {};
  for (const name of APP_STEPS) {
    out[name] = (ctx, o) => {
      // WorkerReputation comes from the usefulwork step, before these: a placeholder in a plan made before it ran
      const R = refs({ ...view(o), $workerReputation: o.workerReputation ?? later('WorkerReputation') }, {});
      const list = specs(ctx)[name];
      const skipped = [];
      if (name === 'immune' && !ctx.mainnet.ai?.mailbox) skipped.push(['immuneBroadcaster', NO_MAILBOX]);
      if (name === 'immune') skipped.push(...APP_EXCLUDED.filter(([k]) => k !== 'pqSettlement'));
      if (name === 'qrescue') skipped.push(APP_EXCLUDED.find(([k]) => k === 'pqSettlement'));
      const calls = name === 'auditnet'
        ? ['(checks) each contract lands at the address AuditNetwork was given (the deployer\'s nonces); a resume finishes them at those addresses',
          '(vote, later) WorkerReputation.setReporter(AuditNetwork, true), setReporter(AuditRunners, true): only the timelock can; until then reports are skipped (try/catch)']
        : ['(checks) governance is the timelock; no owner, guardian or pause is left to anyone'];
      return { deploys: list.map((s) => dep(s.key, s.name, s.args(R), { note: s.note })), calls, skipped };
    };
  }
  return out;
}

export function appSteps() {
  const P = appPlans();
  return APP_STEPS.map((name) => ({
    name, describe: DESCRIBE[name], plan: P[name],
    async run(ctx, state) {
      const o = view(afterHandover(state));
      if (name === 'offline' && !o.router) throw new Error('no DEX router in the state: ZetaphyOfflineOrders swaps on it (the dex step comes first)');
      if (['auditnet', 'immune'].includes(name) && (!o.neuroJobs || !o.threatRegistry)) throw new Error('no NeuroJobs / ThreatRegistry in the state (the neuro and threats steps come first)');
      if (name === 'immune' && ctx.mainnet.ai?.mailbox && (await ctx.provider.getCode(ctx.mainnet.ai.mailbox)) === '0x') throw new Error(`ai.mailbox ${ctx.mainnet.ai.mailbox}: no contract there`);
      const st = (state.steps[name] ??= {});
      const r = (st.partial ??= {});
      const s = signer(ctx);
      const list = specs(ctx)[name];
      const me = getAddress(ctx.address);
      if (name === 'auditnet') {
        // the four addresses follow from one nonce, saved before the first transaction
        const pending = await ctx.provider.getTransactionCount(me, 'pending');
        const at = (n, i) => getAddress(getCreateAddress({ from: me, nonce: n + i }));
        const anyCode = async (n) => { for (let i = 0; i < 4; i++) if ((await ctx.provider.getCode(at(n, i))) !== '0x') return true; return false; };
        // a plan whose first contract never landed and whose nonces were used since: start again at the next nonce
        if (r.nonce != null && pending > r.nonce && !(await anyCode(r.nonce))) { ctx.log(`  the audit network's earlier nonce ${r.nonce} was used by another transaction and nothing landed: planning again`); delete r.nonce; }
        if (r.nonce == null) { r.nonce = pending; ctx.saveState?.(state); }
        list.forEach((sp, i) => { r[sp.key] = at(r.nonce, i); });
        ctx.saveState?.(state);
      }
      const R = refs(o, r);
      const out = {};
      for (const [i, sp] of list.entries()) {
        const a = art('zetaphy-network', sp.name);
        if (r[sp.key] && (await ctx.provider.getCode(r[sp.key])) !== '0x') {
          ctx.log(`  ${sp.name} ${r[sp.key]} (deployed by an earlier try of this step)`);
        } else if (name === 'auditnet') {
          const next = await ctx.provider.getTransactionCount(me, 'pending');
          if (next !== r.nonce + i) {
            throw new Error(`${sp.name} must be deployed with nonce ${r.nonce + i} (to land at ${r[sp.key]}, the address AuditNetwork was given), but the deployer's next nonce is ${next}: `
              + (next < r.nonce + i ? 'an earlier transaction of this step was dropped' : 'another transaction used it (re-run once a pending one is mined)'));
          }
          const k = await deployOne(ctx, s, dep(sp.key, sp.name, sp.args(R)));
          if (!same(k.target, r[sp.key])) throw new Error(`${sp.name} landed at ${k.target}, not ${r[sp.key]}`);
        } else {
          const k = await deployOne(ctx, s, dep(sp.key, sp.name, sp.args(R)));
          r[sp.key] = getAddress(k.target);
          ctx.saveState?.(state);
        }
        out[sp.key] = r[sp.key];
        if (a.abi.some((f) => f.type === 'function' && f.name === 'governance' && !f.inputs.length)) {
          const g = await new Contract(r[sp.key], a.abi, ctx.provider).governance();
          if (!same(g, o.timelock)) throw new Error(`${sp.name}: governance is ${g}, not the timelock`);
        }
      }
      if (name === 'auditnet') {
        const calls = auditReporterCalls({ ...o, ...out });
        for (const c of calls) ctx.log(`  for a later vote (only the timelock can): ${c.what} -> to ${c.to} data ${c.data}`);
        if (calls.length) out.auditReporterCalls = calls;
      }
      if (name === 'immune' && !ctx.mainnet.ai?.mailbox) ctx.log(`  ImmuneBroadcaster: skipped (${NO_MAILBOX})`);
      return out;
    },
  }));
}

// ---------- the on-chain check (called by verifyMainnet) ----------

/** These contracts with a governance role: [{ key, name, address }]. */
export const appGoverned = (o) => Object.entries(CONTRACT).filter(([k, n]) => o[k] && NET(n).abi.some((f) => f.type === 'function' && f.name === 'governance' && !f.inputs.length))
  .map(([k, n]) => ({ key: k, name: n, address: o[k] }));

export async function verifyApps(ctx, o, problems, lines) {
  const p = ctx.provider;
  const me = ctx.address;
  const C = (k) => new Contract(o[k], NET(CONTRACT[k]).abi, p);
  const present = Object.keys(CONTRACT).filter((k) => o[k]);
  if (!present.length) return;
  for (const k of present) if ((await p.getCode(o[k])) === '0x') problems.push(`${CONTRACT[k]} ${o[k]}: no code`);
  for (const x of appGoverned(o)) {
    const gov = await C(x.key).governance();
    if (same(gov, me)) problems.push(`${x.name} ${x.address}: the deployer is its governance`);
    if (!same(gov, o.timelock)) problems.push(`${x.name} ${x.address}: governance ${gov}, not the timelock`);
  }
  if (o.offlineOrders && o.dex?.contracts?.router && !same(await C('offlineOrders').router(), o.dex.contracts.router)) problems.push('ZetaphyOfflineOrders: not on this DEX router');
  if (o.auditNetwork) {
    const n = C('auditNetwork');
    if (same(await n.treasury(), me)) problems.push('AuditNetwork: the treasury is the deployer');
    if (!same(await n.runners(), o.auditRunners) || !same(await n.judging(), o.auditJudges) || !same(await n.certificate(), o.auditCertificate)) problems.push('AuditNetwork: not wired to this AuditRunners, AuditJudges and AuditCertificate');
  }
  if (o.auditRunners) {
    const r = C('auditRunners');
    if (!same(await r.network(), o.auditNetwork) || !same(await r.jobs(), o.neuroJobs)) problems.push('AuditRunners: not this AuditNetwork\'s, or not on NeuroJobs');
  }
  if (o.auditJudges && !same(await C('auditJudges').network(), o.auditNetwork)) problems.push('AuditJudges: not this AuditNetwork\'s');
  if (o.auditCertificate) {
    const c = C('auditCertificate');
    if (!same(await c.network(), o.auditNetwork) || !same(await c.runners(), o.auditRunners) || !same(await c.judges(), o.auditJudges)) problems.push('AuditCertificate: not wired to this audit network');
  }
  if (o.quantumRescue && !same(await C('quantumRescue').security(), SECURITY_PRECOMPILE)) problems.push('QuantumRescue: it does not read the chain\'s security precompile');
  if (o.immuneRegistry) {
    const i = C('immuneRegistry');
    if (!same(await i.jobs(), o.neuroJobs) || !same(await i.threats(), o.threatRegistry)) problems.push('ImmuneRegistry: not on this NeuroJobs and ThreatRegistry');
  }
  if (o.immuneBroadcaster && !same(await C('immuneBroadcaster').registry(), o.immuneRegistry)) problems.push('ImmuneBroadcaster: not this ImmuneRegistry\'s');
  lines.push(`${'hub tab contracts'.padEnd(18)} ${present.length} contract(s) (offline, audit, quantum, immune); ${appGoverned(o).length} governed by the timelock, the rest have no owner`);
}
