#!/usr/bin/env node
// The vote that moves ZETAPHY's on-chain Neuro runners to this repo's Neuro code. NeuroJobs records
// NeuroControl.activeSkill() in every new job, and a runner only works on jobs whose skill id is the sha256 of the code it
// runs (src/skill.js). So a change to zetaphy-neuro/src reaches the web page and the CLI at once, but the network only
// after governance approves the new skill id and makes it the active one. On mainnet NeuroControl's governance is the
// ZetaphyTimelock (48 h), whose proposer is the chain's gov module: this writes ONE timelock operation
// (approveSkill if needed, then setActiveSkill), the gov proposal that schedules it, and the executeBatch anyone sends
// after the delay. Every call is simulated as the timelock first; nothing is sent.
//
//   node scripts/neuro-skill-proposal.js status [--skill local|0x…]          [อ่าน] active / approved skill, the operation's state
//   node scripts/neuro-skill-proposal.js write [--skill local|0x…] [--out dir] [--deposit 10000]
//                                                                            [เปลี่ยนไฟล์] <out>/neuro-skill.gov-proposal.json + neuro-skill.timelock-batch.json
// then on the validator: bash zetaphy-chain/gov.sh propose-file neuro-skill.gov-proposal.json --from <key>; vote; 48 h later
// anyone sends execute.data from the batch file to the timelock.
// env: ZETAPHY_RPC (default https://rpc.sawasdeecoin.com).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Contract, Interface, ZeroHash, getAddress, keccak256, toUtf8Bytes, parseEther, formatEther } from 'ethers';
import { skillId } from '../src/skill.js';
import { GOV_MODULE_BECH32 } from '../src/timelockcli.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MAINNET = JSON.parse(readFileSync(join(ROOT, 'zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json'), 'utf8'));
export const CONTROL = new Interface([
  'function governance() view returns (address)', 'function activeSkill() view returns (bytes32)', 'function skillApproved(bytes32) view returns (bool)',
  'function approveSkill(bytes32 id)', 'function setActiveSkill(bytes32 id)',
]);
export const TIMELOCK = new Interface([
  'function getMinDelay() view returns (uint256)', 'function hashOperationBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) view returns (bytes32)',
  'function getOperationState(bytes32 id) view returns (uint8)',
  'function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)',
  'function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) payable',
]);
const STATES = ['Unset', 'Waiting', 'Ready', 'Done'];
const ID = /^0x[0-9a-fA-F]{64}$/;

/** A per-skill salt: the same skill always gives the same operation id (re-running finds it instead of scheduling twice). */
export const saltOf = (id) => keccak256(toUtf8Bytes(`zetaphy:neuro-skill:${id.toLowerCase()}`));

/** The calls the timelock must make for `id`, given what NeuroControl holds now ([] when it is already active). */
export function skillCalls(control, id, { active, approved }) {
  if (String(active).toLowerCase() === id.toLowerCase()) return [];
  return [
    ...(approved ? [] : [{ to: control, data: CONTROL.encodeFunctionData('approveSkill', [id]), what: `NeuroControl.approveSkill(${id})` }]),
    { to: control, data: CONTROL.encodeFunctionData('setActiveSkill', [id]), what: `NeuroControl.setActiveSkill(${id})` },
  ];
}

/** The timelock batch + the gov module's proposal for `calls` (pure: the reads are passed in). */
export function batchFiles({ timelock, calls, delay, salt, operationId, state, id, previous, depositWei }) {
  const targets = calls.map((c) => getAddress(c.to)), values = calls.map(() => 0n), datas = calls.map((c) => c.data);
  const scheduleData = TIMELOCK.encodeFunctionData('scheduleBatch', [targets, values, datas, ZeroHash, salt, delay]);
  const executeData = TIMELOCK.encodeFunctionData('executeBatch', [targets, values, datas, ZeroHash, salt]);
  const gasLimit = 1_000_000n + 100_000n * BigInt(calls.length) + 64n * BigInt((scheduleData.length - 2) / 2);
  const title = `Neuro: move the network's runners to skill ${id.slice(0, 10)}…`;
  const summary = `Schedules ONE operation on the ZetaphyTimelock ${getAddress(timelock)} (operation ${operationId}, salt ${salt}, delay ${delay} s): `
    + calls.map((c, i) => `${i + 1}. ${c.what}`).join('; ')
    + `. Effect: new NeuroJobs jobs record skill ${id} (the sha256 of zetaphy-neuro/src, src/skill.js) instead of ${previous}; runners on the old code skip them until they update.`
    + ' Steers Neuro only, never coin transfers. After the delay anyone runs it: executeBatch on the timelock (neuro-skill.timelock-batch.json, execute.data).';
  return {
    gov: { messages: [{ '@type': '/zetaphy.pq.v1.MsgEVMCall', Sender: GOV_MODULE_BECH32, To: getAddress(timelock), Value: '0', Data: Buffer.from(scheduleData.slice(2), 'hex').toString('base64'), GasLimit: String(gasLimit) }],
      metadata: '', deposit: `${depositWei}azetaphy`, title: title.slice(0, 140), summary, expedited: false },
    batch: { _comment: 'scripts/neuro-skill-proposal.js: the Neuro skill vote as ONE timelock operation. Public values only.',
      chainId: MAINNET.chainId, timelock: getAddress(timelock), operationId, state, predecessor: ZeroHash, salt, delay: Number(delay), skill: id, previousSkill: previous,
      calls: calls.map((c) => ({ to: getAddress(c.to), value: '0', data: c.data, what: c.what })),
      schedule: { to: getAddress(timelock), data: scheduleData, by: 'the gov module: gov.sh propose-file neuro-skill.gov-proposal.json, then vote' },
      execute: { to: getAddress(timelock), value: '0', data: executeData, by: 'anyone, once the delay has passed' } },
  };
}

