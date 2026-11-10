# เส้นทางสู่เมนู DeFi ของ Solscan (ขึ้นรายชื่อคู่กับ Raydium, Orca, Meteora)

> English version: `docs/DEFI_LISTING.md`

เอกสารนี้สำหรับเจ้าของโปรเจกต์ (ไม่ต้องเป็นโปรแกรมเมอร์) บอกทุกขั้นตั้งแต่วันนี้จนถึงวันที่ SWD AMM มีชื่อในเมนู
DeFi ของ Solscan พร้อมบอกตรง ๆ ว่าข้อไหน **ยืนยันแล้ว** ข้อไหน **ยังไม่ได้ยืนยัน** (ค้นข้อมูลเมื่อ 8 พ.ย. 2026)

> **สถานะวันนี้:** โปรแกรม swd_amm เขียนเสร็จและผ่านเทสต์ แต่ **ยังไม่ได้ audit และยังไม่อยู่บน mainnet**
> ไม่มีขั้นตอนไหนในเอกสารนี้ที่ทำไปแล้วบน mainnet และไม่มีเงินจริงถูกใช้
> ห้ามให้ private key / seed phrase กับใคร (รวมถึง AI, นักพัฒนา, auditor, ทีม Jupiter/Solscan) — การเซ็นทุกครั้ง
> ทำบนเครื่องของคุณเองด้วยไฟล์ keypair หรือผ่าน Squads เท่านั้น

## ภาพรวม 10 ขั้น

| # | ขั้น | ใครทำ | ค่าใช้จ่ายโดยประมาณ | สถานะ |
|---|---|---|---|---|
| 1 | Audit โดยบริษัทภายนอก | auditor + นักพัฒนาแก้ | สูงสุดในทั้งหมด (ดูข้อ 1) | ❌ ยังไม่เริ่ม |
| 2 | เตรียมกุญแจใหม่ + program id ของ mainnet | เจ้าของ | ค่า hardware wallet | ❌ |
| 3 | Build แบบ verified + deploy | เจ้าของ (รันสคริปต์) | ~17.9 SOL ต้องมีในกระเป๋า, ~9.04 SOL ถูกล็อก/ใช้ไป | ❌ |
| 4 | อัปโหลด IDL ขึ้น chain | สคริปต์ | ~0.18 SOL | ❌ |
| 5 | ยืนยัน "Verified" กับ OtterSec | สคริปต์ | ฟรี (ค่าธรรมเนียมเล็กน้อย) | ❌ |
| 6 | ส่งมอบสิทธิ์ทั้งหมดให้ Squads multisig | สคริปต์ + สมาชิก Squads | เล็กน้อย | ❌ |
| 7 | เปิด pool แรก + ใส่สภาพคล่อง | เจ้าของ / ทีม | เงินทุนสภาพคล่องของโปรเจกต์ | ❌ |
| 8 | สมัครเชื่อมกับ Jupiter | เจ้าของ | ฟรี (ตามเอกสาร Jupiter) | SDK ✅ พร้อม |
| 9 | ส่ง TVL adapter ให้ DefiLlama | เจ้าของ (GitHub PR) | ฟรี | adapter ✅ พร้อม |
| 10 | ติดต่อ Solscan ขอขึ้นเมนู DeFi | เจ้าของ | ไม่ทราบ (ดูข้อ 10) | ❌ |

สิ่งที่เตรียมไว้ให้แล้วใน repo:

- `security.txt` ฝังในโปรแกรมแล้ว (Solscan / Solana Explorer แสดงในแท็บ Security) — ดูข้อ 5.1
- `scripts/deploy-mainnet.sh` — สคริปต์ deploy ครบขั้น 3–6 (ค่าเริ่มต้นคือ "ซ้อม" ไม่ส่งอะไรจริง)
- `integrations/jupiter-amm-swd/` — SDK สำหรับ Jupiter (ข้อ 8)
- `integrations/defillama/swd-amm/` — adapter สำหรับ DefiLlama (ข้อ 9)

