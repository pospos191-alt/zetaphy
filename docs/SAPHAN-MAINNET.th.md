[English](SAPHAN-MAINNET.md) | **ภาษาไทย**

# Saphan mainnet: ZTPHY ระหว่าง ZETAPHY กับ Base

การตัดสินใจของเจ้าของ 2026-11-14: เปิดสะพาน Saphan ระหว่าง ZETAPHY mainnet (`zetaphy_3659-1`, EVM chain 3659) กับ
Base mainnet (8453) เพื่อให้ซื้อขาย ZTPHY กับ USDC (และ USDT) บน Base ได้ การตัดสินใจของเจ้าของ 2026-11-16: เพิ่ม BNB Smart Chain (56)
และ Arbitrum One (42161) แต่ละเชนเป็น route ของตัวเอง (ดู "ปลายทางเพิ่ม" ด้านล่าง; เตรียม Polygon PoS ไว้แต่ปิดอยู่) testnet ปิดแล้ว ชุดเครื่องมือนี้สำหรับ mainnet
ทุกอย่าง**เจ้าของรันเองจากเครื่องของตัวเอง**: ไม่มี workflow ใดถือกุญแจ mainnet และไม่มีอะไรใน repository นี้ส่งธุรกรรม
mainnet เองได้

ทุกคำสั่งด้านล่างมีป้ายหนึ่งป้าย:

| ป้าย | ความหมาย |
|---|---|
| **[อ่าน]** | อ่านอย่างเดียว ไม่เปลี่ยนอะไรเลย |
| **[เปลี่ยนไฟล์]** | เขียนไฟล์บนเครื่องของคุณ (commit ใน pull request เมื่อคู่มือบอก) |
| **[เปลี่ยนเชน]** | ส่งธุรกรรมไปเชนจริง (เสียค่า gas ย้อนกลับไม่ได้) |
| **[เปลี่ยนการตั้งค่า]** | เปลี่ยนการตั้งค่าของเครื่อง (service, กุญแจ, แพ็กเกจ) |

## อ่านก่อน: ความเสี่ยงตรง ๆ

- **ZETAPHY mainnet มี validator เพียงตัวเดียว** ถ้ามันหยุด สะพานก็หยุด (ไม่มีอะไรหาย ทุกอย่างรอ) ถ้ามันถูกยึด
  ผู้ยึดเขียน ZETAPHY ใหม่ได้ และสะพานเชื่อ ZETAPHY
- **validator ชุดเล็กของเราเองเป็นผู้ลงนามให้สะพาน** การ mint ZETAPHY -> Base จะถูกเชื่อเมื่อ validator Hyperlane
  ของเราลงนาม (`validators.zetaphyOrigin`) การปล่อยคืน Base -> ZETAPHY เมื่อ validator ฝั่ง Base ของเราลงนาม (หรือชุด 3 ใน
  5 ที่ Hyperlane เผยแพร่สำหรับ Base ถ้าตั้ง `validators.baseOrigin.mode = "hyperlane"`) ไม่ใช่เครือข่ายของ Hyperlane
  มาคุ้มครองเรา แต่คือเราเอง ชุด 1 ใน 1 (กุญแจเดียวบนเครื่องเดียว) จะถูกปฏิเสธ เว้นแต่ตั้ง `validators.allowSingleValidator`
  เป็น `true` และเมื่อนั้นทุกแผนจะพิมพ์ว่า *กุญแจเดียวลงนามข้อความเท็จได้*
- **สัญญาของสะพานยังไม่ผ่านการตรวจสอบ (audit)** (`ZetaphyTokenVault`, `SaphanSyntheticToken` ใน
  `zetaphy-network/contracts/SaphanTokens.sol` ทดสอบแล้วแต่ไม่เคย audit) **ผู้ใช้ควรข้ามสะพานเฉพาะจำนวนที่เสียได้**
  บอกข้อนี้ทุกที่ที่เสนอสะพาน
- **อะไรจำกัดความเสียหาย** (`saphan-mainnet.json` -> `token.limits`): ล็อกได้ไม่เกิน **2,500,000 ZTPHY** ตลอดกาล
  (0.25% ของ supply; config ไม่ยอมเกิน 1%) บน Base มีได้ไม่เกิน 2,500,000; mint บน Base ไม่เกิน 2,000,000 ต่อวัน แต่ละครั้งรอ
  **1 ชม.**; ปล่อยคืนไม่เกิน **250,000** ต่อวัน แต่ละครั้งรอ **6 ชม.** ระหว่างรอ guardian **veto** รายการนั้นหรือ **pause**
  ฝั่งหนึ่งได้ทันที การเพิ่มขีดจำกัดใด ๆ ต้องผ่าน timelock 48 ชม.
- **pool แรกบางมาก**: 100 USDC ต่อ 1,000,000 ZTPHY ซื้อ $10 ราคาขยับราว **+21%** ซื้อ $50 ราว **+124%**
  (`saphan-pool.js plan` พิมพ์ให้ทุก pool)
- **อย่าส่งกลับเกินขีดปล่อยคืนหนึ่งวันในครั้งเดียว** (250,000 ZTPHY): รายการเดียวที่เกินขีดรายวันจะรอจนกว่า governance
  เพิ่มขีด (48 ชม.)

## สิ่งที่ถูก deploy

```
 ZETAPHY mainnet (3659)                                         Base mainnet (8453)
 ───────────────────────────────────────                       ─────────────────────────────────────────────
 Hyperlane core (ใหม่, ของเรา): Mailbox, merkle tree hook,        Hyperlane core (มีอยู่แล้ว ของ Hyperlane ไม่ deploy ใหม่)
   ISM factories, ValidatorAnnounce, ProxyAdmin                   Mailbox 0xeA87…4f1D, merkle tree hook 0x19dc…0117,
   เจ้าของทุกตัว = timelock ของ ZETAPHY                             ISM factory 0x8F74…110A, ValidatorAnnounce 0x182E…5a7B
 ZetaphyTokenVault (ZTPHY native)    ── lock ──────────────▶   SaphanSyntheticToken "ZTPHY" (mint 1:1 หลัง 1 ชม.)
   ISM: validator ฝั่ง Base                                         ISM: validator ของเรา (origin ZETAPHY)
   ปล่อยคืนหลัง 6 ชม., ≤ 250,000/วัน ◀──────────── sendBack ──    burn
 governance: timelock ZETAPHY 0x9fC2…f9cA (48 ชม.; โหวต gov)     governance: ZetaphyTimelock ใหม่บน Base (48 ชม.)
 guardian:   guardian multisig 0x54EF…4519 (2 ใน 3)               guardian/proposer: SimpleMultisig ใหม่บน Base (2 ใน 3)
 deploy แบบปิด (paused); การเปิด = timelock ทั้งสองฝั่ง               deploy แบบปิด (paused)
```

ไม่ใช้ interchain gas paymaster: relayer ของเราส่งเฉพาะข้อความของ vault และ synthetic (whitelist) และเจ้าของเติมเงินให้เอง
กุญแจ deployer ไม่เหลือสิทธิ์ใดเลย (`verify` ตรวจ)

ไฟล์: `zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json` (config), `registry/chains/zetaphy/metadata.yaml`
(ZETAPHY สำหรับ Hyperlane CLI), `setup-agents-mainnet.sh` (agents) โค้ด: `zetaphy-network/src/saphanmainnet.js`,
`src/saphanpool.js`, `scripts/saphan-mainnet.js` (เครื่องมือของเจ้าของ), `scripts/saphan-pool.js` (pool),
`scripts/saphan-mainnet-dryrun.js` (dry run บนเครื่อง) การ deploy ใช้โค้ด route ของ testnet (`scripts/saphan.js`
`originPrepare`, `tokenVault`, `tokenSynthetic`) โดยไม่แก้

