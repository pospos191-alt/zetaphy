//! Stateful, DIFFERENTIAL sequence fuzzing of the built program
//! (target/deploy/swd_amm.so) in LiteSVM (2026-11-10).
//!
//! For each seed: deploy the real .so (upgradeable, payer = upgrade
//! authority), run the real governance bootstrap (global config,
//! governance settings with the timelock, mint policies), create a SWDMM v2
//! pool with a random fee configuration, then apply a random sequence of
//! operations by 3 actors: create position, add / remove / lock liquidity,
//! claim fees, swap, swap round trip, donation to the vault, emergency
//! pause, and timelocked governance (unpause, SetV2PoolParams,
//! SetProtocolFeeShare, WithdrawV2ProtocolFees), with time and slots
//! passing.
//!
//! After every transaction we check, from ON-CHAIN state:
//!   * solvency: vault balance >= reserve + protocol fee + every position's
//!     unclaimed fees, per token;
//!   * token conservation across all actors, vaults and the treasury;
//!   * no value creation: a swap round trip never returns more than was
//!     paid; k never decreases on a swap;
//! and DIFFERENTIALLY: the pure-Rust model the libFuzzer targets use
//! (programs/swd_amm/fuzz/src/v2_model.rs) is run side by side, and its
//! success/failure and every pool/position field must match the chain.
//! That ties the millions of fast model executions back to the real
//! program.
//!
//!   cargo +nightly test --release --manifest-path programs/swd_amm/litesvm/Cargo.toml -- --nocapture
//!   SWD_SVM_SEEDS=100 SWD_SVM_STEPS=200 cargo +nightly test --release ...

use std::collections::HashMap;
use std::path::PathBuf;

use litesvm::LiteSVM;
use serde_json::Value;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

use swd_amm_fuzz::swdmm_math as m;
use swd_amm_fuzz::v2_model::{Pos, V2};
use swd_amm_fuzz::Gen;

const TOKEN: Pubkey = solana_pubkey::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM: Pubkey = solana_pubkey::pubkey!("11111111111111111111111111111111");
const LOADER_V3: Pubkey = solana_pubkey::pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");
const COMPUTE_BUDGET: Pubkey = solana_pubkey::pubkey!("ComputeBudget111111111111111111111111111111");
const TIMELOCK: i64 = 5;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

// ---------------------------------------------------------------------
// IDL helpers: instruction encoding and fixed-layout account decoding
// ---------------------------------------------------------------------

struct Idl(Value);

impl Idl {
    fn load() -> Self {
        let p = repo().join("target/idl/swd_amm.json");
        Idl(serde_json::from_str(&std::fs::read_to_string(&p).expect("run `anchor build -p swd_amm` first")).unwrap())
    }
    fn ix(&self, name: &str) -> &Value {
        self.0["instructions"].as_array().unwrap().iter().find(|i| i["name"] == name).unwrap_or_else(|| panic!("no ix {name}"))
    }
    fn ty(&self, name: &str) -> &Value {
        self.0["types"].as_array().unwrap().iter().find(|t| t["name"] == name).unwrap_or_else(|| panic!("no type {name}"))
    }
    fn size_of(&self, t: &Value) -> usize {
        match t {
            Value::String(s) => match s.as_str() {
                "u8" | "i8" | "bool" => 1,
                "u16" | "i16" => 2,
                "u32" | "i32" => 4,
                "u64" | "i64" => 8,
                "u128" | "i128" => 16,
                "pubkey" => 32,
                o => panic!("unsized {o}"),
            },
            Value::Object(o) if o.contains_key("array") => {
                let a = &o["array"];
                self.size_of(&a[0]) * a[1].as_u64().unwrap() as usize
            }
            Value::Object(o) if o.contains_key("defined") => {
                let n = o["defined"]["name"].as_str().unwrap();
                let t = self.ty(n);
                assert_eq!(t["type"]["kind"], "struct", "{n} not a struct");
                t["type"]["fields"].as_array().unwrap().iter().map(|f| self.size_of(&f["type"])).sum()
            }
            o => panic!("unsupported type {o}"),
        }
    }
    /// Byte offset (after the 8-byte discriminator) of `field` in struct `ty`.
    fn offset(&self, ty: &str, field: &str) -> usize {
        let mut off = 8;
        for f in self.ty(ty)["type"]["fields"].as_array().unwrap() {
            if f["name"] == field {
                return off;
            }
            off += self.size_of(&f["type"]);
        }
        panic!("no field {ty}.{field}")
    }
}

fn disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("global:{name}").as_bytes());
    h[..8].try_into().unwrap()
}

fn rd<const N: usize>(d: &[u8], off: usize) -> [u8; N] {
    d[off..off + N].try_into().unwrap()
}

// ---------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------

