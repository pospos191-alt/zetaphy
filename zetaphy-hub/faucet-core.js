// The node's faucet as zetaphy_faucetPowInfo reports it (zetaphy-chain setup-node.sh, evmd/zetaphy_faucetlimits.go):
// whether it is on, what one grant pays (zetaphy_faucet: faucetReward; a browser-mining proof, zetaphy_faucetPow:
// reward), the daily ZTPHY budget and what is left of it (only when the node has one: mainnet's sentry does),
// and the proofs left today. The pages show these numbers as the node gives them (never a hard-coded amount) and say
// so plainly when the faucet is off or today's budget is used up. No DOM, no network: the caller passes evmCall.
import { withFallback } from './i18n.js';
import { FAUCET } from './faucet-i18n.js';

const big = (v) => { try { return v == null || v === '' ? null : BigInt(v); } catch { return null; } };
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/** zetaphy_faucetPowInfo's result, checked: { enabled, grant, pow, budget, left, remainingToday, perDay } (amounts in wei, BigInt or null). */
export function faucetInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    enabled: raw.enabled === true,
    grant: big(raw.faucetReward), // older nodes without config/faucet-amount: the proof reward is also the grant
    pow: big(raw.reward),
    budget: big(raw.dayBudget),
    left: big(raw.remainingBudget),
    remainingToday: int(raw.remainingToday),
    perDay: int(raw.perDay),
  };
}

/** Reads the node's faucet (null when it does not answer or has no such method). */
export async function readFaucet(evmCall) {
  try { return faucetInfo(await evmCall('zetaphy_faucetPowInfo', [])); } catch { return null; }
}

/**
 * 'unknown' (no answer), 'off' (enabled false), 'spent' (today's budget, or today's proofs, are used up) or 'on'.
 * kind 'grant': a zetaphy_faucet grant (the budget must still cover one); 'pow': a mining proof (a proof left today, and
 * the budget must cover its reward).
 */
export function faucetState(info, kind = 'grant') {
  if (!info) return 'unknown';
  if (!info.enabled) return 'off';
  if (info.left != null) {
    const need = (kind === 'pow' ? info.pow : info.grant ?? info.pow) ?? 1n;
    if (info.left <= 0n || info.left < need) return 'spent';
  }
  if (kind === 'pow' && info.remainingToday === 0) return 'spent';
  return 'on';
}

/** The words for `info` in `lang`: the amounts and budget when on, else why it cannot pay. `fmt`: wei -> "1.5". */
export function faucetLine(info, lang, fmt, kind = 'grant') {
  const t = withFallback(FAUCET, lang);
  const s = faucetState(info, kind);
  if (s !== 'on') return { state: s, text: t[s] };
  const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  const grant = info.grant ?? info.pow;
  const text = [
    grant != null && info.pow != null ? fill(t.amounts, { grant: fmt(grant), pow: fmt(info.pow) }) : '',
    info.budget != null && info.left != null ? fill(t.budget, { left: fmt(info.left), budget: fmt(info.budget) }) : '',
  ].filter(Boolean).join(' ');
  return { state: s, text };
}

/** The faucet words in `lang` (English underneath). */
export const faucetText = (lang) => withFallback(FAUCET, lang);
