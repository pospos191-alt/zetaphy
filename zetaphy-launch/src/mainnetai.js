// The AI map's contracts on mainnet (zetaphy-hub/flow.js ITEMS: every "notDeployed" item, and the "practice" items that
// have a contract), as the testnet deploys them (zetaphy-network/src/aideploy.js, usefulworkops.js deployUsefulWork,
// flcli.js `fl deploy`, assistdeploy.js), with the mainnet launch's rules:
//   - every admin / owner / governance role is the existing ZetaphyTimelock. A contract whose constructor takes the
//     governance gets the timelock there; one the deployer must configure first (a guardian, a resolver, an approved
//     checker, reporters, paused) is deployed with the deployer as governance, configured, and handed over one-step in
//     the same step (checked on-chain before the step ends);
//   - where a contract has a guardian, it is the guardian multisig;
//   - what is paused or closed on the testnet stays paused or closed (UsefulWork, BugBounty, FederatedRounds): a vote
//     opens it later, as its doc says;
//   - nothing mints. UsefulIssuance mints nothing: it is a RewardVault recipient (fund()) with capped buckets, so it
//     gets coins only if governance gives it a vault share (RewardVault's own 7-day delay), from the fixed rewards pool.
//   - each contract is saved in the state the moment it is deployed (state.steps.<step>.partial), so a step that stops
//     half way resumes with the same contracts instead of deploying them again.
// Skipped on mainnet, with the reason in the plan: HackInsurance (the contract says testnet only: no real money may be
// put in it), NeuroOracleSender without a Hyperlane Mailbox on this chain (deploy config ai.mailbox).
// The `contracts` step writes <state>.contracts.json: every address the hub's AI map and pages read, under the keys of
// hub-config.json `contracts` (zetaphy-hub/build.mjs), plus the DEX and NFT ones and what was skipped.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Contract, getAddress, parseEther, sha256, toUtf8Bytes, ZeroAddress } from 'ethers';
import { outputs } from './runner.js';
import { art, NET, signer, wait, same } from './steps.js';
import { later, dep, deployOne } from './plan.js';
import { AI_DEFAULTS } from '../../zetaphy-network/src/aideploy.js';
import { DEFAULT_PARAMS as UW_PARAMS, DEFAULT_BOUNTY as UW_BOUNTY, MIN_TIMELOCK_DELAY as UW_MIN_DELAY } from '../../zetaphy-network/src/usefulworkops.js';
import { FL_DEFAULTS } from '../../zetaphy-network/src/flcli.js';
import { APP_HUB_KEYS, APP_EXCLUDED } from './mainnetapps.js';

/** The AI-map items (zetaphy-hub/flow.js) each hub key serves: what a deployed contract switches to "Works now". */
export const AI_ITEMS = {
  modelRegistry: [1], signalBoard: [2, 7], neuroScore: [3], usefulWork: [5], federatedRounds: [6],
  cosignCommittee: [9, 14], webauthn: [9], workerReputation: [10], riskForecasts: [15], dataDao: [16], bugBounty: [17],
  neuroOracleSender: [18, 28], neuroAttest: [19], agentRegistry: [23], intentExecutor: [24], labelRegistry: [25], vouchRegistry: [25],
  detectorPool: [26], arena: [27], foresight: [29], neuroAnchor: [30], hackInsurance: [32], usefulIssuance: [34], modelEpochs: [35],
};

/** The keys of hub-config.json `contracts` (zetaphy-hub/build.mjs hubConfig), the ones this launch can fill. */
export const HUB_KEYS = ['neuroJobs', 'neuroControl', 'threatRegistry', 'threatReports', 'rewardVault', 'computeMarket', 'oracle', 'neuroIdentity',
  'usefulWork', 'bugBounty', 'workerReputation', 'usefulIssuance', 'riskForecasts', 'foresight', 'detectorPool', 'dataDao', 'arena', 'intentExecutor',
  'labelRegistry', 'vouchRegistry', 'agentRegistry', 'timelock', 'neuroAttest', 'neuroAnchor', 'neuroOracleSender', 'hackInsurance',
  'modelRegistry', 'neuroScore', 'modelEpochs', 'signalBoard', 'webauthn', 'cosignCommittee', 'federatedRounds', ...APP_HUB_KEYS];