struct Env {
    svm: LiteSVM,
    idl: Idl,
    pid: Pubkey,
    payer: Keypair,
    emergency: Keypair,
    actors: Vec<Keypair>, // actors[0] is the payer (pool creator)
    mint_a: Pubkey,
    mint_b: Pubkey,
    ta: Vec<Pubkey>,
    tb: Vec<Pubkey>,
    treasury_a: Pubkey,
    treasury_b: Pubkey,
    config: Pubkey,
    settings: Pubkey,
    pool: Pubkey,
    vault_a: Pubkey,
    vault_b: Pubkey,
    positions: Vec<Pubkey>,
    minted_a: u128,
    minted_b: u128,
    last_err: String,
}

fn pda(seeds: &[&[u8]], pid: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, pid).0
}

impl Env {
    fn send(&mut self, ixs: Vec<Instruction>, extra: &[&Keypair]) -> Result<(), String> {
        let mut all = vec![Instruction::new_with_bytes(COMPUTE_BUDGET, &{
            let mut d = vec![2u8];
            d.extend_from_slice(&1_400_000u32.to_le_bytes());
            d
        }, vec![])];
        all.extend(ixs);
        let mut signers: Vec<&Keypair> = vec![&self.payer];
        for k in extra {
            if k.pubkey() != self.payer.pubkey() {
                signers.push(k);
            }
        }
        let tx = Transaction::new_signed_with_payer(&all, Some(&self.payer.pubkey()), &signers, self.svm.latest_blockhash());
        let r = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        r.map(|_| ()).map_err(|e| {
            let logs: Vec<_> = e.meta.logs.iter().filter(|l| l.contains("Error") || l.contains("failed")).cloned().collect();
            self.last_err = format!("{:?} {:?}", e.err, logs);
            self.last_err.clone()
        })
    }

    fn ix(&self, name: &str, accts: &[(&str, Pubkey)], args: &[u8]) -> Instruction {
        let map: HashMap<&str, Pubkey> = accts.iter().cloned().collect();
        let mut metas = vec![];
        for a in self.idl.ix(name)["accounts"].as_array().unwrap() {
            let n = a["name"].as_str().unwrap();
            let key = match map.get(n) {
                Some(k) => *k,
                None if a.get("address").is_some() => a["address"].as_str().unwrap().parse().unwrap(),
                None if a.get("optional") == Some(&Value::Bool(true)) => self.pid, // Anchor's "None"
                None => panic!("{name}: account {n} not given"),
            };
            let w = a.get("writable") == Some(&Value::Bool(true));
            let s = a.get("signer") == Some(&Value::Bool(true));
            metas.push(if w { AccountMeta::new(key, s) } else { AccountMeta::new_readonly(key, s) });
        }
        let mut data = disc(name).to_vec();
        data.extend_from_slice(args);
        Instruction::new_with_bytes(self.pid, &data, metas)
    }

    fn token_balance(&self, acc: &Pubkey) -> u64 {
        let a = self.svm.get_account(acc).unwrap();
        u64::from_le_bytes(rd(&a.data, 64))
    }

    fn create_mint(&mut self) -> Pubkey {
        let kp = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(82);
        let create = solana_system_interface::instruction::create_account(&self.payer.pubkey(), &kp.pubkey(), rent, 82, &TOKEN);
        let mut d = vec![20u8, 6];
        d.extend_from_slice(self.payer.pubkey().as_ref());
        d.push(0);
        let init = Instruction::new_with_bytes(TOKEN, &d, vec![AccountMeta::new(kp.pubkey(), false)]);
        self.send(vec![create, init], &[&kp]).unwrap();
        kp.pubkey()
    }

    fn token_account(&mut self, mint: Pubkey, owner: Pubkey, amount: u64) -> Pubkey {
        let kp = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(165);
        let create = solana_system_interface::instruction::create_account(&self.payer.pubkey(), &kp.pubkey(), rent, 165, &TOKEN);
        let mut d = vec![18u8];
        d.extend_from_slice(owner.as_ref());
        let init = Instruction::new_with_bytes(TOKEN, &d, vec![AccountMeta::new(kp.pubkey(), false), AccountMeta::new_readonly(mint, false)]);
        let mut ixs = vec![create, init];
        if amount > 0 {
            let mut d = vec![7u8];
            d.extend_from_slice(&amount.to_le_bytes());
            ixs.push(Instruction::new_with_bytes(
                TOKEN,
                &d,
                vec![AccountMeta::new(mint, false), AccountMeta::new(kp.pubkey(), false), AccountMeta::new_readonly(self.payer.pubkey(), true)],
            ));
        }
        self.send(ixs, &[&kp]).unwrap();
        kp.pubkey()
    }

    /// Several SPL transfers by one owner, in ONE transaction (all or nothing).
    fn transfers(&mut self, owner: usize, moves: &[(Pubkey, Pubkey, u64)]) -> Result<(), String> {
        let ixs = moves
            .iter()
            .map(|(from, to, amount)| {
                let mut d = vec![3u8];
                d.extend_from_slice(&amount.to_le_bytes());
                Instruction::new_with_bytes(
                    TOKEN,
                    &d,
                    vec![AccountMeta::new(*from, false), AccountMeta::new(*to, false), AccountMeta::new_readonly(self.actors[owner].pubkey(), true)],
                )
            })
            .collect();
        let kp = self.actors[owner].insecure_clone();
        self.send(ixs, &[&kp])
    }

