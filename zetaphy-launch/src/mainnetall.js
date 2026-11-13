// The rest of the testnet's real systems on mainnet, added after the gate-8 set and its handover by a later
// `launch.js --network mainnet … --resume` (the same state file and deployer; --only <steps> works too):
//   identity (NeuroIdentity + NeuroValidation), vault (RewardVault), pq (QuantumWalletFactory), compute (ComputeMarket),
//   dlmm (ZetaphyDlmmFactory + its pair deployer + ZetaphyDlmmRouter), nft (NFTFactory + NFTMarketplace),
//   oracle (TwapRecorder + ZetaphyPythRelay + ZetaphyOracle), protect (a check), proposal (a file), then verify.
//
// The deployer renounced every timelock role in the handover, so each step hands its contracts straight to the
// existing ZetaphyTimelock, and nothing here needs the timelock to accept anything:
//   - a constructor that takes the admin gets the timelock (RewardVault, ZetaphyPythRelay, NFTMarketplace,
//     ZetaphyDlmmFactory): the deployer never holds the role, not even for a block;
//   - where the deployer must configure first, the same step deploys, configures and then makes the one-step transfer
//     (NeuroIdentity: admin = msg.sender, setAdmin(timelock); ZetaphyOracle: setGuardian(the guardian multisig), the
//     optional Pyth feed, then setGovernance(timelock));
//   - no admin at all: NeuroValidation, QuantumWalletFactory, ComputeMarket, TwapRecorder, NFTFactory, the DLMM router
//     and the DLMM pair deployer.
// The DLMM factory's handover is two-step (setGovernance, then the new governance calls acceptGovernance), so it is
// deployed with the timelock as its governance instead, and its set-up (the ThreatRegistry, the default presets, feeTo)
// needs the timelock; so does protecting the NFT collections' code keys in the ThreatRegistry, which the timelock
// governs. The `proposal` step puts all of that into ONE timelock batch, simulates every call as the timelock, and
// writes the gov proposal that schedules it (gov.sh propose-file / zetaphyd tx gov submit-proposal) and the
// executeBatch transaction anyone sends once the delay has passed. Until it runs the DLMM has no preset (no pair can be
// made), and no role is held by anyone but the timelock.
//
// Not on mainnet (skipped, with the reason in the plan): see MAINNET_EXCLUDED.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Contract, getAddress, keccak256, formatEther, ZeroAddress, ZeroHash, id as hashText } from 'ethers';
import { outputs } from './runner.js';
import { art, NET, haveCode, signer, wait, same, ROOT, GOV_MODULE, TIMELOCK_ROLES, GOV_MODULE_BECH32 } from './steps.js';
import { later, ref, dep, deployOne } from './plan.js';
import { NEURO_CHAINS, chainArgs } from '../../zetaphy-network/src/identity.js';

/** The testnet launch's steps that have no mainnet counterpart, and why (printed in every mainnet plan). */
export const MAINNET_EXCLUDED = [
  ['stable', 'test USDC/USDT (TestStable) and the StableGateway priced by them: test tokens, testnet only'],
  ['skill', 'no step of its own: the neuro step approves and activates this repo\'s Neuro skill'],
  ['configs', 'the web apps\' configs are not written by the mainnet launch (they are published from the state file)'],
  ['snap', 'a local npm build of the MetaMask snap, not a deployment'],
  ['test fixtures', 'no TestToken, no seeded pools, no faucet, no mining payout, no fixed test price'],
];

/** The steps of this file, in order (after the handover, before verify). */
export const ADDED_STEPS = ['identity', 'vault', 'pq', 'compute', 'dlmm', 'nft', 'oracle', 'protect', 'proposal'];

const DLMM = (n) => art('zetaphy-dex', n);
const NFT = (n) => art('zetaphy-nft', n);
const TL_NOTE = 'the ZetaphyTimelock from its first block (one step: nothing for the timelock to accept)';

/** NeuroIdentity's chain list for this chain: the repo's list, with ZETAPHY's own entry at this EVM chain id. */
export function identityChains(evmChainId) {
  const chains = { ...NEURO_CHAINS, zetaphy: { ...NEURO_CHAINS.zetaphy, caip2: `eip155:${evmChainId}` } };
  return chainArgs(chains);
}

/** The DLMM presets (zetaphy-dex/dlmm-cli.js DEFAULT_PRESETS), loaded once. */
export async function dlmmPresets(ctx) {
  if (!ctx.dlmmPresets) ctx.dlmmPresets = (await import(pathToFileURL(join(ROOT, 'zetaphy-dex/dlmm-cli.js')).href)).DEFAULT_PRESETS;
  return ctx.dlmmPresets;
}