/** Not deployed on mainnet whatever the config says. */
export const AI_EXCLUDED = [
  ['hackInsurance', 'HackInsurance is testnet only by its own terms: an unaudited parametric insurance pool into which "no real money may ever be put" (AI map item 32 stays "not deployed")'],
];

export const AI_STEPS = ['aimodels', 'aiagents', 'aimarkets', 'aiassist', 'usefulwork'];

const LABEL = { timelock: 'ZetaphyTimelock', neuroJobs: 'NeuroJobs', threatRegistry: 'ThreatRegistry', guardian: 'the guardian multisig', rewardVault: 'RewardVault',
  neuroIdentity: 'NeuroIdentity', webauthn: 'WebAuthnVerifier', agentRegistry: 'AgentRegistry', labelRegistry: 'LabelRegistry', foresight: 'ForesightRegistry',
  constitutionChecker: 'ConstitutionChecker', workerReputation: 'WorkerReputation', usefulIssuance: 'UsefulIssuance', usefulWork: 'UsefulWork', bugBounty: 'BugBounty',
  riskForecasts: 'RiskForecasts' };
/** Known addresses (o, then this step's own), else a printed placeholder. */
// R.$key: an optional address (zero when the state has none, e.g. NeuroIdentity when the identity step was skipped)
const refs = (o, r) => new Proxy({}, { get: (_t, k) => (String(k).startsWith('$') ? r[k.slice(1)] ?? o[k.slice(1)] ?? ZeroAddress : r[k] ?? o[k] ?? later(LABEL[k] ?? k)) });
const TL = 'governance = the ZetaphyTimelock in the constructor';
const VIA = 'governance = the deployer for the calls below, then the timelock (one step, same step)';

/** The deploy-config section `ai` (src/mainnet.js mainnetConfig calls it). `addr`, `addrs`, `int`, `coin`: its checkers. */
export function aiConfig(raw, { only, addr, addrs, int, coin }) {
  const a = only(raw ?? {}, ['committee', 'threshold', 'agentBond', 'claimDeposit', 'hubHost', 'humanTtlDays', 'poster', 'epochLength', 'epochMinDelay', 'mailbox', 'fl', 'usefulWork'], 'ai');
  const committee = addrs(a.committee ?? [], 'ai.committee');
  const host = String(a.hubHost ?? AI_DEFAULTS.hubHost);
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || /(^|\.)(example(\.(com|org|net))?|invalid|test|localhost|local)$/.test(host)) {
    throw new Error(`deploy config ai.hubHost: the host the hub's passkeys are made on (a real lowercase host name, e.g. ${AI_DEFAULTS.hubHost}; not ${host})`);
  }
  const fl = only(a.fl ?? {}, ['commitBlocks', 'revealBlocks', 'maxPerRound', 'startIn'], 'ai.fl');
  const uw = only(a.usefulWork ?? {}, ['feeder', 'issuance'], 'ai.usefulWork');
  if (uw.issuance != null && typeof uw.issuance !== 'boolean') throw new Error('deploy config ai.usefulWork.issuance: true or false');
  return {
    committee, threshold: committee.length ? int(a.threshold ?? 1, 'ai.threshold', 1, committee.length) : 1,
    agentBond: coin(a.agentBond ?? String(AI_DEFAULTS.agentBond), 'ai.agentBond'), claimDeposit: coin(a.claimDeposit ?? String(AI_DEFAULTS.claimDeposit), 'ai.claimDeposit'),
    hubHost: host, humanTtlDays: int(a.humanTtlDays ?? AI_DEFAULTS.humanTtlDays, 'ai.humanTtlDays', 1, 3650),
    poster: a.poster == null ? null : addr(a.poster, 'ai.poster'),
    epochLength: int(a.epochLength ?? AI_DEFAULTS.epochLength, 'ai.epochLength', 1, 10_000_000), epochMinDelay: int(a.epochMinDelay ?? AI_DEFAULTS.epochMinDelay, 'ai.epochMinDelay', 1, 10_000_000),
    mailbox: a.mailbox == null ? null : addr(a.mailbox, 'ai.mailbox'),
    fl: { commitBlocks: int(fl.commitBlocks ?? FL_DEFAULTS.commitBlocks, 'ai.fl.commitBlocks', 1, 10_000_000), revealBlocks: int(fl.revealBlocks ?? FL_DEFAULTS.revealBlocks, 'ai.fl.revealBlocks', 1, 10_000_000),
      maxPerRound: int(fl.maxPerRound ?? FL_DEFAULTS.maxPerRound, 'ai.fl.maxPerRound', 1, 1_000_000), startIn: int(fl.startIn ?? FL_DEFAULTS.startIn, 'ai.fl.startIn', 1, 10_000_000) },
    usefulWork: { feeder: uw.feeder == null ? null : addr(uw.feeder, 'ai.usefulWork.feeder'), issuance: uw.issuance !== false },
  };
}
/** The addresses of the `ai` section that hold a role: the deployer may be none of them. */
export const aiRoleHolders = (ai) => [['ai.committee', ai.committee], ['ai.poster', [ai.poster].filter(Boolean)], ['ai.usefulWork.feeder', [ai.usefulWork.feeder].filter(Boolean)]];

