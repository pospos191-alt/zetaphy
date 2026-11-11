[English](ANTI-ROLLBACK-CHAIN.md) | **ภาษาไทย**

# ตัวกันถอยหลังและกันยึดเชน (ฝั่งเชน)

ใช้กับ testnet เท่านั้น ไม่มีส่วนใดถือหรือจ่ายเงินจริง และยังไม่มีบริษัทภายนอกตรวจสอบ (audit)

ตัวกันหกอย่างสำหรับวิธีที่โหนดหรือเชนอาจถูกพาถอยหลังหรือถูกยึด: ไบนารีเก่า, สำเนาเก่าของสถานะการเซ็น,
อัลกอริทึมลายเซ็นที่อ่อนกว่า, validator ตัวเดียวที่มีอำนาจมากเกินไป, เหตุฉุกเฉินที่ไม่มีเบรก และการโหวต governance
ที่รื้อการป้องกันทิ้ง สองอย่างเป็นการตรวจของโหนดตอนเริ่ม อีกสี่อย่างเป็นกฎของเชนที่มากับ software upgrade ตัวเดียว
คือ **`zetaphy-guard`** และจะปิดอยู่หรือผ่อนปรนจนกว่า governance จะใช้

| ตัวกัน | กันอะไร | อยู่ที่ไหน | ค่าเริ่มต้น |
|---|---|---|---|
| L1-1 กัน downgrade | ไบนารีที่รันบล็อกถัดไปของเชนไม่ได้ (ไม่มี handler ของ upgrade ล่าสุดที่ทำแล้ว, แผนที่ถึงกำหนดแต่ไม่มี handler, upgrade ที่ห้ามติดตั้งก่อนแต่ติดตั้งก่อน) | `zetaphyd start`, `evmd/zetaphy_antirollback.go` | เปิด ทุกครั้งที่เริ่ม |
| L1-2 กันสถานะการเซ็นถอยหลัง | validator ที่เริ่มด้วย `priv_validator_state.json` เก่ากว่าความสูงที่เคยเซ็นแล้ว (กู้ snapshot / backup): double sign | `zetaphyd start` ไฟล์เดียวกัน | เปิด ทุกครั้งที่เริ่ม |
| T อัลกอริทึมลายเซ็น | crypto downgrade: เปิดอัลกอริทึมที่ปลดแล้วกลับ, เอา ECDSA กลับหลัง Q-day, ปลด quantum lock | `evmd/zetaphy_chainguard.go`, ante handler, `MsgSetQDay` | รายการ = เปิดทั้งสามอัลกอริทึม ยังไม่ปลดอะไร |
| S1 เพดานอำนาจโหวต | delegation หรือ self-bond ที่ทำให้ validator ตัวหนึ่งเกิน `max_bps` ของชุดที่ active | staking hooks (ทุกเส้นทาง) | 3333 bps บังคับเฉพาะเมื่อมี validator active ≥ 4 |
| S2 circuit breaker | ไม่มีผลจนกว่าจะ trip แล้วชนิดข้อความที่ trip จะล้มเหลวทุกที่ | message router + ante | ยังไม่มี authority ไม่มีอะไรถูก trip |
| P รัฐธรรมนูญ | ข้อเสนอ governance ที่ mint เพิ่ม, เขียนยอดเงินใหม่, ย่น timelock/unbonding, ลดเกณฑ์ หรือรื้อตัวกัน | ตอนยื่นข้อเสนอ (ante) + ตอนรัน (gov router) | **ปิด** (เปิดตอน mainnet) |

ทั้งหมดอยู่ใน `ZETAPHY_PQ_PATCH` ที่ฝังใน `zetaphy-chain/setup-node.sh` เทสต์อยู่ที่
`zetaphy-chain/fork-tests/evmd/zetaphy_chainguard_test.go` (+ เทสต์ upgrade) และการโจมตีบน devnet อยู่ที่
`zetaphy-chain/test-anti-rollback.sh` (CI job `zetaphy-chain-attacks`)

