[English](ANTI-ROLLBACK-OFFCHAIN.md) | **ภาษาไทย**

# กันการย้อนเชนและกันการยึดเครือข่าย: ส่วนนอกเชน

**ใช้บน testnet เท่านั้น ยังไม่ผ่านการ audit** ตัวป้องกันฝั่งเชน (start guard, บันทึกการเซ็น, ห้ามลดระดับอัลกอริทึม,
เพดานกำลังโหวต, circuit breaker) อยู่ใน [ANTI-ROLLBACK-CHAIN.th.md](ANTI-ROLLBACK-CHAIN.th.md) หน้านี้คือทุกอย่างรอบ ๆ เชน:
ไบนารีที่โหนดติดตั้ง, dependency ที่เราใช้ build, สิ่งที่ผู้ค้นพบช่องโหว่ได้รับ และสิ่งที่ผู้ใช้แต่ละคนเก็บไว้เอง

| รายการ | กันอะไร | อยู่ที่ไหน | เทสต์ |
|---|---|---|---|
| L1-3 release ที่เซ็นแล้ว | โหนดติดตั้งไบนารีที่ workflow release ของ repo นี้ไม่ได้ build จาก `main` หรือเวอร์ชันที่เก่ากว่า | `.github/workflows/release-zetaphyd.yml` (job `sign`), [`zetaphy-chain/verify-release.sh`](../zetaphy-chain/verify-release.sh) | `node --test audit/tools/verify-release.test.js` (workflow `verify-release.yml`) |
| L1-4 ห้ามลดเวอร์ชัน dependency | pull request ที่แอบย้อน Go, Go module, แพ็กเกจ npm หรือ Cargo กลับไปเวอร์ชันเก่า (ที่มีช่องโหว่) | [`audit/tools/no-downgrade.js`](../audit/tools/no-downgrade.js), [`audit/allow-downgrade.txt`](../audit/allow-downgrade.txt), workflow `no-downgrade.yml` | `node --test audit/tools/no-downgrade.test.js` (รวม mutation test) |
| U bug bounty | การโจมตีที่ได้มากกว่าการรายงาน | [`ZetaphyBounty.sol`](../zetaphy-network/contracts/ZetaphyBounty.sol) | `test/zetaphybounty.test.js`, `audit/invariants/ZetaphyBounty.inv.t.sol` |
| Q หลักฐานของคุณเอง + forced exit | validator ของ ZETAPHY เซ็นเซอร์ หยุด หรือย้อนเชน ขณะที่เงินที่บริดจ์ถูกล็อกอยู่บนเชนต้นทาง | [`ZetaphyForcedExit.sol`](../zetaphy-network/contracts/ZetaphyForcedExit.sol), `HyperlaneLockBoxV2.forcedPay`, [`src/forcedexit.js`](../zetaphy-network/src/forcedexit.js) | `test/forcedexit.test.js`, `audit/invariants/ForcedExit.inv.t.sol` |
| F สัญญาณเตือนการย้อนเชน (กระเป๋า) | โหนด (หรือเชนที่ถูกย้อน) แสดงบล็อกที่ต่ำกว่า หรือสถานะที่ต่างจากที่กระเป๋าถืออยู่แล้ว | [`zetaphy-wallet/rollback.js`](../zetaphy-wallet/rollback.js), `app.js` | `zetaphy-wallet/test/wallet.e2e.js` ("rollback alarm") |

## L1-3: release ที่เซ็นแล้ว

`release-zetaphyd.yml` build `zetaphyd-linux-amd64` / `-arm64` เหมือนเดิม แล้ว job ใหม่ **`sign`** (job เดียวที่มี
`id-token: write` และ `attestations: write` และ publish อะไรไม่ได้) จะเขียน

- `RELEASE.json`: release นี้คืออะไร: `tag` (`zetaphyd-<12 ตัวแรกของ sha256 ของ setup-node.sh>`), `setup_node_sha256`,
  `commit`, `ref` (`refs/heads/main`), `main_commits` (ลำดับของ commit บน `main`: `git rev-list --count`), `commit_time`,
  `upgrades` (handler ของ chain upgrade ใน patch: `zetaphy-v2` … `zetaphy-guard`)