/**
 * Every contract of each step: { key (hub key / state key), name, args(R), note, calls: [printed], after(k, R, ctx) }.
 * R reads this step's addresses, then the state's, else a placeholder. `after` configures a contract the deployer
 * governs for now and hands it to the timelock; it is idempotent (a resumed step skips what is done).
 */
function specs(ctx) {
  const ai = ctx.mainnet.ai;
  const me = ctx.address;
  const handTo = async (k, R, n) => {
    const g = await k.governance();
    if (same(g, R.timelock)) return;
    if (!same(g, me)) throw new Error(`${n}: governance is ${g}, neither the deployer nor the timelock`);
    await wait(k.setGovernance(R.timelock));
    if (!same(await k.governance(), R.timelock)) throw new Error(`${n}: governance is not the timelock after setGovernance`);
    ctx.log(`  ${n}: governance -> the timelock`);
  };
  const ownedByMe = async (k, R, n) => { const g = await k.governance(); if (same(g, R.timelock)) return false; if (!same(g, me)) throw new Error(`${n}: governance is ${g}`); return true; };
  const guardianThen = (n) => async (k, R) => {
    if (await ownedByMe(k, R, n)) { if (!(await k.guardian(R.guardian))) await wait(k.setGuardian(R.guardian, true)); }
    await handTo(k, R, n);
  };
  return {
    aimodels: [
      { key: 'modelRegistry', name: 'ModelRegistry', args: () => [me], note: `${VIA}; the guardian multisig may flag a model`, calls: ['ModelRegistry.setGuardian(the guardian multisig, true)', 'ModelRegistry.setGovernance(ZetaphyTimelock)  one step'], after: guardianThen('ModelRegistry') },
      { key: 'neuroScore', name: 'NeuroScore', args: (R) => [R.timelock], note: `${TL} (it has no setGovernance); no feeder until governance appoints one` },
      { key: 'modelEpochs', name: 'ModelEpochs', args: () => [me, BigInt(ai.epochLength), BigInt(ai.epochMinDelay)], note: VIA,
        calls: ['ModelEpochs.setGuardian(the guardian multisig, true)', 'ModelEpochs.setGovernance(ZetaphyTimelock)  one step'], after: guardianThen('ModelEpochs') },
      { key: 'signalBoard', name: 'SignalBoard', args: () => [], note: 'no admin (peer discovery for the Neuro page)' },
      { key: 'federatedRounds', name: 'FederatedRounds', args: (R) => [R.timelock, later(`the block ${ai.fl.startIn} after the deploy`, 10n ** 9n), BigInt(ai.fl.commitBlocks), BigInt(ai.fl.revealBlocks), ai.fl.maxPerRound],
        note: `${TL}; CLOSED (paused) by its constructor until a vote opens it`, start: true },
    ],
    aiagents: [
      { key: 'webauthn', name: 'WebAuthnVerifier', args: () => [], note: 'no admin' },
      { key: 'cosignCommittee', name: 'CosignCommittee', args: (R) => [R.timelock, ai.committee.length ? ai.committee : [R.timelock], BigInt(ai.threshold)],
        note: `${TL}; ${ai.committee.length ? `${ai.committee.length} member(s), threshold ${ai.threshold}` : 'the timelock its only member until governance sets members'}` },
      { key: 'constitutionChecker', name: 'ConstitutionChecker', args: () => [], note: 'no admin' },
      { key: 'agentRegistry', name: 'AgentRegistry', args: () => [me, parseEther(ai.agentBond), parseEther(ai.claimDeposit)], note: `${VIA}; bond ${ai.agentBond}, claim deposit ${ai.claimDeposit} ${ctx.symbol ?? 'ZTPHY'}`,
        calls: ['AgentRegistry.setChecker(ConstitutionChecker, true)  (AR-2: only an approved checker)', 'AgentRegistry.setGovernance(ZetaphyTimelock)  one step'],
        after: async (k, R) => { if ((await ownedByMe(k, R, 'AgentRegistry')) && !(await k.approvedChecker(R.constitutionChecker))) await wait(k.setChecker(R.constitutionChecker, true)); await handTo(k, R, 'AgentRegistry'); } },
      { key: 'labelRegistry', name: 'LabelRegistry', args: (R) => [R.timelock, R.agentRegistry, R.webauthn, sha256(toUtf8Bytes(ai.hubHost)), BigInt(ai.humanTtlDays * 86400)], note: `${TL}; passkeys of ${ai.hubHost}` },
      { key: 'vouchRegistry', name: 'VouchRegistry', args: (R) => [R.labelRegistry, R.timelock], note: TL },
      { key: 'intentExecutor', name: 'IntentExecutor', args: () => [], note: 'no admin' },
    ],
    aimarkets: [
      { key: 'foresight', name: 'ForesightRegistry', args: () => [me], note: VIA, calls: ['ForesightRegistry.setResolver(RiskForecasts, true)', 'ForesightRegistry.setGovernance(ZetaphyTimelock)  one step'], late: true,
        after: async (k, R) => { if ((await ownedByMe(k, R, 'ForesightRegistry')) && !(await k.resolvers(R.riskForecasts))) await wait(k.setResolver(R.riskForecasts, true)); await handTo(k, R, 'ForesightRegistry'); } },
      { key: 'riskForecasts', name: 'RiskForecasts', args: (R) => [R.timelock, R.threatRegistry, R.foresight], note: TL },
      { key: 'detectorPool', name: 'DetectorPool', args: (R) => [R.timelock, R.foresight], note: TL },
      { key: 'dataDao', name: 'DataDAO', args: (R) => [R.timelock, ai.poster ?? R.timelock], note: `${TL}; poster ${ai.poster ?? 'the timelock'}` },
      { key: 'arena', name: 'RedBlueArena', args: (R) => [R.timelock], note: TL },
    ],
    aiassist: [
      { key: 'neuroAttest', name: 'NeuroAttest', args: (R) => [R.neuroJobs, R.timelock], note: TL },
      { key: 'neuroAnchor', name: 'NeuroAnchor', args: () => [], note: 'no admin' },
      ...(ai.mailbox ? [{ key: 'neuroOracleSender', name: 'NeuroOracleSender', args: (R) => [R.threatRegistry, R.neuroJobs, ai.mailbox, R.timelock], note: `${TL}; no receiver until governance adds one (setReceiver)` }] : []),
    ],
    usefulwork: [
      { key: 'workerReputation', name: 'WorkerReputation', args: (R) => [me, R.neuroJobs, R.$neuroIdentity], note: VIA,
        calls: ['WorkerReputation.setReporter(UsefulWork, true), setReporter(BugBounty, true)', 'WorkerReputation.setGovernance(ZetaphyTimelock)  one step'] },
      ...(ai.usefulWork.issuance ? [{ key: 'usefulIssuance', name: 'UsefulIssuance', args: (R) => [R.timelock, R.rewardVault],
        note: `${TL}; mints nothing: a RewardVault recipient with capped buckets, gets coins only once a vote gives it a vault share; overflow = the RewardVault` }] : []),
      { key: 'usefulWork', name: 'UsefulWork', args: (R) => [me, R.workerReputation, ai.usefulWork.issuance ? R.usefulIssuance : ZeroAddress, UW_PARAMS], note: VIA,
        calls: ['UsefulWork.setPaused(true)  (a vote opens it)', 'UsefulWork.setGuardian(the guardian multisig)', ...(ai.usefulWork.feeder ? [`UsefulWork.setFeeder(${ai.usefulWork.feeder}, true)`] : []), 'UsefulWork.setGovernance(ZetaphyTimelock)  one step'] },
      { key: 'bugBounty', name: 'BugBounty', args: (R) => [R.neuroJobs, UW_BOUNTY.quorum, UW_BOUNTY.minAgreed, me, R.workerReputation, ai.usefulWork.issuance ? R.usefulIssuance : ZeroAddress, UW_BOUNTY.findingDeposit, UW_BOUNTY.revealWindow, UW_BOUNTY.judgeWindow],
        note: VIA, calls: ['BugBounty.setPaused(true)  (a vote opens it)', 'BugBounty.setGuardian(the guardian multisig)', 'BugBounty.setGovernance(ZetaphyTimelock)  one step'], last: true,
        after: async (_k, R, c) => wireUsefulWork(c, R, handTo, ownedByMe) },
    ],
  };
}