## L1-1 และ L1-2: start guard

`zetaphyd start` สร้างแอปบนสถานะที่ commit แล้ว และก่อนที่ CometBFT จะเปิดฐานข้อมูล ต่อ peer หรือเซ็นอะไร จะตรวจสองอย่าง
ถ้าปฏิเสธ จะพิมพ์หนึ่งบรรทัดลง journal และ stderr แล้วออกด้วย status 78 unit ของ systemd มี
`RestartPreventExitStatus=78` ดังนั้น `systemctl status zetaphyd` จะแสดงว่าล้มเหลว แทนที่จะรีสตาร์ตทุก 5 วินาที

**L1-1 (downgrade)** อ่าน upgrade ล่าสุดที่ทำแล้วและแผนที่ตั้งไว้จากสถานะ x/upgrade ในเครื่อง แล้วใช้กฎเดียวกับ
`zetaphyd upgrade-check` (`zetaphyUpgradeCheck`): ไบนารีต้องมี handler ของ upgrade ล่าสุดที่ทำแล้ว แผนที่ถึงกำหนดในบล็อกถัดไป
ต้องมี handler แผนที่ยังไม่ถึงกำหนดแต่ไบนารีนี้มี handler แล้ว ต้องเป็นชนิดที่ติดตั้งก่อนได้ (`zetaphyEarlyUpgrades`)
x/upgrade ตรวจข้อแรกตอนรันบล็อกแรกเท่านั้น หลังโหนดเข้าเครือข่ายและโหวตไปแล้ว (เหตุเชนหยุดที่บล็อก 239468 วันที่ 2026-11-05)
ตัวนี้ปฏิเสธก่อน ความสูง `--unsafe-skip-upgrades` ยังใช้ได้ตามเดิม

```
ZETAPHY start guard: refused to start: this binary has no handler for "zetaphy-guard", the chain's last completed
upgrade: ... Install the binary the chain needs; only if you mean it (e.g. a planned rollback): start once with
ZETAPHY_ALLOW_DOWNGRADE=zetaphy_77390-1:350123
```

**L1-2 (สถานะการเซ็น)** สำหรับ validator ที่มีคีย์ในเครื่อง (`priv_validator_laddr` ว่าง; Horcrux และ remote signer อื่นเก็บ
สถานะของตัวเองและไม่ถูกตรวจที่นี่) `data/priv_validator_state.json` ต้องไม่ต่ำกว่าค่าที่สูงที่สุดของ:

- ความสูงล่าสุดใน 1,000 บล็อกท้ายของ block store ในเครื่อง ที่ commit มีลายเซ็นของ validator นี้
- `config/zetaphy_sign_state.json` บันทึกการเซ็น: โหนดเขียนความสูงของทุก precommit ที่กำลังจะเซ็น (จาก `ExtendVote` ซึ่ง
  CometBFT เรียกก่อนเซ็น precommit) เก็บใน `config/` **นอก `data/`** การใส่สำเนาเก่าของ `data/` กลับ (snapshot, backup,
  ดิสก์ที่ clone) จึงไม่ทำให้บันทึกนี้ถอยตาม บันทึกผูกกับ chain id และ sha256 ของ `genesis.json` เชนใหม่ใน home เดิมจึงไม่รับช่วงต่อ

ไฟล์สถานะที่หายไปหรือเก่ากว่าคือสิ่งที่ snapshot ที่กู้คืนทิ้งไว้ validator ที่เริ่มด้วยไฟล์นั้นอาจเซ็นบล็อกที่สองที่ต่างกันใน
ความสูงที่เคยเซ็นแล้ว: double sign ถูก slash และ tombstone block store อย่างเดียวมองไม่เห็นกรณีนี้ (snapshot มี block store
เก่ามาด้วย) แต่บันทึกการเซ็นมองเห็น