- `SHA256SUMS` ของไบนารีและ `RELEASE.json`
- **Sigstore build-provenance attestation** หนึ่งชุด (`actions/attest-build-provenance` แบบ keyless: OIDC token ของ GitHub
  ได้ใบรับรอง Fulcio อายุสั้นที่ระบุ repo, ไฟล์ workflow, ref และ commit; ฟรี) ครอบไบนารีทุกตัว, `SHA256SUMS` และ
  `RELEASE.json` พร้อม bundle `zetaphyd-provenance.sigstore.json`

job `release` (environment `release`, มีแค่ `contents: write`) ตรวจ hash แล้ว publish ทั้งหมด release ที่ทำก่อนมีการเซ็น
ยังมีไฟล์เดิมอยู่; ถ้ารันซ้ำบน tag เดิมจะเพิ่มไฟล์ที่เซ็นแล้วเข้าไป (`--clobber`)

### `verify-release.sh` ตรวจอะไร

1. **Hash**: ไบนารีและ `RELEASE.json` ต้องมีบรรทัดใน `SHA256SUMS` อย่างละหนึ่งบรรทัดพอดีและตรงกัน (ไม่มีบรรทัด = ไม่ผ่าน
   ต่างจาก `sha256sum -c --ignore-missing`)
2. **ลายเซ็น**: `gh attestation verify` (หรือถ้าไม่มี gh ใช้ `cosign verify-blob-attestation` กับ bundle ที่มากับ release)
   สำหรับไบนารี, `SHA256SUMS` และ `RELEASE.json`: workflow ที่เซ็นต้องเป็น
   `pospos191-alt/zetaphy/.github/workflows/release-zetaphyd.yml`, source ref `refs/heads/main`, source commit = `commit`
   ใน `RELEASE.json`, runner ของ GitHub เอง, SLSA provenance v1 และ `RELEASE.json` ต้องระบุ repo นี้กับ `refs/heads/main`
   และ tag ต้องตรงกับ `setup_node_sha256`; ถ้าใส่ `--setup <ไฟล์>` ไฟล์นั้นต้องเป็น `setup-node.sh` ที่ใช้ build release นี้
3. **ห้ามย้อนเวอร์ชัน**: เทียบกับบันทึกของ release ที่ติดตั้งอยู่ (`/var/lib/zetaphy/installed-release.json` ที่ `--record` เขียน):
   `main_commits` ต้องไม่ต่ำกว่า (ตำแหน่งเดียวกันต้องเป็น commit เดียวกัน) และ upgrade handler ทุกตัวของ release ที่ติดตั้งอยู่
   ต้องอยู่ใน release ใหม่ด้วย ถ้ายังไม่มีบันทึก: `zetaphy-vN` สูงสุดที่อยู่ในไบนารีที่ติดตั้งต้องอยู่ใน release ใหม่
   `ALLOW_ROLLBACK=1` = ยอมรับ release ที่เก่ากว่าโดยตั้งใจ (ยังพิมพ์บอก)
4. release ที่ทำก่อนมีการเซ็น (ไม่มี `RELEASE.json`) จะถูกปฏิเสธ; `ALLOW_UNSIGNED=1` ยอมรับโดยตรวจแค่ attestation ของไบนารี
   และไม่ตรวจการย้อนเวอร์ชัน exit 0 = ผ่าน, 1 = ปฏิเสธ, 2 = ใช้ผิด / ไม่มีเครื่องมือ

`UPGRADE_CHECK` ของ `setup-node.sh` (ไบนารีต้องรันบล็อกถัดไปของเชนบนโหนดนี้ได้) และ start guard ยังทำงานหลังติดตั้ง;
การตรวจนี้ทำก่อนติดตั้งอะไรเลย

### บน VM

