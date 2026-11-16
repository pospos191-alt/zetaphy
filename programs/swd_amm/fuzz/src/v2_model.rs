//! Stateful model of a SWDMM v2 pool (swdmm_v2.rs: add/remove liquidity,
//! claim fees, lock, swap with base-fee scheduler + dynamic fee + price
//! impact caps, plus the governance actions that touch a v2 pool:
//! SetV2PoolParams, pause/unpause, protocol-share change, protocol-fee
//! withdrawal). All curve/fee math is the program's own swdmm_math.rs;
//! the bookkeeping lines are re-stated from swdmm_v2.rs.
//!
//! Invariants checked after EVERY op:
//!   (a) solvency per token: vault >= reserve + protocol_fee + every
//!       position's unclaimed fees (pending + accrued since checkpoint)
//!   (a) liquidity: pool.liquidity == MINIMUM_LIQUIDITY + sum(position
//!       liquidity + locked); pool.locked_liquidity likewise
//!   (d) k never decreases on a swap; k / liquidity^2 never decreases on
//!       any op (LP value can't be diluted); fee_per_liquidity is
//!       monotone and settle() never overflows (fees stay claimable)
//!   (b) deposit->withdraw and swap A->B->A never profit
//!   (f) no panic anywhere
//! At the end every position must be able to withdraw and claim (liveness).

use crate::stats;
use crate::swdmm_math as m;
use crate::wide::{w, U512};
use crate::Gen;

