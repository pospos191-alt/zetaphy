// SWD Quantum — quantum-safe vaults for SWD (SAWASDEE COIN) on Solana, and a
// post-quantum key commitment registry. ZETAPHY's quantum-safety design
// (docs/future/quantum-safe-settlement.md) brought to Solana.
//
// ============================================================================
// STATUS (2026-11-09): UNAUDITED DRAFT. NOT DEPLOYED ANYWHERE.
// Devnet first, then an INDEPENDENT AUDIT, then mainnet. The program must be
// made immutable (no upgrade authority) before it can protect anything
// against a quantum attacker: an upgrade key is an Ed25519 key.
// See docs/SWD_QUANTUM.md (design, threat model, costs, deploy steps).
// ============================================================================
//
// Every Solana wallet address IS an Ed25519 public key, so once a large
// quantum computer exists, every wallet's private key can be computed from
// its address. This program offers two things:
//
// 1. QUANTUM VAULT. A program-derived account whose funds (SOL and SPL /
//    Token-2022 tokens, e.g. SWD) move ONLY with a hash-based one-time
//    signature (LM-OTS, the standardised Winternitz scheme: RFC 8554 +
//    NIST SP 800-208, parameter set LMOTS_SHA256_N24_W8 — see wots.rs).
//    No Ed25519 key can move vault funds: the fee payer of a spend can be
//    anyone, it only pays the fee.
//      - The vault address is derived from (I, K0): a random-looking
//        16-byte identifier and the HASH of the first one-time public key.
//        Neither gives a quantum attacker anything to work on.
//      - Each spend is signed with the current one-time key (index `seq`)
//        over a message (message.rs) that binds the program, the vault,
//        its opening slot, `seq`, the mint, the token program, the source
//        and destination accounts, the amount and the NEXT one-time public
//        key K'. The program checks the signature, moves exactly that
//        amount, and replaces K by K' (seq + 1) in the same instruction.
//        A one-time key therefore signs exactly once, and an old signature
//        never verifies again (replay-proof).
//      - Design note vs. the "split and close" vault of Dean Little's
//        solana-winternitz-vault (MIT; studied, no code copied): there, a
//        spend moves the remainder to a NEW vault and closes the old one.
//        Here the key rotates IN PLACE: the vault keeps one stable address
//        (deposits made after a spend are not stranded), holds any number
//        of mints without a sweep of every token account per spend, and
//        never pays rent twice. The vault is never closed: closing would let
//        anyone re-open the same address with the already-used first key.
//        The LM-OTS checksum is included (a Winternitz scheme without it lets
//        whoever sees one signature forge others by walking chains forward).
//
// 2. PQ KEY COMMITMENT REGISTRY (QuantumRescue-style). A wallet records,
//    signed with its Ed25519 key TODAY, a hash
//      c = keccak256("SWD QuantumCommit v1" || wallet || keccak256(ML-DSA-44 pk) || secret)
//    in a PDA. A change only takes effect after a delay (7 days on mainnet),
//    and every change is an event. After a future Q-day, SWD / ZETAPHY can
//    honour a reveal (the ML-DSA-44 public key + secret, plus an ML-DSA
//    signature) for migration claims, using the commitment that was in
//    force at the announced cut-off. This program does NOT verify ML-DSA
//    and moves no funds for it (see docs/SWD_QUANTUM.md, "What the registry
//    does and does not protect").

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::extension::{
    transfer_hook::TransferHook, BaseStateWithExtensions, ExtensionType, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as SplToken2022Mint;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

pub mod message;
pub mod wots;

#[cfg(test)]
mod tests;

use message::{SpendMessage, ACTION_SPEND_SOL, ACTION_SPEND_TOKEN, FLAG_CLOSE_SOURCE, KNOWN_FLAGS};
#[allow(unused_imports)] // P: used by the IDL build (the `Chains` alias)
use wots::{Chains, ID_LEN, N, P};

// TODO(before build): run `solana-keygen new -o target/deploy/swd_quantum-keypair.json`
// after your first `anchor build`, then `anchor keys list` and paste the
// real program id here AND in Anchor.toml's [programs.*] swd_quantum entries.
declare_id!("HGtZWKNPwqNY19RNJBrzs8qQwwmnAexxAWZFxAwFuF9h");

pub const VAULT_SEED: &[u8] = b"swdq-vault";
pub const COMMIT_SEED: &[u8] = b"swdq-commit";

/// How long a new PQ commitment (or a revoke) waits before it is in force.
#[cfg(feature = "mainnet")]
pub const COMMIT_DELAY_SECS: i64 = 7 * 24 * 60 * 60;
#[cfg(not(feature = "mainnet"))]
pub const COMMIT_DELAY_SECS: i64 = 8;

#[program]
pub mod swd_quantum {
    use super::*;

    /// Creates the vault of one-time-key chain (id, K0). Anyone may pay the
    /// rent (it stays in the vault for good); the content is fixed by the
    /// seeds, so whoever opens it, it is the same vault.
    pub fn open_vault(ctx: Context<OpenVault>, id: [u8; ID_LEN], key: [u8; N]) -> Result<()> {
        require!(key != [0u8; N], QuantumError::BadKey);
        let v = &mut ctx.accounts.vault;
        v.version = 1;
        v.bump = ctx.bumps.vault;
        v.id = id;
        v.genesis_key = key;
        v.key = key;
        v.seq = 0;
        v.opened_slot = Clock::get()?.slot;
        v.spends = 0;
        emit!(VaultOpened { vault: v.key(), id, key, opened_slot: v.opened_slot });
        Ok(())
    }

    /// Adds SOL. (A plain system transfer to the vault address works too.)
    pub fn deposit_sol(ctx: Context<DepositSol>, amount: u64) -> Result<()> {
        require!(amount > 0, QuantumError::ZeroAmount);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        emit!(Deposited {
            vault: ctx.accounts.vault.key(),
            mint: Pubkey::default(),
            from: ctx.accounts.depositor.key(),
            amount,
        });
        Ok(())
    }

    /// Adds SPL / Token-2022 tokens to the vault's associated token account
    /// (created on the first deposit; the depositor pays its rent). Refuses
    /// mints the vault could not hold safely (`mint_policy`) and any
    /// transfer that does not arrive in full.
    pub fn deposit_token(ctx: Context<DepositToken>, amount: u64) -> Result<()> {
        require!(amount > 0, QuantumError::ZeroAmount);
        mint_policy(&ctx.accounts.mint.to_account_info(), Use::Deposit)?;
        let before = ctx.accounts.vault_token.amount;
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.from.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault_token.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.vault_token.reload()?;
        require!(
            ctx.accounts.vault_token.amount == before.checked_add(amount).ok_or(QuantumError::Overflow)?,
            QuantumError::PartialTransfer
        );
        emit!(Deposited {
            vault: ctx.accounts.vault.key(),
            mint: ctx.accounts.mint.key(),
            from: ctx.accounts.depositor.key(),
            amount,
        });
        Ok(())
    }

    /// Sends `amount` lamports to `destination`, authorised by the vault's
    /// current one-time key, and rotates to `next_key`. The vault keeps its
    /// rent-exempt minimum (it is never closed).
    pub fn spend_sol(ctx: Context<SpendSol>, c: [u8; N], y: Chains, amount: u64, next_key: [u8; N]) -> Result<()> {
        require!(amount > 0, QuantumError::ZeroAmount);
        let vault_ai = ctx.accounts.vault.to_account_info();
        let dest = ctx.accounts.destination.to_account_info();
        require_keys_neq!(dest.key(), vault_ai.key(), QuantumError::BadDestination);
        let msg = SpendMessage {
            action: ACTION_SPEND_SOL,
            program_id: crate::ID,
            vault: vault_ai.key(),
            opened_slot: ctx.accounts.vault.opened_slot,
            seq: ctx.accounts.vault.seq,
            next_key,
            mint: Pubkey::default(),
            token_program: Pubkey::default(),
            source: vault_ai.key(),
            destination: dest.key(),
            amount,
            flags: 0,
        };
        check_and_rotate(&mut ctx.accounts.vault, &c, &y, &msg)?;

        let keep = Rent::get()?.minimum_balance(vault_ai.data_len());
        let available = vault_ai.lamports().saturating_sub(keep);
        require!(amount <= available, QuantumError::InsufficientFunds);
        vault_ai.sub_lamports(amount)?;
        dest.add_lamports(amount)?;

        emit_spent(&ctx.accounts.vault, &msg);
        Ok(())
    }

    /// Sends `amount` tokens from the vault's token account `source` to the
    /// token account `destination`, authorised by the vault's current
    /// one-time key, and rotates to `next_key`. With FLAG_CLOSE_SOURCE the
    /// emptied source account is closed and its rent goes INTO the vault.
    pub fn spend_token(
        ctx: Context<SpendToken>,
        c: [u8; N],
        y: Chains,
        amount: u64,
        flags: u8,
        next_key: [u8; N],
    ) -> Result<()> {
        require!(flags & !KNOWN_FLAGS == 0, QuantumError::BadFlags);
        let close_source = flags & FLAG_CLOSE_SOURCE != 0;
        require!(amount > 0 || close_source, QuantumError::ZeroAmount);
        let msg = SpendMessage {
            action: ACTION_SPEND_TOKEN,
            program_id: crate::ID,
            vault: ctx.accounts.vault.key(),
            opened_slot: ctx.accounts.vault.opened_slot,
            seq: ctx.accounts.vault.seq,
            next_key,
            mint: ctx.accounts.mint.key(),
            token_program: ctx.accounts.token_program.key(),
            source: ctx.accounts.source.key(),
            destination: ctx.accounts.destination.key(),
            amount,
            flags,
        };
        check_and_rotate(&mut ctx.accounts.vault, &c, &y, &msg)?;
        mint_policy(&ctx.accounts.mint.to_account_info(), Use::Spend)?;

        let v = &ctx.accounts.vault;
        let seeds: &[&[u8]] = &[VAULT_SEED, &v.id, &v.genesis_key, &[v.bump]];
        let signer = &[seeds];

        if amount > 0 {
            let src_before = ctx.accounts.source.amount;
            let dst_before = ctx.accounts.destination.amount;
            require!(amount <= src_before, QuantumError::InsufficientFunds);
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.source.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.destination.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    signer,
                ),
                amount,
                ctx.accounts.mint.decimals,
            )?;
            ctx.accounts.source.reload()?;
            ctx.accounts.destination.reload()?;
            // Exactly `amount` left the vault and exactly `amount` arrived
            // (a transfer-fee mint, or anything else that changes amounts,
            // fails here instead of silently delivering less).
            require!(ctx.accounts.source.amount == src_before - amount, QuantumError::PartialTransfer);
            require!(
                ctx.accounts.destination.amount == dst_before.checked_add(amount).ok_or(QuantumError::Overflow)?,
                QuantumError::PartialTransfer
            );
        }

        if close_source {
            require!(ctx.accounts.source.amount == 0, QuantumError::SourceNotEmpty);
            close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.source.to_account_info(),
                    destination: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ))?;
        }

        emit_spent(&ctx.accounts.vault, &msg);
        Ok(())
    }

    // ------------------------------------------------------------------
    // PQ key commitment registry
    // ------------------------------------------------------------------

    /// Records a new commitment for the signing wallet (or `[0; 32]` to
    /// revoke). It is in force COMMIT_DELAY_SECS later; until then the
    /// previous one stays in force. A newer commit replaces a pending one
    /// and restarts the clock.
    pub fn commit_pq_key(ctx: Context<CommitPqKey>, commitment: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let r = &mut ctx.accounts.record;
        if r.wallet == Pubkey::default() {
            r.wallet = ctx.accounts.wallet.key();
            r.bump = ctx.bumps.record;
        }
        promote_if_mature(r, now);
        require!(!(r.has_pending && r.pending == commitment), QuantumError::NoChange);
        require!(r.has_pending || r.active != commitment, QuantumError::NoChange);
        r.pending = commitment;
        r.pending_since = now;
        r.has_pending = true;
        r.changes = r.changes.saturating_add(1);
        emit!(PqCommitted {
            wallet: r.wallet,
            commitment,
            committed_at: now,
            in_force_from: now + COMMIT_DELAY_SECS,
        });
        Ok(())
    }

    /// Moves a matured pending commitment to `active`. Anyone may call it;
    /// readers apply the same rule themselves (`PqCommitment::in_force_at`).
    pub fn promote_pq_key(ctx: Context<PromotePqKey>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let r = &mut ctx.accounts.record;
        require!(r.has_pending, QuantumError::NothingPending);
        require!(now >= r.pending_since + COMMIT_DELAY_SECS, QuantumError::TooSoon);
        promote_if_mature(r, now);
        Ok(())
    }

    /// The wallet withdraws a commitment that is not in force yet.
    pub fn cancel_pq_pending(ctx: Context<CancelPqPending>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let r = &mut ctx.accounts.record;
        promote_if_mature(r, now);
        require!(r.has_pending, QuantumError::NothingPending);
        let cancelled = r.pending;
        r.pending = [0u8; 32];
        r.pending_since = 0;
        r.has_pending = false;
        emit!(PqPendingCancelled { wallet: r.wallet, commitment: cancelled });
        Ok(())
    }
}