**[อ่าน]** = อ่านอย่างเดียว; **[เปลี่ยนไฟล์]** = เขียนไฟล์ (เหมือน [CHAIN-FIREWALL.th.md](CHAIN-FIREWALL.th.md))

```bash
# [อ่าน] เครื่องมือ: gh (https://cli.github.com) หรือ cosign; jq; ทั้งสองตัวฟรี
command -v gh cosign jq sha256sum
# [เปลี่ยนไฟล์] ดาวน์โหลด release ลงโฟลเดอร์ของมันเอง (R = zetaphyd-<12 hex>, ARCH = amd64 หรือ arm64)
R=zetaphyd-<12 hex>; ARCH=amd64; D=/tmp/$R; mkdir -p $D && cd $D
for f in zetaphyd-linux-$ARCH SHA256SUMS RELEASE.json zetaphyd-provenance.sigstore.json; do
  curl -fsSLO https://github.com/pospos191-alt/zetaphy/releases/download/$R/$f; done
# [เปลี่ยนไฟล์] ตัวตรวจเอง จาก commit ที่ release ระบุ (อ่านดูก่อน: สั้น)
C=$(jq -r .commit RELEASE.json)
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/verify-release.sh -o verify-release.sh
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/setup-node.sh -o setup.sh
# [อ่าน] ตรวจ (gh ต้อง `gh auth login` หรือ GH_TOKEN แบบอ่านอย่างเดียว; cosign ไม่ต้องใช้อะไร)
bash verify-release.sh --dir $D --arch $ARCH --setup setup.sh
# [อ่าน] แบบเดียวกันแต่ใช้ cosign แทน gh
VERIFIER=cosign bash verify-release.sh --dir $D --arch $ARCH --setup setup.sh
# [เปลี่ยนไฟล์] ติดตั้งตามปกติ (zetaphy-chain/README.md, ZETAPHYD_BIN=$D/zetaphyd-linux-$ARCH) แล้วบันทึกไว้:
sudo bash verify-release.sh --dir $D --arch $ARCH --record     # เขียน /var/lib/zetaphy/installed-release.json
# [อ่าน] ดูว่าติดตั้งอะไรอยู่
sudo cat /var/lib/zetaphy/installed-release.json | jq '{tag, commit, main_commits, upgrades}'
```

ต้องเห็น "VERIFIED" ตอนท้ายเท่านั้นจึงถือว่าผ่านทุกข้อ ถ้ามีบรรทัด `REFUSED:` จะบอกว่าข้อไหนไม่ผ่าน: อย่าติดตั้ง

**สิ่งที่ดูได้เฉพาะใน CI / บน VM**: ลายเซ็น Sigstore จริงจะมีหลัง job `sign` รันบน `main` ครั้งแรกเท่านั้น เทสต์
(`audit/tools/verify-release.test.js`) รันสคริปต์กับโฟลเดอร์ release ปลอม โดยใช้ `gh` / `cosign` ปลอมที่ยอมรับเฉพาะตัวตนที่ถูกต้อง
จึงพิสูจน์ hash, flag ของตัวตน, การกันย้อนเวอร์ชันและการปฏิเสธ แต่ไม่ใช่ตัว Sigstore เอง หลังมี release ที่เซ็นแล้วชุดแรก
ให้รันคำสั่งข้างบนบน VM (หรือแล็ปท็อป) หนึ่งครั้งเพื่อยืนยัน

## L1-4: ห้ามลดเวอร์ชัน dependency

`no-downgrade.yml` (pull request และ push เข้า `main` ที่แตะ `setup-node.sh`, `go.mod`, lockfile หรือ workflow) รัน unit test
แล้วรัน `node audit/tools/no-downgrade.js --base-ref <base> --head-ref HEAD` ซึ่งเทียบทุกเวอร์ชันที่ปักไว้ของ commit ฐานกับ
commit ใหม่ และไม่ผ่านถ้ามีตัวไหนลดลง:

- `setup:<VAR>`: `GO_VERSION`, `*_VERSION`, `*_TAG` ใน `zetaphy-chain/setup-node.sh`
- `gomod:<file>:…`: `go` / `toolchain` และทุก `require` / `replace` ของ diff `go.mod` ที่ฝังอยู่ใน patch ของ setup-node.sh
  (`evmd/go.mod`, `go.mod` ที่ราก) อ่านจากฝั่งใหม่ของ diff โมดูลที่ patch เดิมปักไว้เองแล้ว patch ใหม่ทิ้งไป จะกลับไปใช้
  เวอร์ชัน upstream ที่เก่ากว่า จึงนับด้วย (`pin removed`); บรรทัด context ของ upstream ที่ไม่ได้แก้แล้วหลุดจาก hunk ไม่นับ
- ไฟล์ `go.mod` ปกติ, `go-version:` ใน workflow (ต่ำสุดและสูงสุดต่อไฟล์), แพ็กเกจระดับบนของทุก `package-lock.json`,
  เวอร์ชันสูงสุดของแต่ละ crate ในทุก `Cargo.lock`

เรียงแบบ semver รวม pre-release และ Go pseudo-version การลดเวอร์ชันจะผ่านได้ก็ต่อเมื่อมีบรรทัดที่ review แล้วใน
`audit/allow-downgrade.txt` (ค่าเริ่มต้นว่าง): `<key> <from> -> <to>  # <เหตุผล>` (ต้องมีเหตุผล; `*` = เวอร์ชันใดก็ได้)
รันเอง: `node audit/tools/no-downgrade.js --base-ref origin/main` ถ้าย้อนการอัปเกรด Go ครั้งล่าสุด
(`--base-ref HEAD --head-ref HEAD~3`) จะไม่ผ่านพร้อม 57 รายการ ซึ่งถูกต้องแล้ว

## U: bug bounty (`ZetaphyBounty`)

กองทุนที่มีเงินจริงในสัญญา จ่ายให้ผู้ที่รายงานช่องโหว่จริงของเชน บริดจ์ หรือสัญญา แบบส่วนตัว เพื่อให้การรายงานได้มากกว่า
และแน่นอนกว่าการโจมตี (`BugBounty.sol` เป็นอีกเรื่อง: งาน fuzz ที่มีผู้สนับสนุนสำหรับเบราว์เซอร์)

1. **รายงานแบบส่วนตัว** (SECURITY.md) แล้ว **commit** บนเชน: `commit(commitmentOf(reportHash, คุณ, salt))` พร้อม
   `reportBond` โดย `reportHash` = keccak256 ของรายงานที่ส่งไป เวลาของ commit คือหลักฐานว่าคุณมาก่อน มันไม่เปิดเผยอะไร
   และคัดลอกไปก็ไม่มีประโยชน์ (ผูกกับ address ของคุณ)
2. **Reveal** ภายใน 90 วัน: `reveal(id, reportHash, salt)` เนื้อหาเก็บเป็นความลับได้จนกว่าจะแก้เสร็จ การเผยแพร่ทีหลัง
   ทำให้ทุกคนตรวจ hash ได้
3. **คณะกรรมการ** (สมาชิก, `threshold` ที่เป็นเสียงข้างมาก) อนุมัติ `approvePay(id, amount)` โดย `amount <= maxPayout`
   **จ่ายให้ผู้รายงานเท่านั้น** หรือ `approveReject(id)` การจ่ายถูกตั้งเวลาไว้ที่ `eta = ตอนนี้ + timelock` (>= 2 วัน) ระหว่าง
   timelock คณะกรรมการยังปฏิเสธได้ แล้วใครก็เรียก `execute(id)` ได้ ผู้รายงานเรียก `withdraw()` ได้รับเงินรางวัลพร้อม bond คืน