สิ่งที่ตัวกันมองไม่เห็น: สำเนาของ home ทั้งหมด (รวม `config/`) ที่กู้คืนพร้อมกัน หรือคีย์ที่รันบนสองเครื่องพร้อมกัน ห้ามรันคีย์
validator สองที่ สำหรับกรณีเหล่านั้นให้ใช้ remote signer (Horcrux, `zetaphy-chain/horcrux/`) และบนเชนที่มี validator มาก
ใช้ `double_sign_check_height` ของ CometBFT

**Override** (ทั้งสองการตรวจ): `ZETAPHY_ALLOW_DOWNGRADE=<chain-id>:<height>` โดย height คือ **ความสูงบล็อกล่าสุดที่ commit
แล้วของโหนด** ตามที่ข้อความปฏิเสธพิมพ์ทุกตัวอักษร ค่าที่ผิดหรือเก่าจะถูกข้าม (บันทึกไว้) และโหนดยังปฏิเสธ ค่าที่ถูกจะเริ่มโหนด
ได้หนึ่งครั้ง บันทึกระดับ error (`ZETAPHY START GUARD OVERRIDDEN`) และตั้งบันทึกการเซ็นใหม่ให้เท่ากับความสูงของไฟล์สถานะ
พอโหนด commit บล็อกใหม่ ค่านี้ก็ไม่ตรงอีก

```bash
sudo systemctl set-environment ZETAPHY_ALLOW_DOWNGRADE=<chain-id>:<height>     # [เปลี่ยนไฟล์] environment ของ systemd
sudo systemctl restart zetaphyd && sudo systemctl unset-environment ZETAPHY_ALLOW_DOWNGRADE
journalctl -u zetaphyd -n 30 --no-pager | grep -E 'START GUARD|start guard'      # [อ่าน]
```

ใช้เฉพาะตอนถอยทั้งเชนแบบวางแผนไว้ (testnet ที่มี validator ตัวเดียว: บล็อกหลังสำเนาถูกทิ้งไปด้วย ไม่มีใครอื่นเซ็น) บนเชนที่มี
validator อื่น ให้ใส่ `priv_validator_state.json` ล่าสุดกลับแทน ห้าม override L1-2 ที่นั่นเด็ดขาด

### `setup-node.sh` และ pre-flight

`setup-node.sh` (และ `zetaphy-validator update`) ยังรัน `upgrade-check` ด้วยไบนารีใหม่กับโหนดที่รันอยู่ก่อนเปลี่ยน
`/usr/local/bin/zetaphyd` ทางข้าม `UPGRADE_CHECK=0` แบบเดิมไม่มีแล้ว (ถูกข้ามพร้อมข้อความแจ้ง) ไบนารีที่ไม่ผ่านจะติดตั้งได้เฉพาะ
เมื่อมี `ZETAPHY_ALLOW_DOWNGRADE=<chain-id>:<height>` ที่เป็น chain ของโหนดนี้และความสูงที่ต่ำกว่าความสูงปัจจุบันไม่เกิน 100 บล็อก
(ข้อความปฏิเสธพิมพ์ค่าให้) ทุกครั้งที่ใช้จะบันทึกระดับ `user.crit` ลง journal (`journalctl -t zetaphy-setup`) และ
`/var/log/zetaphy-setup.log` ไบนารีที่ติดตั้งแล้วยังรัน start guard ของตัวเองอีก

สคริปต์ติดตั้งไม่เคยเขียน `priv_validator_state.json` จาก backup: `zetaphy-validator backup` ระบุว่าเป็นไฟล์ที่อยู่ในเครื่อง และ
`setup-horcrux.sh` ขยับมันไปข้างหน้าเท่านั้น (+2) ขั้นตอน rollback ใน [CHAIN-FIREWALL.th.md](CHAIN-FIREWALL.th.md) เก็บสำเนา
ไฟล์สถานะล่าสุดไว้ก่อนใส่ข้อมูลเก่ากลับ

## T: ไม่มี crypto downgrade

เชนเก็บรายการอัลกอริทึมลายเซ็นของบัญชีพร้อมเวอร์ชัน (คีย์ `0x41` ของ store `zetaphypq`):