    fn clock(&self) -> Clock {
        self.svm.get_sysvar::<Clock>()
    }
    fn warp(&mut self, secs: i64, slots: u64) {
        let mut c = self.clock();
        c.unix_timestamp += secs;
        c.slot += slots;
        self.svm.set_sysvar(&c);
    }

    fn acc(&self, k: &Pubkey) -> Account {
        self.svm.get_account(k).unwrap()
    }
    fn f_u64(&self, d: &[u8], ty: &str, f: &str) -> u64 {
        u64::from_le_bytes(rd(d, self.idl.offset(ty, f)))
    }
    fn f_i64(&self, d: &[u8], ty: &str, f: &str) -> i64 {
        i64::from_le_bytes(rd(d, self.idl.offset(ty, f)))
    }
    fn f_u128(&self, d: &[u8], ty: &str, f: &str) -> u128 {
        u128::from_le_bytes(rd(d, self.idl.offset(ty, f)))
    }
    fn f_bool(&self, d: &[u8], ty: &str, f: &str) -> bool {
        d[self.idl.offset(ty, f)] != 0
    }

    fn modify_accts(&self, actor: usize, pos: Pubkey) -> Vec<(&'static str, Pubkey)> {
        vec![
            ("owner", self.actors[actor].pubkey()),
            ("pool", self.pool),
            ("position", pos),
            ("mint_a", self.mint_a),
            ("mint_b", self.mint_b),
            ("vault_a", self.vault_a),
            ("vault_b", self.vault_b),
            ("owner_token_a", self.ta[actor]),
            ("owner_token_b", self.tb[actor]),
            ("token_program_a", TOKEN),
            ("token_program_b", TOKEN),
        ]
    }

    fn create_position(&mut self, actor: usize) -> Result<Pubkey, String> {
        let pd = self.acc(&self.pool).data;
        let nonce = self.f_u64(&pd, "SwdmmV2Pool", "position_count");
        let owner = self.actors[actor].pubkey();
        let h = Sha256::digest([&b"swdmm_v2_position_index"[..], owner.as_ref(), &nonce.to_le_bytes()].concat());
        let index = u64::from_le_bytes(h[..8].try_into().unwrap());
        let position = pda(&[b"swdmm_v2_position", self.pool.as_ref(), &index.to_le_bytes()], &self.pid);
        let mut args = nonce.to_le_bytes().to_vec();
        args.extend_from_slice(&index.to_le_bytes());
        let ix = self.ix("create_v2_position", &[("owner", owner), ("pool", self.pool), ("position", position), ("system_program", SYSTEM)], &args);
        let kp = self.actors[actor].insecure_clone();
        self.send(vec![ix], &[&kp])?;
        self.positions.push(position);
        Ok(position)
    }

    /// propose -> wait the timelock -> execute. Returns the execute result.
    fn governed(&mut self, action: Vec<u8>, exec: &str, exec_accts: Vec<(&str, Pubkey)>) -> Result<(), String> {
        let sd = self.acc(&self.settings).data;
        let id = self.f_u64(&sd, "GovernanceSettings", "next_action_id");
        let pending = pda(&[b"gov_action", &id.to_le_bytes()], &self.pid);
        let p = self.payer.pubkey();
        let ix = self.ix(
            "propose_gov_action",
            &[("config", self.config), ("governance_authority", p), ("settings", self.settings), ("pending", pending), ("payer", p), ("system_program", SYSTEM)],
            &action,
        );
        self.send(vec![ix], &[])?;
        self.warp(TIMELOCK + 1, 3);
        let mut a = exec_accts;
        a.push(("pending", pending));
        let ix = self.ix(exec, &a, &[]);
        self.send(vec![ix], &[])
    }
}

