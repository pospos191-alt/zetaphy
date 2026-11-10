//! Shared fixtures: every pool/settings account used by the tests is built
//! from the PROGRAM's own Rust structs (`swd_amm::SwdmmV2Pool`, …) and
//! serialised with Anchor's own `AccountSerialize`, so the bytes are
//! exactly what the chain would hold.
#![allow(dead_code)]

use anchor_lang::{prelude::Pubkey as APubkey, AccountSerialize};
use jupiter_amm_interface::{AccountMap, Amm, AmmContext, ClockRef, KeyedAccount};
use jupiter_amm_swd::{gov_settings_address, SwdAmm, SWD_AMM_PROGRAM_ID};
use solana_account::Account;
use solana_clock::Clock;
use solana_pubkey::Pubkey;

pub const NOW: i64 = 1_800_000_000;
pub const SLOT: u64 = 400_000_000;

pub fn apk(b: u8) -> APubkey {
    APubkey::new_from_array([b; 32])
}

pub fn to_pk(p: &APubkey) -> Pubkey {
    Pubkey::new_from_array(p.to_bytes())
}

pub fn fixed_fee(bps: u16) -> swd_amm::BaseFeeParams {
    swd_amm::BaseFeeParams {
        mode: 0,
        decay: 0,
        cliff_fee_bps: bps,
        floor_fee_bps: bps,
        number_of_periods: 0,
        period_frequency: 0,
        reduction_factor: 0,
    }
}

pub fn no_dynamic() -> swd_amm::DynamicFeeParams {
    swd_amm::DynamicFeeParams {
        enabled: false,
        max_dynamic_fee_bps: 0,
        variable_fee_control: 0,
        filter_period: 0,
        decay_period: 0,
        reduction_factor: 0,
        max_volatility_accumulator: 0,
    }
}

pub fn dynamic_on() -> swd_amm::DynamicFeeParams {
    swd_amm::DynamicFeeParams {
        enabled: true,
        max_dynamic_fee_bps: 200,
        variable_fee_control: 5_000,
        filter_period: 10,
        decay_period: 120,
        reduction_factor: 5_000,
        max_volatility_accumulator: 10_000,
    }
}

pub fn no_oracle() -> swd_amm::OracleGuardParams {
    swd_amm::OracleGuardParams {
        enabled: false,
        pyth_feed_id_a: [0; 32],
        pyth_feed_id_b: [0; 32],
        max_staleness_secs: 0,
        max_deviation_bps: 0,
    }
}

/// A plain, active, fixed-fee pool. Tests mutate fields as needed.
pub fn program_pool(reserve_a: u64, reserve_b: u64, fee_bps: u16, collect_mode: u8) -> swd_amm::SwdmmV2Pool {
    let init_price = if reserve_a > 0 { ((reserve_b as u128) << 64) / reserve_a as u128 } else { 0 };
    swd_amm::SwdmmV2Pool {
        mint_a: apk(1),
        mint_b: apk(2),
        vault_a: apk(3),
        vault_b: apk(4),
        token_program_a: anchor_lang::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        token_program_b: anchor_lang::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
        creator: apk(5),
        reserve_a,
        reserve_b,
        liquidity: 1_000_000,
        locked_liquidity: 1_000,
        base_fee: fixed_fee(fee_bps),
        dynamic_fee: no_dynamic(),
        volatility_accumulator: 0,
        volatility_reference: 0,
        price_reference_q64: 0,
        last_swap_ts: 0,
        collect_fee_mode: collect_mode,
        activation_ts: NOW - 1_000,
        init_price_q64: init_price,
        max_price_impact_bps: 5_000,
        oracle: no_oracle(),
        fee_per_liquidity_a: 0,
        fee_per_liquidity_b: 0,
        protocol_fee_a: 0,
        protocol_fee_b: 0,
        total_volume_a: 0,
        total_volume_b: 0,
        total_lp_fee_a: 0,
        total_lp_fee_b: 0,
        total_protocol_fee_a: 0,
        total_protocol_fee_b: 0,
        swap_count: 0,
        swap_paused: false,
        deposit_paused: false,
        withdraw_paused: false,
        position_count: 1,
        created_at: NOW - 2_000,
        bump: 254,
        impact_slot: 0,
        impact_ref_price_q64: 0,
        _reserved: [0; 40],
    }
}

pub fn ser<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut out = Vec::new();
    v.try_serialize(&mut out).unwrap();
    out
}

pub fn settings_bytes(protocol_fee_share_bps: u16) -> Vec<u8> {
    ser(&swd_amm::GovernanceSettings {
        timelock_delay_secs: 86_400,
        protocol_fee_share_bps,
        treasury: apk(9),
        next_action_id: 0,
        bump: 255,
    })
}

pub fn acct(data: Vec<u8>, owner: Pubkey) -> Account {
    Account { lamports: 1_000_000, data, owner, executable: false, rent_epoch: 0 }
}

pub fn pool_key() -> Pubkey {
    Pubkey::new_from_array([7; 32])
}

pub fn ctx(now: i64, slot: u64) -> AmmContext {
    AmmContext {
        clock_ref: ClockRef::from(Clock {
            slot,
            epoch_start_timestamp: 0,
            epoch: 900,
            leader_schedule_epoch: 901,
            unix_timestamp: now,
        }),
    }
}

/// Build the Jupiter AMM from program bytes and run `update`, the way
/// Jupiter does: from_keyed_account -> get_accounts_to_update -> update.
pub fn load_amm(pool: &swd_amm::SwdmmV2Pool, share_bps: u16, now: i64, slot: u64, extra: &[(Pubkey, Account)]) -> SwdAmm {
    let ka = KeyedAccount { key: pool_key(), account: acct(ser(pool), SWD_AMM_PROGRAM_ID), params: None };
    let mut amm = SwdAmm::from_keyed_account(&ka, &ctx(now, slot)).unwrap();
    let mut map = AccountMap::default();
    map.insert(pool_key(), ka.account.clone());
    map.insert(gov_settings_address(&SWD_AMM_PROGRAM_ID), acct(settings_bytes(share_bps), SWD_AMM_PROGRAM_ID));
    for (k, a) in extra {
        map.insert(*k, a.clone());
    }
    for k in amm.get_accounts_to_update() {
        assert!(map.contains_key(&k), "test is missing account {k}");
    }
    amm.update(&map).unwrap();
    amm
}