## ข้อมูลที่เจ้าของต้องให้ (สิ่งที่เจ้าของเท่านั้นตัดสินใจได้)

| ข้อมูล | อยู่ที่ | สถานะ |
|---|---|---|
| **กุญแจ deployer ใหม่** (address เดียวกันทั้งสองเชน) และ address ของมัน | `deployer.address` | ยังขาด |
| address ของ validator ของเรา (origin ZETAPHY จากเครื่อง agents) + threshold | `validators.zetaphyOrigin` | ยังขาด |
| validator ฝั่ง Base: ของเรา (`mode: "ours"` ต้องรัน validator ตัวที่สอง) หรือ 3 ใน 5 ของ Hyperlane (`mode: "hyperlane"`) | `validators.baseOrigin` | ยังขาด (ต้องเลือก) |
| **Safe บน Base** ที่รับ ZTPHY ที่ข้ามมาและเป็นเจ้าของ pool (2 ใน 3 สร้างที่ app.safe.global) | `liquidity.baseRecipient` | ยังขาด |
| **โทเคน USDT บน Base** (ตรวจที่ basescan.org ดูด้านล่าง) | `liquidity.pools[1].address` | ยังขาด |
| เจ้าของ multisig บน Base (ค่าเริ่มต้น: เจ้าของ guardian ของ ZETAPHY) | `base.owners` | ยืนยัน |
| จำนวนใน pool (ตัดสินเมื่อ 2026-11-16: เริ่ม pool เดียว 500,000 ZTPHY + 50 USDC, 0.0001 USD ต่อ ZTPHY; pool USDT ทีหลังเมื่อเลือกสัญญาแล้ว) | `liquidity.pools` | ตั้งแล้ว |
| ETH บน Base: deployer ~0.0035, relayer ~0.002 (เงินสำรอง), Safe ~0.001; ใส่ 50 USDC เข้า Safe | — | ต้องซื้อ/ส่ง |
| ZTPHY: 1 ให้ deployer, 0.1 ให้แต่ละ validator, 1 ให้ relayer (ฝั่ง ZETAPHY), 10,000 เป็นมัดจำ gov proposal แต่ละอัน | — | ต้องส่ง |

