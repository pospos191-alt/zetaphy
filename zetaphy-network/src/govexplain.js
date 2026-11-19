// Explain a ZETAPHY gov proposal in plain words, for key watch (scripts/key-watch.js, "new gov proposal") and anyone
// reading a proposal before the vote: what each message does, what each timelock call it schedules does, on which
// contract (by its watch-list label), and which of them change who controls the chain's money or rules.
//
// A gov proposal acts through MsgEVMCall messages sent by the gov module, usually to the ZetaphyTimelock's
// schedule / scheduleBatch, so the EVM never logs them; read here from the Cosmos REST answer. Every function of
// every contract in this repository's artifacts is known by its selector; an unknown one is itself a warning.
// Pure: no network.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, getAddress, formatEther } from 'ethers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART_DIRS = ['zetaphy-network/artifacts', 'zetaphy-dex/artifacts', 'zetaphy-nft/artifacts'];

/** selector -> [{ contract, fragment }] from every artifact (first ABI wins per contract). */
export function loadSelectors(dirs = ART_DIRS.map((d) => join(ROOT, d))) {
  const by = new Map();
  for (const dir of dirs) {
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      let abi;
      try { abi = JSON.parse(readFileSync(join(dir, f), 'utf8')).abi; } catch { continue; }
      if (!Array.isArray(abi)) continue;
      let iface;
      try { iface = new Interface(abi); } catch { continue; }
      iface.forEachFunction((fn) => {
        if (fn.constant || fn.stateMutability === 'view' || fn.stateMutability === 'pure') return;
        const list = by.get(fn.selector) ?? [];
        if (!list.some((x) => x.fragment.format() === fn.format())) list.push({ contract: f.replace(/\.json$/, ''), fragment: fn });
        by.set(fn.selector, list);
      });
    }
  }
  return by;
}

// [pattern on the function name, severity, why it matters]. Checked in order; the first match wins.
export const RISK = [
  [/^(setGuardian|addGuardian|removeGuardian|setGuardians)$/i, 'critical', 'changes who can pause and veto'],
  [/^setIsm$|^setInterchainSecurityModule$/i, 'critical', 'changes who may sign bridge messages: a bad ISM can mint unbacked tokens'],
  [/^(setGovernance|transferOwnership|acceptOwnership|renounceOwnership|setOwner|setOwners|changeOwners|setAdmin)$/i, 'critical', 'changes who controls the contract'],
  [/^(grantRole|revokeRole|renounceRole)$/i, 'critical', 'changes a role (who may propose, execute, cancel, mint…)'],
  [/^(upgradeTo|upgradeToAndCall|setImplementation)$/i, 'critical', 'replaces the contract\'s code'],
  [/^updateDelay$|^setMinDelay$/i, 'critical', 'changes the timelock delay (the time everyone has to react)'],
  [/^(recoverExcess|withdraw|sweep|rescue|transfer|transferFrom|mint|withdrawTo|payout|release)$/i, 'high', 'moves coins or tokens'],
  [/^unpause$|^setPaused$/i, 'high', 'opens (or closes) a paused contract'],
  [/^(raise|set)(DailyLimit|LockCap|SupplyCap|Cap|Limit|MaxDailyLimit|ReleaseDailyLimit)/i, 'high', 'raises or sets a limit that bounds losses'],
  [/^(lower|raise|set)Delay$|^setReleaseDelay$/i, 'high', 'changes a payout delay (the time a guardian has to veto)'],
  [/^setReporter$|^setFeeder|^setCommittee|^setMarker|^setPoster|^setResolver/i, 'high', 'gives (or takes) a role that writes scores, prices or verdicts'],
  [/^setThreatRegistry$|^setThreats$|^setProtected$/i, 'warning', 'changes the scam-protection wiring'],
  [/^setFeeTo$|^setFee/i, 'warning', 'changes where fees go or how much'],
];
const SEV = { critical: 0, high: 1, warning: 2, info: 3 };
const worst = (a, b) => (SEV[a] <= SEV[b] ? a : b);

const TIMELOCK = new Interface([
  'function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)',
  'function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)',
  'function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)',
  'function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt)',
  'function cancel(bytes32 id)',
]);

const bytesOf = (v) => {
  if (v == null) return '0x';
  const s = String(v);
  if (/^0x[0-9a-fA-F]*$/.test(s)) return s.toLowerCase();
  return '0x' + Buffer.from(s, 'base64').toString('hex');
};
const field = (m, ...names) => { for (const n of names) for (const k of Object.keys(m)) if (k.toLowerCase() === n.toLowerCase()) return m[k]; return undefined; };

