//! Parity with the on-chain program crate (`programs/swd_amm`, linked as a
//! library with `no-entrypoint`).
//!
//! 1. The byte decoders read the program's real Anchor serialisation.
//! 2. The base-fee scheduler equals `SwdmmV2Pool::current_base_fee_bps`.
//! 3. The oracle helpers equal the program's `oracle_price_q64`,
//!    `deviation_bps`, `confidence_ok`, `guard_allows`.
//! 4. The quote equals a swap computed with the program crate's own
//!    `swd_amm::swdmm_math` (a separate compilation of the same file, so a
//!    drift between the copy Jupiter builds and the program would show).

mod common;
use common::*;

use jupiter_amm_interface::{Amm, QuoteParams, SwapMode, FeeMode};
use jupiter_amm_swd::{quote, state};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo + 1)
    }
    /// uniform in [1, base >> s] for a random shift s in [0, max_shift]
    fn range_shr(&mut self, base: u64, max_shift: u64) -> u64 {
        let s = self.range(0, max_shift);
        self.range(1, (base >> s).max(1))
    }
}

#[test]
fn decoder_reads_program_serialisation_field_by_field() {
    let mut p = program_pool(123_456_789, 987_654_321, 30, 2);
    p.liquidity = 0x1111_2222_3333_4444_5555_6666_7777_8888;
    p.locked_liquidity = 0x0102_0304_0506_0708_090a_0b0c_0d0e_0f10;
    p.base_fee = swd_amm::BaseFeeParams {
        mode: 1,
        decay: 1,
        cliff_fee_bps: 5_000,
        floor_fee_bps: 25,
        number_of_periods: 100,
        period_frequency: 60,
        reduction_factor: 300,
    };
    p.dynamic_fee = dynamic_on();
    p.volatility_accumulator = 4_321;
    p.volatility_reference = 1_234;
    p.price_reference_q64 = 99 << 64;
    p.last_swap_ts = NOW - 5;
    p.activation_ts = NOW - 77;
    p.init_price_q64 = 3 << 63;
    p.max_price_impact_bps = 4_444;
    p.oracle = swd_amm::OracleGuardParams {
        enabled: true,
        pyth_feed_id_a: [0xaa; 32],
        pyth_feed_id_b: [0xbb; 32],
        max_staleness_secs: 60,
        max_deviation_bps: 300,
    };
    p.fee_per_liquidity_a = 11;
    p.fee_per_liquidity_b = 12;
    p.protocol_fee_a = 13;
    p.protocol_fee_b = 14;
    p.total_volume_a = 15;
    p.total_volume_b = 16;
    p.total_lp_fee_a = 17;
    p.total_lp_fee_b = 18;
    p.total_protocol_fee_a = 19;
    p.total_protocol_fee_b = 20;
    p.swap_count = 21;
    p.swap_paused = true;
    p.deposit_paused = false;
    p.withdraw_paused = true;
    p.position_count = 22;
    p.bump = 253;
    p.impact_slot = SLOT - 1;
    p.impact_ref_price_q64 = 7 << 64;

    let bytes = ser(&p);
    // Account size the program allocates: 8 + INIT_SPACE.
    assert_eq!(bytes.len(), 8 + <swd_amm::SwdmmV2Pool as anchor_lang::Space>::INIT_SPACE);
    let d = state::SwdmmV2Pool::decode(&bytes).unwrap();

    assert_eq!(d.mint_a, to_pk(&p.mint_a));
    assert_eq!(d.mint_b, to_pk(&p.mint_b));
    assert_eq!(d.vault_a, to_pk(&p.vault_a));
    assert_eq!(d.vault_b, to_pk(&p.vault_b));
    assert_eq!(d.token_program_a, to_pk(&p.token_program_a));
    assert_eq!(d.token_program_b, to_pk(&p.token_program_b));
    assert_eq!(d.creator, to_pk(&p.creator));
    assert_eq!((d.reserve_a, d.reserve_b), (p.reserve_a, p.reserve_b));
    assert_eq!((d.liquidity, d.locked_liquidity), (p.liquidity, p.locked_liquidity));
    let b = d.base_fee;
    assert_eq!(
        (b.mode, b.decay, b.cliff_fee_bps, b.floor_fee_bps, b.number_of_periods, b.period_frequency, b.reduction_factor),
        (1, 1, 5_000, 25, 100, 60, 300)
    );
    let f = d.dynamic_fee;
    let pf = p.dynamic_fee;
    assert_eq!(
        (f.enabled, f.max_dynamic_fee_bps, f.variable_fee_control, f.filter_period, f.decay_period, f.reduction_factor, f.max_volatility_accumulator),
        (pf.enabled, pf.max_dynamic_fee_bps, pf.variable_fee_control, pf.filter_period, pf.decay_period, pf.reduction_factor, pf.max_volatility_accumulator)
    );
    assert_eq!((d.volatility_accumulator, d.volatility_reference), (4_321, 1_234));
    assert_eq!(d.price_reference_q64, p.price_reference_q64);
    assert_eq!(d.last_swap_ts, p.last_swap_ts);
    assert_eq!(d.collect_fee_mode, 2);
    assert_eq!(d.activation_ts, p.activation_ts);
    assert_eq!(d.init_price_q64, p.init_price_q64);
    assert_eq!(d.max_price_impact_bps, 4_444);
    assert!(d.oracle.enabled);
    assert_eq!(d.oracle.pyth_feed_id_a, [0xaa; 32]);
    assert_eq!(d.oracle.pyth_feed_id_b, [0xbb; 32]);
    assert_eq!((d.oracle.max_staleness_secs, d.oracle.max_deviation_bps), (60, 300));
    assert_eq!(
        (d.fee_per_liquidity_a, d.fee_per_liquidity_b, d.protocol_fee_a, d.protocol_fee_b),
        (11, 12, 13, 14)
    );
    assert_eq!(
        (d.total_volume_a, d.total_volume_b, d.total_lp_fee_a, d.total_lp_fee_b, d.total_protocol_fee_a, d.total_protocol_fee_b),
        (15, 16, 17, 18, 19, 20)
    );
    assert_eq!(d.swap_count, 21);
    assert_eq!((d.swap_paused, d.deposit_paused, d.withdraw_paused), (true, false, true));
    assert_eq!((d.position_count, d.created_at, d.bump), (22, p.created_at, 253));
    assert_eq!((d.impact_slot, d.impact_ref_price_q64), (SLOT - 1, 7 << 64));

    // GovernanceSettings
    let s = state::GovernanceSettings::decode(&settings_bytes(1_234)).unwrap();
    assert_eq!((s.timelock_delay_secs, s.protocol_fee_share_bps), (86_400, 1_234));

    // Wrong discriminator / truncated data are rejected.
    assert!(state::SwdmmV2Pool::decode(&settings_bytes(0)).is_err());
    assert!(state::SwdmmV2Pool::decode(&bytes[..bytes.len() - 1]).is_err());
}