// ----------------------------------------------------------------------
// Vault helpers
// ----------------------------------------------------------------------

/// The one place a vault signature is checked. Fails unless (c, y) is the
/// current one-time key's signature on `msg`; then rotates the key.
fn check_and_rotate(vault: &mut Account<Vault>, c: &[u8; N], y: &Chains, msg: &SpendMessage) -> Result<()> {
    // One slot after opening at the earliest: with `opened_slot` in every
    // message, a signature made for this vault can never match a vault
    // opened at the same address later (there is no close, but this keeps
    // the property even if one is ever added).
    require!(Clock::get()?.slot > vault.opened_slot, QuantumError::TooSoon);
    require!(msg.next_key != [0u8; N], QuantumError::BadKey);
    require!(msg.next_key != vault.key && msg.next_key != vault.genesis_key, QuantumError::KeyReuse);
    let candidate = wots::candidate_key(&vault.id, vault.seq, c, y, &msg.encode());
    require!(candidate == vault.key, QuantumError::BadSignature);
    vault.key = msg.next_key;
    vault.seq = vault.seq.checked_add(1).ok_or(QuantumError::Overflow)?;
    vault.spends = vault.spends.saturating_add(1);
    Ok(())
}

fn emit_spent(vault: &Account<Vault>, msg: &SpendMessage) {
    emit!(Spent {
        vault: msg.vault,
        seq: msg.seq,
        mint: msg.mint,
        destination: msg.destination,
        amount: msg.amount,
        next_key: vault.key,
    });
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum Use {
    Deposit,
    Spend,
}

/// Which mints a vault accepts.
///
/// Classic SPL Token (SWD is one): accepted. Its freeze authority, if the
/// mint has one, is an Ed25519 key that could FREEZE (not take) vault
/// tokens — see docs/SWD_QUANTUM.md.
///
/// Token-2022, deposits: only mints whose extensions are ALL on this
/// allowlist (unknown or new extensions are refused, fail-closed). Refused,
/// among others: TransferFeeConfig (partial transfers), TransferHook
/// (arbitrary code on every transfer), PermanentDelegate (an Ed25519 key
/// could take the tokens out of the vault: not quantum-safe), NonTransferable,
/// confidential transfers.
///
/// Token-2022, spends: never block getting funds OUT, except a mint with an
/// active transfer hook (this program does not forward hook accounts); fee
/// or other amount changes are caught by the exact-delta check in spend_token.
fn mint_policy(mint_ai: &AccountInfo, usage: Use) -> Result<()> {
    if mint_ai.owner == &anchor_spl::token::ID {
        return Ok(());
    }
    require_keys_eq!(*mint_ai.owner, anchor_spl::token_2022::ID, QuantumError::WrongTokenProgram);
    const ALLOWED: [ExtensionType; 9] = [
        ExtensionType::MintCloseAuthority,
        ExtensionType::DefaultAccountState,
        ExtensionType::InterestBearingConfig,
        ExtensionType::MetadataPointer,
        ExtensionType::TokenMetadata,
        ExtensionType::GroupPointer,
        ExtensionType::TokenGroup,
        ExtensionType::GroupMemberPointer,
        ExtensionType::TokenGroupMember,
    ];
    let data = mint_ai.try_borrow_data()?;
    let mint = StateWithExtensions::<SplToken2022Mint>::unpack(&data)
        .map_err(|_| error!(QuantumError::UnsupportedMint))?;
    match usage {
        Use::Deposit => {
            let present = mint.get_extension_types().map_err(|_| error!(QuantumError::UnsupportedMint))?;
            for ext in present {
                require!(ALLOWED.contains(&ext), QuantumError::UnsupportedMint);
            }
        }
        Use::Spend => {
            if let Ok(hook) = mint.get_extension::<TransferHook>() {
                require!(Option::<Pubkey>::from(hook.program_id).is_none(), QuantumError::UnsupportedMint);
            }
        }
    }
    Ok(())
}

/// keccak256("SWD QuantumCommit v1" || wallet || ML-DSA-44 public-key hash || secret).
/// The program never computes it on chain (it only stores what the wallet
/// sends); this is the reference for Rust clients and for the reveal check.
pub fn pq_commitment(wallet: &Pubkey, mldsa_key_hash: &[u8; 32], secret: &[u8; 32]) -> [u8; 32] {
    anchor_lang::solana_program::keccak::hashv(&[b"SWD QuantumCommit v1", wallet.as_ref(), mldsa_key_hash, secret]).to_bytes()
}

fn promote_if_mature(r: &mut PqCommitment, now: i64) {
    if r.has_pending && now >= r.pending_since + COMMIT_DELAY_SECS {
        r.active = r.pending;
        r.active_since = r.pending_since + COMMIT_DELAY_SECS;
        r.pending = [0u8; 32];
        r.pending_since = 0;
        r.has_pending = false;
        emit!(PqPromoted { wallet: r.wallet, commitment: r.active, in_force_from: r.active_since });
    }
}

// ----------------------------------------------------------------------
// Accounts
// ----------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(id: [u8; ID_LEN], key: [u8; N])]
pub struct OpenVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, id.as_ref(), key.as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, vault.id.as_ref(), vault.genesis_key.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositToken<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(seeds = [VAULT_SEED, vault.id.as_ref(), vault.genesis_key.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = depositor,
        token::token_program = token_program,
    )]
    pub from: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SpendSol<'info> {
    #[account(mut, seeds = [VAULT_SEED, vault.id.as_ref(), vault.genesis_key.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: any account; it is bound by the one-time signature.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SpendToken<'info> {
    #[account(mut, seeds = [VAULT_SEED, vault.id.as_ref(), vault.genesis_key.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// A token account of the vault (bound by the signature).
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub source: InterfaceAccount<'info, TokenAccount>,
    /// Bound by the signature.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
        constraint = destination.key() != source.key() @ QuantumError::BadDestination,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CommitPqKey<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(
        init_if_needed,
        payer = wallet,
        space = 8 + PqCommitment::INIT_SPACE,
        seeds = [COMMIT_SEED, wallet.key().as_ref()],
        bump,
    )]
    pub record: Account<'info, PqCommitment>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PromotePqKey<'info> {
    #[account(mut, seeds = [COMMIT_SEED, record.wallet.as_ref()], bump = record.bump)]
    pub record: Account<'info, PqCommitment>,
}

