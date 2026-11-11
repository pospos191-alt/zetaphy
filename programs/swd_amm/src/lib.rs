// swd_amm — SAWASDEE COIN (SWD) AMM program for Solana (Anchor 0.31.1).
//
// Pool types:
//   - SWDMM v2 (swdmm_v2.rs + swdmm_math.rs) — the mainnet pool type.
//   - constant-product (cp.rs + cp_math.rs) and DLMM (dlmm.rs +
//     dlmm_math.rs) — legacy pool types, NOT compiled when the crate is
//     built with `--features v2-only` (the reduced mainnet / audit scope,
//     see AUDIT_README.md and audit-package/SCOPE.md).
// Shared by every build: governance.rs (GlobalConfig, authorities, mint
// allowlist, Squads verification), timelock.rs (timelocked actions,
// protocol fee settings, MintPolicy), oracle.rs (hand-written Pyth
// PriceUpdateV2 reader), and this file (entry points, error codes,
// Token-2022 extension gate, security.txt).
//
// Each module's public items are glob re-exported (`pub use m::*;`): Anchor's
// `#[derive(Accounts)]` generates hidden `__client_accounts_*` modules next
// to each Accounts struct, and the `#[program]` macro below expects them at
// the crate root — a selective re-export does not carry them along.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions};
use anchor_spl::token_2022::spl_token_2022::state::Mint as SplToken2022Mint;

#[cfg(not(feature = "v2-only"))]
mod cp;
#[cfg(not(feature = "v2-only"))]
pub use cp::*;
#[cfg(not(feature = "v2-only"))]
pub mod cp_math;
#[cfg(not(feature = "v2-only"))]
mod dlmm;
#[cfg(not(feature = "v2-only"))]
pub use dlmm::*;
#[cfg(not(feature = "v2-only"))]
pub mod dlmm_math;

mod governance;
pub use governance::*;
mod oracle;
pub use oracle::*;
pub mod swdmm_math;
mod swdmm_v2;
pub use swdmm_v2::*;
mod timelock;
pub use timelock::*;

// Anchor 0.31.1 IDL-build quirk: the IDL generator keeps the argument TYPES
// of `#[cfg]`-disabled instructions (it applies the cfg to the instruction
// entry but not to the arg-type list), so a v2-only IDL build still names
// DLMM's `BinLiquidityAmount`. This placeholder exists only in that IDL
// build (never in the program binary) and, using IdlBuild's default
// methods, adds nothing to the IDL.
#[cfg(all(feature = "v2-only", feature = "idl-build"))]
pub struct BinLiquidityAmount;
#[cfg(all(feature = "v2-only", feature = "idl-build"))]
impl anchor_lang::IdlBuild for BinLiquidityAmount {}

// Program id. The mainnet id is generated fresh at deploy time
// (docs/MAINNET_RUNBOOK.md Gate 5, scripts/deploy-mainnet.sh preflight
// refuses to deploy unless this matches the program keypair).
declare_id!("3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL");

// security.txt (2026-11-08): read by Solscan / Solana Explorer from the
// deployed binary ("Security" tab) and by `query-security-txt`. Same
// `no-entrypoint` gate as the entrypoint (see the Cargo.toml comment).
// Change `auditors` only once a published audit report exists, and the
// contact once the project has a monitored security mailbox.
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "SWD AMM",
    project_url: "https://swd-zetaphy.sawasdeecoin.com",
    contacts: "email:security@sawasdeecoin.com,link:https://github.com/pospos191-alt/zetaphy/security",
    policy: "https://github.com/pospos191-alt/zetaphy/blob/main/SECURITY.md",
    preferred_languages: "en,th",
    source_code: "https://github.com/pospos191-alt/zetaphy",
    auditors: "None yet"
}

// Ceiling for the CP / DLMM `fee_bps` and oracle `max_fee_bps` (immutable
// per pool). Also bounds `oracle::validate_oracle_params`, which SWDMM v2
// calls with fee arguments 0 / 0.
pub const MAX_FEE_BPS: u16 = 1_000; // 10%

#[program]
pub mod swd_amm {
    use super::*;

    // -----------------------------------------------------------------
    // Constant-product pool (cp.rs). Not compiled with `v2-only`.
    // -----------------------------------------------------------------