**USDC บน Base** คือ `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Circle): address ที่ repository ตรวจไว้แล้ว
(`zetaphy-neuro/src/known-tokens.js`) ตรงกับ token list ของ Uniswap และ Superchain ส่วน address ในคำสั่งงาน
`0x833589fCD6eDb6E08f4c7C32D29b5Dd5Ac9F4f8E` **ไม่ใช่** USDC (ต้นเหมือน ท้ายต่าง) config จะปฏิเสธ

**USDT บน Base** ตรวจจาก repository นี้ไม่ได้: ไม่มีรายชื่อเชนที่ Tether ออกเหรียญเองอยู่ใน repository และ
`known-tokens.js` ตั้งใจไม่ใส่ USDT บน Base token list ของ Superchain มีโทเคนชื่อ "Tether USD" บน Base ซึ่งเป็นโทเคนที่ถูก
bridge มา ไม่ใช่ที่ Tether ออกเองบนนั้น ตัดสินใจว่าหมายถึงโทเคนไหน ตรวจที่ basescan.org (สัญญา, ชื่อ, decimals 6, ใคร mint /
freeze / upgrade ได้) แล้วใส่ address ใน config ก่อนหน้านั้น pool USDT จะไม่ถูกสร้าง

**Uniswap v3 บน Base**: factory `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`, position manager
`0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` (Uniswap `sdk-core` commit ที่ปักไว้ใน config) dry run ใน CI fork Base แล้ว
ตรวจว่า `factory()` ของ position manager คือ factory นี้ คำสั่ง `check` ตรวจแบบเดียวกันบนเชนจริง

## ค่าใช้จ่าย

`node zetaphy-network/scripts/saphan-mainnet.js costs --base-gwei <gwei>` **[อ่าน]** พิมพ์ประมาณการแยกรายการ
(ZETAPHY ที่ราคาขั้นต่ำ 1 gwei, Base ที่ gwei ที่ให้, เงินสำรองของ relayer) ที่ 0.02 gwei บน Base และ $3,000/ETH:

| อะไร | เชน | Gas | ค่าใช้จ่าย |
|---|---|---:|---:|
| Hyperlane core (Mailbox, hook, ISM factories, ValidatorAnnounce, ProxyAdmin, ICA router) | ZETAPHY | ~35,000,000 | ~0.035 ZTPHY |
| ส่งมอบ core, ISM ของ vault + `ZetaphyTokenVault` | ZETAPHY | ~3,300,000 | ~0.003 ZTPHY |
| validator announce (ครั้งเดียวต่อตัว) | ZETAPHY / Base | ~130,000 | ~0.0001 ZTPHY / ~0.000003 ETH |
| SimpleMultisig + ZetaphyTimelock + ISM ของเรา + `SaphanSyntheticToken` | Base | ~7,250,000 | ~0.00015 ETH + ค่า L1 data |
| การเปิดฝั่ง Base (propose/confirm/execute สองรอบ) | Base | ~1,000,000 | ~0.00002 ETH |
| relayer: ส่ง 200 ครั้ง ZETAPHY -> Base (เงินสำรอง) | Base | ~80,000,000 | ~0.0016 ETH (~$4.80) |
| relayer: ส่ง 200 ครั้ง Base -> ZETAPHY | ZETAPHY | ~80,000,000 | ~0.08 ZTPHY |
| Safe + 2 pool (approve, สร้าง + กำหนดราคา, mint) | Base | ~12,000,000 | ~0.00025 ETH |
| **รวม** | | | **~0.12 ZTPHY บน ZETAPHY; ~0.004 ETH (~$12) บน Base รวมค่า L1 data และเงินสำรอง** |
| มัดจำ gov proposal (การเปิด) | ZETAPHY | | 10,000 ZTPHY ได้คืนเมื่อผ่าน (ถูกเผาถ้าโดน veto) |

dry run บนเครื่องวัดได้: deployer บน Base 5.9 M gas (ประมาณ 7.25 M), บน ZETAPHY 2.55 M (ประมาณ 3.27 M ไม่รวม core),
สอง pool 10.6 M (ประมาณ 11.8 M), Hyperlane core บน ZETAPHY ราว 33 M ราคา gas ของ Base ขยับได้: ดู
basescan.org/gastracker แล้วรัน `costs` ใหม่ก่อนเติมเงิน

## อะไรรันที่ไหน

| เครื่อง | รัน | RAM |
|---|---|---|
| คอมพิวเตอร์ของเจ้าของ | `saphan-mainnet.js` (plan, check, deploy, verify, open-proposals), `saphan-pool.js`, Hyperlane CLI ครั้งเดียว (core) | เท่าไรก็ได้; Node.js 20+ |
| Oracle Always Free VM หนึ่งเครื่อง | `setup-agents-mainnet.sh`: validator ZETAPHY ของเรา, validator Base ของเรา (ถ้าเลือก), relayer (Docker, systemd) | ดูด้านล่าง |
| node validator ของ ZETAPHY (M-VAL) | ไม่มีอะไรใหม่ (ยื่น gov proposal ด้วย `gov.sh` แบบ proposal อื่น) | — |

**E2.1.Micro ฟรี (RAM 1 GB) พอไหม? ไม่พออย่างไว้ใจได้สำหรับทั้งสามตัว** validator ZETAPHY พอ (จำกัด 220 MB);
relayer (จำกัด 480 MB) รวมกับ Docker และ OS บน 1 GB ต้องพึ่ง swap 2 GB ที่สคริปต์สร้าง และ kernel อาจรีสตาร์ตมันเมื่อ
หน่วยความจำตึง (มันทำต่อจากฐานข้อมูล การส่งรอ ไม่มีอะไรหาย) validator ฝั่ง Base ของเราเอง (`mode: "ours"`) ต้องอ่าน merkle
tree ของ Hyperlane บน Base ทั้งหมดตั้งแต่ 2023 ผ่าน RPC สาธารณะก่อน ซึ่งหนักสำหรับ 1 GB และช้า **แนะนำ: Oracle Always Free
Ampere A1 (arm64, สูงสุด 4 OCPU / 24 GB ฟรีเช่นกัน)** รันทั้งสามตัวได้สบาย (ตั้ง `MEM_RELAYER=1500 MEM_VALIDATOR=600`)
image ของ agent รองรับหลายสถาปัตยกรรม

**ที่เก็บ checkpoint (ฟรี):** ดิสก์ในเครื่อง validator เขียน `/var/lib/hyperlane-mainnet/checkpoints/<origin>` และ relayer
บนเครื่องเดียวกันอ่าน ไม่ต้องจ่าย agent ของ Hyperlane อ่าน checkpoint ได้จากดิสก์ในเครื่อง, S3 หรือ GCS เท่านั้น (ไม่ใช่ HTTP
ธรรมดา) relayer จึงต้องอยู่เครื่องเดียวกับ validator `publish-checkpoints` เปิดสำเนาอ่านอย่างเดียวสาธารณะผ่าน HTTPS ด้วย
Caddy ได้ (ฟรี ไว้ให้ตรวจสิ่งที่เราลงนาม)

## Deploy บน mainnet แล้ว (2026-11-16)

บันทึกไว้ใน `zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json` และ `registry/chains/zetaphy/addresses.yaml`
(เครื่องมืออ่านทั้งสองไฟล์ ขั้นที่ทำแล้วจะถูกข้าม) ทุกอย่างข้างล่าง**ยังปิดอยู่** ยังข้ามเชนไม่ได้จนกว่าข้อเสนอ gov ของ BSC
และ multisig ของ BSC จะเปิด

| อะไร | เชน | ที่อยู่ |
|---|---|---|
| Hyperlane Mailbox (core ใช้ร่วมทุกเส้นทาง) | ZETAPHY | `0x9FC59F469454FD27813Da94DF5803D603340E91c` |
| เจ้าของ core: mailbox, proxyAdmin, defaultIsm, requiredHook, ICA router | ZETAPHY | ทั้งหมดคือ timelock `0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA` (อ่านกลับแล้ว) |
| multisig ของ BSC (2 ใน 3, เจ้าของชุดเดียวกับ guardian) | BSC | `0x54EF410b2C7cbec6238fA6d6D9DbAaEABa0F4519` |
| timelock ของ BSC | BSC | `0x7841608c96da5D35cbedFa13139A9f9952fc7695` |
| ISM ของเราบน BSC (1 ใน 1, `0xF134…F6Ea`) | BSC | `0xcAF6e250b5eAd400097004055628B5DC9D6197FF` |
| ZTPHY บน BSC (synthetic) | BSC | `0x68aa0f0144605024eCe1aDccFCC1626352779569` |
| vault ของ BSC | ZETAPHY | `0xFA8F7a89A1f870bDFC03740FbF687e931B0b384A` |

multisig ของ BSC มีที่อยู่เดียวกับ multisig guardian บน ZETAPHY เพราะทั้งคู่เป็นสัญญาตัวแรกของ deployer (nonce 0)
บนเชนของตัวเอง เจ้าของ 3 คนและเกณฑ์เดียวกัน `verify --route bsc`: อ่านกลับผ่านทุกข้อ
Base และ Arbitrum One ยังไม่ได้ deploy ขั้นถัดไปของ BSC: agent (ขั้น 8), การเปิด (ขั้น 9), pool (ขั้น 10)

## คู่มือ

รันคำสั่งของ repository จาก `zetaphy-network/` (`npm ci` ครั้งเดียว) `KEYFILE` คือไฟล์กุญแจของ deployer อ่านเฉพาะขั้น
`--send yes` และไม่เคยพิมพ์ ขั้นใดรันซ้ำได้: ขั้นที่ทำแล้วจะถูกข้าม (ไฟล์สถานะ
`zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json` จำไว้)

### 0. ดูแผน

```bash
node scripts/saphan-mainnet.js plan            # [อ่าน] ความเสี่ยง, ปัญหาของ config, ข้อมูลที่ยังขาด, ขั้นตอน, ค่าใช้จ่าย
node scripts/saphan-pool.js plan               # [อ่าน] pool: ราคา, ความบาง, สิ่งที่จะลงนาม
```

### 1. เครื่อง agents (เอา address ของ validator ก่อน)

บน Oracle VM โดยคัดลอก `zetaphy-chain/hyperlane/mainnet/setup-agents-mainnet.sh` ไปไว้:

```bash
sudo bash setup-agents-mainnet.sh install                     # [เปลี่ยนการตั้งค่า] Docker, image, swap, กุญแจสร้างบนเครื่องนี้; พิมพ์แค่ address
sudo VALIDATE_BASE=yes bash setup-agents-mainnet.sh install   # [เปลี่ยนการตั้งค่า] ใช้แทน ถ้า baseOrigin.mode = "ours"
sudo bash setup-agents-mainnet.sh addresses                   # [อ่าน] address อีกครั้ง
```

ใส่ address ของ validator ที่พิมพ์ออกมาใน `saphan-mainnet.json` (`validators.zetaphyOrigin.validators` และ
`validators.baseOrigin.validators` หรือ `mode: "hyperlane"`) ตั้ง threshold **[เปลี่ยนไฟล์]** แล้วเปิด pull request
validator สองตัวบนสองเครื่องที่ threshold 2 ปลอดภัยกว่าตัวเดียวมาก; 1 ใน 1 ต้องตั้ง `allowSingleValidator: true`

### 2. กุญแจ deployer และข้อมูลที่เหลือ

สร้างกุญแจใหม่บนคอมพิวเตอร์ของคุณ (เช่น `cast wallet new` แล้วเก็บใน keystore) ใส่เฉพาะ address ใน `deployer.address`
**[เปลี่ยนไฟล์]** เติมเงิน: 1 ZTPHY บน ZETAPHY (จาก liquidity multisig ตาม docs/ZETAPHY-MAINNET-PROCEDURE.th.md 16.4) และ ETH
ตามที่ `costs` แนะนำบน Base **[เปลี่ยนเชน]** สร้าง Safe บน Base (app.safe.global กุญแจของสมาชิก liquidity, 2 ใน 3)
**[เปลี่ยนเชน]** แล้วใส่ใน `liquidity.baseRecipient` ใส่ address ของ USDT หลังตรวจแล้ว `plan` ต้องไม่เหลือข้อมูลที่ขาด
นอกจากที่ตั้งใจเว้นไว้ทีหลัง

**อย่าใช้กุญแจ deployer บน Base ทำอย่างอื่นจนกว่าขั้น 5 จะเสร็จ**: address ของ synthetic ถูกกำหนดจาก nonce ของ deployer บน
Base ในขั้น base-roles ธุรกรรมแทรกเพียงครั้งเดียวทำให้มันเลื่อน และขั้นถัดไปจะปฏิเสธ ("nonce moved")

### 3. ตรวจทั้งสองเชน

```bash
node scripts/saphan-mainnet.js check           # [อ่าน] chain id, core บน Base, delay ของ timelock + gov module เป็น proposer,
                                               #        guardian 2 ใน 3, ThreatRegistry, native ERC-20, USDC, Uniswap, Safe, deployer