---

## 1. Audit (ต้องทำก่อนทุกอย่าง)

ทำไมต้องมี: Jupiter ระบุว่า DEX ที่ไม่ได้ใช้โปรแกรมมาตรฐานที่ audit แล้วต้องมี audit ของตัวเอง, DefiLlama มีช่องให้ใส่ลิงก์
audit, และผู้ใช้/Solscan ดูเรื่องนี้ AMM ถือเงินของผู้ใช้ — บั๊กเดียวอาจทำให้เงินใน pool หายถาวร

### 1.1 ขอบเขตงาน (ส่งให้ auditor พร้อม `docs/AUDIT_SCOPE.md`)

นับบรรทัดโค้ดจริงเมื่อ 8 พ.ย. 2026 (ไม่นับบรรทัดว่าง, comment และโค้ดเทสต์):

| ไฟล์ | บรรทัดทั้งหมด | โค้ดจริง (โดยประมาณ) | เนื้อหา |
|---|---|---|---|
| `lib.rs` | 1,921 | ~1,010 | pool แบบ constant-product, entry points, ตัวกรอง Token-2022 |
| `dlmm.rs` | 1,641 | ~890 | pool แบบ DLMM (bin) |
| `swdmm_v2.rs` | 1,189 | ~970 | pool แบบ SWDMM v2 (แบบที่หน้าเว็บใช้) |
| `swdmm_math.rs` | 737 | ~385 | คณิตศาสตร์ของ v2 |
| `timelock.rs` | 580 | ~455 | timelock, ค่าธรรมเนียม protocol, mint policy |
| `governance.rs` | 858 | ~440 | สิทธิ์ผู้ดูแล, pause, ตรวจ Squads |
| `oracle.rs` | 781 | ~285 | อ่านราคา Pyth (เขียนเอง ไม่ใช้ SDK ของ Pyth) |
| **รวม** | **7,707** | **~4,430** | |

ทางเลือกที่ทำให้ audit ถูกลง: ถ้าเปิดบน mainnet เฉพาะ SWDMM v2 (ปิด/ตัด CP และ DLMM ออกก่อน) ขอบเขตจะเหลือราว
**~2,600–3,000 บรรทัด** (v2 + math + timelock + governance + oracle + ส่วนกลางของ lib.rs) — ต้องให้นักพัฒนาตัดโค้ดออกจริง
และ build ใหม่ก่อนส่ง audit ไม่ใช่แค่ "ไม่ใช้"

ส่งให้ auditor ด้วย: commit hash ที่จะ audit, `docs/AUDIT_SCOPE.md`, `docs/SWDMM_V2.md`, `docs/MAINNET_RUNBOOK.md`,
ผลเทสต์ (`cargo test -p swd_amm`, `anchor test`), โฟลเดอร์ `audit/` (ผล review ภายใน)

### 1.2 RFP — ข้อความขอใบเสนอราคา (คัดลอกส่งอีเมลได้)

