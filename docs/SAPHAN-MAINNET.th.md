[English](SAPHAN-MAINNET.md) | **ภาษาไทย**

# Saphan mainnet: ZTPHY ระหว่าง ZETAPHY กับ Base

การตัดสินใจของเจ้าของ 2026-11-14: เปิดสะพาน Saphan ระหว่าง ZETAPHY mainnet (`zetaphy_3659-1`, EVM chain 3659) กับ
Base mainnet (8453) เพื่อให้ซื้อขาย ZTPHY กับ USDC (และ USDT) บน Base ได้ testnet ปิดแล้ว ชุดเครื่องมือนี้สำหรับ mainnet
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
| จำนวนใน pool (ตัดสินแล้ว: 1,000,000 ZTPHY + 100 USDC; 1,000,000 ZTPHY + 100 USDT; 0.0001 USD ต่อ ZTPHY) | `liquidity.pools` | ตั้งแล้ว |
| ETH บน Base: deployer ~0.0035, relayer ~0.002 (เงินสำรอง), Safe ~0.001; ใส่ 100 USDC + 100 USDT เข้า Safe | — | ต้องซื้อ/ส่ง |
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

## ตรวจแล้ว และยังไม่ได้ตรวจ

- `npm test` (zetaphy-network) รัน `test/saphanmainnet.test.js`: config, การปฏิเสธ, 1 ใน 1 ได้เฉพาะเมื่อตั้ง flag, USDC เทียบ
  `known-tokens.js`, core config, calldata ของการเปิดและ pause, whitelist ของ relayer, agent config, ค่าใช้จ่าย, คณิตและ
  calldata ของ pool, ธุรกรรม bridge และสัญญาทั้งสองด้วยเพดานของ mainnet
- `scripts/saphan-mainnet-dryrun.js` ผ่านบนสองเชนในเครื่อง (anvil 8453 กับ Hyperlane core จาก CLI ที่ปักไว้และ Uniswap v3
  จาก artifact ของ npm; anvil 3659 กับ core config ที่เครื่องมือนี้เขียน): ส่งมอบ, deploy, ทำต่อ, อ่านกลับ 29 รายการ, เปิดผ่าน
  timelock ทั้งสองฝั่ง, 2,000,000 ZTPHY ไป Safe, เพดาน, pool ทั้งสองที่ 0.0001 USD, burn -> ปล่อยคืนหลัง 6 ชม., ขีดรายวัน,
  pause, ข้อความปลอม workflow `saphan-mainnet` รันแบบเดียวกันบน **fork ของ Base mainnet** (Mailbox, ISM factory, USDC และ
  Uniswap จริง) และเริ่ม agents
- ยังไม่ได้ตรวจ: การอ่านเชน ZETAPHY หรือ Base จริง (เครื่องที่เขียนสิ่งนี้เข้าถึง RPC ไม่ได้); โทเคน USDT; การที่ liquidity
  multisig ลงนาม `MsgEVMCall`; Hyperlane agents กับ mainnet; การใช้หน่วยความจำของ agents บน E2.1.Micro