```

### 4. Hyperlane core บน ZETAPHY (ไม่ทำบน Base)

```bash
npm i -g @hyperlane-xyz/cli@45.0.1                                   # [เปลี่ยนการตั้งค่า] CLI รุ่นที่ปักไว้
node scripts/saphan-mainnet.js core-config                            # [เปลี่ยนไฟล์] mainnet/core-config.yaml: เจ้าของทุกตัวคือ timelock
node scripts/saphan-mainnet.js core                                   # [อ่าน] พิมพ์คำสั่ง CLI ที่จะรัน
KEYFILE=~/zetaphy-bridge/deployer.key node scripts/saphan-mainnet.js core --send yes          # [เปลี่ยนเชน] deploy; เขียน registry/chains/zetaphy/addresses.yaml
KEYFILE=~/zetaphy-bridge/deployer.key node scripts/saphan-mainnet.js core-handover --send yes # [เปลี่ยนเชน] ICA router -> timelock; ตรวจเจ้าของทุกตัว
```

commit `registry/chains/zetaphy/addresses.yaml` และ `core-config.yaml` ใน pull request **[เปลี่ยนไฟล์]**

### 5. route (deploy แบบปิด)

```bash
node scripts/saphan-mainnet.js deploy --step base-roles                                   # [อ่าน] จะ deploy อะไร
KEYFILE=… node scripts/saphan-mainnet.js deploy --step base-roles --send yes              # [เปลี่ยนเชน] Base: multisig, timelock, ISM ของเรา
KEYFILE=… node scripts/saphan-mainnet.js deploy --step zetaphy-vault --send yes           # [เปลี่ยนเชน] ZETAPHY: ISM + vault (ปิด)
KEYFILE=… node scripts/saphan-mainnet.js deploy --step base-synthetic --send yes          # [เปลี่ยนเชน] Base: ZTPHY synthetic (ปิด)
node scripts/saphan-mainnet.js verify                                                     # [อ่าน] ทุกการอ่านกลับต้อง ok
```

commit `saphan-mainnet-state.json` (address และ block สาธารณะ) **[เปลี่ยนไฟล์]** ส่งเงินที่เหลือของ deployer คืน liquidity
multisig แล้วเลิกใช้กุญแจนั้น

### 6. เริ่ม agents

```bash
node scripts/saphan-mainnet.js agent-config --out agent-config.json [--rpc-base <RPC ส่วนตัวของ Base>]   # [เปลี่ยนไฟล์]
node scripts/saphan-mainnet.js relayer-env > relayer.env                                                # [เปลี่ยนไฟล์]
# คัดลอกทั้งสองไฟล์ไปที่ VM แล้วที่นั่น:
sudo AGENT_CONFIG=agent-config.json CONFIG_SHA256=<sha256 ที่คุณคำนวณ> bash setup-agents-mainnet.sh config   # [เปลี่ยนการตั้งค่า]
# ส่ง 0.1 ZTPHY ให้ validator ZETAPHY (และ 0.0002 ETH บน Base ให้ validator Base) [เปลี่ยนเชน]
sudo bash setup-agents-mainnet.sh start-validators                     # [เปลี่ยนการตั้งค่า]
# ส่ง ETH บน Base และ 1 ZTPHY ให้ relayer [เปลี่ยนเชน]
sudo RELAYER_ENV=relayer.env bash setup-agents-mainnet.sh start-relayer  # [เปลี่ยนการตั้งค่า]
sudo bash setup-agents-mainnet.sh status                               # [อ่าน] announce, checkpoint, ยอดเงิน, หน่วยความจำ
```

RPC สาธารณะฟรีของ Base ใช้ได้แต่จำกัดอัตรา; คีย์ฟรีจากผู้ให้บริการ RPC เสถียรกว่า (`--rpc-base` แล้ว URL จะอยู่ใน
`agent-config.json` บน VM เท่านั้น: อย่า commit ไฟล์นั้นถ้า URL มีคีย์)

### 7. เปิด (ขั้นแยกของเจ้าของ ฝั่งละ 48 ชม.)

```bash
node scripts/saphan-mainnet.js open-proposals --out open/              # [เปลี่ยนไฟล์] gov proposal + คำสั่งของ multisig บน Base
```

มันพิมพ์ตามลำดับ: **[เปลี่ยนเชน]** `bash zetaphy-chain/gov.sh propose-file open/open-zetaphy.gov-proposal.json`
(มัดจำ 10,000 ZTPHY) และการโหวต; เมื่อผ่านและครบ 48 ชม. ใครก็ได้ส่ง `execute` ที่พิมพ์ไปยัง timelock ของ ZETAPHY; บน Base
เจ้าของหนึ่งคนส่ง `propose` ที่พิมพ์ไปยัง multisig ของ Base เจ้าของคนที่สอง `confirm(id)` และ `execute(id)`; ครบ 48 ชม.
ทำแบบเดียวกันกับคำสั่ง execute ที่พิมพ์ จากนั้น `status` **[อ่าน]** แสดง `paused: false` ทั้งสองฝั่ง

### 8. pool บน Base

```bash
node scripts/saphan-pool.js plan --live yes --out pools/   # [เปลี่ยนไฟล์] bridge-zetaphy.unsigned.json, pool-USDC.safe-batch.json, pool-USDT.safe-batch.json
```

(a) **[เปลี่ยนเชน]** liquidity multisig (`0x8598…15d1` เป็น Cosmos 2 ใน 3) ลงนาม `bridge-zetaphy.unsigned.json`: ธุรกรรม
Cosmos เดียวที่มี `MsgEVMCall` สองข้อ: approve vault บน native ERC-20 แล้ว `lock(Safe, 2,000,000 ZTPHY)` สมาชิกลงนามแบบเดียว
กับตอนเติมเงิน deployer (docs/ZETAPHY-MAINNET-PROCEDURE.th.md 16.4) ด้วย `zetaphyd tx sign … --multisig
<liquidity multisig zetaphy1…> --from <สมาชิก>` แล้ว `tx multisign` และ `gov.sh broadcast` **ยังไม่ได้ตรวจที่นี่**: การลงนาม
multisig แบบ legacy-amino ของ node ยอมรับ `MsgEVMCall` หรือไม่ (ยังไม่เคยลองจาก multisig) ลองก่อนด้วยสำเนาไฟล์ที่จำนวนเป็น
1 ZTPHY; ถ้าการลงนามปฏิเสธ ใช้ `--sign-mode direct`; ถ้ายังถูกปฏิเสธ ทางสำรองคือ bank send 2,000,000 ZTPHY ไปกุญแจใหม่ใช้
ครั้งเดียว แล้วกุญแจนั้นส่งสองคำสั่งเดียวกันด้วย `cast send` (กุญแจเดียวถือเหรียญอยู่ไม่กี่นาที: ขั้นที่อ่อนกว่า)
หลังรอ mint 1 ชม. ใครก็ได้ส่ง `claim(id)` ไปที่ synthetic บน Base **[เปลี่ยนเชน]** (relayer ไม่ claim ให้)
(b)+(c) **[เปลี่ยนเชน]** ใส่ 100 USDC และ 100 USDT เข้า Safe; ใน app.safe.global -> Apps -> Transaction Builder โหลด
`pool-USDC.safe-batch.json` ตรวจ ลงนาม 2 ใน 3 แล้ว execute; ทำแบบเดียวกันกับ USDT แต่ละ batch: approve ZTPHY, approve
stable, สร้าง pool ที่ราคาของเจ้าของ (fee tier 1%), mint full range ให้ Safe โดยกำหนดขั้นต่ำ 1%: ถ้ามีคนสร้าง pool ก่อนที่
ราคาอื่น การ mint จะล้มแทนการขายถูก รัน `saphan-pool.js plan --live yes` อีกครั้ง: มันอ่าน pool และยอดใน Safe

### 9. ทุกวัน

`node scripts/saphan-mainnet.js status` **[อ่าน]**: ข้อความที่รอแต่ละทาง, โควตาวันนี้, `backed: true` (supply บน Base ≤
ที่ล็อกบน ZETAPHY) guardian: เทียบ `Queued` แต่ละรายการฝั่งหนึ่งกับ `Sent` อีกฝั่งระหว่างช่วงรอ และ veto รายการที่ไม่ตรง
รักษา ETH ของ relayer ให้สูงกว่าเงินสำรอง (`setup-agents-mainnet.sh status`)

## วิธี pause

ทันที ไม่ต้องโหวต โดย guardian 2 ใน 3 ของแต่ละฝั่ง:

```bash
node scripts/saphan-mainnet.js pause                       # [อ่าน] calldata
node scripts/saphan-mainnet.js pause --veto 0x<payout id>  # [อ่าน] และ: veto รายการที่รออยู่หนึ่งรายการ (id = ของ event Queued)
```

ZETAPHY: เจ้าของ guardian คนหนึ่งส่ง `pause.propose` ไปที่ guardian multisig `0x54EF…4519` คนที่สอง `confirm(id)` และ
`execute(id)` **[เปลี่ยนเชน]** Base: ทำแบบเดียวกันบน multisig ของ Base การ pause หยุดการ lock, การส่งกลับ และการ claim;
ข้อความที่มาถึงระหว่าง pause ถูกบันทึกและรอ guardian ยังลดขีดรายวันและเพดาน และเพิ่มเวลารอได้ทันที **มีแต่ governance
ที่เปิดอีกครั้งได้** (ขั้น 7 ด้วยไฟล์เดิม: unpause ผ่าน timelock ทั้งสองฝั่ง 48 ชม.)

## สำหรับ hub (ไม่ได้แก้ที่นี่)

หน้า bridge ของ hub อ่าน `saphan-routes.json` (testnet) สำหรับ mainnet ควรแสดง route จาก
`zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json` (vault, synthetic, CLOSED/OPEN), ข้อความความเสี่ยงของหน้านี้
ตามตัวอักษร, เพดานและเวลารอ และลิงก์ไปยัง pool Uniswap ทั้งสอง; ไม่ควรเสนอจำนวนเกินขีดปล่อยคืนหนึ่งวันสำหรับทางกลับ

## ปลายทางเพิ่ม: BNB Smart Chain และ Arbitrum One (เตรียม Polygon PoS ไว้แต่ปิดอยู่)

การตัดสินใจของเจ้าของ 2026-11-16: เติมเงินบน Base ยาก จึงให้ ZTPHY ไป **BNB Smart Chain** (BSC, chain 56) ด้วย โดยมี pool
**PancakeSwap v3** หนึ่ง pool คู่กับ **USDT** และไป **Arbitrum One** (42161) โดยมี pool **Uniswap v3** หนึ่ง pool คู่กับ
**USDC** แบบ native ของ Circle ส่วน **Polygon PoS** (137) เตรียมไว้ใน config แต่ตั้ง `"enabled": false` ไม่เพิ่มเชนอื่นอีก
ไม่มีอะไรที่นี่ถูก deploy: มีแต่เครื่องมือ, config, test และเอกสาร

**ZTPHY บน BSC ไม่ใช่โทเคนเดียวกับ ZTPHY บน Base (หรือบน Arbitrum)** แต่ละเชนได้ synthetic ของตัวเอง ค้ำด้วย vault ของตัวเอง
ที่ล็อก ZTPHY native ไว้บน ZETAPHY pool แต่ละที่เป็นตลาดแยกกัน มีราคาของตัวเอง การย้าย ZTPHY จาก BSC ไป Base ต้องส่งกลับ
ZETAPHY ก่อน (รอปล่อยคืน 6 ชม.) แล้วค่อยส่งออกอีกครั้ง

### การออกแบบ: หนึ่ง vault ต่อหนึ่งปลายทาง

`ZetaphyTokenVault` ที่มีอยู่ส่งไปหาสัญญาปลายทางได้ตัวเดียวบน domain เดียว (`remote`, `remoteDomain`) และรับ ISM ได้ตัวเดียว
vault ตัวเดียวสำหรับทุกเชนจะต้องเขียนสัญญาใหม่ที่ยังไม่ผ่าน audit ดังนั้นแต่ละ route จึงได้ **vault ของตัวเอง** บน ZETAPHY
deploy ด้วยโค้ดเดิมที่ไม่แก้ และทางนี้ปลอดภัยกว่าด้วย:

- **ความเสียหายอยู่แค่ route เดียว** ข้อความปลอมหรือกุญแจเสียบน BSC ทำได้อย่างมากคือดูด vault ของ BSC (lockCap 1,000,000
  ZTPHY) แตะสิ่งที่ล็อกไว้ให้ Base ไม่ได้: vault ของ Base รับเฉพาะข้อความจาก domain ของ Base และจาก synthetic ของ Base
  (ทดสอบแล้ว: `test/saphanroutes.test.js` และ dry run)
- **เพดานและเวลารอของแต่ละ route แยกกัน** (`destinations.<route>.limits`) ทุก route ที่เปิดรวมกันจะถูกปฏิเสธถ้าเกิน 1% ของ
  supply (ตอนนี้ 2,500,000 + 1,000,000 + 1,000,000 = 4,500,000 ZTPHY)
- **กฎความปลอดภัยเหมือนเดิมทุกข้อ**: vault และ synthetic ทุกตัว deploy แบบปิด การเปิดต้องผ่าน gov proposal บวก 48 ชม. บน
  ZETAPHY และ multisig ของ route บวก timelock 48 ชม. อีกฝั่ง guardian multisig ตัวเดิม `0x54EF…4519` pause และ veto ได้ทุก
  vault ทันที บนแต่ละปลายทางมี SimpleMultisig ตัวใหม่เป็น guardian กฎกันการเล่นซ้ำ (replay) และ veto อยู่ในสัญญา ไม่เปลี่ยน
- **validator ZETAPHY ตัวเดียวของเราลงนามให้ทุกปลายทาง** validator ของ Hyperlane ลงนาม merkle tree ของ ZETAPHY ซึ่ง ISM
  ของทุกปลายทางตรวจ ข้อความขากลับจากแต่ละปลายทางมา ZETAPHY ตรวจด้วยชุดที่ Hyperlane เผยแพร่สำหรับเชนนั้น: BSC 4 ใน 6,
  Arbitrum 3 ใน 5 (Polygon 2 ใน 3) แนวเดียวกับ 3 ใน 5 ของ Base
- Hyperlane core ของ ZETAPHY และ default ISM ไม่เปลี่ยน (default ISM ยังเชื่อเฉพาะชุดของ Base; ทุก vault มี ISM ของตัวเอง)

Config: `zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json` -> `destinations.bsc`, `.arbitrum`, `.polygon` **เชน EVM ใหม่
คือหนึ่งรายการในนั้น ไม่ต้องแก้โค้ด** (ฟิลด์เดียวกัน, address ที่ตรวจแล้วพร้อมแหล่งและ commit ใน `sources`) Base คงฟิลด์และชื่อ
ในไฟล์ state เดิม (`base-roles`, `zetaphy-vault`, `base-synthetic`) route อื่นเพิ่ม `<route>-roles`, `zetaphy-vault-<route>`,
`<route>-synthetic` ลงในไฟล์ state เดียวกัน

### address และแหล่งที่มา (อ่านเมื่อ 2026-11-16)

| อะไร | BNB Smart Chain (56) | Arbitrum One (42161) | Polygon PoS (137, ปิดอยู่) |
|---|---|---|---|
| Hyperlane Mailbox | `0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4` | `0x979Ca5202784112f4738403dBec5D0F3B9daabB9` | `0x5d934f4e2f797775e53561bB72aca21ba36B96BB` |
| merkle tree hook | `0xFDb9Cd5f9daAA2E4474019405A328a88E7484f26` | `0x748040afB89B8FdBb992799808215419d36A0930` | `0x73FbD25c3e817DC4B4Cd9d00eff6D83dcde2DfF6` |
| ValidatorAnnounce | `0x7024078130D9c2100fEA474DAD009C2d1703aCcd` | `0x1df063280C4166AF9a725e3828b4dAC6c7113B08` | `0x454E1a1E1CA8B51506090f1b5399083658eA4Fc5` |
| ISM factory แบบ message-id multisig | `0x4B1d8352E35e3BDE36dF5ED2e73C24E35c4a96b7` | `0x12Df53079d399a47e9E730df095b712B0FDFA791` | `0xEa5Be2AD66BB1BA321B7aCf0A079fBE304B09Ca0` |
| validator ของ Hyperlane สำหรับข้อความจากเชนนั้น | 4 ใน 6 | 3 ใน 5 | 2 ใน 3 |
| DEX | PancakeSwap v3: factory `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`, position manager `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | Uniswap v3: factory `0x1F98431c8aD98523631AE4a59f267346ea31F984`, position manager `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | Uniswap v3 (address เดียวกัน) |
| stable | USDT (BSC-USD) `0x55d398326f99059fF775485246999027B3197955` **18 ทศนิยม**; มี USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` 18 ทศนิยมด้วย | USDC native (Circle) `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` 6 ทศนิยม | USDC native (Circle) `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` 6 ทศนิยม |
| โทเคนค่า gas | BNB | ETH | POL |

