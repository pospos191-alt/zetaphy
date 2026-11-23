# Neuro red-team report

Seed `rt-2026-W48-fresh`, model `nml-aff2cf2d4d85`. 160 scam variants built, compiled and read by Neuro (rules + buy/sell simulation on an in-memory EVM) and the model.
An **evasion** is a scam whose shown level stays below "medium".

| | caught by rules + simulation | caught with the model |
|---|---:|---:|
| all | 56% | 93% |
| family:blacklist-trap (18) | 33% | 83% |
| family:dormant-fee (18) | 33% | 100% |
| family:drain (12) | 25% | 92% |
| family:hidden-mint (24) | 33% | 100% |
| family:high-tax (28) | 100% | 100% |
| family:honeypot (17) | 100% | 100% |
| family:max-sell (7) | 100% | 100% |
| family:seize (16) | 25% | 100% |
| family:stealth (20) | 50% | 60% |
| mutation:block-ramp (9) | 22% | 33% |
| mutation:fake-renounce (20) | 60% | 95% |
| mutation:hashed-owner (32) | 59% | 88% |
| mutation:noise (71) | 51% | 89% |
| mutation:origin-owner (37) | 54% | 95% |
| mutation:proxy (30) | 100% | 100% |
| mutation:rename (138) | 51% | 92% |
| mutation:sim-aware (7) | 100% | 100% |
| mutation:split-guard (12) | 100% | 100% |
| mutation:timebomb (4) | 25% | 50% |
| mutation:xor-owner (33) | 48% | 91% |
| tell:gasprice (2) | 100% | 100% |
| tell:nobalance (2) | 100% | 100% |
| tell:share99 (3) | 100% | 100% |

## Evasions (12)

- `rt-rt_2026_W48_fresh_9` blacklist-trap [hashed-owner, noise, rename]: rules low, shown low, p=0.7349; sim done; top: x_priv_unknown +0.752, o_rate_log -0.601, x_priv_xfer_free -0.526, g3_11 +0.318
- `rt-rt_2026_W48_fresh_38` blacklist-trap [noise, rename, xor-owner]: rules low, shown low, p=0.6133; sim done; top: x_priv_unknown +0.781, o_rate_log -0.601, x_priv_xfer_free -0.526, g3_11 +0.318
- `rt-rt_2026_W48_fresh_52` stealth [block-ramp]: rules low, shown low, p=0.1366; sim done; top: x_priv_unknown +0.744, x_tx_time -0.499, x_priv_xfer_free -0.455, o_rate_sload -0.347
- `rt-rt_2026_W48_fresh_72` stealth [block-ramp, hashed-owner, rename]: rules low, shown low, p=0.2999; sim done; top: x_priv_unknown +0.767, x_priv_xfer_free -0.561, o_rate_log -0.558, x_tx_time -0.512
- `rt-rt_2026_W48_fresh_82` stealth [block-ramp, noise, rename]: rules low, shown low, p=0.2718; sim done; top: x_priv_unknown +0.649, x_tx_time -0.539, x_priv_xfer_free -0.516, x_fee_owner_free -0.361
- `rt-rt_2026_W48_fresh_96` stealth [block-ramp, noise, origin-owner, rename]: rules low, shown low, p=0.6071; sim done; top: x_priv_unknown +0.823, x_tx_time -0.577, x_priv_xfer_free -0.503, m_sim_ok -0.29
- `rt-rt_2026_W48_fresh_129` stealth [block-ramp, hashed-owner, noise, rename]: rules low, shown low, p=0.5416; sim done; top: x_priv_unknown +0.796, x_priv_xfer_free -0.529, x_tx_time -0.499, g3_17 +0.396
- `rt-rt_2026_W48_fresh_4` stealth [hashed-owner, noise, rename, timebomb]: rules low, shown low, p=0.3162; sim done; top: x_priv_unknown +0.852, x_priv_xfer_free -0.515, x_tx_time -0.483, m_sim_ok -0.464
- `rt-rt_2026_W48_fresh_11` stealth [block-ramp, noise, origin-owner, rename]: rules low, shown low, p=0.2955; sim done; top: x_priv_unknown +0.852, x_tx_time -0.678, x_priv_xfer_free -0.504, g3_11 +0.331
- `rt-rt_2026_W48_fresh_22` blacklist-trap [noise, rename, xor-owner]: rules low, shown low, p=0.5912; sim done; top: x_priv_unknown +0.825, x_priv_xfer_free -0.51, g3_11 +0.357, m_sim_ok -0.333
- `rt-rt_2026_W48_fresh_45` stealth [rename, timebomb, xor-owner]: rules low, shown low, p=0.796; sim done; top: x_priv_unknown +0.924, x_tx_time -0.52, x_priv_xfer_free -0.484, s_dispatched +0.406
- `rt-rt_2026_W48_fresh_127` drain [fake-renounce, rename]: rules info, shown info, p=0.0084; sim done; top: r_ctl_renounced -1.261, r_level -0.96, x_priv_unknown -0.931, x_owner_const +0.651