#[derive(Accounts)]
pub struct CancelPqPending<'info> {
    pub wallet: Signer<'info>,
    #[account(
        mut,
        seeds = [COMMIT_SEED, wallet.key().as_ref()],
        bump = record.bump,
        has_one = wallet,
    )]
    pub record: Account<'info, PqCommitment>,
}

// ----------------------------------------------------------------------
// State
// ----------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub version: u8,
    pub bump: u8,
    /// LM-OTS key identifier I (from the owner's seed; public).
    pub id: [u8; ID_LEN],
    /// K0, the first one-time public key (part of the address).
    pub genesis_key: [u8; N],
    /// The one-time public key that must sign the next spend.
    pub key: [u8; N],
    /// Its index q (0 for K0, +1 per spend).
    pub seq: u32,
    pub opened_slot: u64,
    pub spends: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PqCommitment {
    pub wallet: Pubkey,
    pub bump: u8,
    /// The commitment in force before `pending` matures ([0; 32] = none).
    pub active: [u8; 32],
    /// When `active` came into force (unix seconds; 0 = never).
    pub active_since: i64,
    pub pending: [u8; 32],
    /// When `pending` was committed; in force from pending_since + delay.
    pub pending_since: i64,
    pub has_pending: bool,
    /// Number of commits ever made (each one is a PqCommitted event).
    pub changes: u32,
}

