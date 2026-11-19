#!/usr/bin/env node
// Raise the threshold of a route's ISM (who must sign ZETAPHY -> destination messages) by adding the Neuro validator
// (docs/SAPHAN-NEURO-VALIDATOR.md): a new Hyperlane StaticMessageIdMultisigIsm on the destination, `threshold` of
// [our Hyperlane validator(s) + the Neuro validator], set on the route's synthetic through its timelock (48 h).
//
//   node scripts/saphan-ism.js plan    --route bsc --add 0xNEURO [--threshold 2] [--out ~/open]   [อ่าน] + writes the plan file
//   KEYFILE=… node scripts/saphan-ism.js deploy --route bsc --add 0xNEURO --send yes             [เปลี่ยนเชน] the ISM, through the factory (anyone)
//   read -rs M; export M; node scripts/saphan-ism.js propose --route bsc [--out ~/open]          [เปลี่ยนเชน] guardian 1: schedule
//   read -rs M; export M; node scripts/saphan-ism.js confirm <n> --route bsc [--out ~/open]      [เปลี่ยนเชน] guardian 2: confirm + execute
//   KEYFILE=… node scripts/saphan-ism.js execute --route bsc --send yes [--out ~/open]           [เปลี่ยนเชน] after 48 h, anyone
//   node scripts/saphan-ism.js status  --route bsc                                                [อ่าน] the ISM in use, the timelock op, the Neuro validator's announcement
//
// Refuses: a new validator set without every current validator, a threshold below 2 or above the set, an ISM the
// factory did not make or that reads back differently, a multisig proposal that is not exactly this schedule.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Contract, Wallet, HDNodeWallet, Interface, getAddress, verifyMessage, getBytes } from 'ethers';
import { checkpointHash } from '../src/neurovalidator.js';
import * as M from '../src/saphanmainnet.js';
import { providerFor, factoryIsm, ensureIsm } from './saphan.js';
import { sortAddresses } from '../src/saphan.js';

const SYN = new Interface(['function setInterchainSecurityModule(address ism)', 'function interchainSecurityModule() view returns (address)']);
const ISM = ['function validatorsAndThreshold(bytes) view returns (address[], uint8)'];
const TL = ['function getTimestamp(bytes32) view returns (uint256)'];
const MS = ['function propose(address,uint256,bytes) returns (uint256)', 'function confirm(uint256)', 'function execute(uint256) returns (bytes)', 'function threshold() view returns (uint8)',
  'function proposals(uint256) view returns (address to, uint256 value, bytes data, bool executed, uint8 confirmations)', 'function confirmed(uint256,address) view returns (bool)',
  'function isOwner(address) view returns (bool)', 'event Proposed(uint256 indexed id, address indexed by, address to, uint256 value)'];
const VA = ['function getAnnouncedStorageLocations(address[] validators) view returns (string[][])'];

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(argv[i]);
  return o;
}

/** The new validator set and threshold: every current validator kept, the Neuro validator added. Pure. */
export function newSet(current, add, threshold = 2) {
  const cur = current.map(getAddress);
  const a = getAddress(add);
  if (cur.includes(a)) throw new Error(`${a} is already a validator`);
  const validators = sortAddresses([...cur, a]);
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > validators.length) throw new Error(`--threshold: 2 to ${validators.length}`);
  return { validators, threshold };
}

/** The plan: the ISM address (from the factory) and the timelock schedule/execute + the multisig propose data. Pure given `ism`. */
export function ismPlan(cfg, state, { route: name, ism, validators, threshold }) {
  const R = M.route(cfg, name), d = M.deployedRoute(cfg, state, name);
  if (!d) throw new Error(`route ${name} is not deployed`);
  const data = SYN.encodeFunctionData('setInterchainSecurityModule', [ism]);
  const t = M.timelockCall({ chainId: R.chainId, timelock: d.timelock, target: d.synthetic, data, delay: R.timelockDelay, purpose: `set-ism ${getAddress(ism)}` });
  return { route: name, chainId: R.chainId, synthetic: getAddress(d.synthetic), multisig: getAddress(d.multisig), ism: getAddress(ism), validators, threshold,
    timelock: t.timelock, operationId: t.operationId, delay: t.delay, schedule: t.schedule, execute: t.execute,
    proposeSchedule: M.MULTISIG.encodeFunctionData('propose', [t.timelock, 0n, t.schedule]) };
}