> Subject: Audit request — SWD AMM (Solana, Anchor 0.31.1), ~4.4k nSLOC
>
> We are looking for a security review of SWD AMM, an open-source Solana AMM program
> (https://github.com/pospos191-alt/zetaphy, `programs/swd_amm`). Anchor 0.31.1, Solana 3.1.10,
> ~4,430 lines of non-test Rust (or ~2,600–3,000 if we ship SWDMM v2 only). Scope document: `docs/AUDIT_SCOPE.md`.
> Pool types: constant-product, DLMM (bins), SWDMM v2 (Meteora-DAMM-v2-style: fee schedulers, dynamic fee,
> positions, permanent locks); Token-2022 support with an extension allowlist; hand-written Pyth PriceUpdateV2
> reader; Squads-multisig governance with a 24–48h timelock.
> Please quote: (1) price and number of engineer-weeks, (2) earliest start date, (3) whether a fix review is
> included, (4) whether the final report is public and can be linked from our site, DefiLlama and Jupiter,
> (5) any reduced-scope option. We also ask you to check our Jupiter integration crate
> (`integrations/jupiter-amm-swd`) for quote/execution mismatches as an optional item.

### 1.3 ควรถาม auditor

1. ราคา, จำนวนสัปดาห์-คน, วันเริ่มเร็วที่สุด
2. รวมรอบตรวจการแก้ไข (fix review) ไหม — ควรรวม
3. รายงานเผยแพร่สาธารณะได้ไหม (Jupiter/DefiLlama/ผู้ใช้ต้องเห็น)
4. เคย audit AMM / CLMM / DLMM บน Solana มาก่อนไหม (ขอลิงก์รายงาน)
5. ตรวจ Token-2022 extensions และ Pyth reader ที่เขียนเองด้วยไหม
6. ข้อเสนอแนะเรื่องสิทธิ์ผู้ดูแล (Squads, timelock, emergency pause)
7. ข้อจำกัด "บัญชีปลายทางต้องเป็นของผู้เซ็น" ใน swap_v2 จะขัดกับการ route ของ Jupiter ไหม (README ของ jupiter-amm-swd ข้อ 2)

### 1.4 ราคาโดยประมาณ (**ยังไม่ได้ยืนยัน** — บริษัทส่วนใหญ่ไม่ประกาศราคา ต้องขอใบเสนอราคาเท่านั้น)

ตัวเลขจากบทความของบุคคลที่สาม (บางแห่งขาย audit เอง จึงอาจไม่เป็นกลาง):

- โปรแกรม Solana ขนาดเล็ก/ง่าย: ราว **$7,000–$20,000**
- โปรโตคอล DeFi บน Solana ทั่วไป: ราว **$60,000–$130,000**; ซับซ้อนมาก: **$180,000+**
- audit บน Solana มักแพงกว่า Ethereum ขนาดเท่ากัน ~20–30%
- บริษัทใหญ่ (เช่น OtterSec) มักมีคิวยาวเป็นสัปดาห์ถึงเดือน

ด้วยขนาด ~4.4k บรรทัด + 3 ชนิด pool คาดว่าอยู่ช่วงกลางถึงบนของ "DeFi ทั่วไป"; ถ้าตัดเหลือ v2 อย่างเดียวน่าจะถูกลงชัดเจน
ทางเลือกเสริม (ไม่แทน audit หลัก): **audit contest** (Code4rena, Sherlock, Cantina) และ **bug bounty** (Immunefi) หลัง launch

### 1.5 บริษัท audit ที่มีชื่อด้าน Solana (รายชื่อจากการค้นข้อมูล — ตรวจสอบเว็บไซต์/ผลงานเองก่อนเลือก)

OtterSec, Neodyme, Sec3, Zellic, Halborn, Trail of Bits, Ackee Blockchain, Accretion, Offside Labs, MadShield, Certora
(หลายรายตรวจ Raydium/Orca/Meteora/Jupiter มาแล้ว — ขอลิงก์รายงานจริงจากแต่ละราย)

หลัง audit: แก้ทุกข้อระดับ critical/high → ให้ auditor ตรวจซ้ำ → เผยแพร่รายงาน → แก้ `auditors` ใน security.txt
(`programs/swd_amm/src/lib.rs`) จาก "None yet" เป็นชื่อบริษัท → บันทึก commit ที่ audit ใน `docs/MAINNET_RUNBOOK.md` Gate 4

---

## 2. กุญแจใหม่ + program id ของ mainnet

ทำตาม `docs/MAINNET_RUNBOOK.md` Gate 5 (สมาชิก Squads 3 คน hardware wallet คนละเครื่อง, emergency authority แยก, deployer ใช้ครั้งเดียว)

เพิ่มเติมสำหรับ program id (ทำบนเครื่องของคุณ ไฟล์ต้องอยู่ **นอก** โฟลเดอร์ repo):

```bash
solana-keygen new -o ~/swd-keys/swd_amm-program.json     # program id ใหม่ (เก็บไฟล์ไว้ให้ดี ห้ามเผยแพร่)
solana-keygen pubkey ~/swd-keys/swd_amm-program.json     # ← ส่ง "ตัวเลขนี้" (public) ให้นักพัฒนาได้
```

นักพัฒนาจะแก้ `declare_id!` ใน `programs/swd_amm/src/lib.rs` และเพิ่ม `[programs.mainnet]` ใน `Anchor.toml` เป็น id นี้
แล้ว commit + push (ต้อง push เพราะ OtterSec build ใหม่จาก GitHub) — ควรทำบน commit ที่ audit แล้ว
(ถ้าเปลี่ยนแค่ id ให้แจ้ง auditor ว่าต่างจาก commit ที่ audit เฉพาะบรรทัดนี้)

---

## 3–6. Build, deploy, IDL, verify, ส่งมอบให้ Squads — ใช้ `scripts/deploy-mainnet.sh`

ต้องติดตั้งบนเครื่อง: Solana CLI 3.1.10, Anchor 0.31.1, Docker, `cargo install solana-verify`, Node + yarn (`yarn install` ใน repo)
และ RPC ส่วนตัวของ mainnet (Helius / Triton / QuickNode) — RPC สาธารณะมักล้มกลางทางตอน deploy โปรแกรมใหญ่

**ซ้อมก่อน (ไม่ส่งอะไรจริง):**

```bash
export RPC=https://<rpc ส่วนตัวของคุณ>
export DEPLOYER_KEYPAIR=~/swd-keys/deployer.json
export PROGRAM_KEYPAIR=~/swd-keys/swd_amm-program.json
export SQUADS_VAULT=<vault PDA จาก scripts/squads-setup.ts>
export EMERGENCY_AUTHORITY=<pubkey ของผู้ถือสิทธิ์ pause>
bash scripts/deploy-mainnet.sh all          # พิมพ์ทุกคำสั่งที่จะรัน + ประเมินค่าใช้จ่าย
```

**ทำจริง:** `bash scripts/deploy-mainnet.sh all --execute` — ทุกคำสั่งที่ใช้เงิน/เปลี่ยน chain จะถามให้พิมพ์ `yes` ก่อน
(ทำทีละขั้นก็ได้: `preflight`, `build`, `estimate`, `deploy`, `idl`, `verify`, `governance`, `handover`, `check`)

สคริปต์ทำอะไร ตามลำดับ (ลำดับนี้สำคัญ):

1. **preflight** — เช็คเครื่องมือ, เช็คว่า RPC เป็น mainnet จริง (genesis hash), ไฟล์ keypair อยู่นอก repo,
   `declare_id!` ตรงกับ program keypair, git สะอาดและ push แล้ว, แสดงยอด SOL ของ deployer
2. **build** — `solana-verify build` (build ใน Docker ให้ได้ไฟล์เหมือนกันทุกเครื่อง) ด้วย `--features mainnet`
   (timelock 24–48 ชม.) + พิมพ์ hash; ถ้าตั้ง `AUDITED_SHA256` จะไม่ยอมไปต่อถ้า hash ไม่ตรงกับที่ audit
3. **estimate** — คำนวณค่าใช้จ่ายจากขนาดไฟล์ `.so` จริง
4. **deploy** — deploy ด้วย program keypair ใหม่ (deployer เป็นผู้มีสิทธิ์อัปเกรดชั่วคราว)
5. **idl** — `anchor idl init` เอา IDL ขึ้น chain → Solscan อ่านคำสั่ง/บัญชีของโปรแกรมเป็นภาษาคนได้
6. **verify** — เขียน "verify PDA" แล้วส่งงานให้ OtterSec build ซ้ำจาก GitHub → Solscan / Solana Explorer ขึ้นป้าย **Verified**
   (ทำตอนที่ deployer ยังเป็นผู้มีสิทธิ์ จะได้ไม่ต้องทำ proposal ใน Squads)
7. **governance** — ตั้งค่า GlobalConfig + GovernanceSettings (โปรแกรมยอมให้เฉพาะผู้มีสิทธิ์อัปเกรดทำ จึงต้องก่อนส่งมอบ)
8. **handover** — โอนสิทธิ์ governance, สิทธิ์ IDL และสิทธิ์อัปเกรดโปรแกรมให้ Squads vault (**ขั้นสุดท้าย**)
9. **check** — ตรวจ: ผู้มีสิทธิ์ == vault, hash บน chain == hash ที่ build, มี IDL บน chain

### ค่าใช้จ่าย (คำนวณจากไฟล์ .so ที่ build ได้วันนี้: 1,266,528 bytes — build mainnet จริงอาจต่างเล็กน้อย สคริปต์คำนวณใหม่ให้)

| รายการ | SOL |
|---|---|
| ค่าเช่า (rent) บัญชีข้อมูลโปรแกรม — ล็อกไว้ตลอดที่โปรแกรมยังอยู่ | ~8.82 |
| บัญชีโปรแกรม | ~0.001 |
| buffer ชั่วคราวระหว่าง deploy — ได้คืนเมื่อเสร็จ แต่ต้องมีในกระเป๋าตอน deploy | ~8.82 |
| บัญชี IDL (ประมาณ) | ~0.18 |
| ค่าธรรมเนียม ~1,250 ธุรกรรม (priority fee 50,000 micro-lamports/CU) | ≤ ~0.02 |
| verify PDA, governance, อื่น ๆ | ~0.02 |
| **ต้องมีใน deployer ก่อนเริ่ม** | **≥ ~17.9** |
| **ใช้/ล็อกจริงหลังเสร็จ** | **~9.04** |

สูตร rent: (ขนาด + 128) × 6,960 lamports (ค่าปัจจุบันของ Solana — สคริปต์ถาม RPC จริงก่อนถ้าทำได้)
ถ้า deploy ค้างกลางทาง: รันใหม่ด้วย `--buffer` ตามที่ CLI พิมพ์ หรือปิด buffer เพื่อเอา SOL คืน (`solana program close --buffers`)

### 5.1 security.txt (ทำแล้วในโค้ด)

ฝังในโปรแกรมแล้ว: ชื่อ "SWD AMM", เว็บ https://swd-zetaphy.sawasdeecoin.com, ช่องทางแจ้งช่องโหว่
`security@sawasdeecoin.com` + https://github.com/pospos191-alt/zetaphy/security, นโยบาย = SECURITY.md, ซอร์สโค้ด = repo zetaphy,
auditors = "None yet"

**ต้องทำ:** อีเมล `security@sawasdeecoin.com` เป็นค่าชั่วคราว — สร้างกล่องอีเมลนี้จริง (และมีคนอ่าน) **หรือ** บอกนักพัฒนาให้เปลี่ยน
**ก่อน** build mainnet (แก้หลัง deploy ต้องอัปเกรดโปรแกรม = proposal ใน Squads); เปิด
GitHub → Settings → Code security → Private vulnerability reporting ด้วย

---

## 7. Pool แรกและสภาพคล่อง

ทำตาม `docs/MAINNET_RUNBOOK.md` Gate 8 (อนุญาต mint ผ่าน Squads proposal) แล้วสร้าง pool ด้วยหน้าเว็บ (SWDMM v2)

- คู่ที่ควรมี: **SWD/SOL** และ/หรือ **SWD/USDC** — aggregator และ DefiLlama ตีราคาได้เมื่ออีกข้างเป็นเหรียญที่มีราคาตลาด
- Jupiter ระบุขั้นต่ำ **$500 ต่อ pool** (ตามเอกสาร ณ 1 ม.ค. 2025 — **อาจเปลี่ยนแล้ว**) ในทางปฏิบัติควรมากกว่านี้มาก
  ไม่งั้นราคาจะไม่ดีพอให้ Jupiter route มา
- พิจารณา **lock liquidity ถาวร** ของผู้สร้าง pool (ฟังก์ชัน Permanently lock) — เพิ่มความน่าเชื่อถือ
- ค่า fee tier ต่ำ (0.25–0.3%) แข่งราคาได้ดีกว่าบน Jupiter; fee สูงเหมาะช่วงเปิดตัว (time scheduler)
- ทุกการตั้งค่า governance หลังส่งมอบ = proposal ใน Squads ที่ต้องอนุมัติ 2 ใน 3

---

## 8. Jupiter

รายละเอียด: `integrations/jupiter-amm-swd/README.th.md`
สรุป: SDK พร้อมแล้วและทดสอบกับโปรแกรมจริงในเครื่องจำลอง; สิ่งที่ Jupiter ขอ (จากเอกสารของเขา — **ยังไม่ได้ยืนยัน**):
SDK open source, audit + การตรวจ security/code health ของเขา, traction, สภาพคล่องขั้นต่ำต่อ pool, (ควรมี) API รายชื่อ pool
ติดต่อผ่านช่องทางในหน้า "DEX Integration" ของเอกสาร Jupiter (dev.jup.ag) / Discord ของ Jupiter

ทำไมสำคัญ: volume ส่วนใหญ่บน Solana มาจาก Jupiter — DEX ที่ Jupiter ไม่ route มาแทบไม่มี volume ให้ Solscan เห็น

---

## 9. DefiLlama

รายละเอียดทีละขั้น: `integrations/defillama/swd-amm/README.th.md`
สรุป: แก้ PROGRAM_ID เป็นของ mainnet → fork DefiLlama-Adapters → วางไฟล์ `projects/swd-amm/index.js` →
`node test.js projects/swd-amm/index.js` → เปิด PR กรอก template — ทำได้เมื่อมี pool และเงินจริงบน mainnet แล้วเท่านั้น
(อยากให้แสดง volume ด้วย ต้องทำ adapter เพิ่มใน `DefiLlama/dimension-adapters` — ยังไม่ได้ทำ)

---

## 10. Solscan

สิ่งที่ Solscan "เห็นเอง" อยู่แล้วเมื่อทำข้อ 3–6: ป้าย Verified, IDL (แสดงคำสั่งเป็นตาราง), security.txt

**ช่องทางขอขึ้นเมนู DeFi — ยังไม่ได้ยืนยัน:** ค้นแล้ว **ไม่พบ** แบบฟอร์มสาธารณะสำหรับ "ขอเพิ่มโปรโตคอลในเมนู DeFi"
(เว็บเอกสารของ Solscan เปิดจากเครื่องที่เตรียมงานนี้ไม่ได้ จึงตรวจได้แค่ผลค้นหา) สิ่งที่พบ:

- เมนู DeFi ของ Solscan แสดง volume และสัดส่วนการเทรดของ DEX/โปรโตคอลหลัก ๆ (ตามเอกสารของ Solscan)
- มีแบบฟอร์ม **Token Update** อย่างเป็นทางการ (สำหรับข้อมูลเหรียญ — โลโก้, เว็บ, โซเชียล ของเหรียญ SWD) ซึ่ง
  Solscan ระบุว่ารับเฉพาะทางแบบฟอร์มนั้น — ใช้สำหรับเหรียญ ไม่ใช่โปรโตคอล
- หน้าเว็บ Solscan มีลิงก์ **Contact Us** และบริการ **Priority Support** ที่ท้ายเว็บ; เอกสาร "Solscan Integration Guideline"
  (เก่า ~3 ปี) บอกให้ติดต่อผ่าน **Discord**
- Solscan ถูก Etherscan ซื้อกิจการ (ปี 2024 — ตามความรู้เดิม ไม่ได้ตรวจซ้ำ)

แนวทางที่แนะนำ: เข้า solscan.io → เลื่อนลงล่าง → **Contact Us** เลือกหัวข้อที่ใกล้ที่สุด (เช่น labeling / DeFi / partnership)
แล้วส่ง: ชื่อโปรเจกต์, program id, ลิงก์ Verified + IDL บน Solscan, ลิงก์รายงาน audit, ลิงก์ DefiLlama, การเชื่อม Jupiter,
ตัวเลข TVL / volume / จำนวนผู้ใช้, โลโก้ — และขอให้ทำ program label + เพิ่มในเมนู DeFi
ถ้ามีค่าใช้จ่าย (เช่น Priority Support หรือโฆษณา) ให้ถามให้ชัดว่าจ่ายเพื่ออะไร — การจ่ายเงินไม่ควรเป็นทางลัดแทน audit

### ตัวเลขที่มักถูกดู (ประสบการณ์ทั่วไปของวงการ ไม่ใช่เกณฑ์ที่ Solscan ประกาศ)

- **TVL** (ดูจาก DefiLlama) และแนวโน้มต่อเนื่อง ไม่ใช่พุ่งวันเดียว
- **Volume** 24 ชม. / 7 วัน และ **จำนวนธุรกรรม / ผู้เทรดไม่ซ้ำ** (wash trading ถูกตรวจจับได้ง่าย อย่าทำ)
- จำนวน pool ที่มีสภาพคล่องจริง, Jupiter route มาหรือไม่
- ความน่าเชื่อถือ: audit สาธารณะ, Verified build, multisig + timelock, security.txt, bug bounty
- อายุโปรเจกต์บน mainnet และการไม่มีเหตุการณ์ด้านความปลอดภัย

---

## สิ่งที่ยังไม่แน่นอน (พูดตรง ๆ)

1. **ไม่มีการรับประกัน** ว่า Solscan จะใส่ SWD AMM ในเมนู DeFi แม้ทำครบทุกข้อ — เป็นการตัดสินใจของ Solscan และไม่พบเกณฑ์ที่ประกาศ
2. ราคา audit และคิวงานเป็นตัวเลขจากบทความ ต้องขอใบเสนอราคาจริง
3. ข้อกำหนดของ Jupiter (ขั้นต่ำ $500/pool, ฟรี) มาจากเอกสารที่อาจเก่า
4. ช่อง PR template ของ DefiLlama และชื่อตัวแปร RPC อาจเปลี่ยน — กรอกตามที่ขึ้นจริง
5. ที่อยู่บัญชีราคา Pyth (ใช้เฉพาะ pool ที่เปิด oracle guard) คำนวณตามวิธีของ SDK ของ Pyth — ตรวจซ้ำก่อนใช้
6. ขั้นตอน deploy ในสคริปต์ยังไม่เคยรันจริงบน mainnet (ซ้อมแบบ dry-run แล้ว, คำสั่งตรวจกับ CLI เวอร์ชันที่ใช้แล้ว)
7. Jupiter อาจขอแก้โปรแกรมเรื่องบัญชีปลายทางของ swap (ดู README ของ SDK) ซึ่งต้อง audit ส่วนที่แก้ด้วย —
   ถามก่อน audit จะประหยัดที่สุด

ที่มา (ค้นเมื่อ 8 พ.ย. 2026): เอกสาร DEX Integration ของ Jupiter (dev.jup.ag, station.jup.ag, hub.jup.ag),
docs.solscan.io (DeFi dashboard, integration guideline, anchor verified programs), kb.solscan.io (Token Update guideline),
บทความราคา audit ของ zealynx.io, softstack.io, sherlock.xyz, docs.llama.fi