/** Protobuf wire format -> { field: [values] } (varints as BigInt, length-delimited as Buffer); throws on anything else. */
export function pbFields(buf) {
  const out = {};
  let i = 0;
  const varint = () => { let r = 0n, s = 0n; for (;;) { if (i >= buf.length) throw new Error('truncated'); const b = buf[i++]; r |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) return r; s += 7n; } };
  while (i < buf.length) {
    const key = Number(varint()), f = key >> 3, wt = key & 7;
    let v;
    if (wt === 0) v = varint();
    else if (wt === 2) { const len = Number(varint()); if (i + len > buf.length) throw new Error('truncated'); v = buf.subarray(i, i + len); i += len; }
    else if (wt === 1) { v = buf.subarray(i, i + 8); i += 8; }
    else if (wt === 5) { v = buf.subarray(i, i + 4); i += 4; }
    else throw new Error(`wire type ${wt}`);
    (out[f] ??= []).push(v);
  }
  return out;
}

/**
 * MsgEVMCall as a proposal may carry it: its own JSON (Sender, To, Value, Data, GasLimit, any letter case), or an Any
 * whose `value` holds the protobuf bytes (the node builds the message with dynamicpb: 1 sender, 2 to, 3 value,
 * 4 data, 5 gas_limit, 6 as_owner; the REST API shows only its @type, so key watch reads it from the submitting
 * transaction, messagesFromTx). Returns { to, data, value } or null.
 */
export function evmCallFields(m) {
  const to = field(m, 'to'), data = field(m, 'data');
  if (to) return { to, data: bytesOf(data), value: BigInt(field(m, 'value') ?? 0) };
  const raw = field(m, 'value');
  if (typeof raw !== 'string' || /^\d+$/.test(raw)) return null;
  let f;
  try { f = pbFields(Buffer.from(/^0x/.test(raw) ? raw.slice(2) : raw, /^0x/.test(raw) ? 'hex' : 'base64')); } catch { return null; }
  if (!f[2]?.[0] || !Buffer.isBuffer(f[2][0])) return null;
  return { to: f[2][0].toString('utf8'), data: '0x' + (f[4]?.[0] ? f[4][0].toString('hex') : ''), value: f[3]?.[0] ? BigInt(f[3][0].toString('utf8') || 0) : 0n };
}

/**
 * The messages of the first MsgSubmitProposal in a transaction (base64 TxRaw, as CometBFT tx_search returns it), as
 * Any objects { '@type', value (base64) }: TxRaw 1 body -> TxBody 1 messages (Any: 1 type_url, 2 value) ->
 * cosmos.gov.v1.MsgSubmitProposal 1 messages. null if there is none.
 */
