# Neuro red-team report

Seed `rt-2026-W47-fresh`, model `nml-ac17d469ebb6`. 160 scam variants built, compiled and read by Neuro (rules + buy/sell simulation on an in-memory EVM) and the model.
An **evasion** is a scam whose shown level stays below "medium".

| | caught by rules + simulation | caught with the model |
|---|---:|---:|
| all | 52% | 94% |
| family:blacklist-trap (28) | 46% | 96% |
| family:dormant-fee (17) | 41% | 100% |
| family:drain (18) | 11% | 100% |
| family:hidden-mint (13) | 15% | 100% |
| family:high-tax (20) | 100% | 100% |
| family:honeypot (15) | 100% | 100% |
| family:max-sell (18) | 100% | 100% |
| family:seize (15) | 13% | 100% |
| family:stealth (16) | 25% | 44% |
| mutation:block-ramp (5) | 20% | 40% |
| mutation:fake-renounce (22) | 55% | 100% |
| mutation:hashed-owner (47) | 43% | 98% |
| mutation:noise (68) | 49% | 96% |
| mutation:origin-owner (31) | 58% | 94% |
| mutation:proxy (26) | 100% | 100% |
| mutation:rename (130) | 48% | 94% |
| mutation:sim-aware (4) | 75% | 100% |
| mutation:split-guard (12) | 83% | 92% |
| mutation:timebomb (7) | 0% | 14% |
| mutation:xor-owner (27) | 74% | 96% |
| tell:gasleft (1) | 100% | 100% |
| tell:iscontract (1) | 0% | 100% |
| tell:nobalance (2) | 100% | 100% |

## Evasions (10)

- `rt-rt_2026_W47_fresh_18` stealth [block-ramp, noise]: rules low, shown low, p=0.5437; sim done; top: x_priv_unknown +0.831, x_tx_time -0.512, x_priv_xfer_free -0.466, m_sim_ok -0.435
- `rt-rt_2026_W47_fresh_40` stealth [block-ramp, hashed-owner, rename]: rules low, shown low, p=0.7968; sim done; top: x_priv_unknown +0.799, s_dispatched +0.53, x_priv_xfer_free -0.459, m_sim_ok -0.435
- `rt-rt_2026_W47_fresh_64` stealth [block-ramp, xor-owner]: rules low, shown low, p=0.6015; sim done; top: x_priv_unknown +0.797, x_tx_time -0.512, x_priv_xfer_free -0.504, o_rate_log -0.449
- `rt-rt_2026_W47_fresh_137` stealth [rename, timebomb]: rules low, shown low, p=0.1733; sim done; top: x_priv_unknown +0.828, x_priv_xfer_free -0.514, m_sim_ok -0.49, x_tx_guard -0.455
- `rt-rt_2026_W47_fresh_145` stealth [noise, rename, split-guard, timebomb]: rules low, shown low, p=0.2156; sim done; top: x_priv_unknown +0.706, x_tx_guard -0.537, m_sim_ok -0.506, x_priv_xfer_free -0.485
- `rt-rt_2026_W47_fresh_159` blacklist-trap [rename]: rules low, shown low, p=0.6217; sim done; top: x_priv_unknown +0.702, x_priv_xfer_free -0.526, m_sim_ok -0.407, o_rate_log -0.378
- `rt-rt_2026_W47_fresh_57` stealth [noise, rename, timebomb]: rules low, shown low, p=0.1195; sim done; top: x_priv_unknown +0.734, x_priv_xfer_free -0.513, m_sim_ok -0.489, x_tx_time -0.377
- `rt-rt_2026_W47_fresh_82` stealth [origin-owner, rename, timebomb]: rules low, shown low, p=0.7237; sim done; top: r_ctl_owner +0.728, x_priv_unknown +0.719, x_tx_time -0.49, x_priv_xfer_free -0.488
- `rt-rt_2026_W47_fresh_94` stealth [rename, timebomb]: rules low, shown low, p=0.1511; sim done; top: x_priv_unknown +0.735, x_priv_xfer_free -0.5, m_sim_ok -0.489, x_tx_guard -0.399
- `rt-rt_2026_W47_fresh_110` stealth [origin-owner, rename, timebomb]: rules low, shown low, p=0.7442; sim done; top: x_priv_unknown +0.759, r_ctl_owner +0.758, x_tx_time -0.49, x_priv_xfer_free -0.484