/** The runtime code hashes every NFT factory collection has (zetaphy-nft/cli.js collectionCode). */
export const nftCodeHashes = () => ({ erc721: keccak256(NFT('ZetaphyERC721').deployedBytecode), erc1155: keccak256(NFT('ZetaphyERC1155').deployedBytecode) });

const guardianOf = (ctx, o) => ctx.guardian ?? o.guardianMultisig ?? null;

/** The added steps run after the handover: they need its timelock. */
function afterHandover(state) {
  const o = outputs(state);
  if (!o.timelock || !state.steps.handover?.doneAt) throw new Error('the handover has not run yet: the timelock and handover steps come first (this step hands its contracts to that timelock)');
  return o;
}

// ---------- the plans: every contract, its constructor arguments and every call ----------

export function addedPlans() {
  return {
    identity: (ctx, o) => {
      const i = ctx.mainnet.identity;
      if (!i) return { deploys: [], calls: [] };
      const [keys, caip2s, rules] = identityChains(ctx.evmChainId);
      return {
        deploys: [
          dep('neuroIdentity', 'NeuroIdentity', [i.web, i.image, keys, caip2s, rules, ref(o, 'neuroJobs', 'NeuroJobs'), BigInt(i.claimQuorum), BigInt(i.claimMinAgreed), BigInt(i.claimDelay)],
            { note: 'ERC-8004 identities; admin (add a chain, move the web link, nothing else) = the deployer for one call, then the timelock' }),
          dep('neuroValidation', 'NeuroValidation', [ref(o, 'neuroIdentity', 'NeuroIdentity'), ref(o, 'neuroJobs', 'NeuroJobs'), BigInt(i.minAgreed)], { note: 'no admin' }),
        ],
        calls: ['NeuroIdentity.setAdmin(ZetaphyTimelock)  one step: the admin moves at once'],
      };
    },
    vault: (ctx, o) => {
      const v = ctx.mainnet.vault;
      const shares = [[ref(o, 'neuroJobs', 'NeuroJobs'), (100 - v.validatorsShare) * 100, true], ...(v.validators ? [[v.validators, v.validatorsShare * 100, false]] : [])];
      return {
        deploys: [dep('rewardVault', 'RewardVault', [ref(o, 'timelock', 'ZetaphyTimelock'), shares], { note: `governance = ${TL_NOTE}; releases 10% a year of what it holds` })],
        calls: [],
        note: 'the deployer puts no coins in it: the rewards pool is moved in by its own keys after the launch (zetaphy deploy-vault --fund is not used)',
      };
    },
    pq: () => ({ deploys: [dep('quantumWalletFactory', 'QuantumWalletFactory', [], { note: 'no admin' })], calls: [] }),
    compute: (ctx, o) => ({ deploys: [dep('computeMarket', 'ComputeMarket', [ref(o, 'neuroJobs', 'NeuroJobs'), BigInt(ctx.mainnet.compute.minAgreed)], { note: 'no admin: escrowed AI jobs for runners with a record' })], calls: [] }),
    dlmm: (ctx, o) => ({
      deploys: [
        dep('dlmmFactory', 'ZetaphyDlmmFactory', [ref(o, 'timelock', 'ZetaphyTimelock')], { pkg: 'zetaphy-dex',
          note: `UNAUDITED; governance = ${TL_NOTE}; its constructor deploys the ZetaphyDlmmPairDeployer (no admin)` }),
        dep('dlmmRouter', 'ZetaphyDlmmRouter', [ref(o, 'dlmmFactory', 'ZetaphyDlmmFactory'), o.dex?.contracts?.wnative ?? (ctx.dexWnative === 'deploy' ? later('WZETAPHY') : ctx.dexWnative ?? later('the DEX\'s wrapped native'))],
          { pkg: 'zetaphy-dex', note: 'no admin; the same wrapped native as the DEX' }),
      ],
      calls: [`(proposal) ZetaphyDlmmFactory.setThreatRegistry(ThreatRegistry), setPreset x${Object.keys(ctx.dlmmPresets ?? { 1: 0, 10: 0, 25: 0, 100: 0 }).length} (bin steps ${Object.keys(ctx.dlmmPresets ?? { 1: 0, 10: 0, 25: 0, 100: 0 }).join(', ')})${ctx.mainnet.dlmm.feeTo ? `, setFeeTo(${ctx.mainnet.dlmm.feeTo})` : ''}: by the timelock (the proposal step)`],
      note: 'no pair can be made until the timelock has set the presets',
    }),
    nft: (ctx, o) => ({
      deploys: [
        dep('nftFactory', 'NFTFactory', [], { pkg: 'zetaphy-nft', note: 'no admin, no fee, no control over the collections it makes' }),
        dep('nftMarketplace', 'NFTMarketplace', [ref(o, 'timelock', 'ZetaphyTimelock'), ctx.mainnet.nft.feeRecipient, ctx.mainnet.nft.feeBps, ref(o, 'threatRegistry', 'ThreatRegistry'), ref(o, 'nftFactory', 'NFTFactory')],
          { pkg: 'zetaphy-nft', note: `governance = ${TL_NOTE}; it checks the ThreatRegistry` }),
      ],
      calls: ['(proposal) ThreatRegistry.setProtected(<the ERC-721 and ERC-1155 collection code keys>, true): by the timelock (the proposal step)'],
    }),
    oracle: (ctx, o) => {
      const c = ctx.mainnet.oracle;
      const g = guardianOf(ctx, o) ?? 'the guardian multisig';
      return {
        deploys: [
          dep('twapRecorder', 'TwapRecorder', [c.twapMinSpacing], { note: 'no owner, no settings' }),
          dep('pythRelay', 'ZetaphyPythRelay', [ref(o, 'timelock', 'ZetaphyTimelock'), c.relayers, c.relayerThreshold], { note: `governance = ${TL_NOTE}${c.relayers.length ? '' : '; no relayer yet (governance names them)'}` }),
          dep('oracle', 'ZetaphyOracle', [ctx.address, ref(o, 'twapRecorder', 'TwapRecorder'), ref(o, 'pythRelay', 'ZetaphyPythRelay')], { note: 'governance = the deployer for the calls below, then the timelock' }),
        ],
        calls: [`ZetaphyOracle.setGuardian(${g}, true)`,
          ...(c.pythZetaFeed ? [`ZetaphyOracle.setPythFeed(<the DEX's wrapped native>, ${c.pythZetaFeed}, 120 s, 100 bps)`, 'ZetaphyOracle.setGuards(<wrapped native>, 200, 1500, 3000, 3600)'] : []),
          'ZetaphyOracle.setGovernance(ZetaphyTimelock)  one step'],
        note: `no feed priced from the DEX yet: there is no pool with a real stablecoin${c.pythZetaFeed ? '' : '; no Pyth feed in the deploy config'} (governance adds them: zetaphy oracle feed …)`,
      };
    },
    protect: () => ({ deploys: [], calls: ['(checks) the NFT collections\' code keys are protected in the ThreatRegistry (the timelock governs it: missing ones go into the proposal)'] }),
    proposal: () => ({ deploys: [], calls: ['(writes) one timelock batch for what only the timelock can do now (the DLMM\'s set-up, the NFT code keys): the gov proposal that schedules it, and the executeBatch anyone sends after the delay; every call simulated as the timelock'] }),
  };
}