```json
{"version": 0, "enabled": ["eth_secp256k1", "mldsa44", "secp256k1"], "retired": []}
```

governance เปลี่ยนด้วย `zetaphyd tx security-proposal sig-algos '<json>'`:
`{"version": <ปัจจุบัน+1>, "enable": [...], "retire": [...]}`

- เวอร์ชันเดินหน้าอย่างเดียว ทีละหนึ่ง
- อัลกอริทึมที่ปลดแล้วจะถูกปฏิเสธนับจากนั้น: ธุรกรรม Cosmos ที่คีย์ของผู้เซ็นใช้อัลกอริทึมนั้น (รวมคีย์ย่อยของ multisig) และ
  สำหรับ `eth_secp256k1` คือธุรกรรม Ethereum (รวม authorization ของ EIP-7702 ที่อยู่ในนั้น) เงินยังอยู่ บัญชีที่ quantum lock
  ไว้ยังทำงานผ่าน controller ML-DSA-44 ได้
- **อัลกอริทึมที่ปลดแล้วเปิดกลับไม่ได้อีกเลย** เปิดได้เฉพาะอัลกอริทึมที่ไบนารีนี้ตรวจได้
- `mldsa44` (อัลกอริทึม post-quantum ตัวเดียว) ปลดไม่ได้ ต้องมีอัลกอริทึม post-quantum เปิดอยู่อย่างน้อยหนึ่งตัวเสมอ
- **Q-day ไม่ถอย** เมื่อผ่าน Q-day แล้ว `MsgSetQDay` จะถูกปฏิเสธ (สิ่งที่มันทำได้คือยกเลิกหรือเลื่อนออกไป ซึ่งทั้งสองอย่างเอา
  ECDSA กลับมา) ก่อนถึง Q-day governance ยังเลื่อนได้
- **quantum lock ยังเป็น post-quantum** (เป็นจริงอยู่แล้ว ตอนนี้มีเทสต์): ไม่มีข้อความใดปลด lock การควบคุมย้ายได้เฉพาะไปบัญชี
  ML-DSA-44 อื่นที่ไม่ได้ถูก lock เอง และคีย์ ECDSA ที่ถูก lock ถูกปฏิเสธทุกที่

`ecrecover` ระดับสัญญาตาม Q-day ไม่ได้ตามรายการนี้

## S1: เพดานอำนาจโหวต

`max_bps` (คีย์ `0x42` ค่าเริ่ม 3333 = ต่ำกว่า 1/3 เล็กน้อย validator ตัวเดียวจึงหยุดเชนเองไม่ได้) delegation, redelegation หรือ
self-bond (`MsgCreateValidator`) ที่จะทำให้ validator ปลายทางเกิน `max_bps` ของอำนาจในชุดที่ active (นับ validator นั้นเหมือน
เข้าชุดแล้ว) จะล้มเหลวด้วย `voting power cap` บังคับ **เฉพาะเมื่อชุด active ล่าสุดมี validator อย่างน้อย 4 ตัว**: testnet
(validator 1 ตัว) และ devnet ของ CI (2 ตัว 60/40) ไม่ถูกปฏิเสธเลย staking hooks เห็นทุกเส้นทาง: ข้อความ Cosmos, authz,
staking precompile (0x…0800) และ gentx ตรวจเฉพาะการเพิ่ม: การ undelegate จาก หรือการ slash validator ที่เกินเพดาน
ไม่ถูกบล็อก governance: `zetaphyd tx security-proposal power-cap <bps>` (0 = ปิด)

## S2: circuit breaker

ตัวเทียบเท่า `x/circuit` ของ Cosmos SDK (SDK v0.54 ไม่มีให้แล้ว) เก็บใน store เดิม (upgrade จึงไม่เพิ่ม store และติดตั้งก่อนได้
ดูด้านล่าง) อยู่ใน message router (`MsgServiceRouter.SetCircuit`) ชนิดข้อความที่ trip จึงล้มเหลวทุกที่ที่มันรัน: ธุรกรรมระดับบน,
`authz` `MsgExec`, ข้อเสนอ governance, ICA และ ante handler ปฏิเสธตั้งแต่ CheckTx

