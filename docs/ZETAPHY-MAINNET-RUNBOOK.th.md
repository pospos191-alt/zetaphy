[English](ZETAPHY-MAINNET-RUNBOOK.md) | **ภาษาไทย**

# ZETAPHY mainnet (ZTPHY): ขั้นตอนเปิดตัว

ด่านตามลำดับสำหรับเปลี่ยนเชน ZETAPHY เป็น mainnet ที่เหรียญ ZTPHY มีมูลค่าจริงได้ ต้องผ่านทุกด่านตามลำดับ และจดหลักฐานไว้ข้างๆ
ทุกด่าน ไม่มีอะไรอัตโนมัติ: ไม่มี workflow ไหนสร้าง genesis หรือเปิดโหนดของ mainnet คำสั่งของแต่ละด่านอยู่ใน
[ZETAPHY-MAINNET-PROCEDURE.th.md](ZETAPHY-MAINNET-PROCEDURE.th.md) (เครื่องมือ: `zetaphy-chain/mainnet/make-genesis.sh` และโหมด
pinned chain ของ `zetaphy-chain/setup-node.sh`) เจ้าของเป็นผู้รัน

**การตัดสินใจของเจ้าของ (2026-11-12): mainnet เปิดตัวด้วย validator 1 ตัวที่โครงการดูแลเอง และจะเพิ่มภายหลัง**
ความเสี่ยงของทางเลือกนี้: ใครคุมเครื่องนั้นหรือคีย์ของมันได้ ก็คุมเชนได้ (หยุดเชน เลือกไม่รับธุรกรรม และถ้าใช้ไบนารีที่แก้แล้วก็เปลี่ยนกฎได้
รวมถึงตัวป้องกันทุกตัวที่ระบุไว้ที่นี่) และถ้าเครื่องหายโดยไม่มีสำรองคีย์ เชนจะหยุด ผู้ใช้ได้รับแจ้งผ่านประกาศสาธารณะในเอกสารขั้นตอน
พร้อมเรื่อง audit ที่ยังไม่เสร็จ (ด่าน 1) ด่าน 2 ข้างล่างยังเป็นเป้าหมาย โดยระบุว่าเป็นการตัดสินใจนี้

**การตัดสินใจของเจ้าของ (2026-11-13): เปิด mainnet `zetaphy_3659-1` เมื่อ 2026-11-13 เวลา 14:00 UTC ก่อนผ่านด่าน 1, 3 และ 5**
genesis sha256 `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667` ไฟล์ที่เผยแพร่: [zetaphy-chain/mainnet/zetaphy_3659-1/](../zetaphy-chain/mainnet/zetaphy_3659-1/README.th.md)
ประกาศสาธารณะ: [ZETAPHY-MAINNET-NOTICE.th.md](ZETAPHY-MAINNET-NOTICE.th.md) ด่านที่ยังไม่ผ่านยังเปิดอยู่ข้างล่าง และยังต้องทำตามลำดับ

ค่าธรรมเนียม การ deploy และ gas บน ZETAPHY จ่ายด้วย ZTPHY ไม่ต้องใช้ SOL หรือเหรียญอื่น (SOL ใช้เฉพาะ program swd-amm
บน Solana ซึ่งเป็นงานแยก ดู [MAINNET_RUNBOOK.md](MAINNET_RUNBOOK.md))

**สถานะ 2026-11-13:** mainnet ทำงานแล้ว (ตามการตัดสินใจของเจ้าของด้านบน) ด้วย validator 1 ตัว ด่าน 1 ยังไม่เริ่ม ด่าน 3 เริ่ม 2026-11-12
และยังไม่ครบ ด่าน 4, 6 และ 7 เสร็จ ตามที่จดไว้ข้างล่าง ด่าน 8 ถึง 10 ยังเปิดอยู่ testnet (`zetaphy_77390-1`) ยังรันต่อเพื่อซ้อม upgrade