/** UsefulWork + BugBounty paused, guarded and reported by WorkerReputation; then all three to the timelock. */
async function wireUsefulWork(ctx, R, handTo, ownedByMe) {
  const s = signer(ctx);
  const uw = new Contract(R.usefulWork, NET('UsefulWork').abi, s), bb = new Contract(R.bugBounty, NET('BugBounty').abi, s), rep = new Contract(R.workerReputation, NET('WorkerReputation').abi, s);
  for (const [k, n] of [[uw, 'UsefulWork'], [bb, 'BugBounty']]) {
    if (!(await ownedByMe(k, R, n))) continue;
    if (!(await k.paused())) await wait(k.setPaused(true));
    if (!same(await k.guardian(), R.guardian)) await wait(k.setGuardian(R.guardian));
  }
  const feeder = ctx.mainnet.ai.usefulWork.feeder;
  if (feeder && (await ownedByMe(uw, R, 'UsefulWork')) && !(await uw.feeders(feeder))) await wait(uw.setFeeder(feeder, true));
  if (await ownedByMe(rep, R, 'WorkerReputation')) {
    for (const r of [R.usefulWork, R.bugBounty]) if (!(await rep.reporters(r))) await wait(rep.setReporter(r, true));
  }
  for (const [k, n] of [[uw, 'UsefulWork'], [bb, 'BugBounty'], [rep, 'WorkerReputation']]) await handTo(k, R, n);
  ctx.log(`  useful work: PAUSED, guardian ${R.guardian}; WorkerReputation takes reports from both; all three governed by the timelock`);
}