// ---------- the steps ----------

export function addedSteps() {
  const P = addedPlans();
  const withPlan = (s) => ({ ...s, plan: P[s.name] });
  return [
    withPlan({
      name: 'identity',
      describe: 'NeuroIdentity + NeuroValidation (ERC-8004): identities and runner verdicts; the identity admin straight to the timelock',
      when: (ctx) => (ctx.mainnet.identity ? true : 'no "identity" in the deploy config (it needs identity.web, the Neuro web page https://<host>/web/)'),
      async run(ctx, state) {
        const o = afterHandover(state);
        const s = signer(ctx);
        const ds = P.identity(ctx, o).deploys;
        const idr = await deployOne(ctx, s, ds[0]);
        const val = await deployOne(ctx, s, { ...ds[1], args: [idr.target, ...ds[1].args.slice(1)] });
        await wait(idr.setAdmin(o.timelock));
        if (!same(await idr.admin(), o.timelock)) throw new Error('NeuroIdentity: admin() is not the timelock after setAdmin');
        if ((await idr.localCaip2Hash()) !== keccak256(Buffer.from(`eip155:${ctx.evmChainId}`))) throw new Error(`NeuroIdentity: its own chain is not eip155:${ctx.evmChainId}`);
        ctx.log(`  NeuroIdentity admin: the timelock ${o.timelock}; web ${ctx.mainnet.identity.web}; ZETAPHY is eip155:${ctx.evmChainId}`);
        return haveCode(ctx, { neuroIdentity: getAddress(idr.target), neuroValidation: getAddress(val.target) });
      },
    }),
    withPlan({
      name: 'vault',
      describe: 'RewardVault: releases 10% a year to NeuroJobs (governance: the timelock from its first block; funded later by the rewards pool)',
      async run(ctx, state) {
        const o = afterHandover(state);
        const v = await deployOne(ctx, signer(ctx), P.vault(ctx, o).deploys[0]);
        if (!same(await v.governance(), o.timelock)) throw new Error('RewardVault: governance is not the timelock');
        const shares = await v.shares();
        ctx.log(`  RewardVault shares: ${shares.map((x) => `${Number(x.bps) / 100}% to ${x.to}${x.callFund ? ' (fund())' : ''}`).join(', ')}`);
        return haveCode(ctx, { rewardVault: getAddress(v.target) });
      },
    }),
    withPlan({
      name: 'pq',
      describe: 'QuantumWalletFactory: post-quantum smart wallets (no admin)',
      async run(ctx, state) {
        afterHandover(state);
        const k = await deployOne(ctx, signer(ctx), P.pq(ctx).deploys[0]);
        return haveCode(ctx, { quantumWalletFactory: getAddress(k.target) });
      },
    }),
    withPlan({
      name: 'compute',
      describe: 'ComputeMarket: escrowed AI jobs for runners with a NeuroJobs record (no admin)',
      async run(ctx, state) {
        const o = afterHandover(state);
        const k = await deployOne(ctx, signer(ctx), P.compute(ctx, o).deploys[0]);
        ctx.log(`  runners need ${ctx.mainnet.compute.minAgreed} accepted verdict(s)`);
        return haveCode(ctx, { computeMarket: getAddress(k.target) });
      },
    }),
    withPlan({
      name: 'dlmm',
      describe: 'the DLMM (UNAUDITED): factory with the timelock as governance, its pair deployer, the router; its set-up goes into the timelock proposal',
      async run(ctx, state) {
        const o = afterHandover(state);
        if (!o.dex?.contracts?.wnative) throw new Error('no DEX in the state: the DLMM uses the DEX\'s wrapped native');
        const s = signer(ctx);
        const ds = P.dlmm(ctx, o).deploys;
        const factory = await deployOne(ctx, s, ds[0]);
        const router = await deployOne(ctx, s, { ...ds[1], args: [factory.target, o.dex.contracts.wnative] });
        if (!same(await factory.governance(), o.timelock) || !same(await factory.pendingGovernance(), ZeroAddress)) throw new Error('ZetaphyDlmmFactory: governance is not the timelock');
        const pairCodeHash = await factory.PAIR_CODE_HASH();
        if (pairCodeHash !== keccak256(DLMM('ZetaphyDlmmPair').bytecode)) throw new Error('PAIR_CODE_HASH does not match zetaphy-dex/artifacts/ZetaphyDlmmPair.json');
        const contracts = { dlmmFactory: getAddress(factory.target), dlmmRouter: getAddress(router.target), dlmmPairDeployer: getAddress(await factory.pairDeployer()), dlmmPairCodeHash: pairCodeHash };
        await haveCode(ctx, { f: contracts.dlmmFactory, r: contracts.dlmmRouter, d: contracts.dlmmPairDeployer });
        ctx.log(`  DLMM factory ${contracts.dlmmFactory} (governance: the timelock), router ${contracts.dlmmRouter}; no preset yet: the proposal step writes the timelock batch that sets them`);
        return { dlmm: { unaudited: true, contracts, wnative: getAddress(o.dex.contracts.wnative), governance: o.timelock, presets: [] } };
      },
    }),
    withPlan({
      name: 'nft',
      describe: 'NFTFactory + NFTMarketplace (governance: the timelock from its first block), the marketplace checking the ThreatRegistry',
      async run(ctx, state) {
        const o = afterHandover(state);
        const s = signer(ctx);
        const ds = P.nft(ctx, o).deploys;
        const factory = await deployOne(ctx, s, ds[0]);
        const market = await deployOne(ctx, s, { ...ds[1], args: [...ds[1].args.slice(0, 4), factory.target] });
        if (!same(await market.governance(), o.timelock)) throw new Error('NFTMarketplace: governance is not the timelock');
        const reg = new Contract(o.threatRegistry, NET('ThreatRegistry').abi, ctx.provider);
        const hashes = nftCodeHashes();
        const keys = { erc721: await reg.codeKey(hashes.erc721), erc1155: await reg.codeKey(hashes.erc1155) };
        const nft = { factory: getAddress(factory.target), marketplace: getAddress(market.target), threatRegistry: o.threatRegistry, governance: o.timelock,
          feeRecipient: ctx.mainnet.nft.feeRecipient, feeBps: ctx.mainnet.nft.feeBps, chainId: Number(ctx.evmChainId), collectionCodeHashes: hashes, collectionCodeKeys: keys };
        await haveCode(ctx, { factory: nft.factory, marketplace: nft.marketplace });
        ctx.log(`  NFT marketplace fee ${ctx.mainnet.nft.feeBps / 100}% to ${ctx.mainnet.nft.feeRecipient}; governance the timelock`);
        return { nft };
      },
    }),
    withPlan({
      name: 'oracle',
      describe: 'TwapRecorder + ZetaphyPythRelay + ZetaphyOracle: the guardian may pause a feed; governance to the timelock',
      async run(ctx, state) {
        const o = afterHandover(state);
        const g = guardianOf(ctx, o);
        if (!g) throw new Error('no guardian: the deploy config\'s guardian, or the guardian step\'s multisig');
        const s = signer(ctx);
        const ds = P.oracle(ctx, o).deploys;
        const twap = await deployOne(ctx, s, ds[0]);
        const relay = await deployOne(ctx, s, ds[1]);
        const oracle = await deployOne(ctx, s, { ...ds[2], args: [ctx.address, twap.target, relay.target] });
        await wait(oracle.setGuardian(g, true));
        const out = { twapRecorder: getAddress(twap.target), pythRelay: getAddress(relay.target), oracle: getAddress(oracle.target) };
        const feed = ctx.mainnet.oracle.pythZetaFeed;
        if (feed && o.dex?.contracts?.wnative) {
          const asset = getAddress(o.dex.contracts.wnative);
          await wait(oracle.setPythFeed(asset, feed, 120, 100));
          await wait(oracle.setGuards(asset, 200, 1500, 3000, 3600));
          out.zetaAsset = asset;
        }
        await wait(oracle.setGovernance(o.timelock));
        if (!same(await oracle.governance(), o.timelock) || !same(await relay.governance(), o.timelock)) throw new Error('the oracle\'s governance is not the timelock');
        if (!(await oracle.guardian(g)) || (await oracle.guardian(ctx.address))) throw new Error('ZetaphyOracle: the guardian is not set, or the deployer is one');
        ctx.log(`  ZetaphyOracle ${out.oracle}: guardian ${g}; governance the timelock${feed ? `; Pyth feed ${feed}` : '; no feed yet'}`);
        return haveCode(ctx, out);
      },
    }),
    withPlan({
      name: 'protect',
      always: true,
      describe: 'check the NFT collections\' shared code keys are protected in the ThreatRegistry (the timelock governs it: what is missing goes into the proposal)',
      async run(ctx, state) {
        const o = outputs(state);
        if (!o.nft) { ctx.log('  no NFT factory in the state: nothing to protect'); return {}; }
        const reg = new Contract(o.threatRegistry, NET('ThreatRegistry').abi, ctx.provider);
        const keys = Object.values(o.nft.collectionCodeKeys ?? {});
        const missing = [];
        for (const k of keys) if (!(await reg.protectedKey(k))) missing.push(k);
        ctx.log(missing.length ? `  ${missing.length} of ${keys.length} code key(s) not protected yet: the proposal step puts ThreatRegistry.setProtected into the timelock batch` : `  ${keys.length} shared code key(s) protected`);
        return { protectedKeys: keys.filter((k) => !missing.includes(k)), unprotectedKeys: missing };
      },
    }),
    withPlan({
      name: 'proposal',
      always: true,
      describe: 'write the timelock batch for what only the timelock can do now (the DLMM set-up, the NFT code keys): the gov proposal that schedules it and the executeBatch that runs it',
      async run(ctx, state) { afterHandover(state); return { governanceProposal: await timelockProposal(ctx, state) }; },
    }),
  ];
}