- **Authority**: governance ตั้ง (`security-proposal circuit-authority <zetaphy1…>`) ต้องเป็นบัญชี **multisig** ที่ threshold
  อย่างน้อย 2 จากคีย์ไม่ซ้ำอย่างน้อย 2 ตัว ตรวจจาก public key บนเชนทุกครั้งที่ใช้ คีย์เดี่ยว (หรือ multisig 1-of-N) จึง trip อะไร
  ไม่ได้เลย governance เอง trip และ reset ได้เสมอ
- **Trip / reset**: `zetaphyd tx circuit trip|reset <type URL>[,...] --from <multisig>` (สร้างด้วย `--generate-only`, เซ็นด้วย
  `tx sign --multisig ... --sign-mode amino-json` ทีละคีย์, รวมด้วย `tx multisign`, broadcast) หรือ
  `security-proposal circuit-trip|circuit-reset` CLI พิมพ์ข้อความ ZETAPHY ใน JSON โดยไม่มีฟิลด์ ให้ใส่ข้อความกลับด้วยชื่อฟิลด์แบบ Go
  (`Authority`, `Kind`, `Data` เป็น base64) ทั้งในไฟล์ที่ยังไม่เซ็นและไฟล์ที่รวมแล้ว แบบที่ `test-anti-rollback.sh` (`ms_tx`) ทำ
  ลายเซ็นครอบคลุมข้อความ (ข้อความที่ถูกแก้จะถูกปฏิเสธ)
- **trip ไม่ได้เลย**: `/cosmos.gov.*`, `/cosmos.upgrade.*`, `/cosmos.consensus.*`, `MsgUnjail` และ `MsgSetFuture`,
  `MsgPQCertificate`, `MsgZXVotes`, `MsgPQVoteKey` ของเชนเอง governance จึง reset ได้เสมอ และบล็อกยังมี certificate

## P: รัฐธรรมนูญ (ปิดเป็นค่าเริ่ม)

`security-proposal constitution on` (คีย์ `0x45`) เมื่อเปิด ค่าที่ใช้อยู่จะกลายเป็นพื้น (หรือเพดาน) และนับจากนั้นข้อเสนอ
governance จะถูกปฏิเสธตอนยื่น (ธุรกรรม Cosmos) และอีกครั้งตอนรัน (ทุกเส้นทาง ผ่าน governance router) ถ้ามันจะ:

- รัน `sudo` ของสัญญา CosmWasm (เขียนสถานะและยอดเงินของสัญญาใดก็ได้)
- mint เพิ่ม: เพิ่ม `inflation_max`, `inflation_min`, `inflation_rate_change` หรือ `max_supply` (หรือทำให้ไม่จำกัด), ลด
  `blocks_per_year` หรือเปลี่ยน mint denom
- เขียนยอดเงินใหม่ด้วยการเปลี่ยน bond denom หรือ EVM denom
- ย่น `unbonding_time`, `voting_period`, `expedited_voting_period`, reveal delay ของ Q-day หรือ delay ของ IBC hold
- ลด `quorum`, `threshold`, `veto_threshold`, `expedited_threshold` หรือ `slash_fraction_double_sign`
- เอาเพดานอำนาจออก หรือยกให้สูงกว่าค่าตอนเปิด
- เปลี่ยนหรือปิดรัฐธรรมนูญเอง

