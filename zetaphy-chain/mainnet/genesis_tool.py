#!/usr/bin/env python3
"""ZETAPHY mainnet genesis helper, called by make-genesis.sh (run it with python3 -I).

  genesis_tool.py config   <config.env>                     -> normalized config (JSON) on stdout, or refuses
  genesis_tool.py edit     <config.json> <genesis.json>     -> sets the parameters (before the accounts are added)
  genesis_tool.py pubkey   <config.json> <genesis.json>     -> puts the circuit authority's multisig key on its account
  genesis_tool.py check    <config.json> <genesis.json> [--final]
                                                            -> every property the mainnet genesis must have

It never reads, makes or holds a private key: accounts are addresses, the circuit authority is a multisig public key.
Docs: docs/ZETAPHY-MAINNET-PROCEDURE.md.
"""
import base64
import datetime as dt
import hashlib
import json
import re
import sys
from decimal import Decimal, InvalidOperation

TESTNET_CHAIN_ID = "zetaphy_77390-1"
# EVM chain ids that must never be used: this project's testnet, the cosmos/evm default, and well-known networks.
TAKEN_EVM_CHAIN_IDS = {1, 10, 56, 100, 137, 250, 324, 8453, 42161, 43114, 9000, 9001, 262144, 77390, 11155111}
PQ_ONE = "0000000000000001"
# Activation heights from block 1: v2 (08), security core (0f), v5 (20), invariant-firewall node layer (33),
# chain guard (40), shield (50).
PQ_HEIGHT_KEYS = ["08", "0f", "20", "33", "40", "50"]
QDAY_DEFAULT_REVEAL_DELAY = 720
POWER_CAP_DEFAULT = 3333
PRECOMPILES = ["0x0000000000000000000000000000000000000100", "0x0000000000000000000000000000000000000400",
               "0x0000000000000000000000000000000000000800", "0x0000000000000000000000000000000000000801",
               "0x0000000000000000000000000000000000000802", "0x0000000000000000000000000000000000000803",
               "0x0000000000000000000000000000000000000804", "0x0000000000000000000000000000000000000805",
               "0x0000000000000000000000000000000000000806", "0x0000000000000000000000000000000000000807",
               "0x0000000000000000000000000000000000000900"]
NATIVE_ERC20 = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
MULTISIG_TYPE = "/cosmos.crypto.multisig.LegacyAminoPubKey"
KEY_TYPES = {"/cosmos.evm.crypto.v1.ethsecp256k1.PubKey", "/cosmos.crypto.secp256k1.PubKey"}

REQUIRED = ["CHAIN_ID", "EVM_CHAIN_ID", "GENESIS_TIME", "TOTAL_SUPPLY", "SELF_BOND",
            "CIRCUIT_AUTHORITY", "CIRCUIT_AUTHORITY_PUBKEY_FILE"]
DEFAULTS = {
    "DENOM": "azetaphy", "DENOM_ALIAS": "attozetaphy", "DISPLAY_DENOM": "ztphy", "SYMBOL": "ZTPHY",
    "COIN_NAME": "ZETAPHY", "DECIMALS": "18",
    "DENOM_DESCRIPTION": "ZETAPHY Chain native coin",
    "VALIDATORS": "1",
    "GOV_VOTING_PERIOD": "5d", "GOV_EXPEDITED_VOTING_PERIOD": "1d", "GOV_MAX_DEPOSIT_PERIOD": "14d",
    "GOV_MIN_DEPOSIT": "10000", "GOV_EXPEDITED_MIN_DEPOSIT": "50000", "GOV_MIN_INITIAL_DEPOSIT_RATIO": "0.25",
    "GOV_QUORUM": "0.334", "GOV_THRESHOLD": "0.5", "GOV_VETO_THRESHOLD": "0.334", "GOV_EXPEDITED_THRESHOLD": "0.667",
    "STAKING_UNBONDING_TIME": "21d", "STAKING_MAX_VALIDATORS": "100", "STAKING_MIN_COMMISSION_RATE": "0.05",
    "SLASHING_SIGNED_BLOCKS_WINDOW": "10000", "SLASHING_MIN_SIGNED_PER_WINDOW": "0.05",
    "SLASHING_DOWNTIME_JAIL_DURATION": "10m", "SLASHING_FRACTION_DOUBLE_SIGN": "0.05",
    "SLASHING_FRACTION_DOWNTIME": "0.0001",
    "DISTRIBUTION_COMMUNITY_TAX": "0.02",
    "POWER_CAP_BPS": str(POWER_CAP_DEFAULT),
    "QDAY_HEIGHT": "", "QDAY_REVEAL_DELAY": str(QDAY_DEFAULT_REVEAL_DELAY),
    "BLOCK_MAX_GAS": "30000000",
    # atto per gas: 1000000000 = 1 gwei, as on the testnet. The EIP-1559 base fee starts here and never falls
    # below it (feemarket min_gas_price); nodes set the same as app.toml minimum-gas-prices.
    "MIN_GAS_PRICE": "1000000000",
}
KNOWN = set(REQUIRED) | set(DEFAULTS)