// ---------- the timelock batch and its gov proposal ----------

const STATES = ['Unset', 'Waiting', 'Ready', 'Done'];
export const proposalSalt = (chainId, timelock) => hashText(`zetaphy-launch mainnet systems ${chainId} ${getAddress(timelock)}`);

/** What only the timelock can do now, read on-chain: [{ to, data, what }]. */
export async function timelockCalls(ctx, o) {
  const p = ctx.provider;
  const calls = [];
  const add = (k, fn, args, what) => calls.push({ to: getAddress(k.target), data: k.interface.encodeFunctionData(fn, args), what });
  if (o.dlmm) {
    const f = new Contract(o.dlmm.contracts.dlmmFactory, DLMM('ZetaphyDlmmFactory').abi, p);
    // the router's Neuro check first, so it is on before any pair can exist
    if (o.threatRegistry && !same(await f.threatRegistry(), o.threatRegistry)) add(f, 'setThreatRegistry', [o.threatRegistry], `ZetaphyDlmmFactory.setThreatRegistry(${o.threatRegistry})`);
    const have = new Set((await f.presetSteps()).map(Number));
    for (const [step, pr] of Object.entries(await dlmmPresets(ctx))) {
      if (!have.has(Number(step))) add(f, 'setPreset', [Number(step), pr], `ZetaphyDlmmFactory.setPreset(${step}, [${pr.join(', ')}])`);
    }
    const feeTo = ctx.mainnet.dlmm?.feeTo;
    if (feeTo && !same(await f.feeTo(), feeTo)) add(f, 'setFeeTo', [feeTo], `ZetaphyDlmmFactory.setFeeTo(${feeTo})`);
  }
  if (o.nft && o.threatRegistry) {
    const reg = new Contract(o.threatRegistry, NET('ThreatRegistry').abi, p);
    const missing = [];
    for (const k of Object.values(o.nft.collectionCodeKeys ?? {})) if (!(await reg.protectedKey(k))) missing.push(k);
    if (missing.length) add(reg, 'setProtected', [missing, true], `ThreatRegistry.setProtected([${missing.join(', ')}], true)  (the NFT collections' code keys)`);
  }
  return calls;
}