แหล่งที่มา ปักด้วย commit ใน config (`destinations.<route>.sources`):

- Hyperlane core และ domain id: `hyperlane-xyz/hyperlane-registry` commit `099d9d2a5f27f6d40589a0b55102f917a50b79c7`,
  `chains/{bsc,arbitrum,polygon}/addresses.yaml` และ `metadata.yaml` (domain = chain id ทั้งสาม; sha256 อยู่ใน config)
- ชุด validator ของ Hyperlane: `hyperlane-xyz/hyperlane-monorepo` commit `5db7d80874062bfede7b81fb5eb5ad44398c9c52`,
  `typescript/sdk/src/consts/multisigIsm.ts` (`defaultMultisigConfigs.bsc`, `.arbitrum`, `.polygon`)
- PancakeSwap v3: `pancakeswap/pancake-v3-contracts` commit `986847948755cba528324d41be19480731c36c2a`,
  `projects/v3-core/deployments/bscMainnet.json` และ `projects/v3-periphery/deployments/bscMainnet.json`; fee tier จาก
  `projects/v3-core/contracts/PancakeV3Factory.sol`: 100/1, 500/10, **2500/50** (Uniswap มี 3000/60), 10000/200
  เครื่องมือเก็บตาราง tick spacing แยกต่อ DEX ดังนั้น pool 2500 ได้ tick เต็มช่วง ±887,250 และ Base ปฏิเสธ 2500
