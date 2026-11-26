// Who holds the pool's liquidity (LP) tokens. Whoever holds them can take the liquidity out of the pool at any time,
// which leaves every holder unable to sell (a "rug pull"); LP tokens sent to a burn address can never be withdrawn.
// Read-only: four eth_calls on the token's Uniswap-V2-style pair (the one the buy/sell test found). Like the test, this
// depends on the current block, so it is not part of the network's verdict (src/verdict.js keeps the rules' level).
// It reports what it reads and never labels the token: LP tokens held elsewhere may sit in a lock contract or a wallet,
// and Neuro does not claim which.

const SEL = { totalSupply: '0x18160ddd', balanceOf: '0x70a08231' };
/** Addresses nobody can spend from: the conventional dead address and the zero address. */
export const BURN = Object.freeze(['0x000000000000000000000000000000000000dead', '0x0000000000000000000000000000000000000000']);
const word = (a) => String(a).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const num = (hex) => { const h = String(hex ?? '').replace(/^0x/, ''); return h ? BigInt('0x' + h.slice(0, 64)) : 0n; };
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ''));

/**
 * The pair's LP supply and what the burn addresses and the token's owner hold. Decimal strings; `error` when a read
 * failed (then no finding is made). `owner` is skipped when there is none or it is a burn address.
 */
export async function lpHolders(rpc, pair, { owner } = {}) {
  if (!isAddr(pair)) return null;
  const call = (data) => rpc.call('eth_call', [{ to: pair, data }, 'latest']);
  const bal = (who) => call(SEL.balanceOf + word(who));
  const ownerAddr = isAddr(owner) && !BURN.includes(String(owner).toLowerCase()) ? String(owner).toLowerCase() : null;
  try {
    const [t, ...b] = await Promise.all([call(SEL.totalSupply), ...BURN.map(bal), ...(ownerAddr ? [bal(ownerAddr)] : [])]);
    const total = num(t), burned = num(b[0]) + num(b[1]);
    return { pair: pair.toLowerCase(), total: total.toString(), burned: burned.toString(), ...(ownerAddr ? { owner: ownerAddr, ownerHeld: num(b[2]).toString() } : {}) };
  } catch (e) {
    return { pair: pair.toLowerCase(), error: String(e?.message ?? e).slice(0, 200) };
  }
}

/** A share of the supply in percent, one decimal. */
export const pct = (part, total) => (BigInt(total) > 0n ? Number((BigInt(part) * 1000n) / BigInt(total)) / 10 : 0);

// The owner holding this share or more of the LP tokens can pull most of the liquidity: high; a smaller but real share: medium.
export const LP_OWNER_HIGH = 50, LP_OWNER_MEDIUM = 5;
// This share or more burned: the liquidity cannot be pulled (except the rest).
export const LP_BURNED_GOOD = 95;

/** Findings for lpHolders' result: what share the owner holds, or that it is burned, or that it is not. */
export function lpFindings(lp, { dex } = {}) {
  if (!lp || lp.error || !(BigInt(lp.total ?? 0) > 0n)) return [];
  const burned = pct(lp.burned, lp.total), owner = lp.owner ? pct(lp.ownerHeld, lp.total) : 0;
  if (owner >= LP_OWNER_HIGH) return [{ id: 'lp-owner', severity: 'high', params: { dex, share: owner, owner: lp.owner } }];
  if (owner >= LP_OWNER_MEDIUM) return [{ id: 'lp-owner', severity: 'medium', params: { dex, share: owner, owner: lp.owner } }];
  if (burned >= LP_BURNED_GOOD) return [{ id: 'lp-burned', severity: 'good', params: { dex, share: burned } }];
  return [{ id: 'lp-not-burned', severity: 'info', params: { dex, share: burned } }];
}