async function roleMembers(tl, role) {
  const n = Number(await tl.getRoleMemberCount(role));
  return Promise.all(Array.from({ length: n }, (_, i) => tl.getRoleMember(role, i)));
}

/**
 * The timelock batch of timelockCalls(), checked and written out. Each call is simulated as the timelock (eth_call
 * from it), the schedule as each proposer. Files, next to the state file:
 *   <state>.gov-proposal.json   for gov.sh propose-file / zetaphyd tx gov submit-proposal (when the gov module proposes)
 *   <state>.timelock-batch.json the calls, the operation id, the scheduleBatch for a multisig proposer, the executeBatch
 * Returns what the state keeps: { operationId, state, calls, files } or null when nothing is needed.
 */
export async function timelockProposal(ctx, state) {
  const o = outputs(state);
  const p = ctx.provider;
  const calls = await timelockCalls(ctx, o);
  if (!calls.length) { ctx.log('  nothing needs the timelock: no proposal'); return null; }
  const tl = new Contract(o.timelock, NET('ZetaphyTimelock').abi, p);
  const delay = await tl.getMinDelay();
  const salt = proposalSalt(ctx.evmChainId, o.timelock);
  const targets = calls.map((c) => c.to), values = calls.map(() => 0n), datas = calls.map((c) => c.data);
  const id = await tl.hashOperationBatch(targets, values, datas, ZeroHash, salt);
  const st = STATES[Number(await tl.getOperationState(id))];
  for (const c of calls) {
    try { await p.call({ from: o.timelock, to: c.to, data: c.data }); } catch (e) { throw new Error(`${c.what}: fails when the timelock sends it (${e.shortMessage ?? e.message}): no proposal written`); }
  }
  const scheduleData = tl.interface.encodeFunctionData('scheduleBatch', [targets, values, datas, ZeroHash, salt, delay]);
  const executeData = tl.interface.encodeFunctionData('executeBatch', [targets, values, datas, ZeroHash, salt]);
  const proposers = await roleMembers(tl, TIMELOCK_ROLES.proposer);
  const executors = await roleMembers(tl, TIMELOCK_ROLES.executor);
  const openExec = executors.some((e) => same(e, ZeroAddress));
  // the gas the gov module's MsgEVMCall may use: scheduleBatch stores one timestamp and logs each call (generous)
  const gasLimit = 1_000_000n + 100_000n * BigInt(calls.length) + 64n * BigInt((scheduleData.length - 2) / 2);
  if (st === 'Unset') {
    for (const who of proposers) {
      if (same(who, GOV_MODULE)) {
        // the node answers no eth_call from a module account: scheduleBatch only needs the role, an unused id and the delay
        if (!(await tl.hasRole(TIMELOCK_ROLES.proposer, GOV_MODULE))) throw new Error('the timelock batch: the gov module is not a proposer');
        continue;
      }
      try { await p.estimateGas({ from: who, to: o.timelock, data: scheduleData }); } catch (e) { throw new Error(`the timelock batch: scheduling it as the proposer ${who} fails (${e.shortMessage ?? e.message})`); }
    }
  }
  const title = `ZETAPHY mainnet: timelock batch ${id.slice(0, 10)} (${[o.dlmm && calls.some((c) => c.what.startsWith('ZetaphyDlmm')) ? 'DLMM set-up' : null, calls.some((c) => c.what.startsWith('ThreatRegistry')) ? 'NFT code keys' : null].filter(Boolean).join(', ')})`;
  const summary = `Schedules ONE operation on the ZetaphyTimelock ${o.timelock} (operation ${id}, salt ${salt}, delay ${delay} s; cancellable by a canceller until it runs): `
    + calls.map((c, i) => `${i + 1}. ${c.what} on ${c.to}`).join('; ')
    + `. After the delay ${openExec ? 'anyone' : 'an executor'} runs it: executeBatch on the timelock (zetaphy-launch writes its calldata next to its state file, in <state>.timelock-batch.json). Written by zetaphy-launch --network mainnet.`;
  const govProposal = proposers.some((x) => same(x, GOV_MODULE)) ? {
    messages: [{ '@type': '/zetaphy.pq.v1.MsgEVMCall', Sender: GOV_MODULE_BECH32, To: getAddress(o.timelock), Value: '0', Data: Buffer.from(scheduleData.slice(2), 'hex').toString('base64'), GasLimit: String(gasLimit) }],
    metadata: '', deposit: `${ctx.mainnet.proposalDepositWei}azetaphy`, title: title.slice(0, 140), summary, expedited: false,
  } : null;
  const batch = {
    _comment: 'zetaphy-launch --network mainnet: what only the timelock can do now, as ONE timelock operation. Public values only.',
    chainId: Number(ctx.evmChainId), timelock: getAddress(o.timelock), operationId: id, state: st, predecessor: ZeroHash, salt, delay: Number(delay),
    calls: calls.map((c) => ({ to: c.to, value: '0', data: c.data, what: c.what })),
    schedule: { to: getAddress(o.timelock), data: scheduleData, by: proposers, note: proposers.some((x) => same(x, GOV_MODULE)) ? 'the gov module: submit the gov proposal file (gov.sh propose-file), then vote' : 'a proposer multisig sends this' },
    execute: { to: getAddress(o.timelock), value: '0', data: executeData, by: openExec ? 'anyone, once the delay has passed' : executors },
  };
  const files = {};
  if (ctx.stateFile) {
    const base = ctx.stateFile.replace(/\.json$/, '');
    mkdirSync(dirname(ctx.stateFile), { recursive: true });
    files.batch = `${base}.timelock-batch.json`;
    writeFileSync(files.batch, JSON.stringify(batch, null, 2) + '\n');
    if (govProposal) { files.gov = `${base}.gov-proposal.json`; writeFileSync(files.gov, JSON.stringify(govProposal, null, 2) + '\n'); }
    // timelockExecutor "governance": only the proposers execute, so the gov module needs a second vote, after the delay
    if (govProposal && !openExec && executors.some((x) => same(x, GOV_MODULE))) {
      files.govExecute = `${base}.gov-execute-proposal.json`;
      writeFileSync(files.govExecute, JSON.stringify({ ...govProposal, messages: [{ ...govProposal.messages[0], Data: Buffer.from(executeData.slice(2), 'hex').toString('base64') }],
        title: `${govProposal.title} (execute)`.slice(0, 140), summary: `Runs operation ${id} on the ZetaphyTimelock ${o.timelock} (executeBatch), once its delay has passed: ${calls.map((c) => c.what).join('; ')}` }, null, 2) + '\n');
    }
  }
  ctx.log(`  timelock operation ${id} (${st}): ${calls.length} call(s), each simulated as the timelock:`);
  for (const c of calls) ctx.log(`    ${c.what}`);
  if (st === 'Unset') {
    if (govProposal) ctx.log(`  the gov module schedules it: bash zetaphy-chain/gov.sh propose-file ${files.gov ?? '<state>.gov-proposal.json'}  (deposit ${formatEther(ctx.mainnet.proposalDepositWei)} ${ctx.symbol}), then vote`);
    for (const x of proposers.filter((y) => !same(y, GOV_MODULE))) ctx.log(`  or the proposer ${x} sends to ${o.timelock} the scheduleBatch data in ${files.batch ? basename(files.batch) : 'the batch file'}`);
  }
  if (st !== 'Done') ctx.log(`  after the ${delay} s delay ${openExec ? 'anyone' : 'an executor'} sends executeBatch: to ${o.timelock}, data in ${files.batch ? basename(files.batch) : 'the batch file'} (execute.data)`);
  return { operationId: id, state: st, calls: calls.map((c) => c.what), ...(files.batch ? { files: Object.values(files) } : {}) };
}

