//! The real thing: run the BUILT program (`target/deploy/swd_amm.so`,
//! from `anchor build` at the repo root) in LiteSVM, execute `swap_v2`
//! with the account metas this crate produces, and check the chain's
//! result equals the quote — output amount, post-trade reserves, and
//! "would fail" vs "would succeed".
//!
//! Skipped (with a message) when the .so is missing. Point
//! `SWD_AMM_SO=/path/to/swd_amm.so` at another build to test that one.

mod common;
use common::*;

use jupiter_amm_interface::{Amm, FeeMode, QuoteParams, SwapMode, SwapParams};
use jupiter_amm_swd::{gov_settings_address, swap_v2_ix_data, SWD_AMM_PROGRAM_ID};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::{pubkey, Pubkey};
use solana_signer::Signer;
use solana_transaction::Transaction;

const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

fn so_path() -> std::path::PathBuf {
    std::env::var("SWD_AMM_SO")
        .map(Into::into)
        .unwrap_or_else(|_| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/swd_amm.so"))
}

fn mint_data(decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[36..44].copy_from_slice(&u64::MAX.to_le_bytes()); // supply (large, never checked here)
    d[44] = decimals;
    d[45] = 1; // is_initialized
    d
}

fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // AccountState::Initialized
    d
}

fn rent_acct(svm: &LiteSVM, data: Vec<u8>, owner: Pubkey) -> Account {
    Account { lamports: svm.minimum_balance_for_rent_exemption(data.len()), data, owner, executable: false, rent_epoch: 0 }
}

fn balance(svm: &LiteSVM, k: &Pubkey) -> u64 {
    let a = svm.get_account(k).unwrap();
    u64::from_le_bytes(a.data[64..72].try_into().unwrap())
}

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
}