บน testnet นี้ปิดไว้ สิ่งที่มีอยู่จึงไม่เปลี่ยน ตั้งใจให้เปิดตอน mainnet งานนี้ไม่ได้เปลี่ยนค่า timelock ใดที่มีอยู่ ข้อจำกัด:
governance ยังรันข้อความธรรมดาในนามบัญชี governance ได้ (เช่น `MsgEVMCall` ไปยังสัญญาที่มันเป็นเจ้าของ แบบที่ `gov.sh neuro`
ทำ) และยังโหวต software upgrade ไปไบนารีที่ไม่มีกฎเหล่านี้ได้ timelock ระดับสัญญา (`ZetaphyTimelock` 48 ชม.) แยกกันและไม่เปลี่ยน

## upgrade `zetaphy-guard`

handler ตั้งคีย์ `0x40` ของ store `zetaphypq` เป็นความสูง upgrade + 1 และรัน module migration (ไม่มี) **ไม่เพิ่ม store**:
ค่าใหม่ทั้งหมดอยู่ใน store `zetaphypq` เดิม `zetaphy-guard` จึงอยู่ใน `zetaphyEarlyUpgrades` และ validator ติดตั้งไบนารีใหม่
เมื่อไรก็ได้ก่อนความสูงนั้น ต่ำกว่าความสูงนั้น ทุกเส้นทางใหม่คืนค่าเหมือนไบนารีที่ไม่มีมันทุกอย่าง โดยอ่าน `0x40` โดยไม่คิด gas:
kind ใหม่ของ `MsgSetFuture` ล้มเหลวด้วยข้อความ error เดิม ส่วน router, staking hooks, การตรวจใน ante และ `MsgSetQDay`
ทำงานเหมือนเดิม ต้องมี v5 (`zetaphy-v5` testnet ทำแล้ว) เชนใหม่ใส่ `0x40` ใน genesis ได้ (`app_state.zetaphypq`)

ตรวจแล้ว: `TestChainGuardOffBeforeHeight` (error และ gas เหมือนเดิมก่อนความสูง store ไม่ถูกแตะ),
`TestChainGuardUpgradeHandler`, `TestUpgradeRestartAfterEveryUpgrade` (ตอนนี้มี `zetaphy-guard` และ start guard เห็นด้วย)
และบน devnet: validator A ใช้ไบนารีก่อนงานนี้ validator B กับ full node ใช้ไบนารีใหม่ รัน bank, staking และข้อเสนอ chain-guard
ที่ล้มเหลว ได้ app hash เดียวกันทุกความสูงที่เทียบ ที่ความสูง upgrade A หยุด (`UPGRADE "zetaphy-guard" NEEDED`) B รัน
upgrade เอง A เปลี่ยนไบนารีแล้วเชนเดินต่อ

## เปิดใช้บน testnet ที่รันอยู่

สัญลักษณ์เหมือน [CHAIN-FIREWALL.th.md](CHAIN-FIREWALL.th.md): **[อ่าน]** ไม่เปลี่ยนอะไร, **[เปลี่ยนไฟล์]**, **[เปลี่ยนเชน]**
ไม่มีขั้นใดถูกรันกับโหนดจริง การโหวต governance ใช้ voting period ของเชน (600 วินาทีบน testnet) ไม่มีขั้นใดข้ามการโหวต และ
ไม่มีขั้นใดแตะ `ZetaphyTimelock`: งาน admin ของสัญญายังรอ 48 ชั่วโมงตามเดิม

1. merge, publish `public/` (fingerprint ใหม่ของ `setup-node.sh`) และรอ build ของ `release-zetaphyd` เหมือนทุกครั้งที่เปลี่ยน
   `setup-node.sh`
2. **[อ่าน]** `zetaphyd q upgrade applied zetaphy-firewall` ต้องแสดงความสูง (testnet มี v5 และ firewall แล้ว)
3. **[เปลี่ยนไฟล์]** ติดตั้ง release ใหม่ (`sudo zetaphy-validator update` หรือขั้น 3–4 ของ runbook firewall โดยใช้
   `zetaphy-guard`) `upgrade-check` ผ่าน (upgrade ที่ติดตั้งก่อนได้) หลังรีสตาร์ตดู journal ว่ามีบรรทัด `start guard` ไหม
   ถ้าไม่มีแปลว่าผ่านทั้งสองการตรวจ จากนั้นโหนดจะเขียน `~/.zetaphy/config/zetaphy_sign_state.json`