const guardianOf = (ctx, o) => ctx.guardian ?? o.guardianMultisig ?? null;
function afterHandover(state) {
  const o = outputs(state);
  if (!o.timelock || !state.steps.handover?.doneAt) throw new Error('the handover has not run yet: the timelock and handover steps come first (this step hands its contracts to that timelock)');
  return o;
}

const DESCRIBE = {
  aimodels: 'the AI models: ModelRegistry, NeuroScore, ModelEpochs, SignalBoard, FederatedRounds (closed) — AI map items 1, 2, 3, 6, 7, 35',
  aiagents: 'agents: WebAuthnVerifier, CosignCommittee, ConstitutionChecker, AgentRegistry, LabelRegistry, VouchRegistry, IntentExecutor — items 9, 14, 23, 24, 25',
  aimarkets: 'markets: ForesightRegistry, RiskForecasts, DetectorPool, DataDAO, RedBlueArena — items 15, 16, 26, 27, 29',
  aiassist: 'cross-chain assist: NeuroAttest, NeuroAnchor, NeuroOracleSender (with a Mailbox) — items 18, 19, 28, 30',
  usefulwork: 'useful work: WorkerReputation, UsefulIssuance, UsefulWork, BugBounty, PAUSED — items 5, 10, 17, 34',
};