export function messagesFromTx(txB64) {
  try {
    const body = pbFields(pbFields(Buffer.from(txB64, 'base64'))[1][0]);
    for (const anyBuf of body[1] ?? []) {
      const any = pbFields(anyBuf);
      const type = any[1]?.[0]?.toString('utf8') ?? '';
      if (!/gov\.v1\.MsgSubmitProposal$/.test(type)) continue;
      const sub = pbFields(any[2]?.[0] ?? Buffer.alloc(0));
      return (sub[1] ?? []).map((a) => { const x = pbFields(a); return { '@type': '/' + (x[1]?.[0]?.toString('utf8') ?? '?').replace(/^\//, ''), value: (x[2]?.[0] ?? Buffer.alloc(0)).toString('base64') }; });
    }
  } catch { /* not a transaction we can read */ }
  return null;
}

/** A proposal message the REST API showed without its fields (only @type): it must be read from the transaction. */
export const isOpaque = (m) => m && typeof m === 'object' && Object.keys(m).length === 1 && '@type' in m;

const short = (v) => { const s = typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? `[${v.map(short).join(', ')}]` : String(v); return s.length > 80 ? `${s.slice(0, 77)}…` : s; };

/** One call (to, data): { text, severity, why } with the function and its arguments by name. */
export function explainCall(to, data, { selectors, labels = {} }) {
  const label = labels[String(to).toLowerCase()];
  const where = `${label ? `${label} ` : ''}\`${getAddress(to)}\``;
  if (!data || data === '0x') return { text: `send coins to ${where}`, severity: 'high', why: 'a plain transfer of native coins' };
  const cands = selectors.get(data.slice(0, 10)) ?? [];
  for (const c of cands) {
    let args;
    try { args = c.fragment.inputs.length ? new Interface([c.fragment]).decodeFunctionData(c.fragment, data) : []; } catch { continue; }
    const name = c.fragment.name;
    const rule = RISK.find(([re]) => re.test(name));
    const shown = c.fragment.inputs.map((p, i) => `${p.name || `arg${i}`}=${short(args[i])}`).join(', ');
    return { text: `**${name}**(${shown}) on ${where}${label ? '' : ` (a ${c.contract}?)`}`, severity: rule?.[1] ?? 'info', why: rule?.[2] ?? null, name };
  }
  return { text: `unknown function ${data.slice(0, 10)} on ${where}`, severity: 'high', why: 'no contract in this repository has this function: read the code before voting' };
}

/**
 * A proposal as the Cosmos REST gov v1 API returns it -> { severity, lines }. `timelock`: the ZetaphyTimelock;
 * `labels`: lower-case address -> name (the watch list).
 */
export function explainProposal(p, { selectors, labels = {}, timelock = null }) {
  const lines = [];
  let sev = 'info';
  const tl = timelock ? getAddress(timelock).toLowerCase() : null;
  for (const m of p.messages ?? []) {
    const type = m['@type'] ?? '?';
    if (/MsgEVMCall$/.test(type)) {
      const f = evmCallFields(m);
      if (!f) { lines.push(`- [HIGH] a MsgEVMCall this watch could not read (fields: ${Object.keys(m).join(', ')}): read the proposal by hand (zetaphyd q gov proposal <id>)`); sev = worst(sev, 'high'); continue; }
      const { to, data, value } = f;
      if (tl && getAddress(to).toLowerCase() === tl) {
        let d = null;
        try { d = TIMELOCK.parseTransaction({ data }); } catch { /* not a timelock call */ }
        if (d?.name === 'schedule' || d?.name === 'scheduleBatch') {
          const batch = d.name === 'schedule' ? [[d.args.target, d.args.data]] : d.args.targets.map((t, i) => [t, d.args.payloads[i]]);
          lines.push(`- **schedules ${batch.length} call(s) in the timelock** (they run ${Number(d.args.delay) / 3600} h after the vote passes, unless cancelled):`);
          for (const [t, cd] of batch) {
            const e = explainCall(t, cd, { selectors, labels });
            sev = worst(sev, e.severity);
            lines.push(`  - ${e.severity === 'info' ? '' : `[${e.severity.toUpperCase()}] `}${e.text}${e.why ? ` — ${e.why}` : ''}`);
          }
        } else if (d?.name === 'cancel') lines.push(`- cancels timelock operation \`${d.args.id}\``), (sev = worst(sev, 'high'));
        else if (d) lines.push(`- ${d.name} on the timelock`);
        else { lines.push(`- an unknown call ${data.slice(0, 10)} to the timelock`); sev = worst(sev, 'high'); }
      } else {
        const e = explainCall(to, data, { selectors, labels });
        sev = worst(sev, e.severity === 'info' ? 'warning' : e.severity);
        lines.push(`- [${(e.severity === 'info' ? 'warning' : e.severity).toUpperCase()}] the gov module calls ${e.text} **directly, with no timelock delay**${e.why ? ` — ${e.why}` : ''}${value ? `, sending ${formatEther(value)} ZTPHY` : ''}`);
      }
    } else if (/MsgSoftwareUpgrade$/.test(type)) {
      const plan = m.plan ?? {};
      lines.push(`- [CRITICAL] **chain software upgrade** "${plan.name ?? '?'}" at height ${plan.height ?? '?'}: every validator must run the new zetaphyd. Check it is a signed release (docs/ZETAPHY-MAINNET-RUNBOOK.md).`);
      sev = worst(sev, 'critical');
    } else if (/MsgCommunityPoolSpend$/.test(type)) {
      lines.push(`- [HIGH] pays from the community pool to ${m.recipient ?? '?'}: ${(m.amount ?? []).map((a) => `${a.amount} ${a.denom}`).join(', ')}`);
      sev = worst(sev, 'high');
    } else if (/MsgUpdateParams$/.test(type)) {
      lines.push(`- [HIGH] changes the parameters of module \`${type.split('.').slice(1, -2).join('.') || type}\` (authority ${m.authority ?? '?'})`);
      sev = worst(sev, 'high');
    } else {
      lines.push(`- ${type}`);
      sev = worst(sev, 'warning');
    }
  }
  if (!(p.messages ?? []).length) lines.push('- no messages (a text-only proposal)');
  return { severity: sev, lines };
}
