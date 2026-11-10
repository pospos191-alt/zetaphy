//! Hand-computed fixtures and edge cases for the Jupiter AMM.
//! Expected numbers are worked out by hand from swdmm_math.rs's formulas:
//!   fee   = ceil(amount * fee_bps / 10_000)
//!   out   = floor(x * R_out / (R_in + x))

mod common;
use common::*;

use jupiter_amm_interface::{Amm, FeeMode, QuoteParams, SwapMode, SwapParams};
use jupiter_amm_swd::{pyth_price_feed_address, swap_v2_ix_data, PYTH_DEFAULT_SHARD, SWAP_V2_ACCOUNTS_LEN, SWD_AMM_PROGRAM_ID};
use rust_decimal::Decimal;
use solana_pubkey::Pubkey;

fn q(amm: &impl Amm, amount: u64, a_to_b: bool) -> anyhow::Result<jupiter_amm_interface::Quote> {
    let (a, b) = (to_pk(&apk(1)), to_pk(&apk(2)));
    let (i, o) = if a_to_b { (a, b) } else { (b, a) };
    amm.quote(&QuoteParams { amount, input_mint: i, output_mint: o, swap_mode: SwapMode::ExactIn, fee_mode: FeeMode::Normal })
}

#[test]
fn fixture_fee_on_input_a_to_b() {
    // 1_000_000 A / 2_000_000 B, 0.30%, "Base + Quote": fee on input.
    // fee = ceil(10_000*30/10_000) = 30; x = 9_970;
    // out = floor(9_970*2_000_000/1_009_970) = 19_743.
    let amm = load_amm(&program_pool(1_000_000, 2_000_000, 30, 0), 1_000, NOW, SLOT, &[]);
    let r = q(&amm, 10_000, true).unwrap();
    assert_eq!((r.in_amount, r.out_amount, r.fee_amount), (10_000, 19_743, 30));
    assert_eq!(r.fee_mint, to_pk(&apk(1)));
    assert_eq!(r.fee_pct, Decimal::new(30, 4));
}

#[test]
fn fixture_fee_on_output_quote_mode_a_to_b() {
    // "Quote" mode, A in: gross = floor(10_000*2_000_000/1_010_000) = 19_801;
    // fee = ceil(19_801*100/10_000) = 199; out = 19_602, fee in B.
    let amm = load_amm(&program_pool(1_000_000, 2_000_000, 100, 1), 0, NOW, SLOT, &[]);
    let r = q(&amm, 10_000, true).unwrap();
    assert_eq!((r.out_amount, r.fee_amount, r.fee_mint), (19_602, 199, to_pk(&apk(2))));
}

#[test]
fn fixture_fee_on_input_quote_mode_b_to_a() {
    // "Quote" mode, B in: fee on input = 100; out = floor(9_900*1_000_000/2_009_900) = 4_925.
    let amm = load_amm(&program_pool(1_000_000, 2_000_000, 100, 2), 2_000, NOW, SLOT, &[]);
    let r = q(&amm, 10_000, false).unwrap();
    assert_eq!((r.out_amount, r.fee_amount, r.fee_mint), (4_925, 100, to_pk(&apk(2))));
}

#[test]
fn protocol_share_never_changes_trader_output() {
    let p = program_pool(5_000_000, 7_000_000, 25, 0);
    let a = q(&load_amm(&p, 0, NOW, SLOT, &[]), 123_456, true).unwrap();
    let b = q(&load_amm(&p, 2_000, NOW, SLOT, &[]), 123_456, true).unwrap();
    assert_eq!((a.out_amount, a.fee_amount), (b.out_amount, b.fee_amount));
}

#[test]
fn dust_rounding_is_rejected_like_the_program() {
    let amm = load_amm(&program_pool(1_000_000, 1_000_000, 25, 0), 0, NOW, SLOT, &[]);
    // amount 1: fee = ceil(0.0025) = 1 >= amount -> program returns SwapTooLarge.
    assert!(q(&amm, 1, true).is_err());
    // amount 2: x = 1, out = floor(1_000_000/1_000_001) = 0 -> rejected.
    assert!(q(&amm, 2, true).is_err());
    // Smallest amount that pays out: out = floor((n-1)*1e6/(1e6+n-1)) >= 1 -> n = 3.
    assert_eq!(q(&amm, 3, true).unwrap().out_amount, 1);
}