export function aiPlans() {
  const out = {};
  for (const name of AI_STEPS) {
    out[name] = (ctx, o) => {
      const list = specs(ctx)[name];
      const R = refs({ ...o, guardian: guardianOf(ctx, o) ?? undefined }, {});
      const skipped = [];
      if (name === 'aiassist' && !ctx.mainnet.ai.mailbox) skipped.push(['neuroOracleSender', 'no Hyperlane Mailbox on this chain (deploy config ai.mailbox): NeuroOracleSender sends flags through one; items 18 and 28 stay "not deployed"']);
      if (name === 'usefulwork' && !ctx.mainnet.ai.usefulWork.issuance) skipped.push(['usefulIssuance', 'ai.usefulWork.issuance is false']);
      if (name === 'aiassist') skipped.push(...AI_EXCLUDED);
      return {
        deploys: list.map((s) => dep(s.key, s.name, s.args(R), { note: s.note })),
        calls: list.flatMap((s) => s.calls ?? []),
        skipped,
        note: name === 'usefulwork' ? 'opened later by a vote (UsefulIssuance.setBuckets, setPaused(false)), as docs/future/useful-work.md says' : undefined,
      };
    };
  }
  return out;
}

export function aiSteps() {
  const P = aiPlans();
  return AI_STEPS.map((name) => ({
    name, describe: DESCRIBE[name], plan: P[name],
    async run(ctx, state) {
      const o = afterHandover(state);
      const g = guardianOf(ctx, o);
      if (!g) throw new Error('no guardian multisig in the state');
      if (name === 'usefulwork') {
        const delay = await new Contract(o.timelock, NET('ZetaphyTimelock').abi, ctx.provider).getMinDelay();
        if (delay < BigInt(UW_MIN_DELAY)) throw new Error(`the timelock's delay is ${delay} s: useful work needs at least ${UW_MIN_DELAY} s`);
        if (ctx.mainnet.ai.usefulWork.issuance && !o.rewardVault) throw new Error('UsefulIssuance overflows into the RewardVault: the vault step comes first');
      }
      if (name === 'aiassist' && ctx.mainnet.ai.mailbox && (await ctx.provider.getCode(ctx.mainnet.ai.mailbox)) === '0x') throw new Error(`ai.mailbox ${ctx.mainnet.ai.mailbox}: no contract there`);
      const st = (state.steps[name] ??= {});
      const r = (st.partial ??= {});
      const R = refs({ ...o, guardian: g }, r);
      const s = signer(ctx);
      const list = specs(ctx)[name];
      const deployedNow = [];
      for (const sp of list) {
        let k;
        const a = art('zetaphy-network', sp.name);
        if (r[sp.key] && (await ctx.provider.getCode(r[sp.key])) !== '0x') {
          ctx.log(`  ${sp.name} ${r[sp.key]} (deployed by an earlier try of this step)`);
          k = new Contract(r[sp.key], a.abi, s);
        } else {
          let args = sp.args(R);
          if (sp.start) args = [args[0], BigInt(await ctx.provider.getBlockNumber()) + BigInt(ctx.mainnet.ai.fl.startIn), ...args.slice(2)];
          k = await deployOne(ctx, s, dep(sp.key, sp.name, args));
          r[sp.key] = getAddress(k.target);
          ctx.saveState?.(state);
        }
        deployedNow.push([sp, k]);
        if (sp.after && !sp.late) await sp.after(k, R, ctx);
      }
      for (const [sp, k] of deployedNow) if (sp.after && sp.late) await sp.after(k, R, ctx);
      const out = { ...r };
      for (const [sp, k] of deployedNow) {
        const abi = art('zetaphy-network', sp.name).abi;
        if (abi.some((f) => f.name === 'governance' && f.type === 'function') && !same(await k.governance(), o.timelock)) throw new Error(`${sp.name}: governance is not the timelock at the end of the step`);
      }
      if (name === 'aimodels') {
        const fr = new Contract(out.federatedRounds, NET('FederatedRounds').abi, ctx.provider);
        if (!(await fr.paused())) throw new Error('FederatedRounds is not closed after deploy');
      }
      return out;
    },
  }));
}

// ---------- the on-chain check (called by verifyMainnet) ----------

const AI_CONTRACT = { modelRegistry: 'ModelRegistry', neuroScore: 'NeuroScore', modelEpochs: 'ModelEpochs', signalBoard: 'SignalBoard', federatedRounds: 'FederatedRounds',
  webauthn: 'WebAuthnVerifier', cosignCommittee: 'CosignCommittee', constitutionChecker: 'ConstitutionChecker', agentRegistry: 'AgentRegistry', labelRegistry: 'LabelRegistry',
  vouchRegistry: 'VouchRegistry', intentExecutor: 'IntentExecutor', foresight: 'ForesightRegistry', riskForecasts: 'RiskForecasts', detectorPool: 'DetectorPool', dataDao: 'DataDAO',
  arena: 'RedBlueArena', neuroAttest: 'NeuroAttest', neuroAnchor: 'NeuroAnchor', neuroOracleSender: 'NeuroOracleSender', workerReputation: 'WorkerReputation',
  usefulIssuance: 'UsefulIssuance', usefulWork: 'UsefulWork', bugBounty: 'BugBounty' };