| ด่าน | อะไร | สถานะ |
|---|---|---|
| 1 | audit อิสระจากภายนอก ตรวจ commit ที่จะ release แก้ทุก Critical/High และให้ผู้ตรวจยืนยัน | ❌ ยังไม่เริ่ม |
| 2 | validator อิสระอย่างน้อย 4 ราย ไม่มีรายไหนเกิน 1/3 ของ power | ⚠️ การตัดสินใจของเจ้าของ: เปิดด้วย 1 validator; มีแผนเพิ่ม |
| 3 | release ตัวนี้รันบน testnet อย่างน้อย 4 สัปดาห์โดยไม่มีปัญหา | ⏳ เริ่ม 2026-11-12 |
| 4 | กุญแจใหม่ทั้งหมด ไม่มีกุญแจไหนอยู่บนเครื่องสาธารณะ | ✅ 2026-11-13 |
| 5 | release สำหรับ mainnet: เซ็นแล้ว publish แล้ว ล็อก fingerprint | ⚠️ การตัดสินใจของเจ้าของ: ใช้ release ที่ยังไม่ audit (จดในด่าน 5) |
| 6 | พิธีสร้าง genesis ร่วมกับ validator ทุกราย | ✅ 2026-11-13 |
| 7 | เปิดเชนพร้อมกัน | ✅ 2026-11-13 14:00 UTC (ตรวจบล็อก, ใบรับรองโหวต PQ และยอดเงินแล้ว) |
| 8 | deploy contract ด้วย ZTPHY แล้วส่งสิทธิ์ admin ให้ governance | ✅ 2026-11-13 (timelock 48 ชั่วโมง; ยังไม่มี bridge; [contracts.json](../zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json)) |
| 9 | การดูแลระบบ: monitoring, bounty, แผนรับเหตุ | ❌ |
| 10 | RPC สาธารณะ, กระเป๋า, registry, listing | ⏳ RPC สาธารณะเปิดแล้ว 2026-11-13 (https://129-221-199-191.sslip.io ผ่าน sentry; validator ไม่เปิดพอร์ตสาธารณะ) เตรียมไฟล์ listing แล้ว |

## ด่าน 1: audit อิสระจากภายนอก

รีวิวภายในไม่นับเป็น audit ของด่านนี้ ไม่ว่าใครเขียน (`audit/REPORT.md`, รีวิว team-only วันที่ 2026-11-10) audit จะนับก็ต่อเมื่อ:

- ทำโดยบริษัทที่มีชื่อ หรือการแข่งขันแบบเปิด (เช่น Code4rena, Sherlock, Cantina) ที่เป็นอิสระจากทีม
- ขอบเขตระบุ commit และ fingerprint ของ `setup-node.sh` ของ release ที่จะรัน mainnet จริง ครอบคลุม patch ของโหนด (บัญชีและ
  ลายเซ็น PQ, Q-day, quantum lock, guard, invariant firewall, chain guard, IBC hold และ rate limit, vote extension, upgrade
  handler), สคริปต์ติดตั้งและอัปเกรดโหนด และ contract ที่จะถือมูลค่า (Saphan bridge, DEX, Neuro, timelock, multisig, bounty)
- ผู้ตรวจรันโค้ดจริง (fork test, devnet) ไม่ใช่แค่อ่าน
- แก้ทุก Critical และ High แล้ว และผู้ตรวจยืนยันการแก้แต่ละข้อเป็นลายลักษณ์อักษร
- เผยแพร่รายงาน (รายละเอียดวิธีโจมตีเก็บเป็นความลับได้จนกว่าจะแก้)

ก่อนส่งโค้ดให้ตรวจ แก้ข้อที่ค้างจากรีวิวภายในก่อน (รายการลับวันที่ 2026-11-10 เริ่มจากข้อ High) เพื่อให้ audit ที่จ่ายเงินใช้เวลากับสิ่งที่เหลือ

จดไว้ตรงนี้: บริษัท / การแข่งขัน `________`, URL รายงาน `________`, commit ที่ตรวจ `________`, fingerprint `________`

## ด่าน 2: validator อิสระ

**การตัดสินใจของเจ้าของ: เปิดด้วย 1 validator; มีแผนเพิ่ม** (ความเสี่ยง: ข้างบน และในเอกสารขั้นตอน) การเพิ่ม validator:
ข้อ 17 ของ[เอกสารขั้นตอน](ZETAPHY-MAINNET-PROCEDURE.th.md) เป้าหมายยังคงเป็น:

- **อย่างน้อย 4 ราย** ที่ดูแลโดยคนหรือองค์กรต่างกัน บนเครื่องและผู้ให้บริการต่างกัน CometBFT ปลอดภัยเฉพาะเมื่อ power ที่ไม่ซื่อสัตย์
  น้อยกว่า 1/3: มี 4 ราย พังหรือถูกยึดได้ 1 ราย ถ้ามีรายเดียว ใครยึดเครื่องนั้นได้ก็คุมเชนได้ทั้งหมด (เขียนประวัติใหม่ พิมพ์เหรียญ
  เปลี่ยนกฎ) และตัวป้องกันทุกตัวใน [ANTI-ROLLBACK-CHAIN.th.md](ANTI-ROLLBACK-CHAIN.th.md) ถูกผู้ดูแลคนเดียวนั้นถอดออกได้
- ไม่มี validator ไหนเกิน 1/3 ของ voting power ตอน genesis เพดาน power ของ chain guard (3333 bps) รักษาไว้เมื่อมีตั้งแต่ 4 รายขึ้นไป
- แต่ละราย: กุญแจของตัวเอง (ควรใช้ remote signer เช่น Horcrux), sentry ของตัวเอง, ติดตั้งโหนดจาก release ที่เซ็นแล้วและตรวจด้วย
  `verify-release.sh`, และมีผู้ติดต่อเมื่อเกิดเหตุ
- เริ่มหาบน testnet: ชวนผู้ดูแลเมื่อ RPC สาธารณะเปิดกลับมา และให้รัน validator บน testnet ก่อน
  ([zetaphy-chain/README.md](../zetaphy-chain/README.md) และ `zetaphy-validator`)

จดไว้ตรงนี้: validator แต่ละราย (ชื่อ, ช่องทางติดต่อ, operator address) `zetaphy-validator-0` (โครงการ ZETAPHY ดู SECURITY.md),
`zetaphyvaloper1l9fxu7xn7yrug9rlsve9hs4mgtpn9zej9tqvx8`, node id `9d71e8582823a74d2cfbf51b1c6ef4af50e94e5c`

## ด่าน 3: รันบน testnet ให้นิ่ง

- release ที่จะรัน mainnet (หรือตัวที่รวมการแก้จาก audit) รันบน testnet **อย่างน้อย 4 สัปดาห์** โดย: ไม่มี consensus failure ไม่มี
  app hash ไม่ตรง ไม่มี start guard ปฏิเสธโดยไม่ได้ตั้งใจ validator ทุกรายผ่าน upgrade อย่างน้อย 1 ครั้ง และการโจมตีใน
  `test-anti-rollback.sh` ยังถูกปฏิเสธใน CI
- เปิด bounty บน testnet (`ZetaphyBounty` บน testnet) ระหว่างช่วงนี้

## ด่าน 4: กุญแจใหม่

ห้ามใช้กุญแจที่เคยแตะ testnet, secret ของ CI, กระเป๋าในเบราว์เซอร์ที่ใช้ทดสอบ หรือ VM ของ testnet

| บทบาท | ผู้ถือ | เก็บที่ |
|---|---|---|
| กุญแจ consensus ของ validator แต่ละราย | validator รายนั้น | remote signer / hardware ห้ามอยู่บนเครื่อง RPC |
| สมาชิก multisig ของ governance (อย่างน้อย 2-of-3) | คนละคน | hardware wallet |
| ผู้มีสิทธิ์สั่ง circuit breaker (multisig อย่างน้อย 2 กุญแจที่ต่างกัน) | คนละคน | hardware wallet |
| บัญชีกองทุนใน genesis (rewards, airdrop, team, treasury) | multisig หรือบัญชี vesting | **ห้าม**อยู่บนโหนดหรือเครื่อง RPC ใดๆ ห้ามใช้ keyring `test` |
| deployer (contract) | ใช้ครั้งเดียวแล้วเลิกใช้ | offline |

ทำแล้วเมื่อ 2026-11-13: กุญแจผู้เซ็น 3 ดอก (A, B, C) สร้างบน VM ชั่วคราวที่ตัดอินเทอร์เน็ต (ลบ VM แล้ว คำกู้กุญแจจดบนกระดาษ และตรวจแล้วทุกดอกด้วยการกู้คืน)
multisig แบบ 2 จาก 3 จำนวน 6 ตัวจากกุญแจชุดนี้ (circuit authority และกองเหรียญ 5 กอง เรียงลำดับกุญแจต่างกัน) และกุญแจ validator บนเครื่อง validator

## ด่าน 5: release สำหรับ mainnet

- build โดย `release-zetaphyd.yml` จาก commit ที่ผ่าน audit (หรือ commit นั้นบวกการแก้ที่ผู้ตรวจยืนยันแล้ว) เซ็นด้วย Sigstore และ
  validator ทุกรายตรวจด้วย `zetaphy-chain/verify-release.sh` (ต้องได้ `VERIFIED` เท่านั้น)
- ล็อกไว้ตรงนี้: release tag `zetaphyd-a5698832d273`, commit `dc0d0bbbaa827c0b5049603ab3fec8a56c8c7f44`, sha256 ของ `setup-node.sh`
  `a5698832d273aa3e297b0ff7365ca5eeb4b024adb9d361a2e82f052c4ce70c6d` (การตัดสินใจของเจ้าของ 2026-11-13: ยังไม่ audit ด่าน 1 ยังต้องทำ)
- publish `zetaphy-chain/public/v/<sha>.sh` ก่อนที่อะไรจะชี้ไปหามัน (cloud-init และเอกสาร)

## ด่าน 6: พิธีสร้าง genesis

validator ทุกรายร่วมด้วย ไม่มีใครใช้สถานะของ testnet

1. **chain id ใหม่** (ไม่ใช่ `zetaphy_77390-1`) และ EVM chain id ใหม่ ตรวจว่ายังไม่มีใครใช้ใน chain registry และ chainlist
2. ผู้ประสานงานเขียน genesis ฉบับร่าง: denom (ZTPHY, 18 ทศนิยม), supply และการจัดสรรที่ตกลงกันในที่สาธารณะ, พารามิเตอร์ของ
   governance และ staking, กำหนดการ Q-day, ความสูงของ firewall/guard เป็น 0 (ทำงานตั้งแต่บล็อก 1), ค่าของ chain guard (รายการ
   อัลกอริทึม, เพดาน power 3333, circuit authority = multisig ของด่าน 4, **เปิด constitution**: บน mainnet ค่าขั้นต่ำของมันปกป้อง
   ผู้ถือเหรียญจากการยึด governance)
3. validator แต่ละรายสร้าง gentx ด้วยกุญแจใหม่ ผู้ประสานงานรวบรวม ทุกคนตรวจ genesis ฉบับสุดท้ายแล้วเซ็นรับรอง sha256 ในที่สาธารณะ
4. ฝัง `GENESIS_SHA256` ที่ประกาศไว้ในสคริปต์ของโหนด เพื่อให้โหนดที่เข้าร่วมใหม่ปฏิเสธ genesis อื่น
5. บัญชี vesting สำหรับ team และ treasury ไม่มีกุญแจกองทุนบนเครื่องสาธารณะ

จดไว้ตรงนี้: chain id `zetaphy_3659-1` (EVM 3659), sha256 ของ genesis `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`, ลายเซ็นรับรอง `________`
genesis ถูกสร้างซ้ำแยกอีกเครื่องจาก draft และ gentx และได้ sha256 เดียวกัน

## ด่าน 7: เปิดเชนพร้อมกัน

- นัดเวลา genesis ที่ validator ทุกรายตกลง แต่ละรายรัน release ของด่าน 5, `verify-release.sh --record` แล้วเริ่ม
- เชนต้องมี power ออนไลน์เกิน 2/3 จึงจะสร้างบล็อกแรกได้ ถ้ามี 4 ราย ต้องออนไลน์อย่างน้อย 3
- เฝ้าดู: บล็อกเดินต่อ validator ทุกรายเซ็น app hash ตรงกัน และ start guard ไม่มี log ที่ไม่คาดคิด

## ด่าน 8: contract (จ่ายด้วย ZTPHY)

deploy ด้วย deployer ของด่าน 4 แล้วส่งสิทธิ์ admin ทุกตัวให้ governance ผ่าน timelock ก่อนจะมีมูลค่าเข้ามา ลำดับที่แนะนำ: timelock
และ multisig; Saphan bridge (ปิดไว้ เปิดเฉพาะเมื่อผ่านด่านของมันเองและมี monitor); DEX; Neuro; `ZetaphyBounty` (เติมเงินแล้ว)
ยืนยัน source ของทุก contract (Sourcify) และประกาศ address

## ด่าน 9: การดูแลระบบ

- monitoring และการแจ้งเตือน: บล็อกที่ validator แต่ละรายพลาด, app hash ตรงกัน, เหตุการณ์ของ start guard และ circuit breaker,
  แผน upgrade, การโอนออกก้อนใหญ่, breaker ของ bridge
- แผนรับเหตุ: ใครสั่ง circuit breaker ได้ (multisig), ส่งการแก้ไบนารีอย่างไร (release ที่เซ็นแล้ว + upgrade), ช่องทางติดต่อ validator ทุกราย
- bounty ที่เติมเงินแล้วและประกาศไว้ พร้อมอีเมล `security@` ที่ใช้งานได้
- การสำรอง: ห้ามกู้ `priv_validator_state.json` หรือ `zetaphy_sign_state.json` จากสำเนาที่เก่ากว่า

## ด่าน 10: เปิดให้สาธารณะ

- RPC สาธารณะผ่าน rpc-guard พร้อมตั้งงบ egress; กระเป๋า (MetaMask, Keplr, Snap) ด้วย chain id ใหม่; ลงทะเบียน chain-registry
  และ chainlist (หลังด่าน 1–7 เท่านั้น); explorer
- หน้าเว็บเอาป้าย testnet ออกหลังด่าน 1–8 เท่านั้น
- ปรึกษากฎหมายเรื่องการเปิดตัวในประเทศเป้าหมาย (ดู `docs/LEGAL.md`)