#[test]
fn price_update_decoder_reads_program_serialisation() {
    for full in [true, false] {
        let pu = swd_amm::PriceUpdateV2 {
            write_authority: apk(8),
            verification_level: if full {
                swd_amm::VerificationLevel::Full
            } else {
                swd_amm::VerificationLevel::Partial { num_signatures: 5 }
            },
            price_message: swd_amm::PriceFeedMessage {
                feed_id: [0xcd; 32],
                price: 15_012_345_678,
                conf: 1_234_567,
                exponent: -8,
                publish_time: NOW - 3,
                prev_publish_time: NOW - 4,
                ema_price: 15_000_000_000,
                ema_conf: 1_000_000,
            },
            posted_slot: SLOT - 2,
        };
        let d = state::PriceUpdate::decode(&ser(&pu)).unwrap();
        assert_eq!(d.verification_full, full);
        assert_eq!(d.feed_id, [0xcd; 32]);
        assert_eq!((d.price, d.conf, d.exponent, d.publish_time), (15_012_345_678, 1_234_567, -8, NOW - 3));
    }
}

#[test]
fn base_fee_scheduler_matches_program_current_base_fee_bps() {
    let mut rng = Rng(0x5eed_1234_abcd_0001);
    let mut checked = 0;
    for _ in 0..20_000 {
        let mode = rng.range(0, 2) as u8;
        let decay = rng.range(0, 1) as u8;
        let floor = rng.range(1, 1_000) as u16;
        let cliff = if mode == 0 { floor } else { rng.range(floor as u64, 9_900) as u16 };
        let base_fee = swd_amm::BaseFeeParams {
            mode,
            decay,
            cliff_fee_bps: cliff,
            floor_fee_bps: floor,
            number_of_periods: rng.range(1, 10_000) as u16,
            period_frequency: rng.range(1, 3_600),
            reduction_factor: if decay == 1 { rng.range(1, 9_999) } else { rng.range(1, 500) },
        };
        let mut p = program_pool(rng.range(1, u64::MAX >> 8), rng.range(1, u64::MAX >> 8), floor, 0);
        p.base_fee = base_fee;
        p.init_price_q64 = (rng.range(1, u64::MAX) as u128) << rng.range(0, 40);
        p.activation_ts = NOW - rng.range(0, 1_000_000) as i64;
        let now = NOW + rng.range(0, 100_000) as i64 - 50_000;

        let ours = quote::current_base_fee_bps(&state::SwdmmV2Pool::decode(&ser(&p)).unwrap(), now).ok();
        let theirs = p.current_base_fee_bps(now).ok();
        assert_eq!(ours, theirs, "base fee mismatch for {base_fee:?} now={now}");
        checked += 1;
    }
    assert_eq!(checked, 20_000);
}