- Uniswap v3 บน Arbitrum และ Polygon: `Uniswap/sdk-core` commit `baff6d3c78b09aa0b2f96148bc223b42a57fd28a`,
  `src/addresses.ts` (`DEFAULT_ADDRESSES` แบบเดียวกับ Base) บน Polygon เลือก Uniswap v3 แทน QuickSwap v3: QuickSwap v3
  คือ Algebra (ไม่มี fee tier, position manager คนละ interface) ซึ่งโค้ด pool ไม่ได้สร้างให้
- stable บน BSC: token list ของ PancakeSwap เอง (`pancakeswap/token-list` commit `1dd8633d75ea081a9fbf88b1a22f29f74c06b36d`,
  `lists/pancakeswap-default.json`: "Binance Pegged USDT", "Binance Pegged USD Coin", 18 ทศนิยม) ตรงกับรายการ asset ของ
  Trust Wallet (`trustwallet/assets` commit `50d6fd574843da19cdd5fded102b5d6b951c72d2`) และ `zetaphy-neuro/src/known-tokens.js`
  ใน repository นี้
- USDC บน Arbitrum: เอกสารของ Arbitrum เอง (`OffchainLabs/arbitrum-docs` commit `8f3db19377666b0b2f1a5180e34754160f7047e5`,
  `content/docs/arbitrum-bridge/usdc-arbitrum-one.mdx`: USDC native ไม่ใช่ USDC.e `0xFF97…5CC8`), Trust Wallet (6 ทศนิยม) และ
  `known-tokens.js` USDC บน Polygon: default token list ของ Uniswap (commit `0ae664438dd43d428c5cbef2726af1ba6378a17c`,
  `src/tokens/polygon.json`: "USDCoin" 6 ทศนิยม; ไม่ใช่ USDC.e `0x2791…4174`) และ Trust Wallet
- **ยังไม่ได้ตรวจ**: หน้า address ของ Circle เอง (เครื่องที่เขียนสิ่งนี้เข้า developers.circle.com ไม่ได้); การอ่านเชนจริง
  (เข้า RPC ของ BSC, Arbitrum หรือ Polygon ไม่ได้) `check --route <route>` อ่านทุก address บนเชนจริงก่อนส่งอะไร: domain ของ
  Mailbox, hook, ISM factory, ทศนิยมของ stable, `factory()` ของ position manager, tick spacing ของ fee tier และว่า Safe ของคุณมีอยู่บน
  เชนนั้น

### ข้อมูลที่เจ้าของต้องให้ แยกตามเชน

`node scripts/saphan-mainnet.js plan` **[อ่าน]** แสดงสิ่งที่ยังขาด แยกตามเชน สำหรับ BSC และ Arbitrum ตอนนี้:

| ข้อมูล | อยู่ที่ | สถานะ |
|---|---|---|
| **Safe บนเชนนั้น** ที่รับ ZTPHY ของเชนนั้นและเป็นเจ้าของ pool ของมัน ใช้ address เดียวกับบน Base ได้ (`0x08Da43D48f1f68587220768Faf5a00C28962Dc36`): ที่ app.safe.global เปิด Safe เลือก "Add another network" แล้วเลือกเชน มันจะมีอยู่บนเชนนั้นเมื่อคุณทำขั้นนี้แล้วเท่านั้น (และจ่าย gas ของเชนนั้น) `check --route` อ่านมันบนเชนนั้น | `destinations.<route>.liquidity.recipient` | ยังขาด |
| owner ของ multisig บนเชนนั้น (แนะนำ: owner สามคนของ guardian ZETAPHY อยู่ใน `ownersSuggested`; คัดลอกไปใส่ `owners` เพื่อยืนยัน) และ threshold (2) | `destinations.<route>.owners`, `.threshold` | ยังขาด |
| gas ที่คุณจะส่งให้ deployer และ relayer บนเชนนั้น (`costs` แนะนำ; `plan` เตือนถ้าน้อยกว่า) | `destinations.<route>.funding.deployer`, `.relayer` | ยังขาด |
| จำนวนใน pool (ค่าเริ่มต้น 500,000 ZTPHY + 50 USDT บน BSC, + 50 USDC บน Arbitrum, 0.0001 USD ต่อ ZTPHY, tier 1%, เต็มช่วง) | `destinations.<route>.liquidity.pools`, `.feeTier` | ตั้งแล้ว (แก้ได้) |
| กุญแจ deployer และ validator ZETAPHY ของเรา: ตัวเดียวกับของ Base (กุญแจเดียว; address ของ synthetic บนแต่ละเชนขึ้นกับ nonce ของเชนนั้นเท่านั้น) | `deployer.address`, `validators.zetaphyOrigin` | ยังขาด (ใช้ร่วม) |

pool บน BSC ต้องใช้ ZTPHY 500,000 ของตัวเอง (ล็อกแยกเข้า vault ของ BSC): liquidity multisig ของ ZETAPHY ล็อก 500,000 ให้ Base,
500,000 ให้ BSC และ 500,000 ให้ Arbitrum รวม 1,500,000 ZTPHY และ stable 50 + 50 + 50 USD

### BSC: ขั้นตอนของเจ้าของ ตามลำดับ