// ---------- the on-chain check of the added contracts (called by verifyMainnet) ----------

/** Pushes a problem for every role a new contract gives the deployer or an EOA, and a line per contract. */
export async function verifyAdded(ctx, o, problems, lines) {
  const p = ctx.provider;
  const me = ctx.address;
  const C = (a, n, pkg = 'zetaphy-network') => new Contract(a, art(pkg, n).abi, p);
  const isContract = async (a) => same(a, GOV_MODULE) || (await p.getCode(a)) !== '0x';
  const line = (name, a, what) => lines.push(`${name.padEnd(18)} ${a}  ${what}`);
  if (o.neuroIdentity) {
    const k = C(o.neuroIdentity, 'NeuroIdentity');
    if (!same(await k.claimRunners(), o.neuroJobs)) problems.push('NeuroIdentity: its claim runners are not NeuroJobs');
    if ((await k.localCaip2Hash()) !== keccak256(Buffer.from(`eip155:${ctx.evmChainId}`))) problems.push(`NeuroIdentity: its own chain is not eip155:${ctx.evmChainId}`);
    line('NeuroIdentity', o.neuroIdentity, `admin ${await k.admin()}`);
  }
  if (o.neuroValidation) {
    const k = C(o.neuroValidation, 'NeuroValidation');
    if (!same(await k.identityRegistry(), o.neuroIdentity) || !same(await k.runners(), o.neuroJobs)) problems.push('NeuroValidation: not wired to this NeuroIdentity and NeuroJobs');
    line('NeuroValidation', o.neuroValidation, 'no admin');
  }
  if (o.rewardVault) {
    const k = C(o.rewardVault, 'RewardVault');
    for (const s of [...(await k.shares()), ...(await k.pendingShares())]) if (same(s.to, me)) problems.push('RewardVault: a share goes to the deployer');
    if (!(await k.shares()).some((s) => same(s.to, o.neuroJobs))) problems.push('RewardVault: no share to NeuroJobs');
  }
  if (o.computeMarket) {
    if (!same(await C(o.computeMarket, 'ComputeMarket').runners(), o.neuroJobs)) problems.push('ComputeMarket: its runners are not NeuroJobs');
    line('ComputeMarket', o.computeMarket, 'no admin');
  }
  if (o.quantumWalletFactory) line('QuantumWalletFactory', o.quantumWalletFactory, 'no admin');
  if (o.dlmm) {
    const f = C(o.dlmm.contracts.dlmmFactory, 'ZetaphyDlmmFactory', 'zetaphy-dex');
    if (same(await f.feeTo(), me)) problems.push('DLMM factory: feeTo is the deployer');
    if (!same(await C(o.dlmm.contracts.dlmmRouter, 'ZetaphyDlmmRouter', 'zetaphy-dex').factory(), o.dlmm.contracts.dlmmFactory)) problems.push('DLMM router: not this factory\'s');
    if (!same(await f.pairDeployer(), o.dlmm.contracts.dlmmPairDeployer)) problems.push('DLMM factory: another pair deployer');
    const steps = (await f.presetSteps()).map(Number);
    line('DLMM router', o.dlmm.contracts.dlmmRouter, `presets ${steps.length ? steps.join(', ') : 'none yet (the timelock batch sets them)'}; registry ${await f.threatRegistry()}`);
  }
  if (o.nft) {
    const m = C(o.nft.marketplace, 'NFTMarketplace', 'zetaphy-nft');
    if (same(await m.feeRecipient(), me)) problems.push('NFT marketplace: the fee goes to the deployer');
    if (!same(await m.factory(), o.nft.factory)) problems.push('NFT marketplace: not this NFT factory\'s');
    if (!same(await m.threatRegistry(), o.threatRegistry)) problems.push('NFT marketplace: it does not check this ThreatRegistry');
    line('NFTFactory', o.nft.factory, 'no admin');
  }
  if (o.pythRelay) {
    const r = C(o.pythRelay, 'ZetaphyPythRelay');
    if (await r.isRelayer(me)) problems.push('ZetaphyPythRelay: the deployer is a relayer');
  }
  if (o.oracle) {
    const k = C(o.oracle, 'ZetaphyOracle');
    const g = guardianOf(ctx, o);
    if (!same(await k.recorder(), o.twapRecorder) || !same(await k.pyth(), o.pythRelay)) problems.push('ZetaphyOracle: not wired to this TwapRecorder and ZetaphyPythRelay');
    if (!g || !(await k.guardian(g))) problems.push(`ZetaphyOracle: the guardian ${g} cannot pause a feed`);
    else if (!(await isContract(g))) problems.push(`ZetaphyOracle: the guardian ${g} is an EOA`);
    line('TwapRecorder', o.twapRecorder, 'no owner');
  }
  const gp = o.governanceProposal;
  if (gp?.operationId) {
    const st = STATES[Number(await C(o.timelock, 'ZetaphyTimelock').getOperationState(gp.operationId))];
    lines.push(`${'timelock batch'.padEnd(18)} ${gp.operationId}  ${st}${st === 'Done' ? '' : ` (${gp.calls.length} call(s) only the timelock can make: ${(gp.files ?? []).join(', ') || 'see the proposal step'})`}`);
  }
}

/** For the end of a run: the added systems' addresses that are not plain outputs. */
export function addedAddressLines(o) {
  const out = [];
  if (o.dlmm) out.push(['DLMM factory/router', `${o.dlmm.contracts.dlmmFactory} / ${o.dlmm.contracts.dlmmRouter} (UNAUDITED; pair deployer ${o.dlmm.contracts.dlmmPairDeployer})`]);
  if (o.nft) out.push(['NFT factory/market', `${o.nft.factory} / ${o.nft.marketplace}`]);
  return out;
}