#[test]
fn oracle_helpers_match_program() {
    let mut rng = Rng(0x0dd_ba11_cafe);
    for _ in 0..20_000 {
        let pa = rng.range_shr(i64::MAX as u64, 40) as i64;
        let pb = rng.range_shr(i64::MAX as u64, 40) as i64;
        let ea = -(rng.range(0, 12) as i32);
        let eb = -(rng.range(0, 12) as i32);
        let da = rng.range(0, 12) as u8;
        let db = rng.range(0, 12) as u8;
        let ours = quote::oracle_price_q64(pa, ea, da, pb, eb, db).ok();
        let theirs = swd_amm::oracle_price_q64(pa, ea, da, pb, eb, db).ok();
        assert_eq!(ours, theirs);

        let x = (rng.next() as u128) << rng.range(0, 60);
        let y = ((rng.next() as u128) << rng.range(0, 60)).max(1);
        assert_eq!(quote::deviation_bps(x, y).ok(), swd_amm::deviation_bps(x, y).ok());

        let conf = rng.range(0, (pa as u64) / 25);
        let ours_c = quote::confidence_ok(&quote::Price { price: pa, conf, exponent: ea });
        let theirs_c = swd_amm::confidence_ok(&swd_amm::Price { price: pa, conf, exponent: ea, publish_time: 0 });
        assert_eq!(ours_c, theirs_c);

        let (pre, post, max) = (rng.range(0, 1_000), rng.range(0, 1_000), rng.range(1, 1_000) as u16);
        assert_eq!(quote::guard_allows(pre, post, max), swd_amm::guard_allows(pre, post, max));
    }
}