1. **[อ่าน]** `node scripts/saphan-mainnet.js plan` และ `node scripts/saphan-pool.js plan --route bsc`
2. **[เปลี่ยนเชน]** **Safe บน BSC**: ที่ app.safe.global เพิ่ม BNB Smart Chain ให้ Safe ของคุณ (หรือสร้าง 2 ใน 3 ใหม่ที่นั่น)
   ใส่ address ใน `destinations.bsc.liquidity.recipient` **[เปลี่ยนไฟล์]**
3. **[เปลี่ยนเชน]** **USDT เข้า Safe ผ่าน Binance**: ใน Binance เลือก Withdraw -> USDT -> network **"BSC (BEP20)"** (บางที่แสดงเป็น
   "BNB Smart Chain (BEP20)") address = Safe บน BSC ส่งจำนวนน้อยทดลองก่อน ดูว่าถึงบน bscscan.com แล้วค่อยส่งที่เหลือ (50 USDT
   บวกค่าถอนของ Binance) **ห้ามเลือก network อื่น** สำหรับ address นั้น (ERC20, Arbitrum, opBNB...): address เดียวกันบนเชนอื่น
   อาจไม่ใช่ Safe และเหรียญจะหายไป USDT บน BSC มี 18 ทศนิยม: 50 USDT แสดงเป็น 50 ใน wallet และเป็น
   50,000,000,000,000,000,000 ใน calldata ดิบ
4. **[เปลี่ยนเชน]** **BNB**: ถอน BNB บน "BSC (BEP20)" ไปให้ (ก) deployer (`costs` แนะนำ ~0.0022 BNB ที่ 0.1 gwei คือ 3 เท่าของ
   ประมาณการ), (ข) relayer (~0.008 BNB สำหรับส่ง 200 ครั้ง) และ (ค) กุญแจ owner ของ Safe ที่จะกด execute ชุดคำสั่ง pool
   (~0.001 BNB) เขียนจำนวนของ deployer และ relayer ลงใน `destinations.bsc.funding`
5. **[เปลี่ยนไฟล์]** owner ของ multisig บน BSC: คัดลอก `ownersSuggested` ไปใส่ `owners` (หรือระบุคนอื่น) แล้วเปิด pull request
6. **[อ่าน]** `node scripts/saphan-mainnet.js check --route bsc` (core ของ BSC, PancakeSwap, USDT 18 ทศนิยม, Safe บน BSC)
7. **[เปลี่ยนเชน]** หลังขั้น core ของ route Base (core ของ ZETAPHY ใช้ร่วม ทำครั้งเดียว):
   ```bash
   KEYFILE=… node scripts/saphan-mainnet.js deploy --route bsc --step roles --send yes       # BSC: multisig, timelock, ISM ของเรา
   KEYFILE=… node scripts/saphan-mainnet.js deploy --route bsc --step vault --send yes       # ZETAPHY: vault ของ BSC (ปิด)
   KEYFILE=… node scripts/saphan-mainnet.js deploy --route bsc --step synthetic --send yes   # BSC: synthetic ของ BSC (ปิด)
   node scripts/saphan-mainnet.js verify --route bsc                                        # [อ่าน]
   ```
   ระหว่างนั้นอย่าใช้กุญแจ deployer บน BSC ทำอย่างอื่น (address ของ synthetic ถูกกำหนดด้วย nonce บน BSC)
8. **[เปลี่ยนการตั้งค่า]** agents: `agent-config` และ `relayer-env` ตอนนี้รวมทุก route ที่ deploy แล้ว ติดตั้งบนเครื่อง agents
   แบบขั้น 6 ของคู่มือ แล้วส่ง BNB ให้ relayer
9. **[เปลี่ยนเชน]** เปิด: `node scripts/saphan-mainnet.js open-proposals --route bsc` เขียน
   `open/open-zetaphy-bsc.gov-proposal.json` (gov proposal ของมันเอง มัดจำ 10,000 ZTPHY ได้คืน) และคำสั่งของ multisig บน BSC;
   ฝั่งละ 48 ชม.
10. **[เปลี่ยนเชน]** pool: `node scripts/saphan-pool.js plan --route bsc --live yes --out pools/` เขียน
    `bridge-zetaphy-bsc.unsigned.json` (liquidity multisig ล็อก 500,000 ZTPHY เข้า vault ของ BSC ให้ Safe บน BSC) และ
    `pool-bsc-USDT.safe-batch.json` (approve ZTPHY, approve USDT, สร้าง pool PancakeSwap v3 ที่ 0.0001 USDT ต่อ ZTPHY,
    mint เต็มช่วงด้วยขั้นต่ำ 1%) หลังเวลารอ mint 1 ชม. ใครก็ได้ส่ง `claim(id)` บน BSC แล้วโหลดชุดคำสั่งใน app.safe.global
    (BNB Smart Chain) -> Transaction Builder ตรวจ ลงนาม execute

Arbitrum One ทำแบบเดียวกันด้วย `--route arbitrum` ใช้ ETH บน Arbitrum One เป็นค่า gas (ถอนบน network "Arbitrum One" ห้าม
"Arbitrum Nova") และใส่ USDC native (6 ทศนิยม) เข้า Safe ของมัน

### ค่าใช้จ่ายของ route ใหม่

`node scripts/saphan-mainnet.js costs --bsc-gwei <gwei> --arbitrum-gwei <gwei>` **[อ่าน]** พิมพ์แต่ละ route เป็นโทเคน gas ของ
มันเอง ที่ค่าเริ่มต้น (BSC 0.1 gwei และ $700/BNB; Arbitrum 0.02 gwei บวกเผื่อค่า L1 data และ $3,000/ETH):

| Route | deployer (ประมาณ; เติม 3 เท่า) | เงินสำรอง relayer (ส่ง 200 ครั้ง) | รวมบนเชนนั้น | gas บน ZETAPHY |
|---|---:|---:|---:|---:|
| BNB Smart Chain | ~0.000725 BNB (เติม ~0.0022) | ~0.008 BNB (~$5.60) | ~0.0095 BNB (~$6.60) | ~0.084 ZTPHY |
| Arbitrum One | ~0.00075 ETH รวมค่า L1 (เติม ~0.0022) | 0.002 ETH (ขั้นต่ำ) | ~0.0031 ETH (~$9.30) | ~0.084 ZTPHY |

บวกมัดจำ gov proposal หนึ่งครั้งต่อ route เพื่อเปิด (10,000 ZTPHY ได้คืนเมื่อผ่าน) ดู bscscan.com/gastracker และ arbiscan.io
ก่อนเติมเงิน แล้วรัน `costs` ใหม่

### agents บนเครื่อง sentry 1 CPU / 6 GB

relayer ตัวเดียวส่งทุก route ที่ deploy แล้ว whitelist ของมันมีแต่ vault และ synthetic ของเรา (route ละสองรายการ) จึงไม่มีใครใช้
BNB หรือ ETH ของมันกับข้อความอื่นได้ validator ZETAPHY ตัวเดียวของเราลงนามให้ทุกปลายทาง: ไม่ต้องมี validator เพิ่ม (เว้นแต่
`originValidators.mode` ของ route ใดเป็น "ours": ตอนนั้นตั้ง `VALIDATE_ORIGINS="bsc"`) RPC มาจากรายการสาธารณะของ Hyperlane
registry (BSC: bsc.drpc.org, bsc-rpc.publicnode.com, bsc.rpc.blxrbdn.com) เปลี่ยนได้ด้วย `--rpc-bsc <url>` / `BSC_RPC` (key
ฟรีของผู้ให้บริการ RPC เสถียรกว่า: ถ้าใช้ อย่า commit `agent-config.json`) หน่วยความจำ: เพดานของ relayer คือ 480 MB สำหรับสองเชน
บวก 200 MB ต่อเชนที่เพิ่ม (880 MB สำหรับ ZETAPHY + Base + BSC + Arbitrum) ไม่เกิน 40% ของ RAM ตั้ง `MEM_RELAYER` เพื่อกำหนดเอง
container ของ agent ทุกตัวรันด้วยน้ำหนัก CPU ต่ำ (`--cpu-shares 512`) บน CPU เดียว node ของ ZETAPHY จึงได้ก่อนเมื่อต้องใช้พร้อมกัน
BSC ออก block ทุก 0.45 วินาที: การ index มันผ่าน RPC สาธารณะหนักที่สุด ถ้า relayer ตามไม่ทัน ให้ใช้ RPC ส่วนตัว