fn setup(g: &mut Gen) -> Option<(Env, V2)> {
    let lib = std::fs::read_to_string(repo().join("programs/swd_amm/src/lib.rs")).unwrap();
    let id = lib.split("declare_id!(\"").nth(1).unwrap().split('"').next().unwrap();
    let pid: Pubkey = id.parse().unwrap();
    let so = std::fs::read(repo().join("target/deploy/swd_amm.so")).expect("run `anchor build -p swd_amm` first");
    let mut svm = LiteSVM::new();
    svm.add_program(pid, &so).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000_000).unwrap();
    // upgrade authority = payer (initialize_global_config requires it)
    let pdata = Pubkey::find_program_address(&[pid.as_ref()], &LOADER_V3).0;
    let mut acc = svm.get_account(&pdata).unwrap();
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(payer.pubkey().as_ref());
    svm.set_account(pdata, acc).unwrap();
    let mut c = svm.get_sysvar::<Clock>();
    c.unix_timestamp = 1_800_000_000;
    c.slot = 1_000;
    svm.set_sysvar(&c);

    let emergency = Keypair::new();
    let config = pda(&[b"global-config"], &pid);
    let settings = pda(&[b"gov_settings"], &pid);
    let mut env = Env {
        svm,
        idl: Idl::load(),
        pid,
        actors: vec![payer.insecure_clone(), Keypair::new(), Keypair::new()],
        payer,
        emergency,
        mint_a: Pubkey::default(),
        mint_b: Pubkey::default(),
        ta: vec![],
        tb: vec![],
        treasury_a: Pubkey::default(),
        treasury_b: Pubkey::default(),
        config,
        settings,
        pool: Pubkey::default(),
        vault_a: Pubkey::default(),
        vault_b: Pubkey::default(),
        positions: vec![],
        minted_a: 0,
        minted_b: 0,
        last_err: String::new(),
    };
    for k in &env.actors[1..] {
        env.svm.airdrop(&k.pubkey(), 100_000_000_000).unwrap();
    }
    let p = env.payer.pubkey();
    let mut args = p.to_bytes().to_vec();
    args.extend_from_slice(env.emergency.pubkey().as_ref());
    let ix = env.ix("initialize_global_config", &[("config", config), ("payer", p), ("program_data", pdata)], &args);
    env.send(vec![ix], &[]).expect("initialize_global_config");
    let protocol_share = g.range(0, 2_000) as u16;
    let mut args = TIMELOCK.to_le_bytes().to_vec();
    args.extend_from_slice(&protocol_share.to_le_bytes());
    args.extend_from_slice(p.as_ref());
    let ix = env.ix("initialize_governance_settings", &[("config", config), ("governance_authority", p), ("settings", settings), ("payer", p)], &args);
    env.send(vec![ix], &[]).expect("initialize_governance_settings");

    env.mint_a = env.create_mint();
    env.mint_b = env.create_mint();
    for m in [env.mint_a, env.mint_b] {
        let policy = pda(&[b"mint_policy", m.as_ref()], &pid);
        let ix = env.ix(
            "set_mint_policy",
            &[("config", config), ("governance_authority", p), ("mint", m), ("token_program", TOKEN), ("mint_policy", policy), ("payer", p)],
            &[1, 0, 0], // enabled, not Token-2022, no freeze authority to trust (K-1)
        );
        env.send(vec![ix], &[]).expect("set_mint_policy");
    }
    // Balances: big enough for any generated amount we allow (see cap()).
    const BAL: u64 = 1 << 61;
    for i in 0..3 {
        let o = env.actors[i].pubkey();
        let a = env.token_account(env.mint_a, o, BAL);
        let b = env.token_account(env.mint_b, o, BAL);
        env.ta.push(a);
        env.tb.push(b);
        env.minted_a += BAL as u128;
        env.minted_b += BAL as u128;
    }
    env.treasury_a = env.ta[0];
    env.treasury_b = env.tb[0];

    // Random pool config (same generator family as the fuzz model).
    let mode = g.byte() % 3;
    let floor = g.range(1, 1_000) as u16;
    let base = if mode == 0 {
        m::BaseFeeConfig { mode, decay: 0, cliff_fee_bps: floor, floor_fee_bps: floor, number_of_periods: 0, period_frequency: 0, reduction_factor: 0 }
    } else {
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
    };
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
    if !m::validate_base_fee(&base) || !m::validate_dynamic_fee(&dynf) {
        return None;
    }
    let collect = g.byte() % 3;
    let max_impact = g.range(1, 5_000) as u16;
    let delay = g.irange(0, 100);
    let now = env.clock().unix_timestamp;
    let activation = now + delay;

    let mut params = vec![base.mode, base.decay];
    params.extend_from_slice(&base.cliff_fee_bps.to_le_bytes());
    params.extend_from_slice(&base.floor_fee_bps.to_le_bytes());
    params.extend_from_slice(&base.number_of_periods.to_le_bytes());
    params.extend_from_slice(&base.period_frequency.to_le_bytes());
    params.extend_from_slice(&base.reduction_factor.to_le_bytes());
    params.push(dynf.enabled as u8);
    params.extend_from_slice(&dynf.max_dynamic_fee_bps.to_le_bytes());
    params.extend_from_slice(&dynf.variable_fee_control.to_le_bytes());
    params.extend_from_slice(&dynf.filter_period.to_le_bytes());
    params.extend_from_slice(&dynf.decay_period.to_le_bytes());
    params.extend_from_slice(&dynf.reduction_factor.to_le_bytes());
    params.extend_from_slice(&dynf.max_volatility_accumulator.to_le_bytes());
    params.push(collect);
    params.extend_from_slice(&activation.to_le_bytes());
    params.extend_from_slice(&max_impact.to_le_bytes());
    params.push(0); // oracle off
    params.extend_from_slice(&[0u8; 64]);
    params.extend_from_slice(&0u32.to_le_bytes());
    params.extend_from_slice(&0u16.to_le_bytes());

    let (ma, mb) = (env.mint_a, env.mint_b);
    let pool = pda(&[b"swdmm_v2_pool", ma.as_ref(), mb.as_ref(), &floor.to_le_bytes()], &pid);
    let va = pda(&[b"swdmm_v2_vault", pool.as_ref(), ma.as_ref()], &pid);
    let vb = pda(&[b"swdmm_v2_vault", pool.as_ref(), mb.as_ref()], &pid);
    let ix = env.ix(
        "initialize_v2_pool",
        &[
            ("creator", p),
            ("config", config),
            ("settings", settings),
            ("mint_a", ma),
            ("mint_b", mb),
            ("mint_policy_a", pda(&[b"mint_policy", ma.as_ref()], &pid)),
            ("mint_policy_b", pda(&[b"mint_policy", mb.as_ref()], &pid)),
            ("pool", pool),
            ("vault_a", va),
            ("vault_b", vb),
            ("token_program_a", TOKEN),
            ("token_program_b", TOKEN),
        ],
        &params,
    );
    env.send(vec![ix], &[]).expect("initialize_v2_pool");
    env.pool = pool;
    env.vault_a = va;
    env.vault_b = vb;

    let model = V2 {
        reserve_a: 0,
        reserve_b: 0,
        liquidity: 0,
        locked_liquidity: 0,
        base,
        dynf,
        vol: m::VolatilityState::default(),
        collect_mode: collect,
        activation_ts: activation,
        init_price_q64: 0,
        max_impact,
        fpl_a: 0,
        fpl_b: 0,
        protocol_a: 0,
        protocol_b: 0,
        swap_paused: false,
        deposit_paused: false,
        withdraw_paused: false,
        impact_slot: 0,
        impact_ref: 0,
        protocol_share: protocol_share as u64,
        now,
        slot: env.clock().slot,
        vault_a: 0,
        vault_b: 0,
        positions: vec![],
    };
    Some((env, model))
}