/** The AI contracts with a governance role, for the role check: [{ key, name, address }]. */
export const aiGoverned = (o) => Object.entries(AI_CONTRACT).filter(([k, n]) => o[k] && NET(n).abi.some((f) => f.type === 'function' && f.name === 'governance' && !f.inputs.length))
  .map(([k, n]) => ({ key: k, name: n, address: o[k] }));

export async function verifyAi(ctx, o, problems, lines) {
  const p = ctx.provider;
  const me = ctx.address;
  const C = (k) => new Contract(o[k], NET(AI_CONTRACT[k]).abi, p);
  const g = guardianOf(ctx, o);
  for (const [k, n] of Object.entries(AI_CONTRACT)) if (o[k] && (await p.getCode(o[k])) === '0x') problems.push(`${n} ${o[k]}: no code`);
  for (const x of aiGoverned(o)) {
    const gov = await C(x.key).governance();
    if (!same(gov, o.timelock)) problems.push(`${x.name} ${x.address}: governance ${gov}, not the timelock`);
  }
  for (const k of ['modelRegistry', 'modelEpochs']) if (o[k]) {
    if (!g || !(await C(k).guardian(g))) problems.push(`${AI_CONTRACT[k]}: the guardian multisig ${g} is not its guardian`);
    if (await C(k).guardian(me)) problems.push(`${AI_CONTRACT[k]}: the deployer is a guardian`);
  }
  if (o.neuroScore && (await C('neuroScore').feeder(me))) problems.push('NeuroScore: the deployer is a feeder');
  if (o.cosignCommittee && (await C('cosignCommittee').members()).some((m) => same(m, me))) problems.push('CosignCommittee: the deployer is a member');
  if (o.agentRegistry && o.constitutionChecker && !(await C('agentRegistry').approvedChecker(o.constitutionChecker))) problems.push('AgentRegistry: the ConstitutionChecker is not approved');
  if (o.labelRegistry) {
    const l = new Contract(o.labelRegistry, NET('LabelRegistry').abi, p);
    if (!same(await l.agents(), o.agentRegistry) || !same(await l.webauthn(), o.webauthn)) problems.push('LabelRegistry: not wired to this AgentRegistry and WebAuthnVerifier');
  }
  if (o.vouchRegistry && !same(await C('vouchRegistry').labels(), o.labelRegistry)) problems.push('VouchRegistry: not this LabelRegistry\'s');
  if (o.foresight && o.riskForecasts && !(await C('foresight').resolvers(o.riskForecasts))) problems.push('ForesightRegistry: RiskForecasts is not a resolver');
  if (o.foresight && (await C('foresight').resolvers(me))) problems.push('ForesightRegistry: the deployer is a resolver');
  if (o.dataDao && same(await C('dataDao').poster(), me)) problems.push('DataDAO: the deployer is the poster');
  if (o.neuroAttest && !same(await C('neuroAttest').jobs(), o.neuroJobs)) problems.push('NeuroAttest: not on this NeuroJobs');
  for (const k of ['usefulWork', 'bugBounty']) if (o[k]) {
    const c = C(k);
    if (!same(await c.guardian(), g)) problems.push(`${AI_CONTRACT[k]}: its guardian is ${await c.guardian()}, not the guardian multisig`);
  }
  if (o.usefulWork && (await C('usefulWork').feeders(me))) problems.push('UsefulWork: the deployer is a feeder');
  if (o.workerReputation) for (const k of ['usefulWork', 'bugBounty']) if (o[k] && !(await C('workerReputation').reporters(o[k]))) problems.push(`WorkerReputation: ${AI_CONTRACT[k]} is not a reporter`);
  if (o.workerReputation && (await C('workerReputation').reporters(me))) problems.push('WorkerReputation: the deployer is a reporter');
  if (o.usefulIssuance && !same(await C('usefulIssuance').overflow(), o.rewardVault)) problems.push('UsefulIssuance: its overflow is not the RewardVault');
  if (o.federatedRounds || o.usefulWork) {
    const st = [];
    if (o.federatedRounds) st.push(`FederatedRounds ${(await C('federatedRounds').paused()) ? 'closed' : 'OPEN'}`);
    if (o.usefulWork) st.push(`UsefulWork ${(await C('usefulWork').paused()) ? 'paused' : 'open'}`);
    if (o.bugBounty) st.push(`BugBounty ${(await C('bugBounty').paused()) ? 'paused' : 'open'}`);
    lines.push(`${'AI map'.padEnd(18)} ${aiGoverned(o).length} contract(s) governed by the timelock; ${st.join(', ')}`);
  }
}