4. **เพดาน**: ไม่เกิน `maxPayout` ต่อรายงาน และ `periodCap` ต่อ 30 วัน และไม่สัญญาจ่ายเกินที่กองทุนมี (การจ่ายที่ตั้งเวลาแล้ว
   ถูกกันเงินไว้) **Pause**: สมาชิกคนใดก็หยุดได้ทันที; การเลิกหยุดต้องใช้ threshold และการจ่ายต้องรออีกหนึ่ง timelock
   **ไม่มีกุญแจแอดมิน**: ไม่มี sweep, rescue, owner หรือ migration; สมาชิกรายงานเองไม่ได้; การเปลี่ยนคณะกรรมการ (และการตั้ง bond
   หรือ verifier) ต้องใช้ threshold และ timelock และทำให้การอนุมัติที่เก็บไว้ก่อนหน้าเป็นโมฆะ เงินบริจาค (`fund()`) ถอนคืนไม่ได้
   bond ของรายงานที่ถูกปฏิเสธหรือไม่ reveal อยู่ในกองทุนต่อ; รายงานที่ไม่ถูกตัดสินภายใน 180 วันได้ bond คืน (`abandon`)
5. **ช่องเสียบ proof-of-exploit**: `IExploitVerifier.verify(id, reportHash, reporter, proof) -> (valid, amount)` ตอนนี้ยังไม่มี
   ตัวจริง (ไม่มี ZK ในงานนี้) เมื่อคณะกรรมการตั้ง (threshold + timelock) แล้ว `proveExploit(id, proof)` จะตั้งเวลาจ่ายตามจำนวนที่
   verifier รองรับ (มีเพดาน) ผ่าน timelock และเพดานเดียวกัน และคณะกรรมการยังปฏิเสธได้

ประกัน: `HackInsurance` จ่ายผู้เสียหายหลังเกิดเหตุ ส่วนนี้จ่ายผู้ค้นพบก่อนเกิดเหตุ ทั้งสองไม่ใช้เงินร่วมกัน: การฝากเข้า pool ประกัน
จะทำให้สัญญานี้ได้ share ที่ถอนได้ bounty จึงไม่ฝาก
ยังไม่ได้ deploy อะไร ถ้าจะ deploy บน testnet: สมาชิก = เจ้าของ multisig (หรือผู้เซ็นของ `SimpleMultisig`), threshold เสียงข้างมาก
เช่น `maxPayout` 10 ZTPHY, `periodCap` 25 ZTPHY, `timelock` 2 วัน, bond 0.1 ZTPHY; ดู `docs/BUG_BOUNTY.th.md` ว่ารางวัลบน
testnet หมายถึงอะไร (ไม่มีเงินจริง)

## Q และ F: หลักฐานของคุณเอง, สัญญาณเตือนการย้อนเชน, forced exit

### ในกระเป๋า (สัญญาณเตือนหมายความว่าอะไรสำหรับคุณ)

ทุก 5 นาที และเมื่อกด Refresh กระเป๋าจะบันทึก **จุดตรวจ** ของบล็อก H (บล็อกล่าสุดลบหนึ่ง) และเก็บไว้ **ในเครื่องนี้เท่านั้น**:

- บล็อก H ตามที่ EVM ของโหนดเห็น (หมายเลข, hash, state root)
- `eth_getProof` ของบัญชีคุณที่ H และของ slot `balanceOf` ของโทเคนที่โหลดอยู่ (รูปแบบ BridgedToken) ที่ H
- เมื่อ CometBFT RPC ของโหนดตอบ (ค่าเริ่มต้น `<ที่อยู่โหนด>/rpc/` หรือที่อยู่ที่คุณบันทึกในการ์ด "หลักฐานของคุณเอง"):
  **ใบรับรองความสิ้นสุดแบบทนควอนตัม** ในบล็อก H+1 ตรวจในหน้าเว็บด้วยกฎเดียวกับที่ทุกโหนดใช้ (โหวต ML-DSA-44 ของกำลังโหวต
  มากกว่า 2/3 สำหรับ header H) และ `app_hash` ของ header H ต้องเท่ากับ state root ของ EVM