/// Reference: swap_v2's fee + swap steps, written against the PROGRAM
/// crate's API (`p.current_base_fee_bps`, `swd_amm::swdmm_math`).
fn program_reference(p: &swd_amm::SwdmmV2Pool, share: u64, now: i64, amount_in: u64, a_to_b: bool) -> Option<(u64, u64, u64)> {
    use swd_amm::swdmm_math as pm;
    if p.swap_paused || now < p.activation_ts || amount_in == 0 || p.reserve_a == 0 || p.reserve_b == 0 {
        return None;
    }
    let price_before = pm::price_q64(p.reserve_a, p.reserve_b)?;
    let base = p.current_base_fee_bps(now).ok()?;
    let cfg = pm::DynamicFeeConfig {
        enabled: p.dynamic_fee.enabled,
        max_dynamic_fee_bps: p.dynamic_fee.max_dynamic_fee_bps,
        variable_fee_control: p.dynamic_fee.variable_fee_control,
        filter_period: p.dynamic_fee.filter_period,
        decay_period: p.dynamic_fee.decay_period,
        reduction_factor: p.dynamic_fee.reduction_factor,
        max_volatility_accumulator: p.dynamic_fee.max_volatility_accumulator,
    };
    let mut vol = pm::VolatilityState {
        volatility_accumulator: p.volatility_accumulator,
        volatility_reference: p.volatility_reference,
        price_reference_q64: p.price_reference_q64,
        last_update_ts: p.last_swap_ts,
    };
    if cfg.enabled {
        pm::update_references(&cfg, &mut vol, now, price_before);
        pm::accumulate(&cfg, &mut vol, price_before, now);
    }
    let fee_bps = pm::total_fee_bps(base, pm::variable_fee_bps(&cfg, &vol));
    let r = pm::swap(p.reserve_a, p.reserve_b, amount_in, a_to_b, fee_bps, share, p.collect_fee_mode)?;
    if r.price_impact_bps > p.max_price_impact_bps as u64 {
        return None;
    }
    Some((r.amount_out, r.fee, fee_bps))
}

#[test]
fn quote_matches_program_math_on_random_pools() {
    let mut rng = Rng(0xfeed_beef_0042);
    let (mut ok, mut rejected) = (0, 0);
    for i in 0..30_000 {
        let ra = rng.range_shr(u64::MAX, 60);
        let rb = rng.range_shr(u64::MAX, 60);
        let floor = rng.range(1, 1_000) as u16;
        let mode = rng.range(0, 2) as u8;
        let mut p = program_pool(ra, rb, floor, mode);
        if i % 3 == 0 {
            p.base_fee = swd_amm::BaseFeeParams {
                mode: 1,
                decay: (i % 2) as u8,
                cliff_fee_bps: rng.range(floor as u64, 9_900) as u16,
                floor_fee_bps: floor,
                number_of_periods: 100,
                period_frequency: rng.range(1, 600),
                reduction_factor: if i % 2 == 1 { rng.range(1, 9_999) } else { rng.range(1, 200) },
            };
        }
        if i % 4 == 0 {
            p.dynamic_fee = dynamic_on();
            p.volatility_accumulator = rng.range(0, 10_000);
            p.volatility_reference = rng.range(0, 5_000);
            p.price_reference_q64 = if i % 8 == 0 { 0 } else { ((rb as u128) << 64) / ra as u128 };
            p.last_swap_ts = NOW - rng.range(0, 300) as i64;
        }
        p.max_price_impact_bps = rng.range(1, 5_000) as u16;
        let share = rng.range(0, 2_000) as u16;
        let a_to_b = rng.next() & 1 == 0;
        let r_in = if a_to_b { ra } else { rb };
        let amount = rng.range_shr(r_in.max(2), 30).max(1);

        let amm = load_amm(&p, share, NOW, SLOT, &[]);
        let (in_mint, out_mint) = if a_to_b { (to_pk(&p.mint_a), to_pk(&p.mint_b)) } else { (to_pk(&p.mint_b), to_pk(&p.mint_a)) };
        let ours = amm
            .quote(&QuoteParams { amount, input_mint: in_mint, output_mint: out_mint, swap_mode: SwapMode::ExactIn, fee_mode: FeeMode::Normal })
            .ok()
            .map(|q| (q.out_amount, q.fee_amount));
        let theirs = program_reference(&p, share as u64, NOW, amount, a_to_b).map(|(o, f, _)| (o, f));
        assert_eq!(ours, theirs, "pool {ra}/{rb} amount {amount} a_to_b {a_to_b} mode {mode}");
        if ours.is_some() { ok += 1 } else { rejected += 1 }
    }
    // both branches must actually be exercised
    assert!(ok > 10_000 && rejected > 100, "ok={ok} rejected={rejected}");
}