#[test]
fn zero_empty_paused_and_not_activated() {
    let amm = load_amm(&program_pool(1_000_000, 1_000_000, 30, 0), 0, NOW, SLOT, &[]);
    assert!(q(&amm, 0, true).is_err(), "zero amount");

    let empty = load_amm(&program_pool(0, 0, 30, 0), 0, NOW, SLOT, &[]);
    assert!(q(&empty, 1_000, true).is_err(), "empty pool");
    assert!(!empty.is_active());

    let mut p = program_pool(1_000_000, 1_000_000, 30, 0);
    p.swap_paused = true;
    let paused = load_amm(&p, 0, NOW, SLOT, &[]);
    assert!(q(&paused, 1_000, true).is_err());
    assert!(!paused.is_active());

    let mut p = program_pool(1_000_000, 1_000_000, 30, 0);
    p.activation_ts = NOW + 1;
    assert!(q(&load_amm(&p, 0, NOW, SLOT, &[]), 1_000, true).is_err(), "NotActivated");
    // ...and opens exactly at activation_ts.
    assert!(q(&load_amm(&p, 0, NOW + 1, SLOT, &[]), 1_000, true).is_ok());
}

#[test]
fn insufficient_liquidity_and_price_impact_cap() {
    // max_price_impact 10%: impact = ceil(x*10_000/(R_in+x)).
    let mut p = program_pool(1_000_000, 1_000_000, 30, 0);
    p.max_price_impact_bps = 1_000;
    let amm = load_amm(&p, 0, NOW, SLOT, &[]);
    // x = 111_111 - fee(334) = 110_777 -> impact ceil(9_973.6..) = 998 bps... ok
    assert!(q(&amm, 111_111, true).is_ok());
    // well past the cap
    assert!(q(&amm, 200_000, true).is_err());
    // a trade bigger than the whole pool is always refused (max cap is 50%)
    assert!(q(&load_amm(&program_pool(1_000, 1_000, 30, 0), 0, NOW, SLOT, &[]), u64::MAX, true).is_err());
}

#[test]
fn per_slot_cap_uses_the_slot_reference_price() {
    // Earlier swaps in this slot already moved the price 2x away from the
    // slot's reference; with a 10% cap any further move away is refused,
    // a move back toward it is allowed.
    let mut p = program_pool(1_000_000, 2_000_000, 30, 0);
    p.max_price_impact_bps = 1_000;
    p.impact_slot = SLOT;
    p.impact_ref_price_q64 = 1u128 << 64; // reference price 1.0, now 2.0
    let amm = load_amm(&p, 0, NOW, SLOT, &[]);
    assert!(q(&amm, 1_000, false).is_err(), "B in raises B/A further from 1.0");
    assert!(q(&amm, 1_000, true).is_ok(), "A in moves the price back toward 1.0");
    // In the next slot the reference resets to the current price.
    let next = load_amm(&p, 0, NOW, SLOT + 1, &[]);
    assert!(q(&next, 1_000, false).is_ok());
}

#[test]
fn time_scheduler_fee_decays() {
    let mut p = program_pool(10_000_000, 10_000_000, 25, 0);
    p.base_fee = swd_amm::BaseFeeParams {
        mode: 1,
        decay: 0,
        cliff_fee_bps: 5_000,
        floor_fee_bps: 25,
        number_of_periods: 100,
        period_frequency: 60,
        reduction_factor: 50,
    };
    p.activation_ts = NOW;
    let at_open = q(&load_amm(&p, 0, NOW, SLOT, &[]), 100_000, true).unwrap();
    assert_eq!(at_open.fee_pct, Decimal::new(5_000, 4));
    assert_eq!(at_open.fee_amount, 50_000);
    // 10 periods later: 5_000 - 10*50 = 4_500 bps.
    let later = q(&load_amm(&p, 0, NOW + 600, SLOT, &[]), 100_000, true).unwrap();
    assert_eq!(later.fee_pct, Decimal::new(4_500, 4));
    // after the schedule: the floor.
    let end = q(&load_amm(&p, 0, NOW + 1_000_000, SLOT, &[]), 100_000, true).unwrap();
    assert_eq!(end.fee_pct, Decimal::new(25, 4));
}

