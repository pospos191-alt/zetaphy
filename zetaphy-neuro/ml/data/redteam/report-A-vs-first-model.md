# Neuro red-team report

Seed `rt-2026-W48`, model `nml-3ab3cd303911`. 160 scam variants built, compiled and read by Neuro (rules + buy/sell simulation on an in-memory EVM) and the model.
An **evasion** is a scam whose shown level stays below "medium".

| | caught by rules + simulation | caught with the model |
|---|---:|---:|
| all | 52% | 98% |
| family:blacklist-trap (17) | 29% | 100% |
| family:dormant-fee (21) | 33% | 100% |
| family:drain (17) | 18% | 100% |
| family:hidden-mint (15) | 27% | 100% |
| family:high-tax (21) | 100% | 100% |
| family:honeypot (18) | 100% | 100% |
| family:max-sell (18) | 100% | 100% |
| family:seize (20) | 15% | 100% |
| family:stealth (13) | 31% | 77% |
| mutation:block-ramp (4) | 0% | 50% |
| mutation:fake-renounce (26) | 35% | 100% |
| mutation:hashed-owner (33) | 58% | 100% |
| mutation:noise (62) | 52% | 98% |
| mutation:origin-owner (31) | 48% | 100% |
| mutation:proxy (24) | 100% | 100% |
| mutation:rename (134) | 49% | 98% |
| mutation:sim-aware (7) | 57% | 100% |
| mutation:split-guard (17) | 82% | 94% |
| mutation:timebomb (2) | 0% | 50% |
| mutation:xor-owner (29) | 52% | 97% |
| tell:coinbase (2) | 50% | 100% |
| tell:gasleft (1) | 100% | 100% |
| tell:gasprice (2) | 100% | 100% |
| tell:iscontract (2) | 0% | 100% |

## Evasions (3)

- `rt-rt_2026_W48_1` stealth [block-ramp, noise, rename]: rules low, shown low, p=0.2578; sim done; top: x_priv_unknown +1.155, m_sim_ok -0.769, x_tx_guard +0.677, x_fee_owner_free -0.602
- `rt-rt_2026_W48_65` stealth [rename, split-guard, timebomb, xor-owner]: rules low, shown low, p=0.7897; sim done; top: x_priv_unknown +1.406, x_tx_guard -0.742, m_sim_ok -0.655, x_tx_branches +0.652
- `rt-rt_2026_W48_134` stealth [block-ramp, rename]: rules low, shown low, p=0.4542; sim done; top: x_priv_unknown +1.21, m_sim_ok -0.678, x_tx_time -0.591, x_tx_guard +0.576
