// Offline tests: a tiny HTTP server on 127.0.0.1 answers with canned bodies; nothing leaves the machine.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use swd_sdk::{BuyChecks, Level, SwdClient, SwdError, SWD_MINT};

mod txbuild;
use txbuild::*;

#[derive(Debug, Clone)]
struct Seen {
    method: String,
    target: String,
    body: String,
}

/// Serves `routes` (path prefix → (status, content-type, body)) for any number of requests. Returns base URL + log.
fn serve(routes: Vec<(&'static str, u16, &'static str, String)>) -> (String, Arc<Mutex<Vec<Seen>>>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", l.local_addr().unwrap());
    let log = Arc::new(Mutex::new(Vec::new()));
    let log2 = log.clone();
    thread::spawn(move || {
        for s in l.incoming() {
            let mut s = match s {
                Ok(s) => s,
                Err(_) => continue,
            };
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut first = String::new();
            if r.read_line(&mut first).is_err() {
                continue;
            }
            let mut len = 0usize;
            loop {
                let mut h = String::new();
                r.read_line(&mut h).unwrap();
                if h == "\r\n" || h.is_empty() {
                    break;
                }
                if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap_or(0);
                }
            }
            let mut body = vec![0; len];
            r.read_exact(&mut body).unwrap();
            let mut parts = first.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            let target = parts.next().unwrap_or("").to_string();
            log2.lock().unwrap().push(Seen { method, target: target.clone(), body: String::from_utf8_lossy(&body).into() });
            let path = target.split('?').next().unwrap_or("");
            let (status, ctype, b) = routes
                .iter()
                .find(|(p, ..)| path == *p)
                .map(|(_, s, c, b)| (*s, *c, b.clone()))
                .unwrap_or((404, "text/plain", "not found".into()));
            let resp = format!("HTTP/1.1 {status} X\r\ncontent-type: {ctype}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{b}", b.len());
            let _ = s.write_all(resp.as_bytes());
        }
    });
    (base, log)
}

fn audit_body() -> String {
    serde_json::json!({ "ok": true, "audit": {
        "chain": "sol", "chainName": "Solana", "address": SWD_MINT, "level": "low", "title": "Low risk",
        "lines": [{ "id": "mint-authority-none", "severity": "good", "text": "No mint authority" }],
        "token": { "name": "SAWASDEE COIN", "symbol": "SWD" }, "reportHash": "0xaa", "verdict": "0xbb",
        "permalink": "p", "badge": "b", "auditedAt": "2026-11-07T00:00:00Z", "cached": true, "lang": "en",
        "disclaimer": "d", "report": { "big": true }, "newField": 1 } })
    .to_string()
}