### ความเสี่ยงของ route ใหม่ ตรง ๆ

- **USDT บน BSC คือ Binance-Peg BSC-USD ออกโดย Binance ไม่ใช่ Tether** Binance (กุญแจ owner ของมัน) mint เพิ่มได้ และมันมีค่า
  1 USD ตราบที่ Binance ยังรักษา peg เช่นเดียวกับ USDC แบบ Binance-Peg บน BSC (ออกโดย Binance ไม่ใช่ Circle) pool ZTPHY/USDT
  บน BSC จึงพึ่งความเชื่อใน Binance
- **ZTPHY บน BSC, บน Base และบน Arbitrum คือ synthetic สามตัวแยกกันและตลาดสามที่แยกกัน** ราคาอาจห่างกัน การ arbitrage ต้องผ่าน
  ZETAPHY (หลายชั่วโมง)
- **owner ของ factory ของ PancakeSwap ปิด fee tier หรือบังคับ whitelist ได้** สำหรับ pool ใหม่ (`PancakeV3Factory`) `check` และ
  `saphan-pool.js --live` อ่าน tier ก่อนคุณลงนาม pool ที่มีอยู่แล้วไม่กระทบ
- ทุกข้อใน "อ่านก่อน" ใช้กับทุก route: validator ZETAPHY ตัวเดียว, ชุดลงนามเล็กของเรา, สัญญาที่ยังไม่ audit, pool บาง (ข้างละ
  $50: ซื้อ $10 ราคาขยับราว +43%)

**ทำไมเชนเพิ่มไม่ใช่ของฟรี** แต่ละ route มีเพราะเจ้าของขอเท่านั้น และตั้งไว้ไม่เกินสี่เชนนี้ เพราะ:

- ทุก pool แบ่งสภาพคล่องก้อนเล็กเดียวกัน: pool $50 สามที่ บางกว่า pool $150 ที่เดียว
- ทุก route เพิ่ม synthetic, timelock และ multisig ที่ guardian ต้องเฝ้าทุกวัน
- relayer จ่าย gas บนทุกเชน และต้องเติมเงินไว้ทุกเชน
- แต่ละเชนคืออีกหนึ่งที่ที่บั๊กหรือกุญแจหายทำให้เงินหายได้

### dry run ของ BSC

workflow `saphan-mainnet` รัน route BSC ต่อจาก route Base บน **ZETAPHY ในเครื่องตัวเดียวกัน** (vault สองตัวอยู่คู่กัน) บน **anvil
ในเครื่องที่ chain id 56**: Hyperlane core จาก CLI ที่ปักไว้ และ Uniswap v3 จาก artifact ของ npm (v3-core 1.0.1,
v3-periphery 1.4.4; hash ของ init code ของ pool ตรงกัน) เป็นตัวแทนของ PancakeSwap v3 ซึ่งมี interface ของ position manager
แบบเดียวกันและ tier 1% กับ tick spacing (200) เท่ากัน ไม่ได้ fork BSC mainnet: ไม่มี RPC สาธารณะของ BSC ที่ runner ของ GitHub
ใช้ได้ซึ่งเก็บ state แบบ archive และด้วย block 0.45 วินาที node ที่ไม่ใช่ archive จะลบ state ของ block ที่ fork ภายในราวหนึ่งนาที
น้อยกว่าเวลาที่ dry run ใช้มาก PancakeSwap v3 ตัวจริงบน BSC ตรวจด้วย `check --route bsc` และ
`saphan-pool.js plan --route bsc --live yes` (อ่านอย่างเดียว) จากเครื่องของเจ้าของ

## ตรวจแล้ว และยังไม่ได้ตรวจ

- `npm test` (zetaphy-network) รัน `test/saphanmainnet.test.js`: config, การปฏิเสธ, 1 ใน 1 ได้เฉพาะเมื่อตั้ง flag, USDC เทียบ
  `known-tokens.js`, core config, calldata ของการเปิดและ pause, whitelist ของ relayer, agent config, ค่าใช้จ่าย, คณิตและ
  calldata ของ pool, ธุรกรรม bridge และสัญญาทั้งสองด้วยเพดานของ mainnet
- `scripts/saphan-mainnet-dryrun.js` ผ่านบนสองเชนในเครื่อง (anvil 8453 กับ Hyperlane core จาก CLI ที่ปักไว้และ Uniswap v3
  จาก artifact ของ npm; anvil 3659 กับ core config ที่เครื่องมือนี้เขียน): ส่งมอบ, deploy, ทำต่อ, อ่านกลับ 29 รายการ, เปิดผ่าน
  timelock ทั้งสองฝั่ง, 2,000,000 ZTPHY ไป Safe, เพดาน, pool ทั้งสองที่ 0.0001 USD, burn -> ปล่อยคืนหลัง 6 ชม., ขีดรายวัน,
  pause, ข้อความปลอม workflow `saphan-mainnet` รันแบบเดียวกันบน **fork ของ Base mainnet** (Mailbox, ISM factory, USDC และ
  Uniswap จริง) และเริ่ม agents
- `test/saphanroutes.test.js` ครอบคลุม route อื่น: รายการ BSC, Arbitrum และ Polygon ที่ commit เทียบกับแหล่งที่มาและ
  `known-tokens.js`, การปฏิเสธ route BSC ที่ถูกทำให้อ่อนลง, Polygon ถูกปฏิเสธขณะปิดและใช้ได้เมื่อเปิดพร้อมข้อมูลครบ, tier และช่วงเต็ม
  ของ PancakeSwap v3, pool USDT 18 ทศนิยมที่ 0.0001 พอดี, bridge แยกต่อปลายทาง, การเปิดและ pause ต่อ route, whitelist ของ relayer
  และ agent config ที่มีทุกเชน, ค่าใช้จ่ายเป็น BNB และสัญญาของสอง route อยู่คู่กัน (vault แต่ละตัวรับเฉพาะข้อความจากเชนของตัวเอง)
- คำสั่งสี่ข้อของแผน pool BSC ถูกรันจริงหนึ่งครั้งกับ bytecode จริงของ Uniswap v3 (npm v3-core 1.0.1 / v3-periphery 1.4.4
  ตัวแทนของ PancakeSwap v3) และ USDT จำลอง 18 ทศนิยม: pool ถูกสร้างที่ sqrtPriceX96 ตามแผนพอดีและ mint เต็มช่วงผ่านขั้นต่ำ 1%
  dry run ที่ขยาย (`--route bsc`) และขั้นใน workflow เขียนแล้วแต่ยังไม่ได้รันบนเครื่องที่เขียน (ไม่มี anvil): การรัน CI ครั้งแรกคือ
  การทดสอบของมัน
- ยังไม่ได้ตรวจ: การอ่านเชน ZETAPHY, Base, BSC, Arbitrum หรือ Polygon จริง (เครื่องที่เขียนสิ่งนี้เข้าถึง RPC ไม่ได้); หน้า address
  USDC ของ Circle เอง; โทเคน USDT บน Base; การที่ liquidity multisig ลงนาม `MsgEVMCall`; Hyperlane agents กับ mainnet;
  การใช้หน่วยความจำของ agents บน E2.1.Micro หรือ sentry