async function main() {
  const o = args(process.argv.slice(2));
  const cmd = o._[0], name = o.route;
  const cfg = M.loadMainnet(), state = M.loadState();
  if (!name || !M.deployedRoute(cfg, state, name)) throw new Error('--route: a deployed route (bsc, base)');
  const R = M.route(cfg, name), d = M.deployedRoute(cfg, state, name);
  const out = o.out ?? join(process.env.HOME ?? '.', 'open');
  const file = join(out, `ism-${name}.json`);
  const p = await providerFor(process.env[`${name.toUpperCase()}_RPC`] || R.rpc.join(','), R.chainId);
  const factory = R.core.staticMessageIdMultisigIsmFactory;
  const current = cfg.validators.zetaphyOrigin.validators;
  const deployer = () => {
    if (!process.env.KEYFILE) throw new Error('KEYFILE=<the deployer key file> for --send');
    return new Wallet(readFileSync(process.env.KEYFILE, 'utf8').trim()).connect(p);
  };
  if (cmd === 'plan' || cmd === 'deploy') {
    if (!o.add) throw new Error('--add 0x<the Neuro validator address> (neuro-validator.js address)');
    const set = newSet(current, o.add, Number(o.threshold ?? 2));
    let x = await factoryIsm(p, factory, set.validators, set.threshold);
    if (cmd === 'deploy') {
      if (o.send !== 'yes') { console.log(`would deploy ${x.at}: ${set.threshold} of [${set.validators.join(', ')}] via ${factory} (${x.deployed ? 'already deployed' : 'new'}); add --send yes`); return; }
      const r = await ensureIsm(p, deployer(), factory, set.validators, set.threshold);
      console.log(`ISM ${r.ism} on ${R.displayName}: ${set.threshold} of [${set.validators.join(', ')}] (${r.created ? 'deployed now' : 'already there'}; read back ok)`);
      x = await factoryIsm(p, factory, set.validators, set.threshold);
    }
    const plan = ismPlan(cfg, state, { route: name, ism: x.at, ...set });
    mkdirSync(out, { recursive: true });
    writeFileSync(file, JSON.stringify({ ...plan, ismDeployed: x.deployed }, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
    console.log(`${R.displayName}: ISM ${plan.ism} = ${plan.threshold} of [${plan.validators.join(', ')}] (${x.deployed ? 'deployed' : 'NOT deployed yet: run deploy'})`);
    console.log(`timelock op ${plan.operationId} on ${plan.timelock}, delay ${plan.delay} s; plan written to ${file}`);
    return;
  }
  if (!existsSync(file)) throw new Error(`no ${file}: run plan (or deploy) first`);
  const plan = JSON.parse(readFileSync(file, 'utf8'));
  const ms = (signer) => new Contract(plan.multisig, MS, signer);
  const guardian = async () => {
    const words = (process.env.M || '').trim().toLowerCase().split(/\s+/).join(' ');
    if (words.split(' ').length < 12) throw new Error('M: the guardian\'s words (read -rs M; export M): nothing sent');
    const w = HDNodeWallet.fromPhrase(words, undefined, "m/44'/60'/0'/0/0").connect(p);
    if (!(await ms(p).isOwner(w.address))) throw new Error(`${w.address} is not an owner of the ${R.displayName} multisig: nothing sent`);
    return w;
  };
  if (cmd === 'propose') {
    if ((await p.getCode(plan.ism)) === '0x') throw new Error(`the ISM ${plan.ism} is not deployed yet: run deploy first`);
    const [vs, th] = await new Contract(plan.ism, ISM, p).validatorsAndThreshold('0x');
    if (Number(th) !== plan.threshold || vs.map(getAddress).join() !== plan.validators.join()) throw new Error('the deployed ISM reads back differently from the plan: nothing sent');
    const w = await guardian();
    const tx = await w.sendTransaction({ to: plan.multisig, data: plan.proposeSchedule });
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return ms(p).interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'Proposed');
    console.log(`PROPOSED id ${ev.args.id} (tx ${tx.hash}). Guardian 2: node scripts/saphan-ism.js confirm ${ev.args.id} --route ${name}`);
  } else if (cmd === 'confirm') {
    const w = await guardian();
    const id = BigInt(o._[1] ?? -1);
    const pr = await ms(p).proposals(id);
    if (getAddress(pr.to) !== getAddress(plan.timelock) || pr.data.toLowerCase() !== plan.schedule.toLowerCase()) throw new Error(`proposal ${id} is not this ISM schedule: refused, nothing sent`);
    if (pr.executed) return console.log('already executed');
    if (!(await ms(p).confirmed(id, w.address))) { await (await ms(w).confirm(id)).wait(); console.log(`confirmed ${id}`); }
    const tx = await ms(w).execute(id); await tx.wait();
    console.log(`EXECUTED: scheduled setInterchainSecurityModule(${plan.ism}) (tx ${tx.hash}); ready in ${plan.delay} s`);
  } else if (cmd === 'execute') {
    const t = Number(await new Contract(plan.timelock, TL, p).getTimestamp(plan.operationId));
    if (t === 1) return console.log('already done');
    if (t === 0) throw new Error('not scheduled yet');
    if (t > Date.now() / 1000) throw new Error(`not ready: executable after ${new Date(t * 1000).toISOString()}`);
    if (o.send !== 'yes') return console.log('ready; add --send yes');
    const tx = await deployer().sendTransaction({ to: plan.timelock, data: plan.execute });
    await tx.wait();
    console.log(`EXECUTED: the ${R.displayName} synthetic now uses ISM ${plan.ism} (tx ${tx.hash})`);
  } else if (cmd === 'status') {
    const cur = await new Contract(d.synthetic, SYN, p).interchainSecurityModule();
    const [vs, th] = await new Contract(cur, ISM, p).validatorsAndThreshold('0x');
    const t = Number(await new Contract(plan.timelock, TL, p).getTimestamp(plan.operationId));
    const zp = await providerFor(process.env.ZETAPHY_RPC || cfg.zetaphy.rpc.join(','), cfg.zetaphy.chainId);
    const core = M.loadCore();
    const ann = await new Contract(core.validatorAnnounce, VA, zp).getAnnouncedStorageLocations(plan.validators);
    console.log(`${R.displayName}: the synthetic's ISM ${cur} = ${th} of [${vs.join(', ')}]${getAddress(cur) === plan.ism ? ' (the new one)' : ''}`);
    console.log(`timelock op ${plan.operationId}: ${t === 0 ? 'not scheduled' : t === 1 ? 'DONE' : `ready after ${new Date(t * 1000).toISOString()}`}`);
    plan.validators.forEach((v, i) => console.log(`validator ${v}: announced ${ann[i].length ? ann[i].join(', ') : 'NOTHING (the relayer cannot find its signatures)'}`));
    // the Neuro validator's newest checkpoint, read the way anyone can (public bucket), checked against the chain
    for (const [i, v] of plan.validators.entries()) {
      const gs = ann[i].find((l) => l.startsWith('gs://'));
      if (!gs) continue;
      const [, bucket, folder = ''] = /^gs:\/\/([^/]+)\/?(.*)$/.exec(gs);
      const url = (n) => `https://storage.googleapis.com/${bucket}/${folder ? folder.replace(/\/$/, '') + '/' : ''}${n}`;
      try {
        const latest = Number(await (await fetch(url('checkpoint_latest_index.json'))).text());
        const cp = await (await fetch(url(`checkpoint_${latest}_with_id.json`))).json();
        const c = cp.value.checkpoint;
        const signer = verifyMessage(getBytes(checkpointHash({ origin: c.mailbox_domain, merkleTreeHook: '0x' + c.merkle_tree_hook_address.slice(26), root: c.root, index: c.index, messageId: cp.value.message_id })), cp.serialized_signature);
        const ev = await zp.getLogs({ address: core.merkleTreeHook, topics: ['0x253a3a04cab70d47c1504809242d9350cd81627b4f1d50753e159cf8cd76ed33'], fromBlock: 0, toBlock: 'latest' });
        const leaf = ev.map((l) => ({ id: l.data.slice(0, 66), index: Number(BigInt('0x' + l.data.slice(66, 130))) })).find((x) => x.index === c.index);
        const ok = getAddress(signer) === getAddress(v) && leaf && leaf.id.toLowerCase() === cp.value.message_id.toLowerCase() && c.mailbox_domain === cfg.zetaphy.domain;
        console.log(`  ${gs}: latest checkpoint ${latest}: ${ok ? 'OK (signed by this validator, the message id the hook inserted at that index)' : `MISMATCH (signer ${signer}, chain leaf ${leaf?.id ?? 'none'})`}`);
      } catch (e) { console.log(`  ${gs}: could not read its checkpoints (${e.message}); do NOT execute the switch until this reads OK`); }
    }
  } else throw new Error('usage: plan | deploy | propose | confirm <n> | execute | status (see the head of scripts/saphan-ism.js)');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`error: ${e.shortMessage ?? e.message}`); process.exit(1); });