/** Reads NeuroControl and the timelock and checks what the vote would do (every call simulated as the timelock). */
export async function plan(p, { id, control = MAINNET.contracts.NeuroControl }) {
  const c = new Contract(control, CONTROL, p);
  const [governance, active, approved] = await Promise.all([c.governance(), c.activeSkill(), c.skillApproved(id)]);
  const timelock = getAddress(governance);
  if (timelock !== getAddress(MAINNET.timelock.address)) throw new Error(`NeuroControl's governance is ${timelock}, not the timelock ${MAINNET.timelock.address}: refusing`);
  const calls = skillCalls(control, id, { active, approved });
  const tl = new Contract(timelock, TIMELOCK, p);
  const salt = saltOf(id);
  const delay = calls.length ? await tl.getMinDelay() : 0n;
  const operationId = calls.length ? await tl.hashOperationBatch(calls.map((x) => x.to), calls.map(() => 0n), calls.map((x) => x.data), ZeroHash, salt) : null;
  const state = operationId ? STATES[Number(await tl.getOperationState(operationId))] : null;
  // the timelock is NeuroControl's governance, so each call must pass from it (approveSkill first: the simulation of
  // setActiveSkill alone would revert NotApproved while the skill is not approved yet, so it is only checked when it is)
  for (const x of calls) {
    if (x.what.includes('setActiveSkill') && !approved) continue;
    await p.call({ from: timelock, to: x.to, data: x.data }).catch((e) => { throw new Error(`${x.what} fails when the timelock sends it: ${e.shortMessage ?? e.message}`); });
  }
  return { control: getAddress(control), timelock, active, approved, calls, delay, salt, operationId, state };
}

const argsOf = (a) => { const o = { _: [] }; for (let i = 0; i < a.length; i++) a[i].startsWith('--') ? (o[a[i].slice(2)] = a[++i]) : o._.push(a[i]); return o; };

async function main(argv) {
  const o = argsOf(argv), cmd = o._[0];
  const id = !o.skill || o.skill === 'local' ? skillId() : String(o.skill);
  if (!ID.test(id)) throw new Error('--skill: local (this repo) or 0x + 64 hex');
  const p = new JsonRpcProvider(process.env.ZETAPHY_RPC || 'https://rpc.sawasdeecoin.com', MAINNET.chainId, { staticNetwork: true });
  const r = await plan(p, { id });
  console.log(`NeuroControl ${r.control} (governance: the timelock ${r.timelock})\nactive skill  ${r.active}\nthis skill    ${id} (${o.skill && o.skill !== 'local' ? 'given' : 'zetaphy-neuro/src of this checkout'}), approved: ${r.approved}`);
  if (!r.calls.length) { console.log('nothing to vote: this skill is already the active one'); return; }
  console.log(`the vote: ONE timelock operation ${r.operationId} (${r.state}), delay ${r.delay} s:\n${r.calls.map((x) => `  ${x.what}`).join('\n')}`);
  if (cmd === 'status') return;
  if (cmd !== 'write') throw new Error('usage: neuro-skill-proposal.js status|write [--skill local|0x…] [--out dir] [--deposit 10000]');
  if (r.state !== 'Unset') { console.log(`the operation is already ${r.state}: no new proposal (after the delay send execute.data from an earlier batch file)`); return; }
  const depositWei = parseEther(String(o.deposit ?? '10000')).toString();
  const f = batchFiles({ ...r, id, previous: r.active, depositWei });
  const out = (o.out ?? join(homedir(), 'open')).replace(/^~(?=\/|$)/, homedir());
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'neuro-skill.gov-proposal.json'), JSON.stringify(f.gov, null, 2) + '\n');
  writeFileSync(join(out, 'neuro-skill.timelock-batch.json'), JSON.stringify(f.batch, null, 2) + '\n');
  console.log(`wrote ${join(out, 'neuro-skill.gov-proposal.json')} (deposit ${formatEther(depositWei)} ZTPHY) and neuro-skill.timelock-batch.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(`error: ${e.shortMessage ?? e.message}`); process.exit(1); });
