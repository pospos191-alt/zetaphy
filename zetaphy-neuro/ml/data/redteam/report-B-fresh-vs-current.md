# Neuro red-team report

Seed `rt-2026-W46-fresh`, model `nml-311685099571`. 160 scam variants built, compiled and read by Neuro (rules + buy/sell simulation on an in-memory EVM) and the model.
An **evasion** is a scam whose shown level stays below "medium".

| | caught by rules + simulation | caught with the model |
|---|---:|---:|
| all | 54% | 94% |
| family:blacklist-trap (21) | 19% | 95% |
| family:dormant-fee (20) | 45% | 100% |
| family:drain (14) | 50% | 100% |
| family:hidden-mint (19) | 37% | 100% |
| family:high-tax (15) | 100% | 100% |
| family:honeypot (13) | 100% | 100% |
| family:max-sell (21) | 100% | 100% |
| family:seize (15) | 13% | 100% |
| family:stealth (22) | 41% | 64% |
| mutation:block-ramp (9) | 44% | 56% |
| mutation:fake-renounce (35) | 51% | 97% |
| mutation:hashed-owner (39) | 62% | 95% |
| mutation:noise (75) | 47% | 93% |
| mutation:origin-owner (35) | 43% | 91% |
| mutation:proxy (38) | 100% | 100% |
| mutation:rename (132) | 51% | 95% |
| mutation:sim-aware (7) | 71% | 71% |
| mutation:split-guard (17) | 88% | 88% |
| mutation:timebomb (6) | 0% | 67% |
| mutation:xor-owner (23) | 48% | 96% |
| tell:coinbase (1) | 0% | 0% |
| tell:gasprice (4) | 100% | 100% |
| tell:iscontract (1) | 0% | 0% |
| tell:nobalance (1) | 100% | 100% |

## Evasions (9)

- `rt-rt_2026_W46_fresh_11` stealth [sim-aware, tell=coinbase]: rules low, shown low, p=0.1247; sim done; top: x_priv_unknown +0.751, x_tx_guard -0.716, m_sim_ok -0.513, x_priv_xfer_free -0.488
- `rt-rt_2026_W46_fresh_108` stealth [block-ramp, fake-renounce, rename]: rules info, shown info, p=0.0637; sim done; top: x_priv_unknown -1.056, r_ctl_renounced -0.908, r_level -0.757, x_owner_const +0.643
- `rt-rt_2026_W46_fresh_89` blacklist-trap [hashed-owner, noise, rename]: rules low, shown low, p=0.7779; sim done; top: x_priv_unknown +0.789, x_priv_xfer_free -0.464, m_sim_ok -0.392, g3_26 +0.261
- `rt-rt_2026_W46_fresh_94` stealth [noise, rename, timebomb, xor-owner]: rules low, shown low, p=0.3461; sim done; top: x_priv_unknown +0.718, x_priv_xfer_free -0.456, m_sim_ok -0.436, o_rate_xor +0.436
- `rt-rt_2026_W46_fresh_109` stealth [block-ramp, origin-owner, rename]: rules low, shown low, p=0.681; sim done; top: x_priv_unknown +0.788, x_priv_xfer_free -0.424, m_sim_ok -0.392, g3_00 -0.381
- `rt-rt_2026_W46_fresh_135` stealth [noise, rename, split-guard, timebomb]: rules low, shown low, p=0.2352; sim done; top: x_priv_unknown +0.79, x_tx_guard -0.596, m_sim_ok -0.52, x_priv_xfer_free -0.476
- `rt-rt_2026_W46_fresh_142` stealth [block-ramp, origin-owner, rename]: rules low, shown low, p=0.6109; sim done; top: x_priv_unknown +0.764, x_priv_xfer_free -0.488, m_sim_ok -0.392, x_fee_owner_free -0.242
- `rt-rt_2026_W46_fresh_144` stealth [block-ramp, noise, origin-owner]: rules low, shown low, p=0.7364; sim done; top: x_priv_unknown +0.729, x_priv_xfer_free -0.457, m_sim_ok -0.392, g3_21 +0.349
- `rt-rt_2026_W46_fresh_156` stealth [hashed-owner, noise, rename, sim-aware, split-guard, tell=iscontract]: rules low, shown low, p=0.6261; sim done; top: x_priv_unknown +0.774, m_sim_ok -0.479, x_priv_xfer_free -0.452, x_tx_guard -0.363