#[test]
fn dynamic_fee_adds_volatility_part() {
    let mut p = program_pool(10_000_000, 10_000_000, 30, 0);
    p.dynamic_fee = dynamic_on(); // control 5_000 -> var = acc/2, max 200 bps
    p.price_reference_q64 = 1u128 << 64;
    p.volatility_accumulator = 300;
    p.volatility_reference = 300;
    p.last_swap_ts = NOW - 1; // inside filter period: reference kept
    let r = q(&load_amm(&p, 0, NOW, SLOT, &[]), 10_000, true).unwrap();
    // acc = 300 + 0 (price unchanged) -> var = 150 -> 180 bps total
    assert_eq!(r.fee_pct, Decimal::new(180, 4));
    // after the decay period the volatility resets: back to the base fee
    p.last_swap_ts = NOW - 500;
    let r = q(&load_amm(&p, 0, NOW, SLOT, &[]), 10_000, true).unwrap();
    assert_eq!(r.fee_pct, Decimal::new(30, 4));
}

#[test]
fn wrong_mints_and_exact_out_are_refused() {
    let amm = load_amm(&program_pool(1_000_000, 1_000_000, 30, 0), 0, NOW, SLOT, &[]);
    let other = Pubkey::new_unique();
    assert!(amm
        .quote(&QuoteParams { amount: 10, input_mint: other, output_mint: to_pk(&apk(2)), swap_mode: SwapMode::ExactIn, fee_mode: FeeMode::Normal })
        .is_err());
    assert!(amm
        .quote(&QuoteParams { amount: 10, input_mint: to_pk(&apk(1)), output_mint: to_pk(&apk(2)), swap_mode: SwapMode::ExactOut, fee_mode: FeeMode::Normal })
        .is_err());
    assert!(!amm.supports_exact_out());
}

// ---------------------------------------------------------------------
// Oracle guard
// ---------------------------------------------------------------------

fn mint_account(decimals: u8, owner: Pubkey) -> solana_account::Account {
    let mut d = vec![0u8; 82];
    d[44] = decimals;
    d[45] = 1; // is_initialized
    acct(d, owner)
}