// ---------- the contracts JSON the web apps read ----------

/** hub-config.json-shaped addresses of this run: { chainId, network, contracts, dex, nft, aiItems, skipped }. */
export function hubContracts(ctx, o) {
  const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
  const contracts = Object.fromEntries(HUB_KEYS.filter((k) => isAddr(o[k])).map((k) => [k, getAddress(o[k])]));
  if (isAddr(o.zetaphyBounty)) contracts.zetaphyBounty = getAddress(o.zetaphyBounty);
  if (isAddr(o.guardianMultisig)) contracts.guardianMultisig = getAddress(o.guardianMultisig);
  if (Number.isInteger(o.timelockBlock) && contracts.timelock) contracts.timelockBlock = o.timelockBlock;
  const dex = { ...(o.dex?.contracts?.factory ? { factory: o.dex.contracts.factory, router: o.dex.contracts.router } : {}),
    ...(o.dlmm?.contracts ? { dlmmFactory: o.dlmm.contracts.dlmmFactory, dlmmRouter: o.dlmm.contracts.dlmmRouter } : {}) };
  const nft = o.nft ? { factory: o.nft.factory, marketplace: o.nft.marketplace } : {};
  // the hub opens its NFT app only once the collections' shared code keys are protected (zetaphy-hub/network.js nftReady):
  // the protect step reads them on-chain every run, so a --resume after the timelock batch ran writes true here
  const keys = Object.values(o.nft?.collectionCodeKeys ?? {});
  const nftCodeKeysProtected = !!o.nft && keys.length > 0 && Array.isArray(o.protectedKeys) && Array.isArray(o.unprotectedKeys) && o.unprotectedKeys.length === 0 && keys.every((k) => o.protectedKeys.includes(k));
  const live = Object.entries(AI_ITEMS).filter(([k]) => contracts[k]).flatMap(([, it]) => it);
  const skipped = Object.fromEntries([...AI_EXCLUDED, ...APP_EXCLUDED, ...(contracts.immuneBroadcaster ? [] : [['immuneBroadcaster', 'no Hyperlane Mailbox on this chain (deploy config ai.mailbox)']]), ...(contracts.neuroOracleSender ? [] : [['neuroOracleSender', 'no Hyperlane Mailbox on this chain (deploy config ai.mailbox)']])]);
  return { _comment: 'zetaphy-launch --network mainnet: public addresses, keys as in zetaphy-hub hub-config.json `contracts`. No secrets.',
    chainId: Number(ctx.evmChainId), network: 'zetaphy-mainnet', contracts, dex, nft, nftCodeKeysProtected, aiItemsWithContracts: [...new Set(live)].sort((a, b) => a - b), skipped };
}

export function contractsStep() {
  return {
    name: 'contracts', always: true,
    describe: 'write <state>.contracts.json: every address the hub and the web apps read (hub-config.json keys)',
    plan: () => ({ deploys: [], calls: ['(checks) writes <state>.contracts.json (addresses only)'] }),
    async run(ctx, state) {
      const h = hubContracts(ctx, outputs(state));
      if (!ctx.stateFile) return {};
      const file = ctx.stateFile.replace(/\.json$/, '.contracts.json');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(h, null, 2) + '\n');
      ctx.log(`  ${Object.keys(h.contracts).length} contract address(es) written to ${file}; AI map items with their contracts: ${h.aiItemsWithContracts.join(', ')}`);
      return { contractsFile: file };
    },
  };
}

