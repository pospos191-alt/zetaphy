//! Byte-level decoders for the swd_amm accounts a quote needs.
//!
//! Layouts are copied field-for-field from the program source
//! (`programs/swd_amm/src/swdmm_v2.rs` `SwdmmV2Pool`, `timelock.rs`
//! `GovernanceSettings`, `oracle.rs` `PriceUpdateV2`). Anchor accounts are
//! an 8-byte discriminator (sha256("account:<Name>")[..8]) followed by the
//! Borsh encoding of the struct (little-endian integers, no padding,
//! `bool` = 1 byte, enum = 1-byte tag + variant fields).
//! `tests/program_parity.rs` serialises the program's own structs and
//! checks these decoders read back the same values.

use anyhow::{anyhow, bail, ensure, Result};
use solana_pubkey::Pubkey;

use crate::swdmm_math as m;

pub const SWDMM_V2_POOL_DISCRIMINATOR: [u8; 8] = [60, 111, 1, 207, 58, 30, 19, 215];
pub const GOVERNANCE_SETTINGS_DISCRIMINATOR: [u8; 8] = [49, 130, 165, 229, 105, 231, 146, 243];
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8], discriminator: &[u8; 8], name: &str) -> Result<Self> {
        ensure!(data.len() >= 8, "{name}: account too short");
        ensure!(&data[..8] == discriminator, "{name}: wrong account discriminator");
        Ok(Self { data, pos: 8 })
    }
    fn take<const N: usize>(&mut self) -> Result<[u8; N]> {
        let end = self.pos.checked_add(N).ok_or_else(|| anyhow!("offset overflow"))?;
        let s = self.data.get(self.pos..end).ok_or_else(|| anyhow!("account data truncated at {}", self.pos))?;
        self.pos = end;
        Ok(s.try_into().unwrap())
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take::<1>()?[0])
    }
    fn bool(&mut self) -> Result<bool> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            v => bail!("invalid bool byte {v}"),
        }
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.take()?))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take()?))
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.take()?))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take()?))
    }
    fn i64(&mut self) -> Result<i64> {
        Ok(i64::from_le_bytes(self.take()?))
    }
    fn u128(&mut self) -> Result<u128> {
        Ok(u128::from_le_bytes(self.take()?))
    }
    fn pubkey(&mut self) -> Result<Pubkey> {
        Ok(Pubkey::new_from_array(self.take()?))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BaseFeeParams {
    pub mode: u8,
    pub decay: u8,
    pub cliff_fee_bps: u16,
    pub floor_fee_bps: u16,
    pub number_of_periods: u16,
    pub period_frequency: u64,
    pub reduction_factor: u64,
}

impl BaseFeeParams {
    pub fn to_math(self) -> m::BaseFeeConfig {
        m::BaseFeeConfig {
            mode: self.mode,
            decay: self.decay,
            cliff_fee_bps: self.cliff_fee_bps,
            floor_fee_bps: self.floor_fee_bps,
            number_of_periods: self.number_of_periods,
            period_frequency: self.period_frequency,
            reduction_factor: self.reduction_factor,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DynamicFeeParams {
    pub enabled: bool,
    pub max_dynamic_fee_bps: u16,
    pub variable_fee_control: u32,
    pub filter_period: u32,
    pub decay_period: u32,
    pub reduction_factor: u16,
    pub max_volatility_accumulator: u64,
}

impl DynamicFeeParams {
    pub fn to_math(self) -> m::DynamicFeeConfig {
        m::DynamicFeeConfig {
            enabled: self.enabled,
            max_dynamic_fee_bps: self.max_dynamic_fee_bps,
            variable_fee_control: self.variable_fee_control,
            filter_period: self.filter_period,
            decay_period: self.decay_period,
            reduction_factor: self.reduction_factor,
            max_volatility_accumulator: self.max_volatility_accumulator,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OracleGuardParams {
    pub enabled: bool,
    pub pyth_feed_id_a: [u8; 32],
    pub pyth_feed_id_b: [u8; 32],
    pub max_staleness_secs: u32,
    pub max_deviation_bps: u16,
}

/// Mirror of `swd_amm::SwdmmV2Pool` (only the fields a quote reads are
/// used, but every field is decoded so the offsets stay honest).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwdmmV2Pool {
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    pub token_program_a: Pubkey,
    pub token_program_b: Pubkey,
    pub creator: Pubkey,
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub liquidity: u128,
    pub locked_liquidity: u128,
    pub base_fee: BaseFeeParams,
    pub dynamic_fee: DynamicFeeParams,
    pub volatility_accumulator: u64,
    pub volatility_reference: u64,
    pub price_reference_q64: u128,
    pub last_swap_ts: i64,
    pub collect_fee_mode: u8,
    pub activation_ts: i64,
    pub init_price_q64: u128,
    pub max_price_impact_bps: u16,
    pub oracle: OracleGuardParams,
    pub fee_per_liquidity_a: u128,
    pub fee_per_liquidity_b: u128,
    pub protocol_fee_a: u64,
    pub protocol_fee_b: u64,
    pub total_volume_a: u128,
    pub total_volume_b: u128,
    pub total_lp_fee_a: u128,
    pub total_lp_fee_b: u128,
    pub total_protocol_fee_a: u128,
    pub total_protocol_fee_b: u128,
    pub swap_count: u64,
    pub swap_paused: bool,
    pub deposit_paused: bool,
    pub withdraw_paused: bool,
    pub position_count: u64,
    pub created_at: i64,
    pub bump: u8,
    pub impact_slot: u64,
    pub impact_ref_price_q64: u128,
}

impl SwdmmV2Pool {
    pub fn decode(data: &[u8]) -> Result<Self> {
        let mut r = Reader::new(data, &SWDMM_V2_POOL_DISCRIMINATOR, "SwdmmV2Pool")?;
        let pool = Self {
            mint_a: r.pubkey()?,
            mint_b: r.pubkey()?,
            vault_a: r.pubkey()?,
            vault_b: r.pubkey()?,
            token_program_a: r.pubkey()?,
            token_program_b: r.pubkey()?,
            creator: r.pubkey()?,
            reserve_a: r.u64()?,
            reserve_b: r.u64()?,
            liquidity: r.u128()?,
            locked_liquidity: r.u128()?,
            base_fee: BaseFeeParams {
                mode: r.u8()?,
                decay: r.u8()?,
                cliff_fee_bps: r.u16()?,
                floor_fee_bps: r.u16()?,
                number_of_periods: r.u16()?,
                period_frequency: r.u64()?,
                reduction_factor: r.u64()?,
            },
            dynamic_fee: DynamicFeeParams {
                enabled: r.bool()?,
                max_dynamic_fee_bps: r.u16()?,
                variable_fee_control: r.u32()?,
                filter_period: r.u32()?,
                decay_period: r.u32()?,
                reduction_factor: r.u16()?,
                max_volatility_accumulator: r.u64()?,
            },
            volatility_accumulator: r.u64()?,
            volatility_reference: r.u64()?,
            price_reference_q64: r.u128()?,
            last_swap_ts: r.i64()?,
            collect_fee_mode: r.u8()?,
            activation_ts: r.i64()?,
            init_price_q64: r.u128()?,
            max_price_impact_bps: r.u16()?,
            oracle: OracleGuardParams {
                enabled: r.bool()?,
                pyth_feed_id_a: r.take()?,
                pyth_feed_id_b: r.take()?,
                max_staleness_secs: r.u32()?,
                max_deviation_bps: r.u16()?,
            },
            fee_per_liquidity_a: r.u128()?,
            fee_per_liquidity_b: r.u128()?,
            protocol_fee_a: r.u64()?,
            protocol_fee_b: r.u64()?,
            total_volume_a: r.u128()?,
            total_volume_b: r.u128()?,
            total_lp_fee_a: r.u128()?,
            total_lp_fee_b: r.u128()?,
            total_protocol_fee_a: r.u128()?,
            total_protocol_fee_b: r.u128()?,
            swap_count: r.u64()?,
            swap_paused: r.bool()?,
            deposit_paused: r.bool()?,
            withdraw_paused: r.bool()?,
            position_count: r.u64()?,
            created_at: r.i64()?,
            bump: r.u8()?,
            impact_slot: r.u64()?,
            impact_ref_price_q64: r.u128()?,
        };
        let _reserved: [u8; 40] = r.take()?;
        Ok(pool)
    }

    pub fn vol_state(&self) -> m::VolatilityState {
        m::VolatilityState {
            volatility_accumulator: self.volatility_accumulator,
            volatility_reference: self.volatility_reference,
            price_reference_q64: self.price_reference_q64,
            last_update_ts: self.last_swap_ts,
        }
    }
}

/// Only `protocol_fee_share_bps` matters for a quote (it does not change
/// the trader's output, only the protocol/LP split of the fee), but the
/// program reads it, so the quote does too.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GovernanceSettings {
    pub timelock_delay_secs: i64,
    pub protocol_fee_share_bps: u16,
}

impl GovernanceSettings {
    pub fn decode(data: &[u8]) -> Result<Self> {
        let mut r = Reader::new(data, &GOVERNANCE_SETTINGS_DISCRIMINATOR, "GovernanceSettings")?;
        Ok(Self { timelock_delay_secs: r.i64()?, protocol_fee_share_bps: r.u16()? })
    }
}

/// Pyth `PriceUpdateV2` (receiver program rec5EKMG…), as hand-decoded by
/// `programs/swd_amm/src/oracle.rs`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceUpdate {
    pub verification_full: bool,
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
}

impl PriceUpdate {
    pub fn decode(data: &[u8]) -> Result<Self> {
        let mut r = Reader::new(data, &PRICE_UPDATE_V2_DISCRIMINATOR, "PriceUpdateV2")?;
        let _write_authority = r.pubkey()?;
        let verification_full = match r.u8()? {
            0 => {
                let _num_signatures = r.u8()?;
                false
            }
            1 => true,
            v => bail!("invalid VerificationLevel tag {v}"),
        };
        let feed_id = r.take()?;
        let price = r.i64()?;
        let conf = r.u64()?;
        let exponent = r.i32()?;
        let publish_time = r.i64()?;
        Ok(Self { verification_full, feed_id, price, conf, exponent, publish_time })
    }
}

/// `decimals` of an SPL Token / Token-2022 mint (byte 44 of the base
/// `Mint` layout, identical in both programs).
pub fn mint_decimals(data: &[u8]) -> Result<u8> {
    ensure!(data.len() >= 82, "mint account too short");
    Ok(data[44])
}