fn price_account(feed: [u8; 32], price: i64, conf: u64, publish_time: i64, full: bool) -> solana_account::Account {
    let pu = swd_amm::PriceUpdateV2 {
        write_authority: apk(8),
        verification_level: if full { swd_amm::VerificationLevel::Full } else { swd_amm::VerificationLevel::Partial { num_signatures: 3 } },
        price_message: swd_amm::PriceFeedMessage {
            feed_id: feed,
            price,
            conf,
            exponent: -8,
            publish_time,
            prev_publish_time: publish_time - 1,
            ema_price: price,
            ema_conf: conf,
        },
        posted_slot: SLOT,
    };
    acct(ser(&pu), solana_pubkey::pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"))
}

fn oracle_pool() -> swd_amm::SwdmmV2Pool {
    // both tokens 6 decimals; pool price 1.0 B per A
    let mut p = program_pool(10_000_000, 10_000_000, 30, 0);
    p.oracle = swd_amm::OracleGuardParams {
        enabled: true,
        pyth_feed_id_a: [0xa1; 32],
        pyth_feed_id_b: [0xb2; 32],
        max_staleness_secs: 60,
        max_deviation_bps: 200,
    };
    p
}

fn oracle_accounts(price_a: i64, price_b: i64, age: i64, full: bool) -> Vec<(Pubkey, solana_account::Account)> {
    let tk = solana_pubkey::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    vec![
        (pyth_price_feed_address(PYTH_DEFAULT_SHARD, &[0xa1; 32]), price_account([0xa1; 32], price_a, 1_000, NOW - age, full)),
        (pyth_price_feed_address(PYTH_DEFAULT_SHARD, &[0xb2; 32]), price_account([0xb2; 32], price_b, 1_000, NOW - age, full)),
        (to_pk(&apk(1)), mint_account(6, tk)),
        (to_pk(&apk(2)), mint_account(6, tk)),
    ]
}

#[test]
fn oracle_guard_cases() {
    let p = oracle_pool();
    // Oracle agrees with the pool (1.0): small trade passes, a trade that
    // pushes the pool >2% away is refused.
    let amm = load_amm(&p, 0, NOW, SLOT, &oracle_accounts(100_000_000, 100_000_000, 5, true));
    assert_eq!(amm.get_accounts_to_update().len(), 6);
    assert!(q(&amm, 10_000, true).is_ok());
    assert!(q(&amm, 500_000, true).is_err());

    // Stale price (age 61 > 60) and partial verification are refused.
    assert!(q(&load_amm(&p, 0, NOW, SLOT, &oracle_accounts(100_000_000, 100_000_000, 61, true)), 10_000, true).is_err());
    assert!(q(&load_amm(&p, 0, NOW, SLOT, &oracle_accounts(100_000_000, 100_000_000, 5, false)), 10_000, true).is_err());

    // Oracle says A is worth 1.10 B (pool is 10% below): selling A moves the
    // pool further away -> refused; buying A moves it toward -> allowed.
    let amm = load_amm(&p, 0, NOW, SLOT, &oracle_accounts(110_000_000, 100_000_000, 5, true));
    assert!(q(&amm, 10_000, true).is_err());
    assert!(q(&amm, 10_000, false).is_ok());
}

#[test]
fn swap_account_metas_follow_the_swap_v2_struct() {
    let p = program_pool(1_000_000, 1_000_000, 30, 0);
    let amm = load_amm(&p, 0, NOW, SLOT, &[]);
    let (src, dst, user) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
    let jup = Pubkey::new_unique();
    let sp = SwapParams {
        swap_mode: SwapMode::ExactIn,
        in_amount: 1_000,
        out_amount: 900,
        source_mint: to_pk(&p.mint_b),
        destination_mint: to_pk(&p.mint_a),
        source_token_account: src,
        destination_token_account: dst,
        token_transfer_authority: user,
        user,
        payer: user,
        quote_mint_to_referrer: None,
        jupiter_program_id: &jup,
        missing_dynamic_accounts_as_default: false,
    };
    let m = amm.get_swap_and_account_metas(&sp).unwrap().account_metas;
    assert_eq!(m.len(), SWAP_V2_ACCOUNTS_LEN);
    assert_eq!(amm.get_accounts_len(), SWAP_V2_ACCOUNTS_LEN);
    assert!(m[0].is_signer && m[0].pubkey == user);
    assert_eq!(m[1].pubkey, jupiter_amm_swd::gov_settings_address(&SWD_AMM_PROGRAM_ID));
    assert!(m[2].is_writable && m[2].pubkey == pool_key());
    assert_eq!((m[3].pubkey, m[4].pubkey), (to_pk(&p.mint_a), to_pk(&p.mint_b)));
    assert!(m[5].is_writable && m[6].is_writable);
    // B -> A: trader_token_a is the destination, trader_token_b the source
    assert_eq!((m[7].pubkey, m[8].pubkey), (dst, src));
    assert_eq!((m[9].pubkey, m[10].pubkey), (to_pk(&p.token_program_a), to_pk(&p.token_program_b)));
    // oracle off: Option accounts are the program id
    assert_eq!((m[11].pubkey, m[12].pubkey), (SWD_AMM_PROGRAM_ID, SWD_AMM_PROGRAM_ID));
    assert_eq!(swap_v2_ix_data(1, 2, true).len(), 25);
}

#[test]
fn ix_discriminator_is_anchor_global_swap_v2() {
    // sha256("global:swap_v2")[..8], cross-checked with the program's own
    // generated instruction struct.
    use anchor_lang::Discriminator;
    assert_eq!(swd_amm::instruction::SwapV2::DISCRIMINATOR, &jupiter_amm_swd::SWAP_V2_IX_DISCRIMINATOR);
    use anchor_lang::InstructionData;
    let ix = swd_amm::instruction::SwapV2 { amount_in: 1, min_amount_out: 2, a_to_b: true };
    assert_eq!(ix.data(), swap_v2_ix_data(1, 2, true));
}