#[tokio::test(flavor = "current_thread")]
async fn async_audit_and_errors() {
    let (base, log) = serve(vec![
        ("/api/audit", 200, "application/json", audit_body()),
        ("/api/audit/tx", 400, "application/json", r#"{"ok":false,"code":"bad_hash","error":"not a valid signature"}"#.into()),
    ]);
    let swd = SwdClient::with_base_url(&base).unwrap();
    let a = swd.audit("sol", SWD_MINT, "th", false).await.unwrap();
    assert_eq!(a.level, Level::Low);
    assert_eq!(a.token.unwrap().symbol.as_deref(), Some("SWD"));
    assert!(a.extra.get("report").is_none(), "report dropped by default");
    assert_eq!(a.extra.get("newField"), Some(&serde_json::json!(1)));
    let full = swd.audit("sol", SWD_MINT, "en", true).await.unwrap();
    assert!(full.extra.get("report").is_some());
    let t = log.lock().unwrap()[0].target.clone();
    assert!(t.starts_with("/api/audit?") && t.contains("chain=sol") && t.contains("lang=th") && t.contains(SWD_MINT), "{t}");

    let e = swd.audit_tx("sol", "x", "en", false).await.unwrap_err();
    assert_eq!(e.code(), Some("bad_hash"));
    assert!(matches!(swd.audit("", "x", "en", false).await, Err(SwdError::BadInput(_))));
}

#[test]
fn blocking_tx_supply_buy() {
    let good = b64(&buy_tx(vec![], Opts::default()));
    let tx = serde_json::json!({ "ok": true, "tx": { "chain": "sol", "hash": "5sig", "found": true, "status": true,
        "level": "info", "overall": "medium", "lines": [], "notes": [{ "id": "n", "severity": "medium", "text": "t" }] } });
    let (base, log) = serve(vec![
        ("/api/audit/tx", 200, "application/json", tx.to_string()),
        ("/api/supply/total", 200, "text/plain", "999999999.12345\n".into()),
        ("/api/supply/circulating", 200, "text/plain", "500000000".into()),
        ("/api/actions/buy-swd", 200, "application/json", serde_json::json!({ "type": "transaction", "transaction": good, "message": "0.1 SOL" }).to_string()),
    ]);
    let swd = swd_sdk::blocking::SwdClient::with_base_url(&base).unwrap();
    let t = swd.audit_tx("sol", "5sig", "en", false).unwrap();
    assert!(t.found);
    assert_eq!(t.overall, Level::Medium);
    assert_eq!(t.notes.len(), 1);

    let s = swd.supply().unwrap();
    assert_eq!(s.total, "999999999.12345");
    assert_eq!(s.circulating, "500000000");

    let acct = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    let b = swd.buy_swd_transaction(acct, "0.1", Some(100), "en").unwrap();
    assert_eq!(b.bytes, buy_tx(vec![], Opts::default()));
    let i = b.inspection.as_ref().unwrap();
    assert!(i.problems.is_empty(), "{:?}", i.problems);
    assert_eq!(i.sol_out_lamports, 100_000_000);
    assert!(i.uses_lookup_tables);
    let seen = log.lock().unwrap().last().cloned().unwrap();
    assert_eq!(seen.method, "POST");
    assert!(seen.target.contains("amount=0.1") && seen.target.contains("slippageBps=100"));
    assert_eq!(serde_json::from_str::<serde_json::Value>(&seen.body).unwrap(), serde_json::json!({ "account": acct }));

    let before = log.lock().unwrap().len();
    assert!(matches!(swd.buy_swd_transaction("nope", "0.1", None, "en"), Err(SwdError::BadInput(_))));
    assert!(matches!(swd.buy_swd_transaction(acct, "51", None, "en"), Err(SwdError::BadInput(_))));
    assert!(matches!(swd.buy_swd_transaction(acct, "0.0001", None, "en"), Err(SwdError::BadInput(_))));
    assert!(matches!(swd.buy_swd_transaction(acct, "1", Some(5), "en"), Err(SwdError::BadInput(_))));
    assert_eq!(log.lock().unwrap().len(), before, "bad input never reaches the network");
}

#[test]
fn buy_error_message_and_bad_supply() {
    let (base, _) = serve(vec![
        ("/api/actions/buy-swd", 422, "application/json", r#"{"message":"no route right now"}"#.into()),
        ("/api/supply/total", 503, "text/plain", "unavailable".into()),
    ]);
    let swd = swd_sdk::blocking::SwdClient::with_base_url(&base).unwrap();
    let e = swd.buy_swd_transaction("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", "0.05", None, "en").unwrap_err();
    assert!(e.to_string().contains("no route right now"));
    assert!(swd.supply().is_err());
}

#[test]
fn sol_amounts() {
    for ok in ["0.001", "0.05", "1", "50", "12.123456789"] {
        assert!(swd_sdk::check_sol_amount(ok).is_ok(), "{ok}");
    }
    for bad in ["", ".5", "1.", "0.0009", "50.000000001", "1e3", "-1", "1.1234567891", "1000"] {
        assert!(swd_sdk::check_sol_amount(bad).is_err(), "{bad}");
    }
}

// ---- attack tests: a compromised / impersonated server answers with a hostile transaction
fn answer(tx: &[u8]) -> swd_sdk::blocking::SwdClient {
    let body = serde_json::json!({ "type": "transaction", "transaction": b64(tx), "message": "0.1 SOL" }).to_string();
    let (base, _) = serve(vec![("/api/actions/buy-swd", 200, "application/json", body)]);
    swd_sdk::blocking::SwdClient::with_base_url(&base).unwrap()
}
fn refused(tx: Vec<u8>, why: &str) {
    match answer(&tx).buy_swd_transaction(BUYER, "0.1", None, "en") {
        Err(SwdError::Api { code, message, .. }) => {
            assert_eq!(code, "unsafe_transaction");
            assert!(message.contains(why), "{message} should mention {why}");
        }
        other => panic!("expected unsafe_transaction ({why}), got {other:?}"),
    }
}

#[test]
fn attack_hostile_buy_transactions_are_refused() {
    refused(buy_tx(vec![transfer(BUYER, ATTACKER, 5_000_000_000)], Opts::default()), "lamports out of the account");
    refused(buy_tx(vec![], Opts { lamports: 2_000_000_000, ..Opts::default() }), "more than");
    let approve = Ix { program: TOK, accounts: vec![WSOL_ATA, ATTACKER, BUYER], data: [vec![4], le(u64::MAX, 8)].concat() };
    refused(buy_tx(vec![approve], Opts::default()), "SPL Approve");
    let set_auth = Ix { program: TOK, accounts: vec![WSOL_ATA, BUYER], data: [vec![6, 2, 1], b58dec(ATTACKER)].concat() };
    refused(buy_tx(vec![set_auth], Opts::default()), "SetAuthority");
    let close = Ix { program: TOK, accounts: vec![WSOL_ATA, ATTACKER, BUYER], data: vec![9] };
    refused(buy_tx(vec![close], Opts::default()), "CloseAccount");
    let assign = Ix { program: SYS, accounts: vec![BUYER], data: [le(1, 4), b58dec(EVIL)].concat() };
    refused(buy_tx(vec![assign], Opts::default()), "Assign");
    refused(buy_tx(vec![Ix { program: EVIL, accounts: vec![BUYER], data: vec![1] }], Opts::default()), "unknown programs: Evi1Program");
    refused(buy_tx(vec![], Opts { fee_payer: ATTACKER, signers: 2, ..Opts::default() }), "fee payer is HUj3");
    refused(buy_tx(vec![], Opts { signers: 2, extra_keys: vec![ATTACKER], ..Opts::default() }), "other signers");
    refused(buy_tx(vec![], Opts { signed: true, ..Opts::default() }), "already (partly) signed");
}

#[test]
fn attack_fee_within_margin_allowed_programs_and_skip() {
    let ok = answer(&buy_tx(vec![transfer(BUYER, ATTACKER, 1_000_000)], Opts::default())).buy_swd_transaction(BUYER, "0.1", None, "en").unwrap();
    assert_eq!(ok.inspection.unwrap().sol_out_lamports, 101_000_000);
    let evil = buy_tx(vec![Ix { program: EVIL, accounts: vec![BUYER], data: vec![1] }], Opts::default());
    let checks = BuyChecks { allow_programs: vec![EVIL.to_string()], ..BuyChecks::default() };
    assert!(answer(&evil).buy_swd_transaction_with(BUYER, "0.1", None, "en", &checks).is_ok());
    let skip = BuyChecks { unsafe_skip_checks: true, ..BuyChecks::default() };
    assert!(answer(&evil).buy_swd_transaction_with(BUYER, "0.1", None, "en", &skip).unwrap().inspection.is_none());
}

#[test]
fn attack_malformed_bytes_are_bad_response() {
    let good = buy_tx(vec![], Opts::default());
    let mut trailing = good.clone();
    trailing.push(0);
    for bad in [good[..good.len() - 3].to_vec(), trailing, vec![1, 2, 3]] {
        assert!(matches!(answer(&bad).buy_swd_transaction(BUYER, "0.1", None, "en"), Err(SwdError::BadResponse(_))));
    }
}

#[test]
fn decode_and_inspect_legacy() {
    use swd_sdk::inspect::{base58, decode_transaction, inspect_transaction, InspectPolicy};
    let legacy = build(&[BUYER, ATTACKER, SYS], 1, false, &[transfer(BUYER, ATTACKER, 7)], 0, false);
    let d = decode_transaction(&legacy).unwrap();
    assert_eq!(d.version, None);
    assert_eq!(d.fee_payer, BUYER);
    assert_eq!(inspect_transaction(&d, BUYER, &InspectPolicy::default()).sol_out_lamports, 7);
    assert!(inspect_transaction(&d, ATTACKER, &InspectPolicy::default()).problems[0].contains("fee payer"));
    assert_eq!(base58(&[0, 0, 1]), "112");
    assert_eq!(base58(&[0u8; 32]), SYS);
}