/// swdmm_v2.rs / timelock.rs constants (kept in sync by tests/regression.rs).
pub const V2_MIN_INITIAL_DEPOSIT: u64 = 1_000;
pub const MAX_PRICE_IMPACT_BPS: u16 = 5_000;
pub const MAX_PROTOCOL_FEE_SHARE_BPS: u64 = 2_000;
const ACTORS: usize = 4;
const CREATOR: usize = 0;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Pos {
    pub owner: usize,
    pub liquidity: u128,
    pub locked: u128,
    pub ckpt_a: u128,
    pub ckpt_b: u128,
    pub pending_a: u64,
    pub pending_b: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct V2 {
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub liquidity: u128,
    pub locked_liquidity: u128,
    pub base: m::BaseFeeConfig,
    pub dynf: m::DynamicFeeConfig,
    pub vol: m::VolatilityState,
    pub collect_mode: u8,
    pub activation_ts: i64,
    pub init_price_q64: u128,
    pub max_impact: u16,
    pub fpl_a: u128,
    pub fpl_b: u128,
    pub protocol_a: u64,
    pub protocol_b: u64,
    pub swap_paused: bool,
    pub deposit_paused: bool,
    pub withdraw_paused: bool,
    pub impact_slot: u64,
    pub impact_ref: u128,
    pub protocol_share: u64,
    pub now: i64,
    pub slot: u64,
    pub vault_a: u128,
    pub vault_b: u128,
    pub positions: Vec<Pos>,
}

type R<T> = Result<T, ()>;
fn o<T>(v: Option<T>) -> R<T> {
    v.ok_or(())
}
fn req(c: bool) -> R<()> {
    if c {
        Ok(())
    } else {
        Err(())
    }
}

impl Pos {
    /// SwdmmV2Position::settle
    fn settle(&mut self, fpl_a: u128, fpl_b: u128) -> R<()> {
        let l = o(self.liquidity.checked_add(self.locked))?;
        let fa = o(m::pending_fee(fpl_a, self.ckpt_a, l))?;
        let fb = o(m::pending_fee(fpl_b, self.ckpt_b, l))?;
        self.pending_a = o(self.pending_a.checked_add(fa))?;
        self.pending_b = o(self.pending_b.checked_add(fb))?;
        self.ckpt_a = fpl_a;
        self.ckpt_b = fpl_b;
        Ok(())
    }
}

impl V2 {
    pub fn create_position(&mut self, owner: usize) {
        self.positions.push(Pos { owner, ckpt_a: self.fpl_a, ckpt_b: self.fpl_b, ..Default::default() });
    }

    /// add_v2_liquidity (min_liquidity = 0)
    pub fn add(&mut self, pi: usize, max_a: u64, max_b: u64) -> R<(u128, u64, u64)> {
        let mut n = self.clone();
        req(!n.deposit_paused)?;
        req(max_a > 0 && max_b > 0)?;
        let (fa, fb) = (n.fpl_a, n.fpl_b);
        let pos = n.positions.get_mut(pi).ok_or(())?;
        pos.settle(fa, fb)?;
        let owner = pos.owner;
        let (liq, a, b) = if n.liquidity == 0 {
            req(owner == CREATOR)?;
            req(max_a >= V2_MIN_INITIAL_DEPOSIT && max_b >= V2_MIN_INITIAL_DEPOSIT)?;
            let total = o(m::initial_liquidity(max_a, max_b))?;
            n.liquidity = m::MINIMUM_LIQUIDITY;
            n.locked_liquidity = m::MINIMUM_LIQUIDITY;
            n.init_price_q64 = o(m::price_q64(max_a, max_b))?;
            n.vol.price_reference_q64 = n.init_price_q64;
            (total - m::MINIMUM_LIQUIDITY, max_a, max_b)
        } else {
            o(m::deposit_quote(n.reserve_a, n.reserve_b, n.liquidity, max_a, max_b))?
        };
        n.vault_a += a as u128;
        n.vault_b += b as u128;
        req(n.vault_a <= u64::MAX as u128 && n.vault_b <= u64::MAX as u128)?;
        n.reserve_a = o(n.reserve_a.checked_add(a))?;
        n.reserve_b = o(n.reserve_b.checked_add(b))?;
        n.liquidity = o(n.liquidity.checked_add(liq))?;
        let pos = &mut n.positions[pi];
        pos.liquidity = o(pos.liquidity.checked_add(liq))?;
        *self = n;
        Ok((liq, a, b))
    }

    /// remove_v2_liquidity (min_a = min_b = 0)
    pub fn remove(&mut self, pi: usize, liq: u128) -> R<(u64, u64)> {
        let mut n = self.clone();
        req(!n.withdraw_paused)?;
        req(liq > 0)?;
        let (fa, fb) = (n.fpl_a, n.fpl_b);
        let pos = n.positions.get_mut(pi).ok_or(())?;
        req(liq <= pos.liquidity)?;
        pos.settle(fa, fb)?;
        let (a, b) = o(m::withdraw_quote(n.reserve_a, n.reserve_b, n.liquidity, liq))?;
        n.positions[pi].liquidity -= liq;
        n.liquidity = o(n.liquidity.checked_sub(liq))?;
        n.reserve_a = o(n.reserve_a.checked_sub(a))?;
        n.reserve_b = o(n.reserve_b.checked_sub(b))?;
        assert!(n.vault_a >= a as u128 && n.vault_b >= b as u128, "v2 vault cannot pay a withdrawal");
        n.vault_a -= a as u128;
        n.vault_b -= b as u128;
        *self = n;
        Ok((a, b))
    }

    /// claim_v2_fees
    pub fn claim(&mut self, pi: usize) -> R<(u64, u64)> {
        let mut n = self.clone();
        req(!n.withdraw_paused)?;
        let (fa, fb) = (n.fpl_a, n.fpl_b);
        let pos = n.positions.get_mut(pi).ok_or(())?;
        pos.settle(fa, fb)?;
        let (a, b) = (pos.pending_a, pos.pending_b);
        pos.pending_a = 0;
        pos.pending_b = 0;
        assert!(n.vault_a >= a as u128 && n.vault_b >= b as u128, "v2 vault cannot pay claimed fees");
        n.vault_a -= a as u128;
        n.vault_b -= b as u128;
        *self = n;
        Ok((a, b))
    }

    /// lock_v2_liquidity
    pub fn lock(&mut self, pi: usize, liq: u128) -> R<()> {
        let mut n = self.clone();
        let (fa, fb) = (n.fpl_a, n.fpl_b);
        let pos = n.positions.get_mut(pi).ok_or(())?;
        req(liq > 0 && liq <= pos.liquidity)?;
        pos.settle(fa, fb)?;
        pos.liquidity -= liq;
        pos.locked = o(pos.locked.checked_add(liq))?;
        n.locked_liquidity = o(n.locked_liquidity.checked_add(liq))?;
        *self = n;
        Ok(())
    }

    fn current_base_fee_bps(&self) -> R<u64> {
        let price = o(m::price_q64(self.reserve_a, self.reserve_b))?;
        let nper = o(m::scheduler_periods(&self.base, self.now, self.activation_ts, price, self.init_price_q64))?;
        o(m::scheduled_fee_bps(&self.base, nper))
    }

    /// swap_v2 (min_amount_out = 0, oracle guard off)
    pub fn swap(&mut self, amount_in: u64, a_to_b: bool) -> R<u64> {
        let mut n = self.clone();
        req(!n.swap_paused)?;
        req(n.now >= n.activation_ts)?;
        req(amount_in > 0)?;
        req(n.reserve_a > 0 && n.reserve_b > 0)?;
        let price_before = o(m::price_q64(n.reserve_a, n.reserve_b))?;
        let same_slot = n.impact_slot == n.slot && n.impact_ref > 0;
        if !same_slot {
            n.impact_slot = n.slot;
            n.impact_ref = price_before;
        }
        let base_bps = n.current_base_fee_bps()?;
        let mut vol = n.vol;
        if n.dynf.enabled {
            m::update_references(&n.dynf, &mut vol, n.now, price_before);
            m::accumulate(&n.dynf, &mut vol, price_before, n.now);
        }
        let var_bps = m::variable_fee_bps(&n.dynf, &vol);
        let fee_bps = m::total_fee_bps(base_bps, var_bps);
        let r = o(m::swap(n.reserve_a, n.reserve_b, amount_in, a_to_b, fee_bps, n.protocol_share, n.collect_mode))?;
        req(r.price_impact_bps <= n.max_impact as u64)?;
        let k0 = w(n.reserve_a as u128) * w(n.reserve_b as u128);
        if !r.compounded && r.lp_fee > 0 {
            let growth = o(m::fee_growth(r.lp_fee, n.liquidity))?;
            if r.fee_in_b {
                n.fpl_b = o(n.fpl_b.checked_add(growth))?;
            } else {
                n.fpl_a = o(n.fpl_a.checked_add(growth))?;
            }
        }
        if r.fee_in_b {
            n.protocol_b = o(n.protocol_b.checked_add(r.protocol_fee))?;
        } else {
            n.protocol_a = o(n.protocol_a.checked_add(r.protocol_fee))?;
        }
        n.reserve_a = r.new_reserve_a;
        n.reserve_b = r.new_reserve_b;
        assert!(w(n.reserve_a as u128) * w(n.reserve_b as u128) >= k0, "v2 swap decreased k");
        if same_slot {
            let pa = o(m::price_q64(n.reserve_a, n.reserve_b))?;
            req(m::slot_impact_allows(n.impact_ref, price_before, pa, n.max_impact as u64))?;
        }
        if n.dynf.enabled {
            let pa = o(m::price_q64(n.reserve_a, n.reserve_b))?;
            m::accumulate(&n.dynf, &mut vol, pa, n.now);
        }
        n.vol = vol;
        if a_to_b {
            n.vault_a += amount_in as u128;
            req(n.vault_a <= u64::MAX as u128)?;
            assert!(n.vault_b >= r.amount_out as u128, "v2 vault cannot pay a swap");
            n.vault_b -= r.amount_out as u128;
        } else {
            n.vault_b += amount_in as u128;
            req(n.vault_b <= u64::MAX as u128)?;
            assert!(n.vault_a >= r.amount_out as u128, "v2 vault cannot pay a swap");
            n.vault_a -= r.amount_out as u128;
        }
        *self = n;
        Ok(r.amount_out)
    }

    /// Governance: execute SetV2PoolParams (timelock.rs).
    pub fn set_v2_params(&mut self, max_impact: u16, dynamic_enabled: bool) -> R<()> {
        if dynamic_enabled && !self.dynf.enabled {
            req(m::can_enable_dynamic_fee(&self.dynf))?;
            // clean volatility state when the fee is switched (back) on
            self.vol.volatility_accumulator = 0;
            self.vol.volatility_reference = 0;
            self.vol.price_reference_q64 = 0;
        }
        self.max_impact = max_impact;
        self.dynf.enabled = dynamic_enabled;
        Ok(())
    }

    /// Governance: execute WithdrawV2ProtocolFees.
    pub fn withdraw_protocol(&mut self) {
        assert!(self.vault_a >= self.protocol_a as u128 && self.vault_b >= self.protocol_b as u128, "v2 vault cannot pay protocol fees");
        self.vault_a -= self.protocol_a as u128;
        self.vault_b -= self.protocol_b as u128;
        self.protocol_a = 0;
        self.protocol_b = 0;
    }

    pub fn check(&self) {
        let mut owed_a = self.reserve_a as u128 + self.protocol_a as u128;
        let mut owed_b = self.reserve_b as u128 + self.protocol_b as u128;
        let (mut liq, mut locked) = (0u128, 0u128);
        for p in &self.positions {
            let l = p.liquidity + p.locked;
            liq += l;
            locked += p.locked;
            assert!(self.fpl_a >= p.ckpt_a && self.fpl_b >= p.ckpt_b, "checkpoint ahead of global");
            // accrued in u128 (no u64 truncation) — and it must fit u64,
            // otherwise settle() would fail and the position's funds would
            // be stuck.
            let aa = accrued(self.fpl_a - p.ckpt_a, l);
            let ab = accrued(self.fpl_b - p.ckpt_b, l);
            assert!(aa + p.pending_a as u128 <= u64::MAX as u128, "unclaimed fee A no longer fits u64: position stuck");
            assert!(ab + p.pending_b as u128 <= u64::MAX as u128, "unclaimed fee B no longer fits u64: position stuck");
            owed_a += aa + p.pending_a as u128;
            owed_b += ab + p.pending_b as u128;
        }
        assert!(self.vault_a >= owed_a, "v2 insolvent in A: vault {} < owed {owed_a}", self.vault_a);
        assert!(self.vault_b >= owed_b, "v2 insolvent in B: vault {} < owed {owed_b}", self.vault_b);
        if self.liquidity > 0 {
            assert_eq!(self.liquidity, liq + m::MINIMUM_LIQUIDITY, "pool liquidity != positions + locked minimum");
            assert_eq!(self.locked_liquidity, locked + m::MINIMUM_LIQUIDITY, "pool locked liquidity mismatch");
        } else {
            assert_eq!(liq, 0);
        }
    }

    fn value(&self) -> (U512, U512) {
        (w(self.reserve_a as u128) * w(self.reserve_b as u128), w(self.liquidity) * w(self.liquidity))
    }
}

fn accrued(delta: u128, l: u128) -> u128 {
    ((w(delta) * w(l)) >> 64).low_u128()
}

fn gen_config(g: &mut Gen) -> Option<V2> {
    let mode = g.byte() % 3;
    let floor = g.range(1, 1_000) as u16;
    let base = match mode {
        m::BASE_FEE_MODE_FIXED => m::BaseFeeConfig {
            mode,
            decay: 0,
            cliff_fee_bps: floor,
            floor_fee_bps: floor,
            number_of_periods: 0,
            period_frequency: 0,
            reduction_factor: 0,
        },
        _ => {
            let decay = g.byte() % 2;
            m::BaseFeeConfig {
                mode,
                decay,
                cliff_fee_bps: floor + (g.u16() % (m::MAX_TOTAL_FEE_BPS as u16 - floor + 1)),
                floor_fee_bps: floor,
                number_of_periods: g.range(1, 10_000) as u16,
                period_frequency: g.range(1, 100_000),
                reduction_factor: if decay == 1 { g.range(1, 9_999) } else { g.range(1, 10_000) },
            }
        }
    };
    if !m::validate_base_fee(&base) {
        return None;
    }
    let filter = g.range(0, 600) as u32;
    let dynf = m::DynamicFeeConfig {
        enabled: g.bool(),
        max_dynamic_fee_bps: g.range(1, 1_000) as u16,
        variable_fee_control: g.range(1, 200_000) as u32,
        filter_period: filter,
        decay_period: filter + g.range(1, 6_000) as u32,
        reduction_factor: g.range(0, 10_000) as u16,
        max_volatility_accumulator: g.range(1, 1_000_000),
    };
    if !m::validate_dynamic_fee(&dynf) {
        return None;
    }
    let now = g.irange(1_600_000_000, 1_900_000_000);
    Some(V2 {
        reserve_a: 0,
        reserve_b: 0,
        liquidity: 0,
        locked_liquidity: 0,
        base,
        dynf,
        vol: m::VolatilityState { last_update_ts: 0, ..Default::default() },
        collect_mode: g.byte() % 3,
        activation_ts: now + g.irange(0, 100),
        init_price_q64: 0,
        max_impact: g.range(1, MAX_PRICE_IMPACT_BPS as u64) as u16,
        fpl_a: 0,
        fpl_b: 0,
        protocol_a: 0,
        protocol_b: 0,
        swap_paused: false,
        deposit_paused: false,
        withdraw_paused: false,
        impact_slot: 0,
        impact_ref: 0,
        protocol_share: g.range(0, MAX_PROTOCOL_FEE_SHARE_BPS),
        now,
        slot: 1,
        vault_a: 0,
        vault_b: 0,
        positions: vec![],
    })
}

pub fn run(g: &mut Gen) {
    let Some(mut p) = gen_config(g) else { return };
    p.create_position(CREATOR);
    let mut steps = 0;
    while !g.done() && steps < 400 {
        steps += 1;
        let before = p.clone();
        let (k0, l0) = p.value();
        let op = g.byte() % 16;
        let pick = |g: &mut Gen, p: &V2| (g.byte() as usize) % p.positions.len();
        let res: R<()> = match op {
            0 => {
                let who = (g.byte() as usize) % ACTORS;
                p.create_position(who);
                Ok(())
            }
            1 | 2 => {
                let pi = pick(g, &p);
                let (a, b) = if p.liquidity == 0 { (g.amount_in(1_000, u64::MAX), g.amount_in(1_000, u64::MAX)) } else { (g.amount(), g.amount()) };
                p.add(pi, a, b).map(|_| ())
            }
            3 => {
                let pi = pick(g, &p);
                let l = g.part(p.positions[pi].liquidity);
                p.remove(pi, l).map(|_| ())
            }
            4 => {
                let pi = pick(g, &p);
                p.claim(pi).map(|_| ())
            }
            5 => {
                let pi = pick(g, &p);
                let l = g.part(p.positions[pi].liquidity);
                p.lock(pi, l)
            }
            6..=8 => {
                let amt = g.amount();
                let dir = g.bool();
                p.swap(amt, dir).map(|_| ())
            }
            9 => {
                // time / slot passes
                let hi = if g.bool() { 120 } else { 400_000 };
                p.now = p.now.saturating_add(g.irange(0, hi));
                p.slot += g.range(0, 3);
                Ok(())
            }
            10 => {
                // swap round trip within one slot
                let amt = g.amount();
                let dir = g.bool();
                match p.swap(amt, dir) {
                    Ok(out) => {
                        if let Ok(back) = p.swap(out, !dir) {
                            assert!(back <= amt, "v2 round trip profit: in {amt} back {back}");
                        }
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
            11 => {
                // deposit -> withdraw round trip on a fresh position
                if p.liquidity == 0 {
                    Err(())
                } else {
                    let who = (g.byte() as usize) % ACTORS;
                    p.create_position(who);
                    let pi = p.positions.len() - 1;
                    let (a, b) = (g.amount(), g.amount());
                    match p.add(pi, a, b) {
                        Ok((l, pa, pb)) => {
                            if let Ok((ga, gb)) = p.remove(pi, l) {
                                assert!(ga <= pa && gb <= pb, "v2 deposit->withdraw profit");
                            }
                            Ok(())
                        }
                        Err(e) => Err(e),
                    }
                }
            }
            12 => {
                // Governance: SetV2PoolParams
                let mi = g.range(1, MAX_PRICE_IMPACT_BPS as u64) as u16;
                let en = g.bool();
                p.set_v2_params(mi, en)
            }
            13 => {
                // Governance: pause (guardian) / unpause (timelock)
                let (s, d, wd) = (g.bool(), g.bool(), g.bool());
                if g.bool() {
                    p.swap_paused |= s;
                    p.deposit_paused |= d;
                    p.withdraw_paused |= wd;
                } else {
                    p.swap_paused &= !s;
                    p.deposit_paused &= !d;
                    p.withdraw_paused &= !wd;
                }
                Ok(())
            }
            14 => {
                // Governance: protocol share (settings) and protocol-fee withdrawal
                if g.bool() {
                    p.protocol_share = g.range(0, MAX_PROTOCOL_FEE_SHARE_BPS);
                } else if !p.withdraw_paused {
                    p.withdraw_protocol();
                }
                Ok(())
            }
            _ => {
                let (a, b) = (g.amount() as u128, g.amount() as u128);
                if p.vault_a + a <= u64::MAX as u128 && p.vault_b + b <= u64::MAX as u128 {
                    p.vault_a += a;
                    p.vault_b += b;
                    Ok(())
                } else {
                    Err(())
                }
            }
        };
        match res {
            Ok(()) => stats::ok_op(3, op),
            Err(()) => {
                stats::rejected();
                if op != 10 && op != 11 {
                    assert_eq!(p, before, "rejected op mutated state");
                }
            }
        }
        p.check();
        assert!(p.fpl_a >= before.fpl_a && p.fpl_b >= before.fpl_b, "fee growth went backwards");
        let (k1, l1) = p.value();
        if !l0.is_zero() && !l1.is_zero() {
            assert!(k1 * l0 >= k0 * l1, "v2 value per liquidity decreased (op {op})");
        }
    }
    // Liveness: unpause, then every position can withdraw and claim.
    p.withdraw_paused = false;
    for pi in 0..p.positions.len() {
        let l = p.positions[pi].liquidity;
        if l > 0 {
            p.remove(pi, l).expect("a position could not withdraw its liquidity");
        }
        p.claim(pi).expect("a position could not claim its fees");
        p.check();
    }
    p.withdraw_protocol();
    p.check();
}