**สัญญาณเตือน** (กล่องสีแดงด้านบน ทุกภาษา): ตอนนี้โหนดบอกว่าเชนอยู่ที่ **บล็อกที่ต่ำกว่า** บล็อกที่คุณถืออยู่, แสดง **สถานะอื่น**
สำหรับบล็อกที่คุณถือ, **ไม่มี** บล็อกที่เคยแสดงให้คุณเห็นแล้ว หรือให้ **คำตอบสองแบบที่ไม่ตรงกัน** (state root ของ EVM กับ header
ที่ได้รับการรับรอง, หลักฐานกับยอดเงิน) ระหว่างที่เตือนอยู่ กระเป๋า **ไม่ยอมเซ็นอะไรเลย** (กุญแจในหน้านี้, ZETAPHY Snap,
เส้นทาง MetaMask) สิ่งที่ควรทำ:

1. อย่าไปเซ็นที่อื่นจนกว่าจะรู้สาเหตุ กด **ดาวน์โหลดหลักฐานของฉัน** (ไฟล์ JSON ไฟล์เดียว: จุดตรวจที่ได้รับการรับรอง,
   หลักฐานและใบรับรอง, สัญญาณเตือน)
2. ลองโหนดอื่น (เปลี่ยน RPC) ถ้าโหนดอื่นตรงกับที่คุณถืออยู่ แปลว่าโหนดแรกให้ข้อมูลเท็จ
3. เฉพาะเมื่อทีม ZETAPHY **ประกาศ** ว่าเริ่มเชนใหม่ (รีเซ็ต testnet) จึงกด **ยอมรับเชนใหม่**: กระเป๋าจะลืมจุดตรวจ
   (หลังยืนยัน) แล้วเซ็นได้อีกครั้ง

ถ้าไม่มี CometBFT RPC กระเป๋ายังเก็บหลักฐาน เพียงแต่ไม่มีใบรับรองที่ตรวจแล้ว (และบอกไว้) โหนดที่ไม่ให้ `eth_getProof`
เป็นแค่หมายเหตุในการ์ด ไม่ใช่สัญญาณเตือน โหนดที่ช้ากว่าอีกโหนดหนึ่งบล็อกเดียวก็ไม่ใช่สัญญาณเตือน (นับ "ต่ำกว่า" เฉพาะบล็อก
ที่กระเป๋าถือหลักฐานอยู่)

### บนเชนต้นทาง: `ZetaphyForcedExit` + `HyperlaneLockBoxV2.forcedPay`

escape hatch (docs/SAPHAN-SAFETY.th.md) ต้องให้ validator ของ ZETAPHY เซ็น exit root ถ้าไม่เซ็นภายใน **`FORCE_AFTER` (7 วัน)
หลังเริ่ม escape** (14 วันไม่มี heartbeat) ผู้ถือจะออกด้วย **หลักฐานของตัวเอง**:

- `prove(account, height, balance, proof)`: `balanceOf[account]` ของ token(X) = `balance` ในสถานะของ ZETAPHY ที่ `height`
  ซึ่ง `StarkLightClient` ยืนยัน app hash แล้ว; IAVL path ของ key `0x02 || token || keccak256(account, 3)` และ multistore path
  ของ `evm` (โค้ดตรวจหลักฐานชุดเดียวกับ proven release) ใครก็ prove ให้ใครก็ได้ เงินไปที่ account เท่านั้น **ความสูงที่ยืนยันแล้ว
  ที่ใหม่กว่าแทนที่อันเก่า** (ใครก็ทำได้ จนกว่าจะจ่าย): หลักฐานเก่า (ยอดที่ใช้ไปแล้ว) ถูกแก้ด้วยคนที่มีหลักฐานใหม่กว่า เช่น
  archive node ใด ๆ ภายในช่วงคัดค้าน 3 วัน