4. **[เปลี่ยนเชน]** `gov.sh propose-upgrade zetaphy-guard <H> 'Chain guard: algorithm list, power cap, circuit breaker,
   constitution (off)'` โดย H ห่างไปข้างหน้าอย่างน้อย ~300 บล็อก แล้ว `gov.sh vote <ID> yes` หลัง H:
   `zetaphyd q upgrade applied zetaphy-guard` **[อ่าน]**
5. ไม่บังคับ **[เปลี่ยนเชน]** แต่ละข้อเป็นข้อเสนอ governance (`zetaphyd tx security-proposal <kind> ... --deposit ...` แล้ว
   `gov.sh vote`):
   - `circuit-authority <multisig>`: สร้าง multisig ก่อน (`zetaphyd keys add ms --multisig a,b,c --multisig-threshold 2`)
     เติมเงิน และเก็บคีย์ไว้ต่างเครื่องต่างคน
   - `power-cap <bps>` เฉพาะถ้าจะเปลี่ยนจาก 3333 (ไม่มีผลอะไรตราบที่ testnet มี validator น้อยกว่า 4 ตัว)
   - ปล่อย `constitution` ปิดไว้บน testnet เปิดตอนเปิด mainnet เมื่อพารามิเตอร์นิ่งแล้ว (มันตรึงพื้นของค่าเหล่านั้น)
   - `sig-algos` เฉพาะพร้อมแผนย้ายบัญชี: การปลดอัลกอริทึมจะแช่แข็งทุกบัญชีที่ยังเซ็นด้วยมัน

Rollback: ก่อน H ไบนารีเดิมยังรันเชนได้ (upgrade ติดตั้งก่อนได้ ยังไม่มีอะไรถูกเขียน) หลัง H ไบนารีเดิมจะหยุดที่บล็อกแรก
(`upgrade handler is missing for zetaphy-guard`) และ pre-flight กับ start guard ปฏิเสธมัน ทางถอยคือไบนารีที่แก้แล้ว หรือ
rollback ด้วยสำเนาข้อมูลตาม runbook firewall พร้อม override ข้างบน

## เทสต์

- Fork tests (`go test -tags=test -run 'ChainGuard|StartGuard|Upgrade' ./evmd` ในซอร์สที่ patch แล้ว):
  `TestChainGuardOffBeforeHeight`, `TestChainGuardUpgradeHandler`, `TestChainGuardSigAlgos`,
  `TestChainGuardNoWayBackToECDSA`, `TestChainGuardPowerCap`, `TestChainGuardCircuit`, `TestChainGuardConstitution`
  (เปิดรัฐธรรมนูญ), `TestStartGuardDowngrade`, `TestStartGuardSignState` และเทสต์ restart
- การโจมตีบน devnet, `zetaphy-chain/test-anti-rollback.sh <zetaphyd ใหม่> <zetaphyd เก่า>` (CI job `zetaphy-chain-attacks`
  ไบนารีเก่า build จาก commit ก่อน `zetaphy-guard`): ไบนารีผสมก่อนความสูง, upgrade แล้วตามด้วย: ไบนารีเก่าหลัง upgrade
  (`upgrade-check` ปฏิเสธ และหยุดที่บล็อกแรก), สำเนาเก่าของ `data/` ของ validator (ปฏิเสธ รวมถึงกับ override ที่ผิด),
  เปิดอัลกอริทึมที่ปลดแล้วกลับ (ข้อเสนอล้มเหลว), trip breaker โดยไม่มีสิทธิ์ (ปฏิเสธ) และด้วย multisig 2-of-3 (ได้ แล้ว reset),
  ข้อเสนอที่ผิดรัฐธรรมนูญขณะเปิดอยู่ (ปฏิเสธตอนยื่น) และ devnet 4 validator ที่ delegation เกินเพดานถูกปฏิเสธ