/// Read the on-chain pool + positions into the model's shape.
fn chain_state(env: &Env, model: &V2) -> V2 {
    let d = env.acc(&env.pool).data;
    let t = "SwdmmV2Pool";
    let mut s = model.clone();
    s.reserve_a = env.f_u64(&d, t, "reserve_a");
    s.reserve_b = env.f_u64(&d, t, "reserve_b");
    s.liquidity = env.f_u128(&d, t, "liquidity");
    s.locked_liquidity = env.f_u128(&d, t, "locked_liquidity");
    s.fpl_a = env.f_u128(&d, t, "fee_per_liquidity_a");
    s.fpl_b = env.f_u128(&d, t, "fee_per_liquidity_b");
    s.protocol_a = env.f_u64(&d, t, "protocol_fee_a");
    s.protocol_b = env.f_u64(&d, t, "protocol_fee_b");
    s.swap_paused = env.f_bool(&d, t, "swap_paused");
    s.deposit_paused = env.f_bool(&d, t, "deposit_paused");
    s.withdraw_paused = env.f_bool(&d, t, "withdraw_paused");
    s.init_price_q64 = env.f_u128(&d, t, "init_price_q64");
    s.max_impact = u16::from_le_bytes(rd(&d, env.idl.offset(t, "max_price_impact_bps")));
    s.dynf.enabled = d[env.idl.offset(t, "dynamic_fee") ] != 0;
    s.vol.volatility_accumulator = env.f_u64(&d, t, "volatility_accumulator");
    s.vol.volatility_reference = env.f_u64(&d, t, "volatility_reference");
    s.vol.price_reference_q64 = env.f_u128(&d, t, "price_reference_q64");
    s.vol.last_update_ts = env.f_i64(&d, t, "last_swap_ts");
    s.impact_slot = env.f_u64(&d, t, "impact_slot");
    s.impact_ref = env.f_u128(&d, t, "impact_ref_price_q64");
    s.vault_a = env.token_balance(&env.vault_a) as u128;
    s.vault_b = env.token_balance(&env.vault_b) as u128;
    let sd = env.acc(&env.settings).data;
    s.protocol_share = u16::from_le_bytes(rd(&sd, env.idl.offset("GovernanceSettings", "protocol_fee_share_bps"))) as u64;
    s.positions = env
        .positions
        .iter()
        .zip(model.positions.iter())
        .map(|(k, mp)| {
            let pd = env.acc(k).data;
            let t = "SwdmmV2Position";
            Pos {
                owner: mp.owner,
                liquidity: env.f_u128(&pd, t, "liquidity"),
                locked: env.f_u128(&pd, t, "locked_liquidity"),
                ckpt_a: env.f_u128(&pd, t, "fee_checkpoint_a"),
                ckpt_b: env.f_u128(&pd, t, "fee_checkpoint_b"),
                pending_a: env.f_u64(&pd, t, "pending_fee_a"),
                pending_b: env.f_u64(&pd, t, "pending_fee_b"),
            }
        })
        .collect();
    s
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

#[derive(Default, Debug)]
struct Tally {
    ok: HashMap<&'static str, u64>,
    rejected: HashMap<&'static str, u64>,
}

fn run_seed(seed: u64, steps: usize, tally: &mut Tally) {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let bytes: Vec<u8> = (0..steps * 40 + 200).map(|_| rng.next() as u8).collect();
    let mut g = Gen::new(&bytes);
    let Some((mut env, mut model)) = setup(&mut g) else { return };
    let total = |env: &Env| -> (u128, u128) {
        let mut a = env.token_balance(&env.vault_a) as u128;
        let mut b = env.token_balance(&env.vault_b) as u128;
        for i in 0..3 {
            a += env.token_balance(&env.ta[i]) as u128;
            b += env.token_balance(&env.tb[i]) as u128;
        }
        (a, b)
    };
    // creator's position first, like the fuzz model
    env.create_position(0).unwrap();
    model.create_position(0);
    // a fair chance that the creator seeds the pool early
    for step in 0..steps {
        let c = env.clock();
        model.now = c.unix_timestamp;
        model.slot = c.slot;
        let before = model.clone();
        let op = g.byte() % 14;
        let actor = (g.byte() as usize) % 3;
        let cap = |v: u64| v % (1u64 << 58);
        let (name, chain_ok, model_ok): (&'static str, bool, bool) = match op {
            0 => {
                let r = env.create_position(actor).is_ok();
                if r {
                    model.create_position(actor);
                }
                ("create_position", r, r)
            }
            1 | 2 => {
                let pi = (g.byte() as usize) % env.positions.len();
                let owner = model.positions[pi].owner;
                let (a, b) = if model.liquidity == 0 {
                    (g.amount_in(1_000, 1 << 50), g.amount_in(1_000, 1 << 50))
                } else if g.bool() {
                    // roughly at the pool ratio, 0.01%..100% of the reserves
                    let f = g.range(1, 10_000) as u128;
                    (((model.reserve_a as u128 * f) / 10_000) as u64 + 1, ((model.reserve_b as u128 * f) / 10_000) as u64 + 2)
                } else {
                    (cap(g.amount()), cap(g.amount()))
                };
                // the model does not track wallets: never ask for more than the owner holds
                let a = a.min(env.token_balance(&env.ta[owner]));
                let b = b.min(env.token_balance(&env.tb[owner]));
                let mut args = a.to_le_bytes().to_vec();
                args.extend_from_slice(&b.to_le_bytes());
                args.extend_from_slice(&0u128.to_le_bytes());
                let ix = env.ix("add_v2_liquidity", &env.modify_accts(owner, env.positions[pi]), &args);
                let kp = env.actors[owner].insecure_clone();
                let r = env.send(vec![ix], &[&kp]).is_ok();
                ("add_liquidity", r, model.add(pi, a, b).is_ok())
            }
            3 => {
                let pi = (g.byte() as usize) % env.positions.len();
                let owner = model.positions[pi].owner;
                let l = g.part(model.positions[pi].liquidity);
                let mut args = l.to_le_bytes().to_vec();
                args.extend_from_slice(&[0u8; 16]);
                let ix = env.ix("remove_v2_liquidity", &env.modify_accts(owner, env.positions[pi]), &args);
                let kp = env.actors[owner].insecure_clone();
                let r = env.send(vec![ix], &[&kp]).is_ok();
                ("remove_liquidity", r, model.remove(pi, l).is_ok())
            }
            4 => {
                let pi = (g.byte() as usize) % env.positions.len();
                let owner = model.positions[pi].owner;
                let ix = env.ix("claim_v2_fees", &env.modify_accts(owner, env.positions[pi]), &[]);
                let kp = env.actors[owner].insecure_clone();
                let r = env.send(vec![ix], &[&kp]).is_ok();
                ("claim_fees", r, model.claim(pi).is_ok())
            }
            5 => {
                let pi = (g.byte() as usize) % env.positions.len();
                let owner = model.positions[pi].owner;
                let l = g.part(model.positions[pi].liquidity);
                let ix = env.ix("lock_v2_liquidity", &[("owner", env.actors[owner].pubkey()), ("pool", env.pool), ("position", env.positions[pi])], &l.to_le_bytes());
                let kp = env.actors[owner].insecure_clone();
                let r = env.send(vec![ix], &[&kp]).is_ok();
                ("lock_liquidity", r, model.lock(pi, l).is_ok())
            }
            6..=8 | 13 => {
                let dir = g.bool();
                let r_in = if dir { model.reserve_a } else { model.reserve_b };
                // half the time size the trade relative to the pool (0.01%..30%)
                let amt = if g.bool() && r_in > 0 { ((r_in as u128 * g.range(1, 3_000) as u128) / 10_000) as u64 } else { cap(g.amount()) };
                let round_trip = op == 13;
                let (a0, b0) = (env.token_balance(&env.ta[actor]), env.token_balance(&env.tb[actor]));
                let amt = amt.min(if dir { a0 } else { b0 });
                let k0 = (model.reserve_a as u128) * (model.reserve_b as u128);
                let swap_ix = |env: &Env, amt: u64, dir: bool| {
                    let mut args = amt.to_le_bytes().to_vec();
                    args.extend_from_slice(&0u64.to_le_bytes());
                    args.push(dir as u8);
                    env.ix(
                        "swap_v2",
                        &[
                            ("trader", env.actors[actor].pubkey()),
                            ("settings", env.settings),
                            ("pool", env.pool),
                            ("mint_a", env.mint_a),
                            ("mint_b", env.mint_b),
                            ("vault_a", env.vault_a),
                            ("vault_b", env.vault_b),
                            ("trader_token_a", env.ta[actor]),
                            ("trader_token_b", env.tb[actor]),
                            ("token_program_a", TOKEN),
                            ("token_program_b", TOKEN),
                        ],
                        &args,
                    )
                };
                let kp = env.actors[actor].insecure_clone();
                let r = env.send(vec![swap_ix(&env, amt, dir)], &[&kp]).is_ok();
                let mr = model.swap(amt, dir);
                if r {
                    let k1 = (env.f_u64(&env.acc(&env.pool).data, "SwdmmV2Pool", "reserve_a") as u128)
                        * (env.f_u64(&env.acc(&env.pool).data, "SwdmmV2Pool", "reserve_b") as u128);
                    assert!(k1 >= k0, "seed {seed} step {step}: on-chain swap decreased k");
                }
                if round_trip && r && mr.is_ok() {
                    // swap the exact output back in the same slot
                    let got = if dir { env.token_balance(&env.tb[actor]) - b0 } else { env.token_balance(&env.ta[actor]) - a0 };
                    let r2 = env.send(vec![swap_ix(&env, got, !dir)], &[&kp]).is_ok();
                    let mr2 = model.swap(got, !dir).is_ok();
                    assert_eq!(r2, mr2, "seed {seed} step {step}: round-trip leg 2 chain={r2} model={mr2}");
                    if r2 {
                        // both legs done: the trader ends with no more of either token
                        let (a1, b1) = (env.token_balance(&env.ta[actor]), env.token_balance(&env.tb[actor]));
                        assert!(a1 <= a0 && b1 <= b0, "seed {seed} step {step}: on-chain swap round trip returned a profit");
                        *tally.ok.entry("swap_round_trip_both_legs").or_default() += 1;
                    }
                }
                (if round_trip { "swap_round_trip" } else { "swap" }, r, mr.is_ok())
            }
            9 => {
                let dt = if g.bool() { g.irange(0, 120) } else { g.irange(0, 400_000) };
                let ds = g.range(0, 3);
                env.warp(dt, ds);
                ("time_passes", true, true)
            }
            10 => {
                // donation straight into the vaults
                let (a, b) = (cap(g.amount()) >> 8, cap(g.amount()) >> 8);
                let (ta, tb, va, vb) = (env.ta[actor], env.tb[actor], env.vault_a, env.vault_b);
                let r = env.transfers(actor, &[(ta, va, a), (tb, vb, b)]).is_ok();
                if r {
                    model.vault_a += a as u128;
                    model.vault_b += b as u128;
                }
                ("donate", r, r)
            }
            11 => {
                // emergency pause (guardian, immediate) or timelocked unpause
                let (s, d, w) = (g.bool(), g.bool(), g.bool());
                if g.bool() {
                    let ix = env.ix("emergency_pause_v2_pool", &[("config", env.config), ("emergency_authority", env.emergency.pubkey()), ("pool", env.pool)], &[s as u8, d as u8, w as u8]);
                    let kp = env.emergency.insecure_clone();
                    let r = env.send(vec![ix], &[&kp]).is_ok();
                    let mo = s || d || w;
                    if mo {
                        model.swap_paused |= s;
                        model.deposit_paused |= d;
                        model.withdraw_paused |= w;
                    }
                    ("emergency_pause", r, mo)
                } else {
                    let mut act = vec![2u8];
                    act.extend_from_slice(env.pool.as_ref());
                    act.extend_from_slice(&[s as u8, d as u8, w as u8]);
                    let pool = env.pool;
                    let r = env.governed(act, "execute_v2_pool_action", vec![("pool", pool)]);
                    if r.is_ok() {
                        model.swap_paused &= !s;
                        model.deposit_paused &= !d;
                        model.withdraw_paused &= !w;
                    }
                    let ok = r.is_ok();
                    ("gov_unpause", ok, ok)
                }
            }
            _ => {
                match g.byte() % 3 {
                    0 => {
                        let mi = g.range(1, 5_000) as u16;
                        let en = g.bool();
                        let mut act = vec![6u8];
                        act.extend_from_slice(env.pool.as_ref());
                        act.extend_from_slice(&mi.to_le_bytes());
                        act.push(en as u8);
                        let pool = env.pool;
                        let r = env.governed(act, "execute_v2_pool_action", vec![("pool", pool)]).is_ok();
                        let mo = model.set_v2_params(mi, en).is_ok();
                        ("gov_set_v2_params", r, mo)
                    }
                    1 => {
                        let bps = g.range(0, 2_000) as u16;
                        let mut act = vec![3u8];
                        act.extend_from_slice(&bps.to_le_bytes());
                        let s = env.settings;
                        let r = env.governed(act, "execute_settings_action", vec![("settings", s)]).is_ok();
                        if r {
                            model.protocol_share = bps as u64;
                        }
                        ("gov_protocol_share", r, r)
                    }
                    _ => {
                        let mut act = vec![7u8];
                        act.extend_from_slice(env.pool.as_ref());
                        let a = vec![
                            ("settings", env.settings),
                            ("pool", env.pool),
                            ("mint_a", env.mint_a),
                            ("mint_b", env.mint_b),
                            ("vault_a", env.vault_a),
                            ("vault_b", env.vault_b),
                            ("treasury_token_a", env.treasury_a),
                            ("treasury_token_b", env.treasury_b),
                            ("token_program_a", TOKEN),
                            ("token_program_b", TOKEN),
                        ];
                        let r = env.governed(act, "execute_withdraw_protocol_fees", a).is_ok();
                        if r {
                            model.withdraw_protocol();
                        }
                        ("gov_withdraw_protocol_fees", r, r)
                    }
                }
            }
        };
        assert_eq!(
            chain_ok, model_ok,
            "seed {seed} step {step}: op {name}: chain ok={chain_ok} model ok={model_ok}\nlast chain error: {}\nbefore={before:?}", env.last_err
        );
        *if chain_ok { tally.ok.entry(name).or_default() } else { tally.rejected.entry(name).or_default() } += 1;
        // model time may have advanced inside governed(); resync
        let c = env.clock();
        model.now = c.unix_timestamp;
        model.slot = c.slot;
        let chain = chain_state(&env, &model);
        assert_eq!(chain, model, "seed {seed} step {step}: op {name}: chain and model diverged");
        // invariants on the ON-CHAIN state (V2::check reads only the state)
        chain.check();
        assert_eq!(total(&env), (env.minted_a, env.minted_b), "token conservation broken");
    }
    // Liveness on chain: every position can withdraw and claim (unpaused).
    let pool = env.pool;
    let _ = env.governed(
        {
            let mut a = vec![2u8];
            a.extend_from_slice(pool.as_ref());
            a.extend_from_slice(&[1, 1, 1]);
            a
        },
        "execute_v2_pool_action",
        vec![("pool", pool)],
    );
    for pi in 0..env.positions.len() {
        let pd = env.acc(&env.positions[pi]).data;
        let l = env.f_u128(&pd, "SwdmmV2Position", "liquidity");
        let owner = model.positions[pi].owner;
        let kp = env.actors[owner].insecure_clone();
        if l > 0 {
            let mut args = l.to_le_bytes().to_vec();
            args.extend_from_slice(&[0u8; 16]);
            let ix = env.ix("remove_v2_liquidity", &env.modify_accts(owner, env.positions[pi]), &args);
            env.send(vec![ix], &[&kp]).unwrap_or_else(|e| panic!("seed {seed}: position {pi} cannot withdraw: {e}"));
        }
        let ix = env.ix("claim_v2_fees", &env.modify_accts(owner, env.positions[pi]), &[]);
        env.send(vec![ix], &[&kp]).unwrap_or_else(|e| panic!("seed {seed}: position {pi} cannot claim: {e}"));
    }
    let mut final_model = model.clone();
    final_model.withdraw_paused = false;
    let chain = chain_state(&env, &final_model);
    chain.check();
}

#[test]
fn v2_random_sequences_against_the_real_program() {
    let seeds: u64 = std::env::var("SWD_SVM_SEEDS").ok().and_then(|s| s.parse().ok()).unwrap_or(12);
    let steps: usize = std::env::var("SWD_SVM_STEPS").ok().and_then(|s| s.parse().ok()).unwrap_or(120);
    let first: u64 = std::env::var("SWD_SVM_FIRST_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let mut tally = Tally::default();
    let t0 = std::time::Instant::now();
    for seed in first..first + seeds {
        run_seed(seed, steps, &mut tally);
    }
    let mut ok: Vec<_> = tally.ok.iter().collect();
    ok.sort();
    let mut rej: Vec<_> = tally.rejected.iter().collect();
    rej.sort();
    eprintln!("{seeds} seeds x {steps} steps in {:?}\n  succeeded: {ok:?}\n  rejected (by chain AND model): {rej:?}", t0.elapsed());
}
