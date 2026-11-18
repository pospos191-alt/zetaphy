#!/usr/bin/env node
// [เปลี่ยนเชน] The guardians' emergency actions on Saphan mainnet, signed with a guardian's paper words (2 of 3:
// A, B, C), for when key watch fires (docs/KEY-WATCH.md "Saphan: unbacked or forged"). No timelock: these run as
// soon as two guardians signed. Only these calls, built by src/saphanmainnet.js pausePlan:
//   pause            pause()   on the synthetic (--chain dest) or on the vault on ZETAPHY (--chain zetaphy)
//   veto <id>        veto(id)  of a queued payout, on the same two contracts
//
//   read -rs M; export M; node scripts/saphan-guard.js pause --route bsc --chain dest      # first guardian: propose
//   read -rs M; export M; node scripts/saphan-guard.js confirm <n> --route bsc --chain dest # second: confirm + execute
//   node scripts/saphan-guard.js status --route bsc                                        # [อ่าน] paused?
//
// M: the guardian's 24 words (type them into `read -rs`, never on the command line). The key lives in this process
// only. Refuses a signer that is not an owner of that multisig, and refuses to confirm a proposal that is not exactly
// a pause or veto of this route. env <ROUTE>_RPC / ZETAPHY_RPC override the config's RPC list.
import { Contract, HDNodeWallet, getAddress, formatEther } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import { providerFor } from './saphan.js';

const MS = ['function propose(address,uint256,bytes) returns (uint256)', 'function confirm(uint256)', 'function execute(uint256) returns (bytes)', 'function threshold() view returns (uint8)',
  'function proposals(uint256) view returns (address to, uint256 value, bytes data, bool executed, uint8 confirmations)', 'function confirmed(uint256,address) view returns (bool)',
  'function isOwner(address) view returns (bool)', 'event Proposed(uint256 indexed id, address indexed by, address to, uint256 value)'];
const EPV = ['function paused() view returns (bool)'];

/** The calls a guardian may send for `route` on `chain` ('dest' | 'zetaphy'): { multisig, allowed: [{ what, to, data }] }. */
export function guardCalls(cfg, state, { route, chain, veto = null }) {
  const p = M.pausePlan(cfg, state, { route, veto });
  const side = chain === 'zetaphy' ? p.zetaphy : p.destination;
  const allowed = [{ what: 'pause', to: getAddress(side.pause.to), data: side.pause.data }];
  if (side.veto) allowed.push({ what: `veto ${veto}`, to: getAddress(side.veto.to), data: side.veto.data });
  return { multisig: getAddress(side.multisig), allowed };
}

/** Is a multisig proposal (to, data) a pause or a veto of this route's contract on that chain? */
export function isGuardCall(cfg, state, { route, chain }, to, data) {
  const { allowed } = guardCalls(cfg, state, { route, chain });
  const target = allowed[0].to;
  if (getAddress(to) !== target) return null;
  if (data === allowed[0].data) return 'pause';
  try { const d = M.ENDPOINT.parseTransaction({ data }); if (d?.name === 'veto') return `veto ${d.args[0]}`; } catch { /* not ours */ }
  return null;
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]; else o._.push(argv[i]);
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const [cmd, arg] = o._;
  const route = o.route, chain = o.chain ?? 'dest';
  const cfg = M.loadMainnet(), state = M.loadState();
  if (!route || !M.deployedRoute(cfg, state, route)) throw new Error(`--route: a deployed route (${M.routeNames(cfg).filter((n) => M.deployedRoute(cfg, state, n)).join(', ')})`);
  const R = M.route(cfg, route), d = M.deployedRoute(cfg, state, route);
  const zp = () => providerFor(process.env.ZETAPHY_RPC || cfg.zetaphy.rpc.join(','), cfg.zetaphy.chainId);
  const dp = () => providerFor(process.env[`${route.toUpperCase()}_RPC`] || R.rpc.join(','), R.chainId);
  if (cmd === 'status') {
    const [z, y] = [new Contract(d.vault, EPV, await zp()), new Contract(d.synthetic, EPV, await dp())];
    console.log(`${route}: vault on ZETAPHY ${d.vault} paused=${await z.paused()}; synthetic on ${R.displayName} ${d.synthetic} paused=${await y.paused()}`);
    return;
  }
  if (!['dest', 'zetaphy'].includes(chain)) throw new Error('--chain: dest or zetaphy');
  const words = (process.env.M || '').trim().toLowerCase().split(/\s+/).join(' ');
  if (words.split(' ').length < 12) throw new Error('M: the guardian\'s words (read -rs M; export M): nothing sent');
  const p = chain === 'zetaphy' ? await zp() : await dp();
  const w = HDNodeWallet.fromPhrase(words, undefined, "m/44'/60'/0'/0/0").connect(p);
  const where = chain === 'zetaphy' ? 'ZETAPHY' : R.displayName;
  if (cmd === 'pause' || cmd === 'veto') {
    if (cmd === 'veto' && !/^0x[0-9a-fA-F]{64}$/.test(arg ?? '')) throw new Error('veto <id>: the 0x… id from the alert');
    const g = guardCalls(cfg, state, { route, chain, veto: cmd === 'veto' ? arg : null });
    const ms = new Contract(g.multisig, MS, w);
    if (!(await ms.isOwner(w.address))) throw new Error(`${w.address} is not an owner of the ${where} multisig ${g.multisig} (check the words): nothing sent`);
    const c = g.allowed.find((x) => x.what.startsWith(cmd));
    console.log(`signer ${w.address} (${formatEther(await p.getBalance(w.address))} gas) proposes on ${where}: ${c.what} on ${c.to}`);
    const tx = await ms.propose(c.to, 0n, c.data);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return ms.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'Proposed');
    console.log(`PROPOSED id ${ev.args.id} (tx ${tx.hash}). The second guardian: node scripts/saphan-guard.js confirm ${ev.args.id} --route ${route} --chain ${chain}`);
  } else if (cmd === 'confirm') {
    const g = guardCalls(cfg, state, { route, chain });
    const ms = new Contract(g.multisig, MS, w);
    if (!(await ms.isOwner(w.address))) throw new Error(`${w.address} is not an owner of the ${where} multisig: nothing sent`);
    const id = BigInt(arg ?? -1);
    const pr = await ms.proposals(id);
    const what = isGuardCall(cfg, state, { route, chain }, pr.to, pr.data);
    if (!what) throw new Error(`proposal ${id} is not a pause or veto of the ${route} route on ${where} (to ${pr.to}): refused, nothing sent`);
    if (pr.executed) return console.log(`proposal ${id} (${what}) was already executed`);
    if (!(await ms.confirmed(id, w.address))) { await (await ms.confirm(id)).wait(); console.log(`confirmed ${id} (${what})`); }
    const n = Number((await ms.proposals(id)).confirmations), t = Number(await ms.threshold());
    if (n < t) return console.log(`${n} of ${t} confirmations: one more guardian must confirm`);
    const tx = await ms.execute(id);
    await tx.wait();
    console.log(`EXECUTED ${what} on ${where} (tx ${tx.hash})`);
  } else throw new Error('usage: pause | veto <id> | confirm <n> | status   with --route <route> [--chain dest|zetaphy]');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`error: ${e.shortMessage ?? e.message}`); process.exit(1); });