impl PqCommitment {
    /// The commitment in force at unix time `t` (None = no commitment).
    /// This is the rule a post-Q-day reveal is checked against, with `t` =
    /// the announced cut-off. (Only valid for t >= the record's last
    /// change; for older t, replay the PqCommitted/PqPendingCancelled events.)
    pub fn in_force_at(&self, t: i64) -> Option<[u8; 32]> {
        let c = if self.has_pending && t >= self.pending_since + COMMIT_DELAY_SECS {
            self.pending
        } else if self.active_since != 0 && t >= self.active_since {
            self.active
        } else {
            [0u8; 32]
        };
        if c == [0u8; 32] {
            None
        } else {
            Some(c)
        }
    }
}

// ----------------------------------------------------------------------
// Events and errors
// ----------------------------------------------------------------------

#[event]
pub struct VaultOpened {
    pub vault: Pubkey,
    pub id: [u8; ID_LEN],
    pub key: [u8; N],
    pub opened_slot: u64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    /// Pubkey::default() for SOL.
    pub mint: Pubkey,
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Spent {
    pub vault: Pubkey,
    /// The key index that signed.
    pub seq: u32,
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub next_key: [u8; N],
}

#[event]
pub struct PqCommitted {
    pub wallet: Pubkey,
    pub commitment: [u8; 32],
    pub committed_at: i64,
    pub in_force_from: i64,
}

#[event]
pub struct PqPromoted {
    pub wallet: Pubkey,
    pub commitment: [u8; 32],
    pub in_force_from: i64,
}

#[event]
pub struct PqPendingCancelled {
    pub wallet: Pubkey,
    pub commitment: [u8; 32],
}

#[error_code]
pub enum QuantumError {
    #[msg("one-time signature does not match the vault's current key")]
    BadSignature,
    #[msg("the next key must be new (not the current or the first key)")]
    KeyReuse,
    #[msg("key must not be all zero")]
    BadKey,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("not enough funds in the vault (SOL keeps its rent-exempt minimum)")]
    InsufficientFunds,
    #[msg("destination must not be the vault / source itself")]
    BadDestination,
    #[msg("unknown flags")]
    BadFlags,
    #[msg("the transfer did not move exactly the requested amount")]
    PartialTransfer,
    #[msg("the source token account still holds tokens")]
    SourceNotEmpty,
    #[msg("this mint (or one of its Token-2022 extensions) is not accepted by the vault")]
    UnsupportedMint,
    #[msg("mint is not owned by the SPL Token or Token-2022 program")]
    WrongTokenProgram,
    #[msg("too soon")]
    TooSoon,
    #[msg("nothing pending")]
    NothingPending,
    #[msg("that commitment is already recorded")]
    NoChange,
    #[msg("arithmetic overflow")]
    Overflow,
}