    #[cfg(not(feature = "v2-only"))]
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        fee_bps: u16,
        pyth_feed_id_a: [u8; 32],
        pyth_feed_id_b: [u8; 32],
        oracle_max_staleness_secs: u32,
        oracle_max_deviation_bps: u16,
        max_fee_bps: u16,
    ) -> Result<()> {
        cp::initialize_pool(ctx, fee_bps, pyth_feed_id_a, pyth_feed_id_b, oracle_max_staleness_secs, oracle_max_deviation_bps, max_fee_bps)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a_desired: u64,
        amount_b_desired: u64,
        min_lp_out: u64,
    ) -> Result<()> {
        cp::add_liquidity(ctx, amount_a_desired, amount_b_desired, min_lp_out)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_amount: u64,
        min_a_out: u64,
        min_b_out: u64,
    ) -> Result<()> {
        cp::remove_liquidity(ctx, lp_amount, min_a_out, min_b_out)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        cp::swap(ctx, amount_in, min_amount_out, a_to_b)
    }


    // -----------------------------------------------------------------
    // Governance (Squads-signed allowlist + emergency pause) — see
    // governance.rs for the real logic and full documentation. Thin
    // wrappers only, same reasoning as the DLMM wrappers below.
    // -----------------------------------------------------------------

    pub fn initialize_global_config(
        ctx: Context<InitializeGlobalConfig>,
        governance_authority: Pubkey,
        emergency_authority: Pubkey,
    ) -> Result<()> {
        governance::initialize_global_config(ctx, governance_authority, emergency_authority)
    }

    pub fn set_pool_creation_paused(
        ctx: Context<GovernanceOnly>,
        paused: bool,
    ) -> Result<()> {
        governance::set_pool_creation_paused(ctx, paused)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn set_allowed_mint(ctx: Context<SetAllowedMint>, enabled: bool, trust_freeze_authority: bool) -> Result<()> {
        governance::set_allowed_mint(ctx, enabled, trust_freeze_authority)
    }

    pub fn set_mint_feed(ctx: Context<SetMintFeed>, pyth_feed_id: [u8; 32]) -> Result<()> {
        governance::set_mint_feed(ctx, pyth_feed_id)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn emergency_pause_pool(
        ctx: Context<EmergencyPausePool>,
        pause_swap: bool,
        pause_deposit: bool,
        pause_withdraw: bool,
    ) -> Result<()> {
        governance::emergency_pause_pool(ctx, pause_swap, pause_deposit, pause_withdraw)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn emergency_pause_dlmm_pool(
        ctx: Context<EmergencyPauseDlmmPool>,
        pause_swap: bool,
        pause_deposit: bool,
        pause_withdraw: bool,
    ) -> Result<()> {
        governance::emergency_pause_dlmm_pool(ctx, pause_swap, pause_deposit, pause_withdraw)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn governed_unpause_pool(
        ctx: Context<GovernancePausePool>,
        unpause_swap: bool,
        unpause_deposit: bool,
        unpause_withdraw: bool,
    ) -> Result<()> {
        governance::governed_unpause_pool(ctx, unpause_swap, unpause_deposit, unpause_withdraw)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn governed_unpause_dlmm_pool(
        ctx: Context<GovernancePauseDlmmPool>,
        unpause_swap: bool,
        unpause_deposit: bool,
        unpause_withdraw: bool,
    ) -> Result<()> {
        governance::governed_unpause_dlmm_pool(ctx, unpause_swap, unpause_deposit, unpause_withdraw)
    }

    /// "Phase 2" — see governance.rs's module doc comment ("SQUADS
    /// MULTISIG TRANSPARENCY") for what this does and its known
    /// uncertainty around the Squads vault PDA derivation.
    pub fn verify_governance_multisig(
        ctx: Context<VerifyGovernanceMultisig>,
        vault_index: u8,
    ) -> Result<()> {
        governance::verify_governance_multisig(ctx, vault_index)
    }

    // -----------------------------------------------------------------
    // DLMM (concentrated liquidity, bin-based) — see dlmm.rs for the real
    // logic and full documentation. These are thin wrappers only, per
    // Anchor's standard multi-file pattern (same reasoning as the module
    // doc comment above this mod's `mod dlmm;` declaration).
    // -----------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    #[cfg(not(feature = "v2-only"))]
    pub fn initialize_dlmm_pool(
        ctx: Context<InitializeDlmmPool>,
        bin_step_bps: u16,
        fee_bps: u16,
        active_bin_id: i32,
        pyth_feed_id_a: [u8; 32],
        pyth_feed_id_b: [u8; 32],
        oracle_max_staleness_secs: u32,
        oracle_max_deviation_bps: u16,
        max_fee_bps: u16,
    ) -> Result<()> {
        dlmm::initialize_dlmm_pool(
            ctx,
            bin_step_bps,
            fee_bps,
            active_bin_id,
            pyth_feed_id_a,
            pyth_feed_id_b,
            oracle_max_staleness_secs,
            oracle_max_deviation_bps,
            max_fee_bps,
        )
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn add_dlmm_liquidity(
        ctx: Context<AddDlmmLiquidity>,
        bin_id_lower: i32,
        bin_id_upper: i32,
        amounts: Vec<BinLiquidityAmount>,
    ) -> Result<()> {
        dlmm::add_dlmm_liquidity(ctx, bin_id_lower, bin_id_upper, amounts)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn remove_dlmm_liquidity(
        ctx: Context<RemoveDlmmLiquidity>,
        shares_to_remove: Vec<u128>,
        min_a_out: u64,
        min_b_out: u64,
    ) -> Result<()> {
        dlmm::remove_dlmm_liquidity(ctx, shares_to_remove, min_a_out, min_b_out)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn swap_dlmm(
        ctx: Context<SwapDlmm>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        dlmm::swap_dlmm(ctx, amount_in, min_amount_out, a_to_b)
    }

    // -----------------------------------------------------------------
    // Governance v2 — timelock, protocol fee settings, mint policy
    // (timelock.rs)
    // -----------------------------------------------------------------

    pub fn initialize_governance_settings(
        ctx: Context<InitializeGovernanceSettings>,
        timelock_delay_secs: i64,
        protocol_fee_share_bps: u16,
        treasury: Pubkey,
    ) -> Result<()> {
        timelock::initialize_governance_settings(ctx, timelock_delay_secs, protocol_fee_share_bps, treasury)
    }

    pub fn propose_gov_action(ctx: Context<ProposeAction>, action: GovAction) -> Result<()> {
        timelock::propose_action(ctx, action)
    }

    pub fn cancel_gov_action(ctx: Context<CancelAction>) -> Result<()> {
        timelock::cancel_action(ctx)
    }

    pub fn emergency_cancel_unpause(ctx: Context<EmergencyCancelUnpause>) -> Result<()> {
        timelock::emergency_cancel_unpause(ctx)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn execute_unpause_pool(ctx: Context<ExecuteUnpausePool>) -> Result<()> {
        timelock::execute_unpause_pool(ctx)
    }

    #[cfg(not(feature = "v2-only"))]
    pub fn execute_unpause_dlmm_pool(ctx: Context<ExecuteUnpauseDlmmPool>) -> Result<()> {
        timelock::execute_unpause_dlmm_pool(ctx)
    }

    pub fn execute_v2_pool_action(ctx: Context<ExecuteV2PoolAction>) -> Result<()> {
        timelock::execute_v2_pool_action(ctx)
    }

    pub fn execute_settings_action(ctx: Context<ExecuteSettingsAction>) -> Result<()> {
        timelock::execute_settings_action(ctx)
    }

    pub fn execute_withdraw_protocol_fees(ctx: Context<ExecuteWithdrawProtocolFees>) -> Result<()> {
        timelock::execute_withdraw_protocol_fees(ctx)
    }

    pub fn set_mint_policy(
        ctx: Context<SetMintPolicy>,
        enabled: bool,
        token_2022_reviewed: bool,
        trust_freeze_authority: bool,
    ) -> Result<()> {
        timelock::set_mint_policy(ctx, enabled, token_2022_reviewed, trust_freeze_authority)
    }

    /// Second step of an authority rotation (2026-11-11, KNOWN_ISSUES K-3):
    /// the NEW authority named in a matured `SetGovernanceAuthority` /
    /// `SetEmergencyAuthority` action signs to take over.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        timelock::accept_authority(ctx)
    }

    // -----------------------------------------------------------------
    // SWDMM v2 pools (swdmm_v2.rs)
    // -----------------------------------------------------------------

    pub fn initialize_v2_pool(ctx: Context<InitializeV2Pool>, params: InitializeV2PoolParams) -> Result<()> {
        swdmm_v2::initialize_v2_pool(ctx, params)
    }

    pub fn create_v2_position(ctx: Context<CreateV2Position>, nonce: u64, index: u64) -> Result<()> {
        swdmm_v2::create_v2_position(ctx, nonce, index)
    }

    pub fn add_v2_liquidity(ctx: Context<ModifyV2Liquidity>, max_a: u64, max_b: u64, min_liquidity: u128) -> Result<()> {
        swdmm_v2::add_v2_liquidity(ctx, max_a, max_b, min_liquidity)
    }

    pub fn remove_v2_liquidity(ctx: Context<ModifyV2Liquidity>, liquidity: u128, min_a: u64, min_b: u64) -> Result<()> {
        swdmm_v2::remove_v2_liquidity(ctx, liquidity, min_a, min_b)
    }

    pub fn claim_v2_fees(ctx: Context<ModifyV2Liquidity>) -> Result<()> {
        swdmm_v2::claim_v2_fees(ctx)
    }

    pub fn lock_v2_liquidity(ctx: Context<LockV2Liquidity>, liquidity: u128) -> Result<()> {
        swdmm_v2::lock_v2_liquidity(ctx, liquidity)
    }

    pub fn transfer_v2_position(ctx: Context<OwnV2Position>, new_owner: Pubkey) -> Result<()> {
        swdmm_v2::transfer_v2_position(ctx, new_owner)
    }

    pub fn close_v2_position(ctx: Context<CloseV2Position>) -> Result<()> {
        swdmm_v2::close_v2_position(ctx)
    }

    pub fn swap_v2(ctx: Context<SwapV2>, amount_in: u64, min_amount_out: u64, a_to_b: bool) -> Result<()> {
        swdmm_v2::swap_v2(ctx, amount_in, min_amount_out, a_to_b)
    }

    pub fn emergency_pause_v2_pool(ctx: Context<EmergencyPauseV2Pool>, pause_swap: bool, pause_deposit: bool, pause_withdraw: bool) -> Result<()> {
        swdmm_v2::emergency_pause_v2_pool(ctx, pause_swap, pause_deposit, pause_withdraw)
    }

    /// `emergency_pause_v2_pool` for many pools at once: the pools are the
    /// remaining accounts (writable).
    pub fn emergency_pause_v2_pools<'info>(
        ctx: Context<'_, '_, 'info, 'info, EmergencyPauseV2Pools<'info>>,
        pause_swap: bool,
        pause_deposit: bool,
        pause_withdraw: bool,
    ) -> Result<()> {
        swdmm_v2::emergency_pause_v2_pools(ctx, pause_swap, pause_deposit, pause_withdraw)
    }
}


// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

// Default offset (6000). Kept whole in every build so error numbers never
// shift; in a `v2-only` build only `UnsupportedMintExtension` (the
// Token-2022 gate below), `FreezeAuthorityNotTrusted` and `VaultFrozen`
// (the freeze checks below) can be returned. Other enums: DlmmError 6100,
// GovernanceError 6200, OracleError 6300, SwdmmV2Error 8000,
// TimelockError 8500 (the Anchor 0.31 IDL lists only one enum; the full
// table is in audit-package/ERROR_CODES.md).
#[error_code]
pub enum SwdAmmError {
    #[msg("Fee exceeds the maximum allowed")]
    FeeTooHigh,
    #[msg("Mint A and Mint B must be different")]
    IdenticalMints,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Initial liquidity too small")]
    InsufficientInitialLiquidity,
    #[msg("A pool's first deposit must supply at least MIN_INITIAL_DEPOSIT of each token")]
    InitialDepositTooSmall,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("No liquidity would be minted")]
    ZeroLiquidityMinted,
    #[msg("Pool has no liquidity")]
    EmptyPool,
    #[msg("Token account owner mismatch")]
    InvalidTokenAccountOwner,
    #[msg("Token mint does not match pool")]
    MintMismatch,
    #[msg("Internal invariant violated — do not ignore this, it means the math above has a bug")]
    InvariantViolation,
    #[msg("Pool creation is paused by governance")]
    PoolCreationPaused,
    #[msg("This mint is not on the governance allowlist")]
    MintNotAllowlisted,
    #[msg("Swaps are paused on this pool")]
    SwapPaused,
    #[msg("Deposits are paused on this pool")]
    DepositPaused,
    #[msg("Withdrawals are paused on this pool")]
    WithdrawPaused,
    #[msg("This Token-2022 mint carries an extension this program does not yet support (transfer hook, confidential transfer, non-transferable, permanent delegate, mint close authority, or an extension this program does not know)")]
    UnsupportedMintExtension,
    #[msg("Price impact exceeds the 50% cap for a single swap")]
    PriceImpactTooHigh,
    #[msg("Pyth feed ids must match the feeds governance registered for these mints (set_mint_feed)")]
    OracleFeedNotRegistered,
    #[msg("This mint has a freeze authority: governance must explicitly trust it (trust_freeze_authority) to allow the mint")]
    FreezeAuthorityNotTrusted,
    #[msg("A new pool vault is frozen (e.g. Token-2022 DefaultAccountState = Frozen): the pool would be unusable")]
    VaultFrozen,
}

// ---------------------------------------------------------------------
// Token-2022 extension gate
// ---------------------------------------------------------------------

/// Rejects a Token-2022 mint carrying an extension this program's reserve
/// accounting is not safe against yet. A no-op (always `Ok`) for a mint
/// owned by the classic SPL Token program, since that program has no
/// extension mechanism at all — the check only ever fires for a
/// Token-2022-owned mint.
///
/// ALLOWED-BUT-SPECIAL-CASED extension:
/// - `TransferFeeConfig` — a transfer of `amount` does NOT land `amount`
///   in the destination; some is withheld (on the destination account, for
///   later harvest by the mint's withdraw-withheld-authority) as a fee.
///   THIS is no longer blocked as of "Phase 1b" (2026-09-23): `add_liquidity`
///   and `swap` measure each vault's real balance immediately before and
///   after every inbound transfer and credit `Pool.reserve_a`/`reserve_b`
///   with that measured delta, never the nominal transferred amount — see
///   the module doc comment's "TRANSFER-FEE-AWARE RESERVE ACCOUNTING"
///   paragraph and `read_token_balance` below for the mechanics. This is
///   the one extension in this list that changes accounting arithmetic
///   rather than the safety of running this program's CPI/trust model at
///   all — every extension below this one is still blocked because it
///   changes something this program cannot compensate for by measuring a
///   balance delta.
///
/// BLOCKED extensions and why, one at a time:
/// - `TransferHook` — invokes arbitrary, mint-defined third-party program
///   logic on every transfer into/out of a vault, including on the CPI
///   transfers this program itself issues from a PDA-signed context. This
///   program has no way to audit what that hook program does; blocking it
///   is the same "don't execute code we can't reason about" principle
///   that keeps this whole program's CPI surface to well-understood SPL
///   Token instructions only.
/// - `ConfidentialTransferMint` — transferred amounts are encrypted
///   on-chain; this program's pricing/reserve math needs to read amounts
///   in the clear, which confidential transfers make structurally
///   impossible to combine with a public constant-product pool.
/// - `NonTransferable` — a swap/deposit/withdrawal literally cannot
///   transfer such a mint at all; better to reject cleanly at pool
///   creation than let every later instruction fail confusingly.
/// - `PermanentDelegate` — grants a fixed third-party authority the
///   ability to transfer/burn ANY holder's tokens for this mint, forever,
///   bypassing the holder's own signature. A pool vault holding such a
///   mint is one delegate-signed instruction away from being drained
///   outside this program's own logic entirely — a fund-safety property
///   no version of this program's own code can restore once the mint
///   itself grants that power away.
/// - `MintCloseAuthority` (added 2026-11-10, security review): lets the
///   close authority close the mint once its supply is 0 and re-create an
///   account AT THE SAME ADDRESS with different extensions (the issuer
///   holds the mint keypair). Every check here runs only when a pool or
///   policy is created, so a mint that passed it could come back with a
///   PermanentDelegate or TransferHook under a pool (or allowlist entry)
///   that is still waiting for its first deposit. Without this extension a
///   Token-2022 mint can never be closed, so its extension set is fixed.
///
/// Extension types this crate's spl-token-2022 version does not know
/// (e.g. Pausable, ScaledUiAmount) make `get_extension_types` fail, which
/// is mapped to `UnsupportedMintExtension` below: unknown means refused.
///
/// Every OTHER Token-2022 extension (e.g. `MetadataPointer`,
/// `TokenMetadata`, `InterestBearingConfig` — which changes what a UI
/// shows, not what a transfer actually moves) is allowed through.
fn assert_mint_extensions_safe(mint_ai: &AccountInfo) -> Result<()> {
    if mint_ai.owner != &anchor_spl::token_2022::ID {
        return Ok(());
    }

    const BLOCKED: [ExtensionType; 5] = [
        ExtensionType::TransferHook,
        ExtensionType::ConfidentialTransferMint,
        ExtensionType::NonTransferable,
        ExtensionType::PermanentDelegate,
        ExtensionType::MintCloseAuthority,
    ];

    let data = mint_ai.try_borrow_data()?;
    let mint_with_extensions = StateWithExtensions::<SplToken2022Mint>::unpack(&data)
        .map_err(|_| error!(SwdAmmError::UnsupportedMintExtension))?;
    let present = mint_with_extensions
        .get_extension_types()
        .map_err(|_| error!(SwdAmmError::UnsupportedMintExtension))?;

    for ext in present {
        require!(!BLOCKED.contains(&ext), SwdAmmError::UnsupportedMintExtension);
    }
    Ok(())
}


// ---------------------------------------------------------------------
// Freeze authority (2026-11-11, KNOWN_ISSUES K-1)
// ---------------------------------------------------------------------

/// A mint's freeze authority can freeze a pool vault, which blocks every
/// withdrawal, claim and swap of that pool. Governance must therefore
/// enable such a mint EXPLICITLY (`trust_freeze_authority`, e.g. USDC /
/// USDT, whose issuers have one); a mint without one passes.
///
/// Checked when governance enables the mint (`set_mint_policy`,
/// `set_allowed_mint`), not again at pool creation, because the answer
/// cannot change afterwards: the token programs never ADD a freeze
/// authority to a mint that has none (`SetAuthority(FreezeAccount)` fails
/// with `MintCannotFreeze`), classic SPL mints cannot be closed, and a
/// Token-2022 mint can only be closed (and re-created at the same address)
/// with the `MintCloseAuthority` extension, which the extension gate
/// refuses at the same moment.
pub(crate) fn assert_freeze_authority_trusted(
    freeze_authority: &anchor_lang::solana_program::program_option::COption<Pubkey>,
    trusted: bool,
) -> Result<()> {
    require!(freeze_authority.is_none() || trusted, SwdAmmError::FreezeAuthorityNotTrusted);
    Ok(())
}

/// A vault created already frozen (Token-2022 `DefaultAccountState =
/// Frozen`, which the token program only allows on a mint with a freeze
/// authority, i.e. a trusted one) would make the new pool unusable; refuse
/// the pool instead. Called right after the vaults are initialised.
pub(crate) fn assert_vault_not_frozen(vault: &anchor_spl::token_interface::TokenAccount) -> Result<()> {
    require!(!vault.is_frozen(), SwdAmmError::VaultFrozen);
    Ok(())
}

// ---------------------------------------------------------------------
// Unit tests (native `cargo test`, no validator). The CP math tests live in
// cp.rs.
// ---------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------
    // Security review 2026-11-10: attack tests for the Token-2022
    // extension gate and the governance helpers.
    // -----------------------------------------------------------------

    use anchor_spl::token_2022::spl_token_2022::extension::{
        metadata_pointer::MetadataPointer, mint_close_authority::MintCloseAuthority,
        permanent_delegate::PermanentDelegate, transfer_fee::TransferFeeConfig,
        BaseStateWithExtensionsMut, StateWithExtensionsMut,
    };
    use anchor_lang::solana_program::program_option::COption;
    use anchor_lang::solana_program::program_pack::Pack;

    /// Raw Token-2022 mint account data carrying `exts` (each initialised
    /// with its zero/default value — only the presence matters to the gate).
    fn token_2022_mint_data(exts: &[ExtensionType]) -> Vec<u8> {
        let len = if exts.is_empty() {
            SplToken2022Mint::LEN
        } else {
            ExtensionType::try_calculate_account_len::<SplToken2022Mint>(exts).unwrap()
        };
        let mut data = vec![0u8; len];
        {
            let mut st = StateWithExtensionsMut::<SplToken2022Mint>::unpack_uninitialized(&mut data).unwrap();
            for e in exts {
                match e {
                    ExtensionType::MintCloseAuthority => { st.init_extension::<MintCloseAuthority>(true).unwrap(); }
                    ExtensionType::PermanentDelegate => { st.init_extension::<PermanentDelegate>(true).unwrap(); }
                    ExtensionType::MetadataPointer => { st.init_extension::<MetadataPointer>(true).unwrap(); }
                    ExtensionType::TransferFeeConfig => { st.init_extension::<TransferFeeConfig>(true).unwrap(); }
                    other => panic!("test helper does not build {:?}", other),
                }
            }
            st.base = SplToken2022Mint {
                mint_authority: COption::Some(Pubkey::new_unique()),
                supply: 0,
                decimals: 6,
                is_initialized: true,
                freeze_authority: COption::None,
            };
            st.pack_base();
            if !exts.is_empty() {
                st.init_account_type().unwrap();
            }
        }
        data
    }

    fn gate(owner: &Pubkey, mut data: Vec<u8>) -> Result<()> {
        let key = Pubkey::new_unique();
        let mut lamports = 1_000_000u64;
        let ai = AccountInfo::new(&key, false, false, &mut lamports, &mut data, owner, false, 0);
        assert_mint_extensions_safe(&ai)
    }

    #[test]
    fn extension_gate_allows_plain_and_harmless_mints() {
        let t22 = anchor_spl::token_2022::ID;
        assert!(gate(&t22, token_2022_mint_data(&[])).is_ok());
        assert!(gate(&t22, token_2022_mint_data(&[ExtensionType::MetadataPointer])).is_ok());
        // CP pools measure balances, so a transfer fee is allowed here
        // (SWDMM v2 refuses it separately: assert_no_transfer_fee).
        assert!(gate(&t22, token_2022_mint_data(&[ExtensionType::TransferFeeConfig])).is_ok());
        // classic SPL mints are never inspected
        assert!(gate(&anchor_spl::token::ID, vec![0u8; 82]).is_ok());
    }

    #[test]
    fn extension_gate_refuses_permanent_delegate() {
        assert!(gate(&anchor_spl::token_2022::ID, token_2022_mint_data(&[ExtensionType::PermanentDelegate])).is_err());
    }

    /// ATTACK (2026-11-10): a mint with a close authority passes the gate
    /// once, then — while supply is 0, e.g. before a pool's first deposit —
    /// the issuer closes it and re-creates the same address with a
    /// PermanentDelegate (or TransferHook). The gate only ever ran at
    /// policy/pool creation, so the pool would then accept the new mint.
    /// Fixed by refusing MintCloseAuthority outright.
    #[test]
    fn attack_extension_gate_refuses_mint_close_authority() {
        let t22 = anchor_spl::token_2022::ID;
        assert!(gate(&t22, token_2022_mint_data(&[ExtensionType::MintCloseAuthority])).is_err());
        assert!(gate(&t22, token_2022_mint_data(&[ExtensionType::MetadataPointer, ExtensionType::MintCloseAuthority])).is_err());
    }

    /// An extension type this crate's spl-token-2022 does not know (newer
    /// Token-2022 releases added Pausable, ScaledUiAmount, ...) must be
    /// refused, not skipped.
    #[test]
    fn extension_gate_fails_closed_on_unknown_extension_type() {
        let mut data = token_2022_mint_data(&[ExtensionType::MetadataPointer]);
        // TLV starts after the 165-byte base (82 + padding) + 1 account-type byte.
        let tlv = 166;
        let unknown: u16 = 26; // Pausable in later Token-2022 versions
        data[tlv..tlv + 2].copy_from_slice(&unknown.to_le_bytes());
        assert!(gate(&anchor_spl::token_2022::ID, data).is_err());
    }

    #[test]
    fn attack_stale_timelock_action_expires() {
        let after = 1_000_000i64;
        assert!(timelock::check_execution_window(after - 1, after).is_err(), "not matured");
        assert!(timelock::check_execution_window(after, after).is_ok());
        assert!(timelock::check_execution_window(after + timelock::EXECUTION_GRACE_SECS, after).is_ok());
        // Before the fix a matured, never-executed unpause stayed executable
        // forever — e.g. right after a later emergency pause.
        assert!(timelock::check_execution_window(after + timelock::EXECUTION_GRACE_SECS + 1, after).is_err());
        assert!(timelock::check_execution_window(i64::MAX, i64::MAX - 1).is_err(), "no overflow panic");
    }

    /// Internal review 2026-11-11: a matured action queued by a governance
    /// key that has since been replaced (e.g. the deployer's SetTreasury)
    /// must not be executable — execution is permissionless.
    #[test]
    fn attack_action_of_a_replaced_governance_is_stale() {
        let old_gov = Pubkey::new_unique();
        let mut c = governance::GlobalConfig {
            governance_authority: old_gov,
            emergency_authority: Pubkey::new_unique(),
            pool_creation_paused: false,
            bump: 255,
        };
        assert!(timelock::check_proposer_is_governance(&old_gov, &c).is_ok());
        c.governance_authority = Pubkey::new_unique(); // the vault accepted
        assert!(timelock::check_proposer_is_governance(&old_gov, &c).is_err());
        assert!(timelock::check_proposer_is_governance(&c.governance_authority, &c).is_ok());
    }

    #[test]
    fn pool_creation_pause_lets_only_governance_create() {
        let gov = Pubkey::new_unique();
        let mut c = governance::GlobalConfig {
            governance_authority: gov,
            emergency_authority: Pubkey::new_unique(),
            pool_creation_paused: false,
            bump: 255,
        };
        let squatter = Pubkey::new_unique();
        assert!(governance::creation_allowed(&c, &squatter));
        c.pool_creation_paused = true;
        assert!(!governance::creation_allowed(&c, &squatter));
        assert!(governance::creation_allowed(&c, &gov));
    }

    // -----------------------------------------------------------------
    // Pre-audit hardening 2026-11-11 (KNOWN_ISSUES K-1, K-3, K-5).
    // -----------------------------------------------------------------

    fn config(gov: Pubkey, emergency: Pubkey, paused: bool) -> governance::GlobalConfig {
        governance::GlobalConfig { governance_authority: gov, emergency_authority: emergency, pool_creation_paused: paused, bump: 255 }
    }

    /// ATTACK (K-1): a mint whose issuer can freeze the pool vault, enabled
    /// without governance saying it trusts that issuer.
    #[test]
    fn attack_freeze_authority_needs_explicit_trust() {
        let none = COption::None;
        let some = COption::Some(Pubkey::new_unique());
        assert!(assert_freeze_authority_trusted(&none, false).is_ok());
        assert!(assert_freeze_authority_trusted(&none, true).is_ok());
        assert_eq!(
            assert_freeze_authority_trusted(&some, false).unwrap_err(),
            error!(SwdAmmError::FreezeAuthorityNotTrusted)
        );
        assert!(assert_freeze_authority_trusted(&some, true).is_ok(), "USDC / USDT: trusted issuer");
    }

    /// ATTACK (K-1): a vault initialised frozen (Token-2022
    /// DefaultAccountState = Frozen) must refuse the pool.
    #[test]
    fn attack_frozen_vault_refuses_pool() {
        use anchor_lang::AccountDeserialize;
        use anchor_spl::token_2022::spl_token_2022::state::{Account as SplAccount, AccountState};
        let vault = |state: AccountState| {
            let mut data = vec![0u8; SplAccount::LEN];
            SplAccount { mint: Pubkey::new_unique(), owner: Pubkey::new_unique(), state, ..Default::default() }
                .pack_into_slice(&mut data);
            anchor_spl::token_interface::TokenAccount::try_deserialize(&mut &data[..]).unwrap()
        };
        assert!(assert_vault_not_frozen(&vault(AccountState::Initialized)).is_ok());
        assert_eq!(assert_vault_not_frozen(&vault(AccountState::Frozen)).unwrap_err(), error!(SwdAmmError::VaultFrozen));
    }

    /// ATTACK (K-5): on a mainnet build a squatter cannot create a v2 pool
    /// (and so cannot fix a launch pair's fee schedule for good), paused or
    /// not; devnet builds keep permissionless creation.
    #[test]
    fn attack_v2_pool_squatting_mainnet_is_governance_only() {
        let gov = Pubkey::new_unique();
        let squatter = Pubkey::new_unique();
        for paused in [false, true] {
            let c = config(gov, Pubkey::new_unique(), paused);
            assert_eq!(
                swdmm_v2::check_v2_creator(&c, &squatter, true).unwrap_err(),
                error!(SwdmmV2Error::GovernanceOnlyPoolCreation)
            );
            assert!(swdmm_v2::check_v2_creator(&c, &gov, true).is_ok());
            assert!(swdmm_v2::check_v2_creator(&c, &gov, false).is_ok());
            assert_eq!(swdmm_v2::check_v2_creator(&c, &squatter, false).is_ok(), !paused);
        }
        assert_eq!(swdmm_v2::V2_CREATION_GOVERNANCE_ONLY, cfg!(feature = "mainnet"));
    }

    /// ATTACK (K-3, F-4): rotations to the zero key or to the other role's
    /// key are refused at propose (and again at accept).
    #[test]
    fn attack_authority_rotation_bad_keys() {
        let (gov, em) = (Pubkey::new_unique(), Pubkey::new_unique());
        let c = config(gov, em, false);
        let g = |k| GovAction::SetGovernanceAuthority { new_authority: k };
        let e = |k| GovAction::SetEmergencyAuthority { new_authority: k };
        let check = |a: GovAction| timelock::check_authority_change(&c, &a);
        assert_eq!(check(g(Pubkey::default())).unwrap_err(), error!(GovernanceError::InvalidAuthority));
        assert_eq!(check(e(Pubkey::default())).unwrap_err(), error!(GovernanceError::InvalidAuthority));
        assert_eq!(check(g(em)).unwrap_err(), error!(GovernanceError::EmergencyCannotEqualGovernance));
        assert_eq!(check(e(gov)).unwrap_err(), error!(GovernanceError::EmergencyCannotEqualGovernance));
        assert!(check(g(Pubkey::new_unique())).is_ok());
        assert!(check(e(Pubkey::new_unique())).is_ok());
        assert!(check(GovAction::SetTreasury { treasury: Pubkey::default() }).is_ok(), "other actions: not this check");
    }

    /// Governance rotation waits for the timelock; emergency rotation does not.
    #[test]
    fn authority_rotation_delays() {
        let k = Pubkey::new_unique();
        assert_eq!(timelock::action_delay(&GovAction::SetGovernanceAuthority { new_authority: k }, 86_400), 86_400);
        assert_eq!(timelock::action_delay(&GovAction::SetEmergencyAuthority { new_authority: k }, 86_400), 0);
        assert_eq!(timelock::action_delay(&GovAction::SetTreasury { treasury: k }, 86_400), 86_400);
    }

    /// The two GovAction variants were appended: earlier variants keep their
    /// Borsh index and PendingAction keeps its 95-byte size (devnet
    /// PendingAction accounts stay readable).
    #[test]
    fn gov_action_layout_is_backward_compatible() {
        let k = Pubkey::new_unique();
        let tag = |a: GovAction| a.try_to_vec().unwrap()[0];
        assert_eq!(tag(GovAction::WithdrawV2ProtocolFees { pool: k }), 7);
        assert_eq!(tag(GovAction::SetGovernanceAuthority { new_authority: k }), 8);
        assert_eq!(tag(GovAction::SetEmergencyAuthority { new_authority: k }), 9);
        assert_eq!(PendingAction::INIT_SPACE, 95);
        assert_eq!(GovAction::INIT_SPACE, 36);
    }
}