def die(msg):
    print("REFUSED: " + msg, file=sys.stderr)
    sys.exit(1)


# ---- bech32 (BIP-173), for zetaphy1... addresses

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _polymod(values):
    gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1ffffff) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if ((b >> i) & 1) else 0
    return chk


def _hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def _convertbits(data, frm, to, pad):
    acc, bits, ret, maxv = 0, 0, [], (1 << to) - 1
    for v in data:
        acc = (acc << frm) | v
        bits += frm
        while bits >= to:
            bits -= to
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (to - bits)) & maxv)
    elif not pad and (bits >= frm or ((acc << (to - bits)) & maxv)):
        return None
    return ret


def bech32_decode(s):
    if s.lower() != s or "1" not in s:
        return None, None
    pos = s.rfind("1")
    hrp, data = s[:pos], s[pos + 1:]
    if not hrp or len(data) < 6 or any(c not in CHARSET for c in data):
        return None, None
    d = [CHARSET.find(c) for c in data]
    if _polymod(_hrp_expand(hrp) + d) != 1:
        return None, None
    b = _convertbits(d[:-6], 5, 8, False)
    return hrp, (bytes(b) if b is not None else None)


def bech32_encode(hrp, raw):
    d = _convertbits(raw, 8, 5, True)
    pm = _polymod(_hrp_expand(hrp) + d + [0] * 6) ^ 1
    return hrp + "1" + "".join(CHARSET[c] for c in d + [(pm >> 5 * (5 - i)) & 31 for i in range(6)])


def addr_bytes(s, what):
    """zetaphy1... or 0x... (20 bytes) -> bytes; refuses placeholders and malformed input."""
    if "REPLACE" in s.upper() or "PLACEHOLDER" in s.upper():
        die(f"{what}: {s} is a placeholder: put the real address")
    if re.fullmatch(r"0x[0-9a-fA-F]{40}", s):
        raw = bytes.fromhex(s[2:])
    else:
        hrp, raw = bech32_decode(s)
        if hrp != "zetaphy" or raw is None or len(raw) != 20:
            die(f"{what}: {s} is not a zetaphy1... address (bad prefix or checksum) or a 0x... address")
    if len(set(raw.hex())) <= 2:
        die(f"{what}: {s} looks like a placeholder (repeated digits): put the real address")
    return raw


def bech(raw):
    return bech32_encode("zetaphy", raw)


# ---- config

def parse_env(path):
    out = {}
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError as e:
        die(f"config {path}: {e}")
    for n, line in enumerate(lines, 1):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", s)
        if not m:
            die(f"config line {n}: want KEY=VALUE")
        k, v = m.group(1), m.group(2).strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        elif "#" in v:
            v = v.split("#", 1)[0].strip()
        if re.search(r"[$`\\;|&<>]", v):
            die(f"config line {n}: {k}: shell syntax is not allowed (plain values only)")
        if k in out:
            die(f"config line {n}: {k} is set twice")
        out[k] = v
    return out


def dec(v, what, lo=Decimal(0), hi=Decimal(1)):
    try:
        d = Decimal(v)
    except InvalidOperation:
        die(f"{what}: {v} is not a decimal number")
    if not (lo <= d <= hi):
        die(f"{what}: {v} is outside {lo}..{hi}")
    return f"{d:.18f}"


def dur(v, what):
    m = re.fullmatch(r"([0-9]+)([smhd])", v)
    if not m:
        die(f"{what}: {v}: want a number and s, m, h or d (e.g. 5d)")
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]


def whole(v, what, minimum=0):
    if not re.fullmatch(r"[0-9]+", v or ""):
        die(f"{what}: {v!r}: want a whole number of coins (no decimals, no separators)")
    n = int(v)
    if n < minimum:
        die(f"{what}: {n} is below {minimum}")
    return n


