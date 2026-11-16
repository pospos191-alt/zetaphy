# Neuro red-team report

Seed `rt-2026-W47`, model `nml-3ab3cd303911`. 160 scam variants built, compiled and read by Neuro (rules + buy/sell simulation on an in-memory EVM) and the model.
An **evasion** is a scam whose shown level stays below "medium".

| | caught by rules + simulation | caught with the model |
|---|---:|---:|
| all | 50% | 96% |
| family:blacklist-trap (20) | 30% | 100% |
| family:dormant-fee (21) | 19% | 100% |
| family:drain (15) | 20% | 100% |
| family:hidden-mint (20) | 45% | 100% |
| family:high-tax (19) | 100% | 100% |
| family:honeypot (15) | 100% | 100% |
| family:max-sell (13) | 100% | 100% |
| family:seize (16) | 19% | 100% |
| family:stealth (21) | 38% | 67% |
| mutation:block-ramp (10) | 20% | 40% |
| mutation:fake-renounce (23) | 43% | 100% |
| mutation:hashed-owner (25) | 56% | 100% |
| mutation:noise (69) | 51% | 100% |
| mutation:origin-owner (35) | 60% | 91% |
| mutation:proxy (28) | 100% | 100% |
| mutation:rename (122) | 43% | 94% |
| mutation:sim-aware (9) | 56% | 89% |
| mutation:split-guard (17) | 88% | 94% |
| mutation:timebomb (2) | 50% | 100% |
| mutation:xor-owner (40) | 43% | 98% |
| tell:coinbase (3) | 0% | 67% |
| tell:gasleft (3) | 100% | 100% |
| tell:gasprice (2) | 100% | 100% |
| tell:iscontract (1) | 0% | 100% |

## Evasions (7)

- `rt-rt_2026_W47_114` stealth [block-ramp, rename]: rules low, shown low, p=0.2578; sim done; top: x_priv_unknown +1.155, m_sim_ok -0.769, x_tx_guard +0.677, x_fee_owner_free -0.602
- `rt-rt_2026_W47_146` stealth [block-ramp, rename]: rules low, shown low, p=0.6938; sim done; top: x_priv_unknown +1.305, x_tx_branches -0.728, m_sim_ok -0.659, x_tx_guard +0.637
- `rt-rt_2026_W47_9` stealth [block-ramp, rename, xor-owner]: rules low, shown low, p=0.4452; sim done; top: x_priv_unknown +1.224, m_sim_ok -0.66, x_tx_guard +0.576, x_fee_owner_free -0.554
- `rt-rt_2026_W47_48` stealth [origin-owner, rename, sim-aware, split-guard, tell=coinbase]: rules low, shown low, p=0.7752; sim done; top: x_priv_unknown +1.387, x_tx_guard -0.742, m_sim_ok -0.654, x_tx_branches +0.639
- `rt-rt_2026_W47_82` stealth [block-ramp, origin-owner, rename]: rules low, shown low, p=0.4306; sim done; top: x_priv_unknown +1.224, m_sim_ok -0.651, x_tx_guard +0.576, x_fee_owner_free -0.543
- `rt-rt_2026_W47_99` stealth [block-ramp, origin-owner, rename]: rules low, shown low, p=0.4457; sim done; top: x_priv_unknown +1.216, m_sim_ok -0.657, x_tx_guard +0.576, x_fee_owner_free -0.539
- `rt-rt_2026_W47_125` stealth [block-ramp, rename]: rules low, shown low, p=0.4574; sim done; top: x_priv_unknown +1.223, m_sim_ok -0.673, x_tx_time -0.591, x_tx_guard +0.576
