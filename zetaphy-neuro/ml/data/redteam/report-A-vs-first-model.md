# Neuro red-team report

Seed `rt-2026-W46`, model `nml-3ab3cd303911`. 160 scam variants built, compiled and read by Neuro (rules + buy/sell simulation on an in-memory EVM) and the model.
An **evasion** is a scam whose shown level stays below "medium".

| | caught by rules + simulation | caught with the model |
|---|---:|---:|
| all | 54% | 97% |
| family:blacklist-trap (24) | 50% | 100% |
| family:dormant-fee (16) | 25% | 100% |
| family:drain (19) | 16% | 100% |
| family:hidden-mint (11) | 9% | 100% |
| family:high-tax (18) | 100% | 100% |
| family:honeypot (18) | 100% | 100% |
| family:max-sell (20) | 100% | 100% |
| family:seize (18) | 33% | 94% |
| family:stealth (16) | 25% | 75% |
| mutation:block-ramp (5) | 0% | 40% |
| mutation:fake-renounce (37) | 46% | 100% |
| mutation:hashed-owner (27) | 56% | 96% |
| mutation:noise (61) | 59% | 95% |
| mutation:origin-owner (31) | 65% | 100% |
| mutation:proxy (31) | 100% | 100% |
| mutation:rename (129) | 52% | 98% |
| mutation:sim-aware (5) | 60% | 100% |
| mutation:split-guard (21) | 76% | 100% |
| mutation:timebomb (6) | 17% | 83% |
| mutation:xor-owner (34) | 59% | 97% |
| tell:coinbase (1) | 0% | 100% |
| tell:gasprice (1) | 100% | 100% |
| tell:iscontract (1) | 0% | 100% |
| tell:nobalance (1) | 100% | 100% |
| tell:share99 (1) | 100% | 100% |

## Evasions (5)

- `rt-rt_2026_W46_83` stealth [block-ramp, rename]: rules low, shown low, p=0.2464; sim done; top: x_priv_unknown +1.155, m_sim_ok -0.769, x_tx_guard +0.677, x_fee_owner_free -0.602
- `rt-rt_2026_W46_130` seize [hashed-owner, noise, rename]: rules low, shown low, p=0.012; sim done; top: x_priv_unknown -2.335, r_level -1.561, m_sim_ok -0.514, x_priv_xfer_free -0.491
- `rt-rt_2026_W46_156` stealth [noise, timebomb, xor-owner]: rules low, shown low, p=0.0307; sim done; top: x_priv_unknown -2.175, r_level -1.357, m_sim_ok -0.566, r_ctl_owner +0.518
- `rt-rt_2026_W46_26` stealth [block-ramp, rename]: rules low, shown low, p=0.4529; sim done; top: x_priv_unknown +1.223, m_sim_ok -0.673, x_tx_time -0.591, x_tx_guard +0.576
- `rt-rt_2026_W46_53` stealth [block-ramp, noise]: rules low, shown low, p=0.4726; sim done; top: x_priv_unknown +1.248, m_sim_ok -0.649, x_tx_guard +0.606, x_tx_time -0.516
