// The mainnet mode of the launch (docs/ZETAPHY-MAINNET-PROCEDURE.md, step 16; runbook gate 8).
//
// What differs from the testnet launch, and why:
//   - the chain: chain id and EVM chain id come from the published chain.json (make-genesis.sh finalize) and/or the
//     node's pin (/etc/zetaphy/pinned-chain.env) with the genesis it pins; never a default. An RPC that answers
//     another eth_chainId is refused before anything is signed, and every transaction carries the configured id.
//   - the key: an encrypted keystore or a remote/hardware signer (src/signer.js); no plain key in a file, the
//     environment or argv. Everything runs in this process (no child tool gets a key file).
//   - the contracts: the gate-8 set, with mainnet parameters from a deploy config (mainnet.example.json):
//     the guardian multisig; Neuro (NeuroControl + NeuroJobs, ThreatRegistry, ThreatReports); the Saphan bridge
//     (BridgeGuard + BridgeAirlock + NeuroLane) deployed CLOSED; the DEX (factory + router, no test tokens, no
//     seeded pools); ZetaphyBounty (funded); then the ZetaphyTimelock and the handover. After the handover, the
//     rest of the testnet's real systems (src/mainnetall.js: NeuroIdentity + NeuroValidation, RewardVault,
//     QuantumWalletFactory, ComputeMarket, the DLMM, the NFT factory + marketplace, the oracle), each handing its
//     roles straight to that timelock. No faucet, no test stablecoins, no StableGateway, no fixed test price, no
//     test tokens or seeded pools, no web-app config writes, no snap build (MAINNET_EXCLUDED, printed in the plan).
//     Neuro comes before the bridge and the DEX because both read it (NeuroLane runs on NeuroJobs; the bridge and the
//     DEX router check the ThreatRegistry). The timelock is deployed just before the handover so its bootstrap
//     (the deployer as its only proposer at a zero delay) lasts minutes, and the handover's audit of it stays short.
//   - the timelock delay: at least 48 h (172800 s); never --devnet.
//   - a dry run that prints every contract, its constructor arguments, every call and the expected gas and cost
//     in the chain's coin, and sends nothing; a real run needs --confirm-chain <EVM chain id>.
//   - the end: the handover (src/steps.js) gives every admin role to the timelock, then `verify` checks on-chain
//     that no EOA, and not the deployer, keeps any role on any contract this run deployed (the added ones included).

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Contract, ContractFactory, encodeBytes32String, formatEther, formatUnits, getAddress, isAddress, keccak256, parseEther, parseUnits, ZeroAddress } from 'ethers';
import { outputs, assertNoSecrets } from './runner.js';
import { later, isLater, real, ref, resolveArgs, dep, deployOne } from './plan.js';
import { addedPlans, addedSteps, verifyAdded, MAINNET_EXCLUDED } from './mainnetall.js';
import { aiConfig, aiRoleHolders, aiPlans, aiSteps, verifyAi, contractsStep } from './mainnetai.js';
import { launchSteps, art, NET, haveCode, signer, wait, same, bridgeOpen, BRIDGE_GATES, adminRoles, guardianRoles, ROOT, GOV_MODULE, EVM_CHAIN_ID as TESTNET_EVM_CHAIN_ID } from './steps.js';

export const MAINNET_MIN_DELAY = 48 * 3600;
export const TESTNET_CHAIN_ID = 'zetaphy_77390-1';
export const NATIVE_PRECOMPILE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// ---------- the chain ----------

