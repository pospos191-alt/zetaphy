[English](README.md) | **ภาษาไทย**

# ZETAPHY mainnet `zetaphy_3659-1`: genesis ที่เผยแพร่

| | |
|---|---|
| Chain id | `zetaphy_3659-1` |
| EVM chain id | `3659` (`0xe4b`) |
| เหรียญ | ZTPHY (`azetaphy`, ทศนิยม 18 หลัก) จำนวนทั้งหมด 1,000,000,000 ไม่มีการผลิตเพิ่ม |
| ค่า gas ขั้นต่ำ | 1 gwei (`1000000000azetaphy`) |
| เวลาเริ่มเชน | `2026-11-13T14:00:00Z` (21:00 น. เวลาไทย) |
| **Genesis sha256** | **`ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`** |
| Release | `zetaphyd-a5698832d273` (commit `dc0d0bbbaa827c0b5049603ab3fec8a56c8c7f44`) เซ็นด้วย Sigstore |
| Validator ตอนเริ่ม | 1 ตัว (`zetaphyvaloper1l9fxu7xn7yrug9rlsve9hs4mgtpn9zej9tqvx8`, node id `9d71e8582823a74d2cfbf51b1c6ef4af50e94e5c`) |

**อ่านประกาศก่อน: [docs/ZETAPHY-MAINNET-NOTICE.th.md](../../../docs/ZETAPHY-MAINNET-NOTICE.th.md)**

## ไฟล์

| ไฟล์ | คืออะไร |
|---|---|
| `genesis.json` | genesis ที่ทุก node ของเชนนี้ต้องใช้ |
| `genesis.sha256` | sha256 ของไฟล์ด้านบน |
| `chain.json` | chain id, sha256, เหรียญ และค่า gas ขั้นต่ำ |
| `mainnet.env` | ค่าที่ใช้สร้าง genesis (address, จำนวนเหรียญ, พารามิเตอร์) |
| `circuit-authority.pubkey.json` | public key ของ multisig circuit-breaker (2 จาก 3) |
| `gentx.json` | ธุรกรรม genesis ของ validator (stake 500,000 ZTPHY) |

ทุกไฟล์เปิดเผยได้ มีแค่ address และ public key

## การแบ่งเหรียญ

| บัญชี | Address | ZTPHY |
|---|---|---|
| รางวัล (multisig 2 จาก 3) | `0x3B87f248a644aA66Bf35a33c26AbefF3326b3dD7` | 500,000,000 |
| Airdrop ผู้ถือ SWD (multisig 2 จาก 3) | `0xaE842c15Ad4A6D6027597C3c3d44A4ada8FB0318` | 200,000,000 |
| ชุมชน (multisig 2 จาก 3) | `0x53E762B680b28a378cE33eafc6b6384D9DF4B989` | 150,000,000 |
| สภาพคล่องและพาร์ตเนอร์ (multisig 2 จาก 3) | `0x859872fBaB7ad2C0663DC0253E61Cea628cA15d1` | 98,999,000 |
| ผู้ดูแล validator | `0xF9526e78d3f107c4147f83325Bc2bb42c3328B32` | 1,000,000 |
| ผู้มีสิทธิ์สั่ง circuit-breaker (multisig 2 จาก 3) | `0x8D0496dcD685ffc5a5e8Ed86f4648206783E8713` | 1,000 |
| ทีม (multisig 2 จาก 3; ล็อก 1 ปี แล้วทยอยปลดจนครบปีที่ 4) | `0x58B726B2A5404b0374842fE15149294D139D62A8` | 50,000,000 |

## ตรวจด้วยตัวเอง

```bash
sha256sum -c genesis.sha256                                            # genesis.json: OK
ZETAPHYD=<zetaphyd ที่ตรวจด้วย verify-release.sh แล้ว> bash ../make-genesis.sh verify mainnet.env genesis.json
#   ต้องได้สรุปค่า และ: OK  sha256 ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667
```

`verify` สร้างทุกค่าใหม่จาก `mainnet.env` แล้วปฏิเสธถ้ามีจุดไหนต่างกัน ทั้งการแบ่งเหรียญ, vesting, ผู้มีสิทธิ์สั่ง
circuit-breaker, พารามิเตอร์ governance และ staking รวมถึงการที่ chain guard, shield และรัฐธรรมนูญทำงานตั้งแต่บล็อกแรก

## รัน node ของเชนนี้

| | |
|---|---|
| RPC สาธารณะ (EVM JSON-RPC) | `https://129-221-199-191.sslip.io` |
| CometBFT RPC / REST | `https://129-221-199-191.sslip.io/rpc` · `https://129-221-199-191.sslip.io/rest` |
| peer สาธารณะ (sentry) | `ebaab2a38813814916e165d4ad2c3517c6c483d8@129.221.199.191:26656` |

node ต้องติดตั้งจาก release ที่เซ็นแล้ว และล็อก genesis นี้ (ขั้น 11 ของ [ขั้นตอน](../../../docs/ZETAPHY-MAINNET-PROCEDURE.th.md)):

```bash
sudo GENESIS_FILE=$PWD/genesis.json GENESIS_SHA256=ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667 \
  GENESIS_EVM_CHAIN_ID=3659 ZETAPHYD_BIN=<zetaphyd ที่ตรวจแล้ว> PEERS=ebaab2a38813814916e165d4ad2c3517c6c483d8@129.221.199.191:26656 bash setup-node.sh
```