#[test]
fn quote_equals_onchain_swap_v2() {
    let so = so_path();
    if !so.exists() {
        eprintln!("SKIPPED: {} not found (run `anchor build` at the repo root first)", so.display());
        return;
    }
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(SWD_AMM_PROGRAM_ID, &so).unwrap();
    svm.set_sysvar(&Clock { slot: SLOT, epoch_start_timestamp: 0, epoch: 900, leader_schedule_epoch: 901, unix_timestamp: NOW });

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10_000_000_000).unwrap();
    let mint_a = Pubkey::new_unique();
    let mint_b = Pubkey::new_unique();
    svm.set_account(mint_a, rent_acct(&svm, mint_data(6), TOKEN)).unwrap();
    svm.set_account(mint_b, rent_acct(&svm, mint_data(9), TOKEN_2022)).unwrap();

    let (settings_key, settings_bump) = Pubkey::find_program_address(&[b"gov_settings"], &SWD_AMM_PROGRAM_ID);
    assert_eq!(settings_key, gov_settings_address(&SWD_AMM_PROGRAM_ID));

    let trader_a = Pubkey::new_unique();
    let trader_b = Pubkey::new_unique();
    let vault_a = Pubkey::new_unique();
    let vault_b = Pubkey::new_unique();

    let mut rng = Rng(0x0c4a_17_5eed);
    let (mut agreed_ok, mut agreed_err) = (0, 0);
    for i in 0..400u64 {
        let shift_a = rng.range(0, 40);
        let shift_b = rng.range(0, 40);
        let ra = rng.range(1_000, u64::MAX >> (8 + shift_a));
        let rb = rng.range(1_000, u64::MAX >> (8 + shift_b));
        let floor = [25u16, 30, 100, 200, 400, 600][(i % 6) as usize];
        let mode = (i % 3) as u8;
        let share = rng.range(0, 2_000) as u16;

        let mut p = program_pool(ra, rb, floor, mode);
        p.mint_a = anchor_lang::prelude::Pubkey::new_from_array(mint_a.to_bytes());
        p.mint_b = anchor_lang::prelude::Pubkey::new_from_array(mint_b.to_bytes());
        p.vault_a = anchor_lang::prelude::Pubkey::new_from_array(vault_a.to_bytes());
        p.vault_b = anchor_lang::prelude::Pubkey::new_from_array(vault_b.to_bytes());
        p.max_price_impact_bps = rng.range(100, 5_000) as u16;
        if i % 4 == 1 {
            p.base_fee = swd_amm::BaseFeeParams {
                mode: 1,
                decay: (i % 2) as u8,
                cliff_fee_bps: 5_000,
                floor_fee_bps: floor,
                number_of_periods: 100,
                period_frequency: 30,
                reduction_factor: if i % 2 == 1 { 500 } else { 49 },
            };
            p.activation_ts = NOW - rng.range(0, 4_000) as i64;
        }
        if i % 5 == 2 {
            p.dynamic_fee = dynamic_on();
            p.price_reference_q64 = ((rb as u128) << 64) / ra as u128 * rng.range(9_000, 11_000) as u128 / 10_000;
            p.volatility_accumulator = rng.range(0, 10_000);
            p.volatility_reference = rng.range(0, 5_000);
            p.last_swap_ts = NOW - rng.range(0, 200) as i64;
        }
        if i % 7 == 3 {
            // earlier swap in this same slot moved the price
            p.impact_slot = SLOT;
            p.impact_ref_price_q64 = ((rb as u128) << 64) / ra as u128 * rng.range(8_000, 12_000) as u128 / 10_000;
        }
        let (pool_key, pool_bump) = Pubkey::find_program_address(
            &[b"swdmm_v2_pool", mint_a.as_ref(), mint_b.as_ref(), &floor.to_le_bytes()],
            &SWD_AMM_PROGRAM_ID,
        );
        p.bump = pool_bump;

        let pool_bytes = ser(&p);
        svm.set_account(pool_key, rent_acct(&svm, pool_bytes.clone(), SWD_AMM_PROGRAM_ID)).unwrap();
        let mut settings = swd_amm::GovernanceSettings {
            timelock_delay_secs: 86_400,
            protocol_fee_share_bps: share,
            treasury: apk(9),
            next_action_id: 0,
            bump: settings_bump,
        };
        settings.bump = settings_bump;
        svm.set_account(settings_key, rent_acct(&svm, ser(&settings), SWD_AMM_PROGRAM_ID)).unwrap();
        svm.set_account(vault_a, rent_acct(&svm, token_account_data(&mint_a, &pool_key, ra), TOKEN)).unwrap();
        svm.set_account(vault_b, rent_acct(&svm, token_account_data(&mint_b, &pool_key, rb), TOKEN_2022)).unwrap();
        svm.set_account(trader_a, rent_acct(&svm, token_account_data(&mint_a, &trader.pubkey(), u64::MAX / 2), TOKEN)).unwrap();
        svm.set_account(trader_b, rent_acct(&svm, token_account_data(&mint_b, &trader.pubkey(), u64::MAX / 2), TOKEN_2022)).unwrap();

        // Jupiter side: quote + account metas from this crate.
        let a_to_b = rng.next() & 1 == 0;
        let r_in = if a_to_b { ra } else { rb };
        let sh = rng.range(0, 20);
        let amount = rng.range(1, (r_in >> sh).max(1));
        let mut map = jupiter_amm_interface::AccountMap::default();
        let ka = jupiter_amm_interface::KeyedAccount { key: pool_key, account: svm.get_account(&pool_key).unwrap(), params: None };
        let mut amm = jupiter_amm_swd::SwdAmm::from_keyed_account(&ka, &ctx(NOW, SLOT)).unwrap();
        for k in amm.get_accounts_to_update() {
            map.insert(k, svm.get_account(&k).unwrap());
        }
        amm.update(&map).unwrap();
        let (in_mint, out_mint, src, dst) = if a_to_b { (mint_a, mint_b, trader_a, trader_b) } else { (mint_b, mint_a, trader_b, trader_a) };
        let quote = amm.quote(&QuoteParams { amount, input_mint: in_mint, output_mint: out_mint, swap_mode: SwapMode::ExactIn, fee_mode: FeeMode::Normal });

        let jup = Pubkey::new_unique();
        let metas = amm
            .get_swap_and_account_metas(&SwapParams {
                swap_mode: SwapMode::ExactIn,
                in_amount: amount,
                out_amount: 0,
                source_mint: in_mint,
                destination_mint: out_mint,
                source_token_account: src,
                destination_token_account: dst,
                token_transfer_authority: trader.pubkey(),
                user: trader.pubkey(),
                payer: trader.pubkey(),
                quote_mint_to_referrer: None,
                jupiter_program_id: &jup,
                missing_dynamic_accounts_as_default: false,
            })
            .unwrap()
            .account_metas;
        let ix = Instruction { program_id: SWD_AMM_PROGRAM_ID, accounts: metas, data: swap_v2_ix_data(amount, 0, a_to_b) };
        let before_out = balance(&svm, &dst);
        svm.expire_blockhash();
        let tx = Transaction::new(&[&trader], Message::new(&[ix], Some(&trader.pubkey())), svm.latest_blockhash());
        let res = svm.send_transaction(tx);

        match (&quote, &res) {
            (Ok(q), Ok(_)) => {
                let got = balance(&svm, &dst) - before_out;
                assert_eq!(q.out_amount, got, "case {i}: quote {} vs chain {got}", q.out_amount);
                let after = jupiter_amm_swd::state::SwdmmV2Pool::decode(&svm.get_account(&pool_key).unwrap().data).unwrap();
                let expect = jupiter_amm_swd::quote::quote_exact_in(
                    amm.pool(),
                    &jupiter_amm_swd::quote::QuoteEnv { now: NOW, slot: SLOT, protocol_fee_share_bps: share as u64 },
                    None,
                    amount,
                    a_to_b,
                )
                .unwrap();
                assert_eq!((after.reserve_a, after.reserve_b), (expect.new_reserve_a, expect.new_reserve_b), "case {i}: reserves");
                agreed_ok += 1;
            }
            (Err(_), Err(_)) => agreed_err += 1,
            (Ok(q), Err(e)) => panic!("case {i}: quote said {} out but chain failed: {:?}\n{:#?}", q.out_amount, e.err, e.meta.logs),
            (Err(e), Ok(_)) => panic!("case {i}: quote failed ({e}) but chain swapped {}", balance(&svm, &dst) - before_out),
        }
    }
    eprintln!("on-chain parity: {agreed_ok} swaps matched exactly, {agreed_err} rejected by both");
    assert!(agreed_ok > 200 && agreed_err > 5, "ok={agreed_ok} err={agreed_err}");
}