/** KEY=VALUE lines of the node's pin file (setup-node.sh writes GENESIS_SHA256, GENESIS_EVM_CHAIN_ID, PUBLIC_RPC). */
export function readPin(file) {
  if (!existsSync(file)) throw new Error(`--pin: no file at ${file}`);
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=([0-9a-f]*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  if (!/^[0-9a-f]{64}$/.test(out.GENESIS_SHA256 ?? '') || !/^[1-9][0-9]{0,15}$/.test(out.GENESIS_EVM_CHAIN_ID ?? '')) throw new Error(`${file}: not a pin file (GENESIS_SHA256 and GENESIS_EVM_CHAIN_ID expected)`);
  return out;
}

/**
 * The mainnet's identity, from the published chain.json (--chain) and/or the pin file (--pin) with the genesis it
 * pins (--genesis). Every source given must agree; at least chain.json or pin + genesis. Never the testnet's ids.
 * Returns { chainId (cosmos), evmChainId (bigint), genesisSha256, symbol, sources }.
 */
export function loadChain({ chain, pin, genesis } = {}) {
  const got = { chainId: [], evm: [], sha: [] };
  let symbol = null;
  const sources = [];
  if (chain) {
    if (!existsSync(chain)) throw new Error(`--chain: no file at ${chain}`);
    let c;
    try { c = JSON.parse(readFileSync(chain, 'utf8')); } catch { throw new Error(`--chain ${chain}: not JSON (make-genesis.sh finalize writes chain.json)`); }
    if (typeof c.chain_id !== 'string' || !Number.isInteger(Number(c.evm_chain_id)) || !/^[0-9a-f]{64}$/.test(c.genesis_sha256 ?? '')) throw new Error(`--chain ${chain}: chain_id, evm_chain_id and genesis_sha256 expected (make-genesis.sh finalize writes chain.json)`);
    got.chainId.push(['chain.json', c.chain_id]); got.evm.push(['chain.json', String(c.evm_chain_id)]); got.sha.push(['chain.json', c.genesis_sha256]);
    symbol = typeof c.symbol === 'string' ? c.symbol : null;
    sources.push(chain);
  }
  if (pin) {
    const p = readPin(pin);
    got.evm.push(['pin', p.GENESIS_EVM_CHAIN_ID]); got.sha.push(['pin', p.GENESIS_SHA256]);
    sources.push(pin);
  }
  if (genesis) {
    if (!existsSync(genesis)) throw new Error(`--genesis: no file at ${genesis}`);
    const buf = readFileSync(genesis);
    got.sha.push(['genesis file', createHash('sha256').update(buf).digest('hex')]);
    let g;
    try { g = JSON.parse(buf.toString('utf8')); } catch { throw new Error(`--genesis ${genesis}: not JSON`); }
    got.chainId.push(['genesis file', g.chain_id]);
    const a = g.app_state ?? {};
    const d = a.staking?.params?.bond_denom;
    const m = (a.bank?.denom_metadata ?? []).find((x) => x.base === d);
    if (m?.symbol) symbol = symbol ?? m.symbol;
    sources.push(genesis);
  }
  if (!chain && !(pin && genesis)) throw new Error('--network mainnet needs the chain it is for: --chain <chain.json> (make-genesis.sh finalize), or --pin /etc/zetaphy/pinned-chain.env with --genesis <genesis.json>');
  for (const [k, list] of Object.entries(got)) {
    const vals = new Set(list.map(([, v]) => String(v)));
    if (vals.size > 1) throw new Error(`the chain sources disagree on the ${{ chainId: 'chain id', evm: 'EVM chain id', sha: 'genesis sha256' }[k]}: ${list.map(([w, v]) => `${w} ${v}`).join(', ')}: refused`);
  }
  const chainId = got.chainId[0]?.[1] ?? null;
  const evmChainId = BigInt(got.evm[0][1]);
  if (evmChainId === TESTNET_EVM_CHAIN_ID || chainId === TESTNET_CHAIN_ID) throw new Error(`that is the testnet (${chainId ?? ''} EVM ${evmChainId}): --network mainnet is for another chain; the testnet launch takes no --network`);
  if (chainId != null && !/^[a-z][a-z0-9]*_[0-9]+-[0-9]+$/.test(chainId)) throw new Error(`chain id ${chainId}: not a <name>_<number>-<number> chain id`);
  if (chainId != null && chainId.split('_')[1].split('-')[0] !== String(evmChainId)) throw new Error(`chain id ${chainId} and EVM chain id ${evmChainId} must agree`);
  return { chainId, evmChainId, genesisSha256: got.sha[0][1], symbol: symbol ?? 'ZTPHY', sources };
}

// ---------- the deploy config ----------

const isPlaceholder = (a) => /^0x(.)\1{39}$/i.test(a) || /^0x0*$/i.test(a);
function addr(v, what, { gov = false } = {}) {
  if (gov && v === 'gov') return GOV_MODULE;
  if (typeof v !== 'string' || !ADDR_RE.test(v)) throw new Error(`deploy config ${what}: a 0x address${gov ? ' or "gov"' : ''}`);
  if (isPlaceholder(v)) throw new Error(`deploy config ${what}: ${v} is a placeholder: put the real address`);
  return getAddress(v);
}
const addrs = (v, what) => { if (!Array.isArray(v)) throw new Error(`deploy config ${what}: a list of 0x addresses`); const out = v.map((x, i) => addr(x, `${what}[${i}]`)); if (new Set(out).size !== out.length) throw new Error(`deploy config ${what}: an address is listed twice`); return out; };
function int(v, what, min, max) { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`deploy config ${what}: a whole number from ${min} to ${max}`); return n; }
function coin(v, what, { zero = false } = {}) { const s = String(v ?? ''); if (!/^\d{1,12}(\.\d{1,18})?$/.test(s) || (!zero && parseEther(s) === 0n)) throw new Error(`deploy config ${what}: an amount of coins, e.g. "100"`); return s; }
/** An https URL a contract stores (printable, no quotes or spaces, at most 200 bytes); example / test hosts are refused. */
function httpsUrl(v, what, hint) {
  let u;
  try { u = new URL(String(v ?? '')); } catch { throw new Error(`deploy config ${what}: ${hint}`); }
  if (u.protocol !== 'https:' || u.username || u.password || !/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~%\/+=&?#:@!$*,;-]*)?$/.test(String(v)) || String(v).length > 200) throw new Error(`deploy config ${what}: ${hint}`);
  if (/(^|\.)(example(\.(com|org|net))?|invalid|test|localhost|local)$/i.test(u.hostname) || /^[\d.]+$/.test(u.hostname)) throw new Error(`deploy config ${what}: ${v} is a placeholder: put the real URL`);
  return String(v);
}
function only(o, keys, what) { if (o == null || typeof o !== 'object' || Array.isArray(o)) throw new Error(`deploy config ${what}: an object`); for (const k of Object.keys(o)) if (!keys.includes(k) && k !== '_comment') throw new Error(`deploy config ${what}: unknown key "${k}" (known: ${keys.join(', ')})`); return o; }

/** The mainnet's Neuro, registry, reports, bridge, DEX and bounty settings, checked. `deployer` may hold none of them. */
export function mainnetConfig(raw, { deployer } = {}) {
  assertNoSecrets(raw, 'deploy config');
  const c = only(raw, ['governance', 'timelockProposers', 'timelockExecutor', 'timelockDelay', 'guardian', 'guardianOwners', 'guardianThreshold', 'communityFund', 'neuro', 'threats', 'reports', 'bridge', 'dex', 'bounty',
    'identity', 'vault', 'compute', 'dlmm', 'nft', 'oracle', 'proposalDeposit', 'ai'], '');
  if (c.governance == null) throw new Error('deploy config governance: "gov" (the chain\'s gov module) or 0x<multisig>: the timelock\'s proposer');
  const out = {};
  out.governance = addr(c.governance, 'governance', { gov: true });
  out.extraProposers = addrs(c.timelockProposers ?? [], 'timelockProposers');
  out.executorMode = String(c.timelockExecutor ?? 'open');
  if (!['open', 'governance'].includes(out.executorMode)) throw new Error('deploy config timelockExecutor: "open" (anyone) or "governance"');
  out.timelockDelay = int(c.timelockDelay ?? MAINNET_MIN_DELAY, 'timelockDelay', MAINNET_MIN_DELAY, 30 * 86400);
  if (c.guardian != null && c.guardianOwners != null) throw new Error('deploy config: guardian (an existing multisig) or guardianOwners (a new one), not both');
  if (c.guardian == null && c.guardianOwners == null) throw new Error('deploy config: guardian 0x<emergency multisig> or guardianOwners [0x…, 0x…]: with every admin role behind the timelock, it is who can pause at once');
  out.guardian = c.guardian != null ? addr(c.guardian, 'guardian') : null;
  out.guardianOwners = c.guardianOwners != null ? addrs(c.guardianOwners, 'guardianOwners') : [];
  out.guardianThreshold = int(c.guardianThreshold ?? 2, 'guardianThreshold', 2, 20);
  if (out.guardianOwners.length && (out.guardianOwners.length < out.guardianThreshold || out.guardianOwners.length > 20)) throw new Error('deploy config guardianOwners: at least guardianThreshold (2+) and at most 20 owners');
  out.communityFund = addr(c.communityFund, 'communityFund');
  const n = only(c.neuro ?? {}, ['bond', 'reward', 'minFee', 'commitWindow', 'timeout', 'unbondDelay', 'dailyRewardCap', 'maxBodies', 'maxRegrowPerHour'], 'neuro');
  out.neuro = { bond: coin(n.bond ?? '100', 'neuro.bond'), reward: coin(n.reward ?? '1', 'neuro.reward', { zero: true }), minFee: coin(n.minFee ?? '0.1', 'neuro.minFee'),
    commitWindow: int(n.commitWindow ?? 120, 'neuro.commitWindow', 1, 86400), timeout: int(n.timeout ?? 600, 'neuro.timeout', 1, 30 * 86400),
    unbondDelay: int(n.unbondDelay ?? 3600, 'neuro.unbondDelay', 1, 365 * 86400), dailyRewardCap: coin(n.dailyRewardCap ?? '100', 'neuro.dailyRewardCap', { zero: true }),
    maxBodies: int(n.maxBodies ?? 64, 'neuro.maxBodies', 1, 1024), maxRegrowPerHour: int(n.maxRegrowPerHour ?? 4, 'neuro.maxRegrowPerHour', 1, 1024) };
  const t = only(c.threats ?? {}, ['quorum', 'minAgreed', 'enforceDelay', 'appealBond', 'appealWindow'], 'threats');
  out.threats = { quorum: int(t.quorum ?? 3, 'threats.quorum', 1, 255), minAgreed: int(t.minAgreed ?? 5, 'threats.minAgreed', 0, 2 ** 32 - 1),
    enforceDelay: int(t.enforceDelay ?? 3600, 'threats.enforceDelay', 0, 30 * 86400), appealBond: coin(t.appealBond ?? '1', 'threats.appealBond'),
    appealWindow: int(t.appealWindow ?? 14 * 86400, 'threats.appealWindow', 3600, 90 * 86400) };
  const r = only(c.reports ?? {}, ['fee', 'ttl'], 'reports');
  out.reports = { fee: coin(r.fee ?? '0.1', 'reports.fee'), ttl: int(r.ttl ?? 30 * 86400, 'reports.ttl', 3600, 365 * 86400) };
  if (c.bridge != null) {
    const b = only(c.bridge, ['lockbox', 'tokenName', 'tokenSymbol', 'decimals', 'dailyLimit', 'threshold', 'quarantine', 'laneQuorum', 'laneMinAgreed', 'markers'], 'bridge');
    if (!/^\d+:0x[0-9a-fA-F]{40}$/.test(String(b.lockbox ?? ''))) throw new Error('deploy config bridge.lockbox: <source chain id>:0x<LockBox> (the source chain\'s lockbox, protected in the ThreatRegistry)');
    addr(String(b.lockbox).split(':')[1], 'bridge.lockbox');
    for (const k of ['tokenName', 'tokenSymbol']) if (typeof b[k] !== 'string' || !b[k].trim() || b[k].length > 64) throw new Error(`deploy config bridge.${k}: the bridged token's ${k === 'tokenName' ? 'name' : 'symbol'}`);
    if (/test/i.test(b.tokenName) || /test/i.test(b.tokenSymbol)) throw new Error('deploy config bridge.tokenName / tokenSymbol: a mainnet token is not named "test"');
    const decimals = int(b.decimals ?? 18, 'bridge.decimals', 0, 36);
    const daily = String(b.dailyLimit ?? '1000');
    if (!/^\d{1,9}$/.test(daily) || BigInt(daily) < 1n || BigInt(daily) > 1000n) throw new Error('deploy config bridge.dailyLimit: whole tokens, 1 to 1000 (the starter cap; raised later by governance)');
    out.bridge = { lockbox: String(b.lockbox), tokenName: b.tokenName, tokenSymbol: b.tokenSymbol, decimals, dailyLimit: daily,
      threshold: int(b.threshold ?? 2, 'bridge.threshold', 2, 16), quarantine: int(b.quarantine ?? 3600, 'bridge.quarantine', 600, 7 * 86400),
      laneQuorum: int(b.laneQuorum ?? 2, 'bridge.laneQuorum', 2, 255), laneMinAgreed: int(b.laneMinAgreed ?? 5, 'bridge.laneMinAgreed', 1, 2 ** 32 - 1),
      markers: addrs(b.markers ?? [], 'bridge.markers') };
  } else out.bridge = null;
  const d = only(c.dex ?? {}, ['feeTo'], 'dex');
  out.dex = { feeTo: d.feeTo == null ? null : addr(d.feeTo, 'dex.feeTo') };
  if (c.bounty != null) {
    const b = only(c.bounty, ['committee', 'threshold', 'maxPayout', 'periodCap', 'timelock', 'reportBond', 'fund'], 'bounty');
    const committee = addrs(b.committee ?? [], 'bounty.committee');
    const threshold = int(b.threshold ?? 2, 'bounty.threshold', 2, 16);
    if (committee.length < threshold || committee.length > 16) throw new Error('deploy config bounty.committee: at least bounty.threshold (2+) and at most 16 members');
    const maxPayout = coin(b.maxPayout, 'bounty.maxPayout'), periodCap = coin(b.periodCap, 'bounty.periodCap');
    if (parseEther(periodCap) < parseEther(maxPayout)) throw new Error('deploy config bounty.periodCap: at least bounty.maxPayout');
    out.bounty = { committee, threshold, maxPayout, periodCap, timelock: int(b.timelock ?? MAINNET_MIN_DELAY, 'bounty.timelock', MAINNET_MIN_DELAY, 365 * 86400),
      reportBond: coin(b.reportBond ?? '10', 'bounty.reportBond', { zero: true }), fund: b.fund == null ? null : coin(b.fund, 'bounty.fund') };
  } else out.bounty = null;
  // the systems added after gate 8 (src/mainnetall.js): identity, vault, compute, dlmm, nft, oracle
  if (c.identity != null) {
    const i = only(c.identity, ['web', 'image', 'minAgreed', 'claimQuorum', 'claimMinAgreed', 'claimDelay'], 'identity');
    out.identity = { web: httpsUrl(i.web, 'identity.web', 'the Neuro web page, https://<host>/web/'), image: i.image == null || i.image === '' ? '' : httpsUrl(i.image, 'identity.image', 'an https image URL'),
      minAgreed: int(i.minAgreed ?? 1, 'identity.minAgreed', 1, 2 ** 32 - 1), claimQuorum: int(i.claimQuorum ?? 3, 'identity.claimQuorum', 1, 255),
      claimMinAgreed: int(i.claimMinAgreed ?? 5, 'identity.claimMinAgreed', 1, 2 ** 32 - 1), claimDelay: int(i.claimDelay ?? 3 * 86400, 'identity.claimDelay', 3600, 30 * 86400) };
  } else out.identity = null;
  const v = only(c.vault ?? {}, ['validators', 'validatorsShare'], 'vault');
  if (v.validators == null && v.validatorsShare != null) throw new Error('deploy config vault.validatorsShare: only with vault.validators (the address that rewards validators)');
  out.vault = { validators: v.validators == null ? null : addr(v.validators, 'vault.validators'), validatorsShare: v.validators == null ? 0 : int(v.validatorsShare ?? 30, 'vault.validatorsShare', 1, 99) };
  const cm = only(c.compute ?? {}, ['minAgreed'], 'compute');
  out.compute = { minAgreed: int(cm.minAgreed ?? 1, 'compute.minAgreed', 1, 2 ** 32 - 1) };
  const dl = only(c.dlmm ?? {}, ['feeTo'], 'dlmm');
  out.dlmm = { feeTo: dl.feeTo == null ? out.dex.feeTo : addr(dl.feeTo, 'dlmm.feeTo') };
  const nf = only(c.nft ?? {}, ['feeBps', 'feeRecipient'], 'nft');
  out.nft = { feeBps: int(nf.feeBps ?? 100, 'nft.feeBps', 0, 500), feeRecipient: nf.feeRecipient == null ? out.communityFund : addr(nf.feeRecipient, 'nft.feeRecipient') };
  const or = only(c.oracle ?? {}, ['relayers', 'relayerThreshold', 'twapMinSpacing', 'pythZetaFeed'], 'oracle');
  const relayers = addrs(or.relayers ?? [], 'oracle.relayers');
  const relayerThreshold = int(or.relayerThreshold ?? 1, 'oracle.relayerThreshold', 1, Math.max(1, relayers.length));
  if (or.pythZetaFeed != null && (!/^0x[0-9a-fA-F]{64}$/.test(String(or.pythZetaFeed)) || /^0x(.)\1{63}$/i.test(String(or.pythZetaFeed)))) throw new Error('deploy config oracle.pythZetaFeed: the Pyth price feed id of ZTPHY/USD, 0x + 64 hex (not a placeholder)');
  out.oracle = { relayers, relayerThreshold, twapMinSpacing: int(or.twapMinSpacing ?? 60, 'oracle.twapMinSpacing', 1, 3600), pythZetaFeed: or.pythZetaFeed == null ? null : String(or.pythZetaFeed).toLowerCase() };
  out.proposalDeposit = coin(c.proposalDeposit ?? '10000', 'proposalDeposit');
  // the AI map's contracts (src/mainnetai.js)
  out.ai = aiConfig(c.ai, { only, addr, addrs, int, coin });
  out.proposalDepositWei = parseEther(out.proposalDeposit).toString();
  if (deployer) {
    const roles = [['governance', [out.governance]], ['timelockProposers', out.extraProposers], ['guardian', [out.guardian].filter(Boolean)], ['guardianOwners', out.guardianOwners],
      ['communityFund', [out.communityFund]], ['bridge.markers', out.bridge?.markers ?? []], ['dex.feeTo', [out.dex.feeTo].filter(Boolean)], ['bounty.committee', out.bounty?.committee ?? []],
      ['vault.validators', [out.vault.validators].filter(Boolean)], ['dlmm.feeTo', [out.dlmm.feeTo].filter(Boolean)], ['nft.feeRecipient', [out.nft.feeRecipient]], ['oracle.relayers', out.oracle.relayers], ...aiRoleHolders(out.ai)];
    for (const [k, list] of roles) if (list.some((a) => same(a, deployer))) throw new Error(`deploy config ${k}: the deployer ${deployer} is used once and retired; it may hold no role`);
  }
  return out;
}

// ---------- plans: every contract, its constructor arguments and every call, shared by the dry run and the run ----------

function mainnetPlans() {
  return {
    neuro: (ctx, o) => {
      const n = ctx.mainnet.neuro;
      return {
        deploys: [
          dep('neuroControl', 'NeuroControl', [ctx.address, ctx.mainnet.communityFund, BigInt(n.maxBodies), BigInt(n.maxRegrowPerHour)], { note: 'governance = the deployer until the handover' }),
          dep('neuroJobs', 'NeuroJobs', [parseEther(n.bond), parseEther(n.reward), parseEther(n.minFee), BigInt(n.commitWindow), BigInt(n.timeout), BigInt(n.unbondDelay), parseEther(n.dailyRewardCap)]),
        ],
        calls: ['NeuroJobs.setControl(NeuroControl)', 'NeuroControl.approveSkill(<this repo\'s Neuro skill id>)', 'NeuroControl.setActiveSkill(<skill id>)', `NeuroControl.approveChains(<${ctx.supportedChains?.length ?? 'the'} runner chains>)`],
      };
    },
    threats: (ctx, o) => ({
      deploys: [dep('threatRegistry', 'ThreatRegistry', [ref(o, 'neuroJobs', 'NeuroJobs'), ctx.mainnet.threats.quorum, ctx.mainnet.threats.minAgreed, ctx.address, BigInt(ctx.mainnet.threats.enforceDelay)], { note: 'governance = the deployer until the handover' })],
      calls: [`ThreatRegistry.setAppeals(${ctx.mainnet.threats.appealBond} ${ctx.symbol}, ${ctx.mainnet.threats.appealWindow} s, ${ctx.mainnet.communityFund})`],
    }),
    reports: (ctx, o) => ({
      deploys: [dep('threatReports', 'ThreatReports', [ref(o, 'threatRegistry', 'ThreatRegistry'), ctx.mainnet.communityFund, parseEther(ctx.mainnet.reports.fee), BigInt(ctx.mainnet.reports.ttl)])],
      calls: [],
    }),
    bridge: (ctx, o) => {
      const b = ctx.mainnet.bridge;
      return {
        deploys: [
          dep('bridgeGuard', 'BridgeGuard', [ctx.address], { note: 'governance = the deployer until the handover' }),
          dep('bridgeAirlock', 'BridgeAirlock', [ref(o, 'bridgeGuard', 'BridgeGuard'), encodeBytes32String('airlock'), ctx.address, b.threshold, BigInt(b.quarantine)]),
          dep('neuroLane', 'NeuroLane', [ref(o, 'neuroJobs', 'NeuroJobs'), ref(o, 'bridgeAirlock', 'BridgeAirlock'), b.laneQuorum, b.laneMinAgreed, ref(o, 'neuroControl', 'NeuroControl')]),
        ],
        calls: [`BridgeGuard.createToken("${b.tokenName}", "${b.tokenSymbol}", ${b.decimals})`, `BridgeGuard.setRoute(airlock, BridgeAirlock, ${b.dailyLimit} tokens a day, enabled = false)  CLOSED`,
          'BridgeAirlock.setLane(NeuroLane, true)', 'BridgeAirlock.setVetoer(NeuroLane, true)', ...b.markers.map((m) => `BridgeAirlock.setMarker(${m}, true)`),
          'BridgeAirlock.setThreats(ThreatRegistry)', 'BridgeGuard.setThreats(ThreatRegistry)', `ThreatRegistry.setProtected(<the bridge's own contracts and code, and the lockbox ${b.lockbox}>, true)`],
        value: 0n,
      };
    },
    dex: (ctx, o) => {
      const wn = ctx.dexWnative ?? 'deploy';
      return {
        deploys: [
          ...(wn === 'deploy' ? [dep('wnative', 'WZETAPHY', [], { pkg: 'zetaphy-dex' })] : []),
          dep('dexFactory', 'ZetaphyFactory', [ctx.address], { pkg: 'zetaphy-dex', note: 'governance = the deployer until the handover (two-step: the timelock accepts)' }),
          dep('dexRouter', 'ZetaphyRouter', [ref(o, 'dexFactory', 'ZetaphyFactory'), wn === 'deploy' ? ref(o, 'wnative', 'WZETAPHY') : wn], { pkg: 'zetaphy-dex' }),
        ],
        calls: ['ZetaphyFactory.setThreatRegistry(ThreatRegistry)', ...(ctx.mainnet.dex.feeTo ? [`ZetaphyFactory.setFeeTo(${ctx.mainnet.dex.feeTo})`] : [])],
        note: `no test tokens, no seeded pools; wrapped native: ${wn === 'deploy' ? 'a new WZETAPHY' : `${wn} (the native ERC-20 precompile)`}`,
      };
    },
    bounty: (ctx) => {
      const b = ctx.mainnet.bounty;
      return {
        deploys: [dep('zetaphyBounty', 'ZetaphyBounty', [b.committee, b.threshold, parseEther(b.maxPayout), parseEther(b.periodCap), BigInt(b.timelock), parseEther(b.reportBond)], { note: 'no admin key: a committee of people, payouts wait the timelock. Its source still says TESTNET ONLY, not audited: gate 1 must cover it before the pool is funded beyond a test amount' })],
        calls: b.fund ? [`ZetaphyBounty.fund() with ${b.fund} ${ctx.symbol} from the deployer`] : [],
        value: b.fund ? parseEther(b.fund) : 0n,
        note: b.fund ? undefined : 'not funded by the deployer: the pool is funded after the launch (any account may send to it)',
      };
    },
    guardian: (ctx) => ({ deploys: [dep('guardianMultisig', 'SimpleMultisig', [ctx.guardianOwners, ctx.guardianThreshold], { note: 'the emergency multisig; the deployer owns nothing in it' })], calls: [] }),
    timelock: (ctx) => ({
      deploys: [dep('timelock', 'ZetaphyTimelock', [0n, [ctx.address], [ctx.address], ZeroAddress], { note: `bootstrap: the deployer is its only proposer at a zero delay until the handover sets ${ctx.timelockDelay} s and renounces` })],
      calls: [],
    }),
    wire: () => ({ deploys: [], calls: ['(checks) ZetaphyFactory.threatRegistry() is the ThreatRegistry'] }),
    handover: (ctx, o) => {
      const proposers = [...new Set([ctx.governance, ...(ctx.extraProposers ?? [])])];
      const roles = adminRoles(Object.fromEntries(Object.entries({ ...o, ...placeholderOutputs(ctx) }).filter(([, v]) => v)));
      return {
        deploys: [],
        calls: [
          ...guardianRoles({ ...o, ...placeholderOutputs(ctx) }).map((r) => `${r.label.split(' (')[0]}.setGuardian(${ctx.guardian ?? 'the guardian multisig'}, true)`),
          ...(ctx.mainnet.bridge ? [`BridgeAirlock.setVetoer(${ctx.guardian ?? 'the guardian multisig'}, true)`] : []),
          ...roles.map((r) => `${r.label.split(' (')[0]}.${r.write}(ZetaphyTimelock)${r.twoStep ? ' (two-step: accepted by the timelock)' : ''}`),
          `ZetaphyTimelock.scheduleBatch + executeBatch: proposer/canceller ${proposers.join(', ')}${proposers.some((p) => same(p, GOV_MODULE)) ? ' (the gov module)' : ''}, executor ${ctx.executorMode === 'governance' ? 'the proposers' : 'anyone'}, delay ${ctx.timelockDelay} s`,
          'ZetaphyTimelock.renounceRole x4 (the deployer keeps nothing)',
        ],
        txs: 32,
      };
    },
    verify: () => ({ deploys: [], calls: ['(checks) every role on every contract of this run: the timelock, the guardian multisig, the gov module or nobody; never an EOA or the deployer'] }),
    ...addedPlans(),
    ...aiPlans(),
    contracts: contractsStep().plan,
  };
}

/** The keys the handover plan reads, as placeholders where the contract comes later in this run. */
function placeholderOutputs(ctx) {
  const P = '0x000000000000000000000000000000000000dEaD';
  return { neuroControl: P, threatRegistry: P, ...(ctx.mainnet.bridge ? { bridgeGuard: P, bridgeAirlock: P } : {}), dex: { contracts: { factory: P } } };
}

// ---------- the steps ----------

async function isNativeErc20(provider, a) {
  const c = new Contract(a, ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)'], provider);
  try { const [d] = await Promise.all([c.decimals(), c.symbol(), c.balanceOf(ZeroAddress)]); return d === 18n; } catch { return false; }
}

/** The address key and the code key of each target, as the ThreatRegistry computes them (for this chain's id). */
async function threatKeys(ctx, reg, targets) {
  const keys = [];
  for (const t of targets) {
    const m = /^(\d+):(0x[0-9a-fA-F]{40})$/.exec(t);
    if (m) { keys.push(await reg.addressKey(BigInt(m[1]), m[2])); continue; }
    keys.push(await reg.addressKey(ctx.evmChainId, t));
    const code = await ctx.provider.getCode(t);
    if (code !== '0x') keys.push(await reg.codeKey(keccak256(code)));
  }
  return keys;
}

export function mainnetSteps() {
  const P = mainnetPlans();
  const base = Object.fromEntries(launchSteps().map((s) => [s.name, s]));
  const withPlan = (s) => ({ ...s, plan: P[s.name] });
  return [
    withPlan({ ...base.guardian, describe: 'the emergency multisig (SimpleMultisig, guardianOwners / guardianThreshold of the deploy config)',
      when: (ctx) => (ctx.guardianOwners?.length ? true : `the deploy config names an existing guardian ${ctx.guardian}`) }),
    withPlan({
      name: 'neuro',
      describe: 'NeuroControl + NeuroJobs: NeuroJobs governed by NeuroControl, this repo\'s Neuro skill and the runner chains voted in',
      async run(ctx, state) {
        const s = signer(ctx);
        const { deploys } = P.neuro(ctx, outputs(state));
        const control = await deployOne(ctx, s, deploys[0]);
        const jobs = await deployOne(ctx, s, deploys[1]);
        // setControl at once: a request slipped in before it only gets skill 0 (runners skip it; it expires and refunds)
        await wait(jobs.setControl(control.target));
        const { skillId } = await import(pathToFileURL(join(ROOT, 'zetaphy-network/src/skill.js')).href);
        const { SUPPORTED_CHAINS } = await import(pathToFileURL(join(ROOT, 'zetaphy-network/src/worker.js')).href);
        const id = skillId();
        await wait(control.approveSkill(id));
        await wait(control.setActiveSkill(id));
        await wait(control.approveChains(SUPPORTED_CHAINS.map((c) => encodeBytes32String(c))));
        if (!same(await jobs.control(), control.target)) throw new Error('NeuroJobs.control() is not the new NeuroControl');
        ctx.log(`  skill ${id} active; chains ${SUPPORTED_CHAINS.join(' ')}; community fund ${ctx.mainnet.communityFund}`);
        return { ...(await haveCode(ctx, { neuroControl: getAddress(control.target), neuroJobs: getAddress(jobs.target) })), skillId: id };
      },
    }),
    withPlan({
      name: 'threats',
      describe: 'ThreatRegistry on NeuroJobs\' runners (appeals on, kept bonds to the community fund)',
      async run(ctx, state) {
        const s = signer(ctx);
        const reg = await deployOne(ctx, s, P.threats(ctx, outputs(state)).deploys[0]);
        const t = ctx.mainnet.threats;
        await wait(reg.setAppeals(parseEther(t.appealBond), BigInt(t.appealWindow), ctx.mainnet.communityFund));
        return haveCode(ctx, { threatRegistry: getAddress(reg.target) });
      },
    }),
    withPlan({
      name: 'reports',
      describe: 'ThreatReports: user reports, the fee to the runners who flag (governed through the ThreatRegistry)',
      async run(ctx, state) {
        const k = await deployOne(ctx, signer(ctx), P.reports(ctx, outputs(state)).deploys[0]);
        return haveCode(ctx, { threatReports: getAddress(k.target) });
      },
    }),
    withPlan({
      name: 'bridge',
      describe: 'the Saphan bridge on ZETAPHY: BridgeGuard + BridgeAirlock + NeuroLane, deployed CLOSED (route disabled, starter cap), its own contracts and the lockbox protected',
      when: (ctx) => (ctx.mainnet.bridge ? true : 'no "bridge" in the deploy config (it needs the source chain\'s lockbox)'),
      async run(ctx, state) {
        const o = outputs(state);
        const b = ctx.mainnet.bridge;
        const s = signer(ctx);
        const ds = P.bridge(ctx, o).deploys;
        const guard = await deployOne(ctx, s, ds[0]);
        await wait(guard.createToken(b.tokenName, b.tokenSymbol, b.decimals));
        const airlock = await deployOne(ctx, s, { ...ds[1], args: [guard.target, ...ds[1].args.slice(1)] });
        await wait(guard.setRoute(encodeBytes32String('airlock'), airlock.target, parseUnits(b.dailyLimit, b.decimals), false));
        const lane = await deployOne(ctx, s, { ...ds[2], args: [o.neuroJobs, airlock.target, ...ds[2].args.slice(2)] });
        await wait(airlock.setLane(lane.target, true));
        await wait(airlock.setVetoer(lane.target, true));
        for (const m of b.markers) await wait(airlock.setMarker(m, true));
        await wait(airlock.setThreats(o.threatRegistry));
        await wait(guard.setThreats(o.threatRegistry));
        const reg = new Contract(o.threatRegistry, NET('ThreatRegistry').abi, s);
        const token = getAddress(await guard.token());
        const keys = await threatKeys(ctx, reg, [guard.target, token, airlock.target, lane.target, b.lockbox]);
        await wait(reg.setProtected(keys, true));
        const res = await haveCode(ctx, { bridgeGuard: getAddress(guard.target), bridgeAirlock: getAddress(airlock.target), neuroLane: getAddress(lane.target), bridgedToken: token });
        if (await bridgeOpen(ctx, res)) throw new Error('the bridge route is enabled right after the deploy: refusing (the launch deploys it closed)');
        for (const l of BRIDGE_GATES) ctx.log(`  ${l}`);
        return { ...res, bridgeLockbox: b.lockbox, bridgeOpen: false, bridgeProtectedKeys: keys };
      },
    }),
    withPlan({
      name: 'dex',
      describe: 'DEX factory + router (no test tokens, no seeded pools), the router checking the ThreatRegistry',
      async run(ctx, state) {
        const o = outputs(state);
        const s = signer(ctx);
        const ds = P.dex(ctx, o).deploys;
        let wnative = ctx.dexWnative, i = 0;
        if (wnative === 'deploy') { wnative = getAddress((await deployOne(ctx, s, ds[0])).target); i = 1; }
        const factory = await deployOne(ctx, s, ds[i]);
        const router = await deployOne(ctx, s, { ...ds[i + 1], args: [factory.target, wnative] });
        await wait(factory.setThreatRegistry(o.threatRegistry));
        if (ctx.mainnet.dex.feeTo) await wait(factory.setFeeTo(ctx.mainnet.dex.feeTo));
        const pairCodeHash = await factory.PAIR_CODE_HASH();
        if (pairCodeHash !== keccak256(art('zetaphy-dex', 'ZetaphyPair').bytecode)) throw new Error('PAIR_CODE_HASH does not match zetaphy-dex/artifacts/ZetaphyPair.json');
        const contracts = { factory: getAddress(factory.target), router: getAddress(router.target), wnative, wnativeKind: same(wnative, NATIVE_PRECOMPILE) ? 'native-precompile' : 'WZETAPHY', pairCodeHash, threatRegistry: o.threatRegistry };
        await haveCode(ctx, { factory: contracts.factory, router: contracts.router });
        return { dex: { name: 'ZETAPHY DEX', chainId: Number(ctx.evmChainId), cosmosChainId: ctx.cosmosChainId, contracts, tokens: [], feeTo: await factory.feeTo() } };
      },
    }),
    withPlan({
      name: 'bounty',
      describe: 'ZetaphyBounty: the funded bug bounty (no admin key: the committee decides, every payout waits its timelock)',
      when: (ctx) => (ctx.mainnet.bounty ? true : 'no "bounty" in the deploy config'),
      async run(ctx) {
        const b = ctx.mainnet.bounty;
        const p = P.bounty(ctx);
        const k = await deployOne(ctx, signer(ctx), p.deploys[0]);
        if (p.value) {
          await wait(k.fund({ value: p.value }));
          const held = await ctx.provider.getBalance(k.target);
          if (held < p.value) throw new Error(`ZetaphyBounty holds ${formatEther(held)}, not ${b.fund}`);
        }
        ctx.log(`  ZetaphyBounty ${p.value ? `funded with ${b.fund} ${ctx.symbol}` : 'not funded yet (send to it after the launch)'}; committee ${b.threshold} of ${b.committee.length}; payouts wait ${b.timelock} s`);
        return haveCode(ctx, { zetaphyBounty: getAddress(k.target) });
      },
    }),
    withPlan({ ...base.wire, describe: 'check the DEX factory points at the ThreatRegistry (set it while the deployer is governance)' }),
    withPlan({ ...base.timelock, describe: 'ZetaphyTimelock (OpenZeppelin TimelockController 5.4.0), deployed just before the handover: the deployer as its only proposer at a zero delay for the handover\'s own batch' }),
    withPlan({ ...base.handover, describe: 'hand every admin role to the ZetaphyTimelock (its real proposers, delay >= 48 h), the emergency switches to the guardian, the deployer renounces; checked on-chain' }),
    // the rest of the testnet's systems, after the handover (src/mainnetall.js): each hands its roles straight to the timelock
    ...addedSteps(),
    // the AI map's contracts (src/mainnetai.js), then the addresses the web apps read
    ...aiSteps(),
    contractsStep(),
    withPlan({
      name: 'verify',
      always: true,
      describe: 'check on-chain that no EOA, and not the deployer, holds any role on any contract this run deployed',
      async run(ctx, state) { return verifyMainnet(ctx, state); },
    }),
  ];
}

/** After the handover: every role of every contract of the run is the timelock's, the guardian's, the gov module's or nobody's. */
export async function verifyMainnet(ctx, state) {
  const o = outputs(state);
  const p = ctx.provider;
  const problems = [];
  const me = ctx.address;
  const isContract = async (a) => same(a, GOV_MODULE) || (await p.getCode(a)) !== '0x';
  const C = (a, n, pkg = 'zetaphy-network') => new Contract(a, art(pkg, n).abi, p);
  if (!o.timelock || !state.steps.handover?.doneAt) problems.push('the handover has not run');
  const tl = o.timelock;
  const lines = [];
  for (const r of adminRoles(o)) {
    const cur = await new Contract(r.address, r.abi, p)[r.read]();
    lines.push(`${r.label.split(' (')[0].padEnd(18)} ${r.address}  admin ${cur}`);
    if (!same(cur, tl)) problems.push(`${r.label} ${r.address}: admin ${cur}, not the timelock ${tl}`);
  }
  if (o.timelock) {
    const t = C(tl, 'ZetaphyTimelock');
    for (const role of ['DEFAULT_ADMIN_ROLE', 'PROPOSER_ROLE', 'EXECUTOR_ROLE', 'CANCELLER_ROLE']) {
      const id = role === 'DEFAULT_ADMIN_ROLE' ? '0x' + '0'.repeat(64) : await t[role]();
      const n = Number(await t.getRoleMemberCount(id));
      for (let i = 0; i < n; i++) {
        const m = await t.getRoleMember(id, i);
        if (same(m, me)) problems.push(`the deployer holds the timelock's ${role}`);
        else if (!same(m, ZeroAddress) && !(await isContract(m))) problems.push(`${m} (an EOA) holds the timelock's ${role}`);
      }
    }
    const delay = await t.getMinDelay();
    if (delay < BigInt(MAINNET_MIN_DELAY)) problems.push(`the timelock's delay is ${delay} s, below 48 h`);
    lines.push(`${'ZetaphyTimelock'.padEnd(18)} ${tl}  delay ${delay} s`);
  }
  const guardian = ctx.guardian ?? o.guardianMultisig;
  if (guardian && !(await isContract(guardian))) problems.push(`the guardian ${guardian} is an EOA`);
  for (const r of guardianRoles(o)) if (await new Contract(r.address, r.abi, p)[r.read](me)) problems.push(`${r.label}: the deployer is a guardian`);
  if (o.neuroControl) {
    const k = C(o.neuroControl, 'NeuroControl');
    if (await k.defenderApproved(me)) problems.push('NeuroControl: the deployer is an approved defender');
    if (same(await k.communityFund(), me)) problems.push('NeuroControl: the community fund is the deployer');
  }
  if (o.neuroJobs && !same(await C(o.neuroJobs, 'NeuroJobs').control(), o.neuroControl)) problems.push('NeuroJobs: control() is not the NeuroControl (its deployer could still set one)');
  if (o.threatRegistry && same(await C(o.threatRegistry, 'ThreatRegistry').communityFund(), me)) problems.push('ThreatRegistry: the community fund is the deployer');
  if (o.bridgeAirlock) {
    const a = C(o.bridgeAirlock, 'BridgeAirlock');
    if (await a.isVetoer(me)) problems.push('BridgeAirlock: the deployer is a vetoer');
    if (await a.isMarker(me)) problems.push('BridgeAirlock: the deployer is a marker');
    if (await a.isLane(me)) problems.push('BridgeAirlock: the deployer is a lane');
    if (await bridgeOpen(ctx, o)) problems.push('the bridge route is enabled: the launch leaves it closed');
  }
  // a two-step role: nobody may be waiting to accept it
  for (const r of adminRoles(o).filter((x) => x.twoStep)) {
    const pending = await new Contract(r.address, r.abi, p).pendingGovernance();
    if (!same(pending, ZeroAddress)) problems.push(`${r.label} ${r.address}: ${pending} is pending as its governance`);
  }
  if (o.dex && same(await C(o.dex.contracts.factory, 'ZetaphyFactory', 'zetaphy-dex').feeTo(), me)) problems.push('DEX factory: feeTo is the deployer');
  if (o.zetaphyBounty) {
    const b = C(o.zetaphyBounty, 'ZetaphyBounty');
    if (await b.isMember(me)) problems.push('ZetaphyBounty: the deployer is a committee member');
    lines.push(`${'ZetaphyBounty'.padEnd(18)} ${o.zetaphyBounty}  no admin; committee ${(await b.members()).length}, holds ${formatEther(await p.getBalance(o.zetaphyBounty))} ${ctx.symbol}`);
  }
  await verifyAdded(ctx, o, problems, lines);
  await verifyAi(ctx, o, problems, lines);
  if (problems.length) throw new Error(`the mainnet check failed:\n  - ${problems.join('\n  - ')}`);
  for (const l of lines) ctx.log(`  ${l}`);
  ctx.log(`  checked on-chain: no EOA and not the deployer ${me} holds a role on any contract of this run; the bridge is closed`);
  return { verifiedMainnet: new Date().toISOString() };
}

// ---------- the dry run's plan and the cost ----------

const fmtArg = (v) => (isLater(v) ? `<${v.later}>` : Array.isArray(v) ? `[${v.map(fmtArg).join(', ')}]` : typeof v === 'bigint' ? v.toString()
  : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${k}: ${fmtArg(x)}`).join(', ')}}` : String(v));

/** Gas of a deployment: eth_estimateGas with the real constructor arguments (the deployer in place of a contract
 *  that comes later), else priced by code size. */
async function deployGas(ctx, d) {
  const a = art(d.pkg, d.name);
  const tx = await new ContractFactory(a.abi, a.bytecode).getDeployTransaction(...resolveArgs(d.args, ctx.address));
  try { return { gas: await ctx.provider.estimateGas({ from: ctx.address, data: tx.data }), how: 'estimated' }; } catch {
    const init = (a.bytecode.length - 2) / 2, runtime = ((a.deployedBytecode ?? a.bytecode).length - 2) / 2;
    return { gas: 53000n + 16n * BigInt(init) + 200n * BigInt(runtime) + 300000n, how: 'by code size' };
  }
}

/** Every contract, its constructor arguments, every call, and the gas and cost of the steps still to run. */
export async function mainnetPlan(ctx, state, steps) {
  const o = outputs(state);
  const fee = await ctx.provider.getFeeData();
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 10n ** 9n;
  const lines = [];
  let gas = 0n, value = 0n, contracts = 0, calls = 0;
  const todo = [];
  for (const st of steps) {
    const ok = st.when ? st.when(ctx, state) : true;
    if (ok !== true) { lines.push(`- ${st.name}: skipped (${ok})`); continue; }
    if (state.steps[st.name]?.doneAt && !st.always) { lines.push(`✓ ${st.name}: done ${state.steps[st.name].doneAt}`); continue; }
    // a finished step that runs every time (the handover, wire, verify, protect, proposal): checks again, sends nothing new
    if (state.steps[st.name]?.doneAt) { lines.push(`✓ ${st.name}: done ${state.steps[st.name].doneAt}; checked again on-chain`); continue; }
    todo.push(st.name);
    const p = st.plan(ctx, o);
    lines.push(`→ ${st.name}: ${st.describe}${p.note ? ` (${p.note})` : ''}`);
    for (const d of p.deploys) {
      const a = art(d.pkg, d.name);
      const inputs = a.abi.find((x) => x.type === 'constructor')?.inputs ?? [];
      const { gas: g, how } = await deployGas(ctx, d);
      gas += g; contracts++;
      lines.push(`    deploy ${d.name}(${d.args.map((v, i) => `${(inputs[i]?.name ?? `arg${i}`).replace(/_$/, '')}=${fmtArg(v)}`).join(', ')})`);
      lines.push(`        ~${g.toLocaleString('en-US')} gas (${how})${d.note ? `; ${d.note}` : ''}`);
    }
    const nCalls = p.txs ?? p.calls.filter((c) => !c.startsWith('(checks)')).length;
    for (const c of p.calls) lines.push(`    ${c.startsWith('(checks)') ? '' : 'call '}${c}`);
    for (const [k, why] of p.skipped ?? []) lines.push(`    - ${k}: skipped on mainnet (${why})`);
    gas += 150000n * BigInt(nCalls); calls += nCalls;
    if (p.value) { value += p.value; lines.push(`    puts ${formatEther(p.value)} ${ctx.symbol} into the contract`); }
  }
  for (const [name, why] of MAINNET_EXCLUDED) lines.push(`- ${name}: skipped on mainnet (${why})`);
  const need = (gas * price * 3n) / 2n + value;
  const coin = (wei) => `${Number(formatEther(wei)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${ctx.symbol}`;
  lines.push(`total: ${contracts} contract(s), about ${calls} call(s), ~${gas.toLocaleString('en-US')} gas at ${formatUnits(price, 'gwei')} gwei = ${coin(gas * price)}; `
    + `with a 1.5 x margin ${coin((gas * price * 3n) / 2n)}${value ? `, plus ${coin(value)} put into contracts` : ''}: the deployer needs ${coin(need)}`);
  return { lines, gas, price, value, need, todo, coin };
}

/** Which wrapped native the DEX uses: the native ERC-20 precompile when the chain has it, else a new WZETAPHY. */
export async function dexWnative(provider) {
  return (await isNativeErc20(provider, NATIVE_PRECOMPILE)) ? NATIVE_PRECOMPILE : 'deploy';
}