- `finalize(account)` หลังช่วงคัดค้าน: lockbox จ่ายให้ account ตามสัดส่วนกับ supply ของ token(X) ใน heartbeat ล่าสุด
  (proof of reserves) ครั้งเดียวต่อ address และรวมแล้วไม่เป็นหนี้เกิน supply นั้น หลังการจ่ายแบบ forced ครั้งแรก จะไม่รับ
  exit root อีก; ถ้า exit root มาทันเวลา เส้นทาง forced จะปิด
- `src/forcedexit.js forcedExitArgs({ proof, height, holder, token })` แปลงคำตอบ `eth_getProof(token, [slot], H)` ที่กระเป๋าเก็บไว้
  (ICS23 ops) เป็น argument ของ `prove` หลังตรวจ key, spec ของ leaf IAVL และ store `evm` หลักฐานที่บล็อก H ตรวจกับ
  `appHashAt(H)` คือ app hash ใน header H ซึ่งใบรับรอง PQ ในบล็อก H+1 รับรอง

governance ตั้ง forced exit ครั้งเดียว (`setForcedExit` ห้ามตั้งระหว่าง escape) เหมือน checkpointer สิ่งที่ไม่ครอบคลุม:
release ที่รออยู่ใน lockbox และ lock ที่ ZETAPHY ไม่เคย mint (exit root ของ validator ครอบคลุมส่วนนั้น)

### สิ่งที่โหนดของเชนต้องมีเพื่อให้ forced exit สมบูรณ์ (ไม่ได้แก้ในงานนี้)

1. **พิสูจน์รูปแบบ `eth_getProof` ของ cosmos/evm บน devnet**: ว่า `storageProof[].proof` คือ `[IAVL CommitmentProof, multistore CommitmentProof]`
   ที่ IAVL version H-1 (คือตรวจกับ app hash ของ header H) ตามที่ `src/forcedexit.js` สมมติไว้ ถ้าไม่ใช่ ให้มี JSON-RPC
   `zetaphy_storageProof(address, slot, height)` ที่คืน ICS23 existence proof สองชุดนั้นพร้อมความสูงของ header
2. **`zetaphy_pqCertificate(height)`** บน EVM JSON-RPC (header H, tx ใบรับรองในบล็อก H+1, ชุด validator และ vote key ที่ H)
   เพื่อให้กระเป๋าที่รู้จักแค่ EVM RPC เก็บใบรับรองได้โดยไม่ต้องใช้พอร์ต CometBFT
3. **heartbeat ที่บอกความสูงที่ยืนยันแล้ว** (เพิ่ม `block.number` ใน body ของ SaphanCheckpointer) เพื่อให้ lockbox ตั้งพื้นของ
   ความสูงที่ `prove` ยอมรับได้ (ตอนนี้ยอมรับทุกความสูงที่ยืนยันแล้ว และพึ่งหลักฐานใหม่กว่าในการแก้ claim เก่า); และ
   StarkLightClient ต้องยืนยัน ZETAPHY สม่ำเสมอบนเชนต้นทางแต่ละเชน (prover ต้องรัน; ถ้าไม่รัน `appHashAt` ว่าง และ forced exit
   เริ่มไม่ได้)
4. ทางเลือก: token(X) บันทึก root ของยอดคงเหลือไว้ใน state เพื่อให้หลักฐานเดียวครอบคลุมผู้ถือทุกคน (ไม่ต้องคัดค้านทีละบัญชี)

## เทสต์ (ผลบนเครื่องตอนเขียน)

```
node --test audit/tools/no-downgrade.test.js      # ผ่าน 19 (mutation 12 กรณี: การลดเวอร์ชันโดยตั้งใจทุกกรณีต้องไม่ผ่าน)
node --test audit/tools/verify-release.test.js    # ผ่าน 7
cd zetaphy-network && node --test test/zetaphybounty.test.js test/forcedexit.test.js   # ผ่าน 10 + 7
cd zetaphy-network && forge test --match-path 'audit/invariants/{ZetaphyBounty,ForcedExit}.inv.t.sol'   # ผ่าน 8
cd zetaphy-wallet && npm test                      # ผ่าน 40 (ใหม่ 3: rollback alarm)
```