def ts(v, genesis_unix, what):
    m = re.fullmatch(r"genesis\+([0-9]+)d", v)
    if m:
        return genesis_unix + int(m.group(1)) * 86400
    try:
        t = dt.datetime.strptime(v, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        die(f"{what}: {v}: want YYYY-MM-DDTHH:MM:SSZ (UTC) or genesis+<days>d")
    return int(t.timestamp())


def load_config(path):
    import os
    env = parse_env(path)
    allocs_raw = {k: v for k, v in env.items() if k.startswith("ALLOC_")}
    for k in env:
        if k not in KNOWN and not k.startswith("ALLOC_"):
            die(f"config: unknown key {k} (a typo would silently fall back to a default)")
    for k in REQUIRED:
        if not env.get(k):
            die(f"config: {k} is required" + (" (the circuit-breaker authority must be a multisig)" if "CIRCUIT" in k else ""))
    c = dict(DEFAULTS)
    c.update(env)

    cid = c["CHAIN_ID"]
    if cid == TESTNET_CHAIN_ID:
        die(f"CHAIN_ID {cid} is the testnet's: a mainnet needs its own chain id")
    m = re.fullmatch(r"([a-z][a-z0-9]*)_([1-9][0-9]*)-([1-9][0-9]*)", cid)
    if not m:
        die(f"CHAIN_ID {cid}: want <name>_<evm chain id>-<version>, e.g. zetaphy_3659-1")
    evm = whole(c["EVM_CHAIN_ID"], "EVM_CHAIN_ID", 1)
    if evm in TAKEN_EVM_CHAIN_IDS:
        die(f"EVM_CHAIN_ID {evm} is taken (the testnet, the cosmos/evm default or a well-known network)")
    if int(m.group(2)) != evm:
        die(f"CHAIN_ID {cid} names EVM chain id {m.group(2)}, EVM_CHAIN_ID is {evm}: they must agree")

    try:
        gt = dt.datetime.strptime(c["GENESIS_TIME"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        die(f"GENESIS_TIME {c['GENESIS_TIME']}: want YYYY-MM-DDTHH:MM:SSZ (UTC)")
    gunix = int(gt.timestamp())

    if not re.fullmatch(r"a[a-z][a-z0-9]{1,62}", c["DENOM"]):
        die(f"DENOM {c['DENOM']}: want the atto unit, e.g. azetaphy")
    if not re.fullmatch(r"[a-z][a-z0-9]{1,30}", c["DISPLAY_DENOM"]) or c["DISPLAY_DENOM"] == c["DENOM"]:
        die(f"DISPLAY_DENOM {c['DISPLAY_DENOM']}: want a lower-case unit name other than DENOM")
    if not re.fullmatch(r"[A-Z][A-Z0-9]{1,11}", c["SYMBOL"]):
        die(f"SYMBOL {c['SYMBOL']}: want 2-12 upper-case letters or digits")
    if c["DECIMALS"] != "18":
        die("DECIMALS: the EVM coin has 18 decimals (other values need the EVM's extended denom; not supported here)")
    for k in ("DENOM_ALIAS", "COIN_NAME", "DENOM_DESCRIPTION"):
        if not re.fullmatch(r"[A-Za-z0-9 ()._-]{1,80}", c[k]):
            die(f"{k}: letters, digits, spaces and ()._- only")
    unit = 10 ** 18

    supply = whole(c["TOTAL_SUPPLY"], "TOTAL_SUPPLY", 1)
    nval = whole(c["VALIDATORS"], "VALIDATORS", 1)

    # allocations: ALLOC_<NAME>=<address> <whole coins> [vesting <start> <end>]
    allocs, seen = [], {}
    for k, v in sorted(allocs_raw.items()):
        name = k[len("ALLOC_"):]
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            die(f"{k}: bad allocation name")
        parts = v.split()
        if len(parts) not in (2, 5) or (len(parts) == 5 and parts[2] != "vesting"):
            die(f"{k}: want '<address> <whole {c['SYMBOL']}>' or '<address> <amount> vesting <start> <end>'")
        raw = addr_bytes(parts[0], k)
        if raw in seen:
            die(f"{k}: the address is also {seen[raw]}: one allocation per address")
        seen[raw] = k
        amt = whole(parts[1], k, 1)
        a = {"name": name, "address": bech(raw), "hex": "0x" + raw.hex(), "amount": amt, "atto": str(amt * unit)}
        if len(parts) == 5:
            s, e = ts(parts[3], gunix, k + " vesting start"), ts(parts[4], gunix, k + " vesting end")
            if not (gunix <= s < e):
                die(f"{k}: vesting must start at or after genesis and end after it starts")
            a["vesting_start"], a["vesting_end"] = s, e
        allocs.append(a)
    if not allocs:
        die("config: no allocations (ALLOC_<NAME>=<address> <amount>)")
    total = sum(a["amount"] for a in allocs)
    if total != supply:
        die(f"allocations add up to {total:,} {c['SYMBOL']}, TOTAL_SUPPLY is {supply:,}: they must be equal")
    names = {a["name"] for a in allocs}
    for need in ("VALIDATOR", "CIRCUIT"):
        if need not in names:
            die(f"config: ALLOC_{need} is required" + (" (the validator operator's account: self-bond and fees)" if need == "VALIDATOR"
                else " (the circuit-breaker multisig needs an account, and coins for fees)"))
    if any("FAUCET" in n for n in names):
        die("config: no faucet on a mainnet")
    val = next(a for a in allocs if a["name"] == "VALIDATOR")
    if "vesting_start" in val:
        die("ALLOC_VALIDATOR cannot vest: its coins bond at genesis")
    bond = whole(c["SELF_BOND"], "SELF_BOND", 1)
    if bond >= val["amount"]:
        die(f"SELF_BOND {bond} must be below ALLOC_VALIDATOR {val['amount']} (keep some for fees)")

    # circuit authority: a multisig public key (threshold >= 2 of >= 2 distinct keys), its address
    pkf = c["CIRCUIT_AUTHORITY_PUBKEY_FILE"]
    if not os.path.isabs(pkf):
        pkf = os.path.join(os.path.dirname(os.path.abspath(path)), pkf)
    try:
        pk = json.load(open(pkf, encoding="utf-8"))
    except (OSError, ValueError) as e:
        die(f"CIRCUIT_AUTHORITY_PUBKEY_FILE {pkf}: {e} (the output of `zetaphyd keys show <multisig> -p`)")
    check_multisig(pk, "CIRCUIT_AUTHORITY_PUBKEY_FILE")
    ca = bech(addr_bytes(c["CIRCUIT_AUTHORITY"], "CIRCUIT_AUTHORITY"))
    circ = next(a for a in allocs if a["name"] == "CIRCUIT")
    if circ["address"] != ca:
        die(f"ALLOC_CIRCUIT {circ['address']} is not CIRCUIT_AUTHORITY {ca}")
    if "vesting_start" in circ:
        die("ALLOC_CIRCUIT cannot vest: it pays its own fees")

    qh = c["QDAY_HEIGHT"]
    qday = None
    if qh:
        qday = {"height": whole(qh, "QDAY_HEIGHT", 2), "delay": whole(c["QDAY_REVEAL_DELAY"], "QDAY_REVEAL_DELAY", 2)}
        if qday["delay"] > 1_000_000:
            die("QDAY_REVEAL_DELAY: at most 1000000 blocks")
    delay = qday["delay"] if qday else QDAY_DEFAULT_REVEAL_DELAY

    gov = {
        "voting": dur(c["GOV_VOTING_PERIOD"], "GOV_VOTING_PERIOD"),
        "expedited": dur(c["GOV_EXPEDITED_VOTING_PERIOD"], "GOV_EXPEDITED_VOTING_PERIOD"),
        "deposit_period": dur(c["GOV_MAX_DEPOSIT_PERIOD"], "GOV_MAX_DEPOSIT_PERIOD"),
        "min_deposit": whole(c["GOV_MIN_DEPOSIT"], "GOV_MIN_DEPOSIT", 1),
        "expedited_min_deposit": whole(c["GOV_EXPEDITED_MIN_DEPOSIT"], "GOV_EXPEDITED_MIN_DEPOSIT", 1),
        "min_initial_deposit_ratio": dec(c["GOV_MIN_INITIAL_DEPOSIT_RATIO"], "GOV_MIN_INITIAL_DEPOSIT_RATIO"),
        "quorum": dec(c["GOV_QUORUM"], "GOV_QUORUM", Decimal("0.2")),
        "threshold": dec(c["GOV_THRESHOLD"], "GOV_THRESHOLD", Decimal("0.5")),
        "veto": dec(c["GOV_VETO_THRESHOLD"], "GOV_VETO_THRESHOLD", Decimal("0.2")),
        "expedited_threshold": dec(c["GOV_EXPEDITED_THRESHOLD"], "GOV_EXPEDITED_THRESHOLD", Decimal("0.5")),
    }
    # Testnet-like values are refused: the constitution makes these floors from block 1, for good.
    if gov["voting"] < 86400:
        die(f"GOV_VOTING_PERIOD {gov['voting']} s: at least 1 day on a mainnet (the testnet's 600 s lets a vote pass unseen)")
    if not (3600 <= gov["expedited"] < gov["voting"]):
        die("GOV_EXPEDITED_VOTING_PERIOD: at least 1 hour and shorter than GOV_VOTING_PERIOD")
    if gov["deposit_period"] < 86400:
        die("GOV_MAX_DEPOSIT_PERIOD: at least 1 day")
    if gov["min_deposit"] < 100:
        die(f"GOV_MIN_DEPOSIT {gov['min_deposit']}: at least 100 {c['SYMBOL']} (cheap proposals are spam)")
    if gov["expedited_min_deposit"] <= gov["min_deposit"]:
        die("GOV_EXPEDITED_MIN_DEPOSIT must be above GOV_MIN_DEPOSIT")
    if Decimal(gov["expedited_threshold"]) <= Decimal(gov["threshold"]):
        die("GOV_EXPEDITED_THRESHOLD must be above GOV_THRESHOLD")
    staking = {
        "unbonding": dur(c["STAKING_UNBONDING_TIME"], "STAKING_UNBONDING_TIME"),
        "max_validators": whole(c["STAKING_MAX_VALIDATORS"], "STAKING_MAX_VALIDATORS", 1),
        "min_commission_rate": dec(c["STAKING_MIN_COMMISSION_RATE"], "STAKING_MIN_COMMISSION_RATE"),
    }
    if staking["unbonding"] < 7 * 86400:
        die("STAKING_UNBONDING_TIME: at least 7 days (it is how long a misbehaving validator's stake stays slashable)")
    slashing = {
        "window": whole(c["SLASHING_SIGNED_BLOCKS_WINDOW"], "SLASHING_SIGNED_BLOCKS_WINDOW", 100),
        "min_signed": dec(c["SLASHING_MIN_SIGNED_PER_WINDOW"], "SLASHING_MIN_SIGNED_PER_WINDOW"),
        "jail": dur(c["SLASHING_DOWNTIME_JAIL_DURATION"], "SLASHING_DOWNTIME_JAIL_DURATION"),
        "double_sign": dec(c["SLASHING_FRACTION_DOUBLE_SIGN"], "SLASHING_FRACTION_DOUBLE_SIGN", Decimal("0.01")),
        "downtime": dec(c["SLASHING_FRACTION_DOWNTIME"], "SLASHING_FRACTION_DOWNTIME"),
    }
    cap = whole(c["POWER_CAP_BPS"], "POWER_CAP_BPS", 1)
    if cap > 3333:
        die("POWER_CAP_BPS: at most 3333 (below 1/3 of the power)")
    return {
        "chain_id": cid, "evm_chain_id": evm, "genesis_time": c["GENESIS_TIME"], "genesis_unix": gunix,
        "denom": c["DENOM"], "denom_alias": c["DENOM_ALIAS"], "display": c["DISPLAY_DENOM"], "symbol": c["SYMBOL"],
        "coin_name": c["COIN_NAME"], "description": c["DENOM_DESCRIPTION"],
        "supply": supply, "allocations": allocs, "validators": nval,
        "self_bond_atto": str(bond * unit), "validator_address": val["address"],
        "circuit_authority": ca, "circuit_pubkey": pk,
        "qday": qday, "qday_delay": delay, "power_cap": cap,
        "gov": gov, "staking": staking, "slashing": slashing,
        "community_tax": dec(c["DISTRIBUTION_COMMUNITY_TAX"], "DISTRIBUTION_COMMUNITY_TAX"),
        "min_gas_price": whole(c["MIN_GAS_PRICE"], "MIN_GAS_PRICE", 1),
        "max_gas": str(whole(c["BLOCK_MAX_GAS"], "BLOCK_MAX_GAS", 1_000_000)),
        "min_deposit_atto": str(gov["min_deposit"] * unit), "expedited_min_deposit_atto": str(gov["expedited_min_deposit"] * unit),
    }


def check_multisig(pk, what):
    if not isinstance(pk, dict) or pk.get("@type") != MULTISIG_TYPE:
        die(f"{what}: not a multisig public key ({MULTISIG_TYPE}); a single key cannot be the circuit authority")
    keys = pk.get("public_keys") or []
    try:
        t = int(pk.get("threshold"))
    except (TypeError, ValueError):
        die(f"{what}: no threshold")
    if t < 2 or len(keys) < 2 or t > len(keys):
        die(f"{what}: threshold {t} of {len(keys)} keys: the circuit authority needs at least 2 of at least 2")
    raws = []
    for k in keys:
        if not isinstance(k, dict) or k.get("@type") not in KEY_TYPES:
            die(f"{what}: member key type {k.get('@type') if isinstance(k, dict) else k!r} is not supported")
        try:
            raw = base64.b64decode(k.get("key", ""), validate=True)
        except ValueError:
            die(f"{what}: a member key is not base64")
        if len(raw) != 33:
            die(f"{what}: a member key is not a 33-byte compressed public key")
        raws.append(raw)
    if len(set(raws)) != len(raws):
        die(f"{what}: the multisig repeats a key: the members must be distinct keys")


# ---- the expected chain-guard state

def ns(seconds):
    return seconds * 1_000_000_000


def constitution(c):
    # The same fields and values as setConstitution (zetaphy_chainguard.go) writes when governance turns it on.
    g, s = c["gov"], c["staking"]
    zero = f"{Decimal(0):.18f}"
    return {"enabled": True, "since": 1, "unbonding_time": ns(s["unbonding"]), "bond_denom": c["denom"],
            "voting_period": ns(g["voting"]), "expedited_voting_period": ns(g["expedited"]),
            "quorum": g["quorum"], "threshold": g["threshold"], "veto_threshold": g["veto"],
            "expedited_threshold": g["expedited_threshold"], "mint_denom": c["denom"],
            "inflation_max": zero, "inflation_min": zero, "inflation_rate_change": zero,
            "blocks_per_year": 6311520, "max_supply": "0", "slash_fraction_double_sign": c["slashing"]["double_sign"],
            "evm_denom": c["denom"], "power_cap_bps": c["power_cap"], "qday_reveal_delay": c["qday_delay"],
            "ibc_hold_delay_seconds": 0}


def pq_entries(c):
    e = [{"key": k, "value": PQ_ONE} for k in PQ_HEIGHT_KEYS]
    if c["qday"]:
        e.append({"key": "10", "value": c["qday"]["height"].to_bytes(8, "big").hex() + c["qday"]["delay"].to_bytes(8, "big").hex()})
    e.append({"key": "42", "value": c["power_cap"].to_bytes(8, "big").hex()})
    e.append({"key": "43", "value": bech32_decode(c["circuit_authority"])[1].hex()})
    e.append({"key": "45", "value": json.dumps(constitution(c), separators=(",", ":")).encode().hex()})
    return e


def metadata(c):
    return [{"description": c["description"],
             "denom_units": [{"denom": c["denom"], "exponent": 0, "aliases": [c["denom_alias"]]},
                             {"denom": c["display"], "exponent": 18, "aliases": []}],
             "base": c["denom"], "display": c["display"], "name": c["coin_name"], "symbol": c["symbol"],
             "uri": "", "uri_hash": ""}]


def edit(c, g):
    a = g["app_state"]
    d = c["denom"]
    g["chain_id"], g["genesis_time"], g["initial_height"] = c["chain_id"], c["genesis_time"], 1
    sp = a["staking"]["params"]
    sp.update(bond_denom=d, unbonding_time=f"{c['staking']['unbonding']}s", max_validators=c["staking"]["max_validators"],
              min_commission_rate=c["staking"]["min_commission_rate"])
    gp, gv = a["gov"]["params"], c["gov"]
    gp.update(min_deposit=[{"denom": d, "amount": c["min_deposit_atto"]}],
              expedited_min_deposit=[{"denom": d, "amount": c["expedited_min_deposit_atto"]}],
              max_deposit_period=f"{gv['deposit_period']}s", voting_period=f"{gv['voting']}s",
              expedited_voting_period=f"{gv['expedited']}s", quorum=gv["quorum"], threshold=gv["threshold"],
              veto_threshold=gv["veto"], expedited_threshold=gv["expedited_threshold"],
              min_initial_deposit_ratio=gv["min_initial_deposit_ratio"], burn_vote_veto=True)
    sl, cs = a["slashing"]["params"], c["slashing"]
    sl.update(signed_blocks_window=str(cs["window"]), min_signed_per_window=cs["min_signed"],
              downtime_jail_duration=f"{cs['jail']}s", slash_fraction_double_sign=cs["double_sign"],
              slash_fraction_downtime=cs["downtime"])
    a["distribution"]["params"]["community_tax"] = c["community_tax"]
    # Fixed supply: no inflation, as on the testnet; with the constitution these ceilings hold for good.
    zero = f"{Decimal(0):.18f}"
    a["mint"]["minter"]["inflation"] = zero
    a["mint"]["params"].update(mint_denom=d, inflation_rate_change=zero, inflation_max=zero, inflation_min=zero,
                               blocks_per_year="6311520", max_supply="0")
    ev = a["evm"]["params"]
    ev.update(evm_denom=d, active_static_precompiles=PRECOMPILES, history_serve_window="8191")
    ev["extended_denom_options"] = {"extended_denom": d}
    a["erc20"]["native_precompiles"] = [NATIVE_ERC20]
    a["erc20"]["token_pairs"] = [{"contract_owner": 1, "erc20_address": NATIVE_ERC20, "denom": d, "enabled": True}]
    a["bank"]["denom_metadata"] = metadata(c)
    g["consensus"]["params"]["block"]["max_gas"] = c["max_gas"]
    fm = a["feemarket"]["params"]
    fm.update(no_base_fee=False, base_fee=f"{c['min_gas_price']}.000000000000000000",
              min_gas_price=f"{c['min_gas_price']}.000000000000000000")
    g["consensus"]["params"]["abci"]["vote_extensions_enable_height"] = "1"
    a["auth"]["params"]["sig_verify_cost_secp256k1"] = "21000"
    a["wasm"]["params"] = {"code_upload_access": {"permission": "Nobody", "addresses": []}, "instantiate_default_permission": "Everybody"}
    a["zetaphypq"] = pq_entries(c)
    return g


def set_pubkey(c, g):
    hit = 0
    for acc in g["app_state"]["auth"]["accounts"]:
        if acc.get("address") == c["circuit_authority"]:
            acc["pub_key"] = c["circuit_pubkey"]
            hit += 1
    if hit != 1:
        die("the circuit authority's account is not in the genesis")
    return g


# ---- checks

def check(c, g, final):
    bad = []

    def want(cond, msg):
        if not cond:
            bad.append(msg)

    a = g.get("app_state", {})
    d = c["denom"]
    want(g.get("chain_id") == c["chain_id"], f"chain_id {g.get('chain_id')} != {c['chain_id']}")
    want(g.get("chain_id") != TESTNET_CHAIN_ID, "chain_id is the testnet's")
    want(g.get("genesis_time") == c["genesis_time"], f"genesis_time {g.get('genesis_time')} != {c['genesis_time']}")
    want(int(g.get("initial_height", 0)) == 1, "initial_height is not 1")
    want(a["bank"].get("denom_metadata") == metadata(c), "denom metadata differs")
    for path, v in [("staking.params.bond_denom", a["staking"]["params"]["bond_denom"]), ("mint.params.mint_denom", a["mint"]["params"]["mint_denom"]),
                    ("evm.params.evm_denom", a["evm"]["params"]["evm_denom"]), ("gov.params.min_deposit", a["gov"]["params"]["min_deposit"][0]["denom"])]:
        want(v == d, f"{path} is {v}, not {d}")
    zero = Decimal(0)
    for k in ("inflation_max", "inflation_min", "inflation_rate_change"):
        want(Decimal(a["mint"]["params"][k]) == zero, f"mint {k} is not 0 (no inflation)")
    want(Decimal(a["mint"]["minter"]["inflation"]) == zero, "mint inflation is not 0")
    gp, gv = a["gov"]["params"], c["gov"]
    want(gp["voting_period"] == f"{gv['voting']}s", f"gov voting_period {gp['voting_period']}")
    want(gp["expedited_voting_period"] == f"{gv['expedited']}s", "gov expedited_voting_period")
    want(gp["max_deposit_period"] == f"{gv['deposit_period']}s", "gov max_deposit_period")
    want(gp["min_deposit"] == [{"denom": d, "amount": c["min_deposit_atto"]}], "gov min_deposit")
    want(gp["expedited_min_deposit"] == [{"denom": d, "amount": c["expedited_min_deposit_atto"]}], "gov expedited_min_deposit")
    for k, ck in (("quorum", "quorum"), ("threshold", "threshold"), ("veto_threshold", "veto"), ("expedited_threshold", "expedited_threshold")):
        want(Decimal(gp[k]) == Decimal(gv[ck]), f"gov {k}")
    sp = a["staking"]["params"]
    want(sp["unbonding_time"] == f"{c['staking']['unbonding']}s", "staking unbonding_time")
    want(Decimal(a["slashing"]["params"]["slash_fraction_double_sign"]) == Decimal(c["slashing"]["double_sign"]), "slashing double sign")
    want(g["consensus"]["params"]["abci"]["vote_extensions_enable_height"] == "1", "vote extensions not from block 1")
    fm = a["feemarket"]["params"]
    want(fm["no_base_fee"] is False and Decimal(fm["min_gas_price"]) == c["min_gas_price"] and Decimal(fm["base_fee"]) == c["min_gas_price"],
         f"feemarket base_fee/min_gas_price {fm['base_fee']}/{fm['min_gas_price']} != MIN_GAS_PRICE {c['min_gas_price']}")
    want(a["evm"]["params"]["active_static_precompiles"] == PRECOMPILES, "EVM precompiles differ")
    want(len(a["evm"].get("preinstalls") or []) == 4, "EVM preinstalls (CREATE2, Multicall3, Permit2, Safe factory) missing")
    want(a["wasm"]["params"]["code_upload_access"]["permission"] == "Nobody", "CosmWasm upload is not governance-only")

    # zetaphypq: exactly the expected entries (the guards on from block 1, the authority, the constitution)
    got = sorted((e["key"], e["value"]) for e in a.get("zetaphypq") or [])
    exp = sorted((e["key"], e["value"]) for e in pq_entries(c))
    if got != exp:
        gk, ek = dict(got), dict(exp)
        for k in sorted(set(gk) | set(ek)):
            if gk.get(k) != ek.get(k):
                bad.append(f"zetaphypq key {k}: genesis {gk.get(k, '(absent)')[:40]}, expected {ek.get(k, '(absent)')[:40]}")
    cons = dict(got).get("45")
    if cons:
        cj = json.loads(bytes.fromhex(cons))
        # the constitution's floors are the genesis parameters themselves
        want(cj.get("enabled") is True, "constitution not enabled")
        want(cj.get("voting_period") == ns(int(gp["voting_period"][:-1])), "constitution voting_period != gov voting_period")
        want(cj.get("unbonding_time") == ns(int(sp["unbonding_time"][:-1])), "constitution unbonding_time != staking")
        want(Decimal(cj.get("quorum", "x") if cj.get("quorum") else "0") == Decimal(gp["quorum"]), "constitution quorum != gov quorum")

    # the circuit authority: a multisig account with its key in genesis
    def acc_addr(x):
        return x.get("address") or x.get("base_account", {}).get("address") or \
            x.get("base_vesting_account", {}).get("base_account", {}).get("address")
    accs = {acc_addr(x): x for x in a["auth"]["accounts"]}
    ca = accs.get(c["circuit_authority"])
    want(ca is not None and ca.get("pub_key") == c["circuit_pubkey"], "circuit authority account has no multisig key")

    # balances: exactly the allocations (no faucet, no other account), summing to the supply
    bal = {b["address"]: b["coins"] for b in a["bank"]["balances"]}
    exp_bal = {x["address"]: [{"denom": d, "amount": x["atto"]}] for x in c["allocations"]}
    bonded = c["self_bond_atto"] if final else "0"
    for addr in sorted(set(bal) | set(exp_bal)):
        if addr not in exp_bal:
            # after collect-gentxs the bonded pool holds the self-bonds
            if not (final and bal[addr] == [{"denom": d, "amount": str(int(bonded) * c["validators"])}]):
                bad.append(f"unexpected balance {addr} {bal[addr]} (no faucet or other account on a mainnet)")
        elif addr not in bal:
            bad.append(f"allocation {addr} has no balance")
        else:
            want(bal[addr] == exp_bal[addr] or (final and addr == c["validator_address"]),
                 f"balance of {addr}: {bal[addr]} != {exp_bal[addr]}")
    total = sum(int(cn["amount"]) for cs_ in bal.values() for cn in cs_ if cn["denom"] == d)
    want(total == c["supply"] * 10 ** 18, f"balances add up to {total}, not the supply {c['supply'] * 10 ** 18}")
    want(a["bank"].get("supply") in ([], None, [{"denom": d, "amount": str(total)}]), f"bank.supply {a['bank'].get('supply')} != the balances")
    for x in c["allocations"]:
        acc = accs.get(x["address"])
        if "vesting_start" in x:
            ok = acc is not None and acc.get("@type") == "/cosmos.vesting.v1beta1.ContinuousVestingAccount" \
                and int(acc.get("start_time", 0)) == x["vesting_start"] \
                and int(acc["base_vesting_account"]["end_time"]) == x["vesting_end"] \
                and acc["base_vesting_account"]["original_vesting"] == [{"denom": d, "amount": x["atto"]}]
            want(ok, f"ALLOC_{x['name']}: not the vesting account the config asks for")
        else:
            want(acc is not None and acc.get("@type") == "/cosmos.auth.v1beta1.BaseAccount", f"ALLOC_{x['name']}: not a plain account")
    want(len(accs) == len(c["allocations"]), f"{len(accs)} accounts in genesis, {len(c['allocations'])} allocations")

    gtx = a.get("genutil", {}).get("gen_txs") or []
    if final:
        want(len(gtx) == c["validators"], f"{len(gtx)} gentx(s), the config says VALIDATORS={c['validators']}")
        for t in gtx:
            for m in t.get("body", {}).get("messages", []):
                want(m.get("@type") == "/cosmos.staking.v1beta1.MsgCreateValidator", "a gentx is not a MsgCreateValidator")
                want(m.get("value") == {"denom": d, "amount": c["self_bond_atto"]}, f"gentx self-bond {m.get('value')} != SELF_BOND")
                want(m.get("delegator_address") in ("", c["validator_address"]) and
                     bech32_decode(m.get("validator_address", ""))[1] == bech32_decode(c["validator_address"])[1],
                     f"gentx validator {m.get('validator_address')} is not ALLOC_VALIDATOR's operator")
                want(m.get("pubkey", {}).get("@type") == "/cosmos.crypto.ed25519.PubKey", "gentx consensus key is not ed25519")
    else:
        want(not gtx, "a draft genesis carries gentxs")
    if bad:
        for b in bad:
            print("REFUSED: " + b, file=sys.stderr)
        sys.exit(1)


def main():
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    cmd = sys.argv[1]
    if cmd == "config":
        json.dump(load_config(sys.argv[2]), sys.stdout)
        return
    c = json.load(open(sys.argv[2], encoding="utf-8"))
    path = sys.argv[3]
    g = json.load(open(path, encoding="utf-8"))
    if cmd in ("edit", "pubkey"):
        g = edit(c, g) if cmd == "edit" else set_pubkey(c, g)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(g, f, indent=2)
            f.write("\n")
    elif cmd == "check":
        check(c, g, "--final" in sys.argv[4:])
    else:
        die(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
