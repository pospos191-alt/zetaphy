[English](ANTI-ROLLBACK-OFFCHAIN.md) | **ภาษาไทย**

# กันการย้อนเชนและกันการยึดเครือข่าย: ส่วนนอกเชน

**ใช้บน testnet เท่านั้น ยังไม่ผ่านการ audit** ตัวป้องกันฝั่งเชน (start guard, บันทึกการเซ็น, ห้ามลดระดับอัลกอริทึม,
เพดานกำลังโหวต, circuit breaker) อยู่ใน [ANTI-ROLLBACK-CHAIN.th.md](ANTI-ROLLBACK-CHAIN.th.md) หน้านี้คือทุกอย่างรอบ ๆ เชน:
ไบนารีที่โหนดติดตั้ง, dependency ที่เราใช้ build, สิ่งที่ผู้ค้นพบช่องโหว่ได้รับ และสิ่งที่ผู้ใช้แต่ละคนเก็บไว้เอง

| รายการ | กันอะไร | อยู่ที่ไหน | เทสต์ |
|---|---|---|---|
| L1-3 release ที่เซ็นแล้ว | โหนดติดตั้งไบนารีที่ workflow release ของ repo นี้ไม่ได้ build จาก `main` หรือเวอร์ชันที่เก่ากว่า | `.github/workflows/release-zetaphyd.yml` (job `sign`), [`zetaphy-chain/verify-release.sh`](../zetaphy-chain/verify-release.sh) | `node --test audit/tools/verify-release.test.js` (workflow `verify-release.yml`) |
| L1-3 ติดตั้งเฉพาะ release ที่ตรวจแล้ว (internal review 2026-11-10, Z-04) | `install.sh validator`, `zetaphy-validator update` และ timer อัปเกรด รัน `setup-node.sh`, `zetaphyd` หรือตัวสคริปต์เองที่ไม่มี release ที่เซ็นแล้วรับรอง | [`zetaphy-chain/join-validator.sh`](../zetaphy-chain/join-validator.sh) (`fetch_release`, `install_self`) | `node --test audit/tools/join-validator-release.test.js` (workflow `verify-release.yml`), `runner-install.yml` |
| ไฟล์ที่ cloud-init pin ไว้ต้องเผยแพร่แล้ว (internal review 2026-11-10, Z-05) | `cloud-init.sh` บน `main` pin `v/<sha256>.sh` ที่ repo สาธารณะยังไม่มี (ได้โหนดไม่ขึ้น) | [`audit/tools/cloud-init-published.sh`](../audit/tools/cloud-init-published.sh), workflow `cloud-init-published.yml` | `node --test audit/tools/cloud-init-published.test.js` |
| L1-4 ห้ามลดเวอร์ชัน dependency | pull request ที่แอบย้อน Go, Go module, แพ็กเกจ npm หรือ Cargo กลับไปเวอร์ชันเก่า (ที่มีช่องโหว่) | [`audit/tools/no-downgrade.js`](../audit/tools/no-downgrade.js), [`audit/allow-downgrade.txt`](../audit/allow-downgrade.txt), workflow `no-downgrade.yml` | `node --test audit/tools/no-downgrade.test.js` (รวม mutation test) |
| U bug bounty | การโจมตีที่ได้มากกว่าการรายงาน | [`ZetaphyBounty.sol`](../zetaphy-network/contracts/ZetaphyBounty.sol) | `test/zetaphybounty.test.js`, `audit/invariants/ZetaphyBounty.inv.t.sol` |
| Q หลักฐานของคุณเอง + forced exit | validator ของ ZETAPHY เซ็นเซอร์ หยุด หรือย้อนเชน ขณะที่เงินที่บริดจ์ถูกล็อกอยู่บนเชนต้นทาง | [`ZetaphyForcedExit.sol`](../zetaphy-network/contracts/ZetaphyForcedExit.sol), `HyperlaneLockBoxV2.forcedPay`, [`src/forcedexit.js`](../zetaphy-network/src/forcedexit.js) | `test/forcedexit.test.js`, `audit/invariants/ForcedExit.inv.t.sol` |
| F สัญญาณเตือนการย้อนเชน (กระเป๋า) | โหนด (หรือเชนที่ถูกย้อน) แสดงบล็อกที่ต่ำกว่า หรือสถานะที่ต่างจากที่กระเป๋าถืออยู่แล้ว | [`zetaphy-wallet/rollback.js`](../zetaphy-wallet/rollback.js), `app.js` | `zetaphy-wallet/test/wallet.e2e.js` ("rollback alarm") |

## L1-3: release ที่เซ็นแล้ว

`release-zetaphyd.yml` build `zetaphyd-linux-amd64` / `-arm64` เหมือนเดิม แล้ว job ใหม่ **`sign`** (job เดียวที่มี
`id-token: write` และ `attestations: write` และ publish อะไรไม่ได้) จะเขียน

- `RELEASE.json`: release นี้คืออะไร: `tag` (`zetaphyd-<12 ตัวแรกของ sha256 ของ setup-node.sh>`), `setup_node_sha256`,
  `commit`, `ref` (`refs/heads/main`), `main_commits` (ลำดับของ commit บน `main`: `git rev-list --count`), `commit_time`,
  `upgrades` (handler ของ chain upgrade ใน patch: `zetaphy-v2` … `zetaphy-guard`), `scripts` (sha256 ของ
  `zetaphy-chain/join-validator.sh` และ `verify-release.sh` ที่ commit นั้น; release ที่ทำก่อนมีช่องนี้จะไม่มี)
- `SHA256SUMS` ของไบนารีและ `RELEASE.json`
- **Sigstore build-provenance attestation** หนึ่งชุด (`actions/attest-build-provenance` แบบ keyless: OIDC token ของ GitHub
  ได้ใบรับรอง Fulcio อายุสั้นที่ระบุ repo, ไฟล์ workflow, ref และ commit; ฟรี) ครอบไบนารีทุกตัว, `SHA256SUMS` และ
  `RELEASE.json` พร้อม bundle `zetaphyd-provenance.sigstore.json`

job `release` (environment `release`, มีแค่ `contents: write`) ตรวจ hash แล้ว publish ทั้งหมด **tag จะไม่ถูกใช้ซ้ำกับไฟล์ที่เซ็น
ชุดอื่น** (internal review 2026-11-12, Z-49): ถ้า tag นั้นมี `RELEASE.json` แล้ว job จะหยุดพร้อม error เว้นแต่ `SHA256SUMS`
ที่เผยแพร่ไว้ตรงกับของใหม่ทุกไบต์ (แบบนั้นไม่ต้องทำอะไร) release ใหม่มาพร้อม `setup-node.sh` ใหม่เสมอ จึงได้ tag ใหม่
มีแค่ release ที่ทำก่อนมีการเซ็น (ไม่มี `RELEASE.json`) ที่จะได้ไฟล์ที่เซ็นแล้วเพิ่มเข้าไปใน tag เดิม

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
   ต้องอยู่ใน release ใหม่ด้วย ถ้ายังไม่มีบันทึก: ชื่อ upgrade handler **ทุกตัว** ที่พบในไบนารีที่ติดตั้งอยู่ (`zetaphy-v2`,
   `zetaphy-v3`, ... และตัวที่มีชื่อ เช่น `zetaphy-firewall`, `zetaphy-guard`, `zetaphy-shield`: `KNOWN_UPGRADES` ในสคริปต์
   รวมกับทุกชื่อที่ release ใหม่ระบุ) ต้องอยู่ใน release ใหม่ ไม่ใช่แค่เลขสูงสุด
   `ALLOW_ROLLBACK=1` = ยอมรับ release ที่เก่ากว่าโดยตั้งใจ (ยังพิมพ์บอก)
4. **ต้องมี `RELEASE.json`** ไม่มีทางสำหรับ release ที่ไม่ได้เซ็นอีกแล้ว (ลบ `ALLOW_UNSIGNED` ออก, internal review 2026-11-12,
   Z-49): โฟลเดอร์ที่ไม่มีไฟล์นี้ถูกปฏิเสธก่อนการตรวจอื่น การลบไฟล์นี้จึงข้ามการตรวจย้อนเวอร์ชันไม่ได้
5. **ความใหม่** (release ที่เซ็นแล้วแต่เก่า ถูกส่งมาแทนตัวใหม่สุด): เตือนเมื่อ commit ของ release เก่ากว่า `MAX_RELEASE_AGE_DAYS`
   (ค่าเริ่มต้น 60) วัน และเมื่ออ่าน `RELEASE.json` ของ release ล่าสุดที่เผยแพร่ได้ (`LATEST_RELEASE_URL`, ค่าเริ่มต้น
   `https://github.com/<repo>/releases/latest/download/RELEASE.json`; `OFFLINE=1` ข้าม) แล้วตัวนั้นอยู่ไกลกว่าบน `main`
   ถ้าออฟไลน์ ตรวจแค่อายุ ไฟล์ที่ดึงมาไม่ถูกใช้ทำอย่างอื่น `REQUIRE_FRESH=1` เปลี่ยนคำเตือนเป็นการปฏิเสธ

exit 0 = ผ่าน, 1 = ปฏิเสธ, 2 = ใช้ผิด / ไม่มีเครื่องมือ

**หลัง start guard ถอยกลับ** (โหนดปฏิเสธไบนารีที่เพิ่งติดตั้งแล้วกลับไปใช้ `$BIN.prev`) บันทึกยังชี้ release ที่ใหม่กว่าอยู่
`verify-release.sh --mark-refused` (สคริปต์ถอยกลับเรียก หรือรันเองด้วย `sudo`) เก็บตำแหน่งบน `main` ของ release นั้นไว้เป็นพื้น
(ไม่ลดลงเลย จึงไม่เปิดทางกลับไป release ที่เก่ากว่า) เพิ่มเข้า `refused` (commit, ตำแหน่ง, sha256 ของไบนารี) และจดไบนารีที่รันจริง
(`running_binary_sha256`) release นั้นจะถูกปฏิเสธอีก (`RETRY_REFUSED=1` = ลองใหม่โดยตั้งใจ) release ถัดไปต้องอยู่ไกลบน `main`
อย่างน้อยเท่ากัน การบันทึก release ที่ใหม่กว่ายังเก็บประวัติ `refused` ไว้

`UPGRADE_CHECK` ของ `setup-node.sh` (ไบนารีต้องรันบล็อกถัดไปของเชนบนโหนดนี้ได้) และ start guard ยังทำงานหลังติดตั้ง;
การตรวจนี้ทำก่อนติดตั้งอะไรเลย

### บน VM

**[อ่าน]** = อ่านอย่างเดียว; **[เปลี่ยนไฟล์]** = เขียนไฟล์ (เหมือน [CHAIN-FIREWALL.th.md](CHAIN-FIREWALL.th.md))

```bash
# [อ่าน] เครื่องมือ: cosign (หรือ gh), jq; ตัวตรวจทั้งสองตัวฟรี
command -v cosign gh jq sha256sum
# [เปลี่ยนไฟล์] cosign ถ้ายังไม่มี: จาก release ของ cosign เอง ตรวจกับรายการ checksum ของ release นั้น (arm64: cosign-linux-arm64)
cd /tmp && curl -fsSLO https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 \
  && curl -fsSLO https://github.com/sigstore/cosign/releases/latest/download/cosign_checksums.txt
grep ' cosign-linux-amd64$' cosign_checksums.txt | sha256sum -c -        # ต้องขึ้น: cosign-linux-amd64: OK
sudo install -m 755 cosign-linux-amd64 /usr/local/bin/cosign && cosign version | grep GitVersion
# [เปลี่ยนไฟล์] ดาวน์โหลด release ลงโฟลเดอร์ของมันเอง (R = zetaphyd-<12 hex>, ARCH = amd64 หรือ arm64)
R=zetaphyd-<12 hex>; ARCH=amd64; D=/tmp/$R; mkdir -p $D && cd $D
for f in zetaphyd-linux-$ARCH SHA256SUMS RELEASE.json zetaphyd-provenance.sigstore.json; do
  curl -fsSLO https://github.com/pospos191-alt/zetaphy/releases/download/$R/$f; done
# [เปลี่ยนไฟล์] ตัวตรวจเอง จาก commit ที่ release ระบุ (อ่านดูก่อน: สั้น)
C=$(jq -r .commit RELEASE.json)
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/verify-release.sh -o verify-release.sh
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/setup-node.sh -o setup.sh
# [อ่าน] ตรวจด้วย cosign (ไม่ต้องมีบัญชีหรือ token)
VERIFIER=cosign bash verify-release.sh --dir $D --arch $ARCH --setup setup.sh
# [อ่าน] แบบเดียวกันแต่ใช้ gh (ต้อง `gh auth login` หรือ GH_TOKEN แบบอ่านอย่างเดียว)
VERIFIER=gh bash verify-release.sh --dir $D --arch $ARCH --setup setup.sh
# [เปลี่ยนไฟล์] ติดตั้งตามปกติ (zetaphy-chain/README.md, ZETAPHYD_BIN=$D/zetaphyd-linux-$ARCH) แล้วบันทึกไว้:
sudo VERIFIER=cosign bash verify-release.sh --dir $D --arch $ARCH --record     # เขียน /var/lib/zetaphy/installed-release.json
# [อ่าน] ดูว่าติดตั้งอะไรอยู่
sudo cat /var/lib/zetaphy/installed-release.json | jq '{tag, commit, main_commits, upgrades}'
```

ต้องเห็น "VERIFIED" ตอนท้ายเท่านั้นจึงถือว่าผ่านทุกข้อ ถ้ามีบรรทัด `REFUSED:` จะบอกว่าข้อไหนไม่ผ่าน: อย่าติดตั้ง
ถ้า cosign หรือ gh ปฏิเสธ บรรทัดเหนือมัน (`----- cosign exited 1; its last lines:`) คือเหตุผลของเครื่องมือเอง
(ตัวตนไม่ตรง, ไม่มีเน็ต, ...)

เรื่อง cosign:

- **ขนาดไฟล์** cosign ปกติจะไม่ยอมตรวจไฟล์ที่ใหญ่กว่า 128 MiB แต่ `zetaphyd` ใหญ่กว่านั้น (ราว 160 MB)
  `verify-release.sh` จึงตั้ง `COSIGN_MAX_ATTACHMENT_SIZE=512MiB` ให้ตอนเรียก cosign ถ้าคุณไม่ได้ตั้งเอง
- **เวอร์ชัน** cosign v3 อ่าน Sigstore bundle ได้โดยไม่ต้องใส่ `--new-bundle-format` (และเตือนว่า flag นี้เลิกใช้แล้ว)
  สคริปต์จึงไม่ใส่; ส่วน cosign v2.4 ถึง v2.x ที่ยังต้องใช้ สคริปต์จะใส่ให้ ตรวจกับ release `zetaphyd-fd0f272aa982`
  ด้วย cosign v3.1.4, v2.5.3 และ v2.4.3 แล้ว (ทั้งสามตัว: VERIFIED)
- **เครื่องที่ต่อ host TUF ของ Sigstore ไม่ได้** (`tuf-repo-cdn.sigstore.dev`): cosign จะดึง trusted root ไม่ได้
  ใช้ `COSIGN_TRUSTED_ROOT=<trusted_root.json>` ส่งสำเนาให้ (`--trusted-root`) เช่นจาก
  `https://raw.githubusercontent.com/sigstore/root-signing/main/targets/trusted_root.json` เครื่องทั่วไปไม่ต้องทำอะไร

**สิ่งที่ดูได้เฉพาะใน CI / บน VM**: เทสต์ (`audit/tools/verify-release.test.js`) รันสคริปต์กับโฟลเดอร์ release ปลอม โดยใช้
`gh` / `cosign` / `curl` ปลอมที่ยอมรับเฉพาะตัวตนที่ถูกต้อง จึงพิสูจน์ hash, flag ของตัวตน, การกันย้อนเวอร์ชัน (ทั้งมีและไม่มีบันทึก),
การปฏิเสธ, คำเตือนเรื่องความใหม่ และการจัดการ cosign (ขนาดไฟล์, flag ตามเวอร์ชัน, บรรทัดของเครื่องมือเมื่อปฏิเสธ) แต่ไม่ใช่ตัว Sigstore เอง ให้รันคำสั่งข้างบนบน VM
(หรือแล็ปท็อป) หนึ่งครั้งหลังแก้ส่วนการเซ็นทุกครั้ง

### การติดตั้งและอัปเกรดรับเฉพาะ release ที่ตรวจแล้ว (`join-validator.sh`)

Internal review 2026-11-10, Z-04 `install.sh validator`, `zetaphy-validator update` และ timer อัปเกรดทุก 1 นาที
(`upgrade-watch`) ผ่าน `fetch_release` ทั้งหมด:

1. `setup-node.sh` ที่ `REF` (ค่าเริ่มต้น `main`) ใช้แค่บอกชื่อ release (`zetaphyd-<12 hex>`; `RELEASE_TAG=` pin release อื่น)
   ยังไม่มีอะไรที่ดาวน์โหลดมาถูกรัน ทุกไฟล์ลงที่ `/usr/local/lib/zetaphy-validator/incoming` ก่อน
2. ตัวตรวจถูก pin ไว้ใน `join-validator.sh` เอง: `verify-release.sh` ด้วย sha256 (`VERIFY_RELEASE_SHA256` มีเทสต์คุมให้ตรงกัน)
   และ cosign (`COSIGN_VERSION`, sha256 แยกตามสถาปัตยกรรมจากรายการ checksum ของ cosign) ดาวน์โหลดครั้งเดียว
   ถ้า hash ไม่ตรงจะปฏิเสธ `VERIFIER=gh` ใช้ gh ที่ติดตั้งและ login แล้วแทน
3. `verify-release.sh` ตรวจ release (ลายเซ็น, hash, `setup-node.sh` คือตัวที่ release build มา, ไม่เก่ากว่าที่ติดตั้งอยู่)
   ผ่านแล้วเท่านั้นจึงย้ายไฟล์เข้าที่และรัน `setup-node.sh` กับไบนารีที่ตรวจแล้ว จากนั้นเขียน record
   (`/var/lib/zetaphy/installed-release.json`) เพื่อให้การอัปเดตหรืออัปเกรดครั้งต่อไปเก่ากว่านี้ไม่ได้
4. `/usr/local/bin/zetaphy-validator` คือไฟล์ที่กำลังรัน (`install.sh` บันทึกเป็นไฟล์ก่อน) ถ้ามาทาง pipe
   (`curl ... | sudo bash` ไม่มีไฟล์) จะใช้สำเนาที่ commit ของ release ที่เซ็นแล้ว ซึ่ง sha256 ตรงกับช่อง `scripts` ใน
   `RELEASE.json`; release ที่ไม่มีช่องนี้ จะไม่ดึงอะไรเลยและบอกให้ใช้ `install.sh`
5. ไม่มี release ที่เซ็นแล้ว (release เก่าที่ไม่มี `RELEASE.json` หรือยังไม่มีเลย): **ปฏิเสธ** `ALLOW_UNVERIFIED_INSTALL=1`
   คือข้อยกเว้นโดยตั้งใจ (แบบเดิม: ตรวจแค่ SHA256SUMS หรือ build จาก source) ถูกบันทึกลง journal
   (`journalctl -t zetaphy-validator`) และ `/var/lib/zetaphy-validator/unverified-installs.log` timer อัปเกรดไม่สนใจค่านี้

จุดเริ่มของความเชื่อถือคือการดาวน์โหลดครั้งแรก (`install.sh` และ `join-validator.sh` จาก `main`) ถ้าจะ pin ตรงนี้ด้วย:
ตรวจ release ตาม "บน VM" แล้วรัน `join-validator.sh` ของ commit นั้น ที่ตรวจกับ `RELEASE.json` แล้ว:

```bash
# [เปลี่ยนไฟล์] หลังได้ VERIFIED ข้างบน ใน $D
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/join-validator.sh -o join-validator.sh
echo "$(jq -r '.scripts["join-validator.sh"]' RELEASE.json)  join-validator.sh" | sha256sum -c -   # ต้องขึ้น: OK
sudo REF=$C RELEASE_TAG=$R MONIKER=your-name bash join-validator.sh install
```

ยังไม่ครอบคลุม: การ pin ไบนารีผ่านแผนอัปเกรดที่โหวตใน governance (`Plan.Info`) เอง; หลักยึดตอนนี้คือ release ที่เซ็นโดย
workflow ของ repo นี้บน `main`

### การเผยแพร่ setup-node.sh (cloud-init): เผยแพร่ก่อน แล้วค่อยย้าย pin

Internal review 2026-11-10, Z-05 `cloud-init.sh` ดาวน์โหลด `v/<sha256>.sh` จาก repo สาธารณะ `pospos191-alt/zetaphy-chain`
และหยุดถ้าไม่มีไฟล์นั้น workflow `cloud-init-published.yml` ถาม repo สาธารณะ (`audit/tools/cloud-init-published.sh`:
`curl -fsI` ที่ URL ที่ pin ไว้ แล้วตรวจ sha256 ของมัน):

| เมื่อไร | ทำอะไร |
|---|---|
| pull request ที่แก้ `setup-node.sh` / `cloud-init.sh` | เตือนอย่างเดียว (ไฟล์อาจเผยแพร่ทีหลัง ก่อน merge) |
| push เข้า `main`, ทุกวัน, รันเอง | fail และเปิด (หรือเพิ่มความเห็นใน) issue "cloud-init.sh pins a setup-node.sh that is not published"; ปิดเองเมื่อไฟล์มีแล้ว; ถ้าเน็ตมีปัญหาแค่เตือน |

ลำดับสำหรับเจ้าของ ทุกครั้งที่ `setup-node.sh` เปลี่ยน:

1. ใน pull request: `bash zetaphy-chain/pack-cloud-init.sh` (เขียน `cloud-init.sh` และ `zetaphy-chain/public/`)
2. **เผยแพร่ก่อน**: คัดลอก `zetaphy-chain/public/v/<sha256>.sh` ไปไว้ใน `v/` ของ repo สาธารณะโดยไม่แก้อะไร แล้ว push
   (ไฟล์ที่ตั้งชื่อด้วย sha256 ของตัวเองจะไม่ถูกแก้หรือลบภายหลัง) ตรวจ:
   `curl -fsI https://raw.githubusercontent.com/pospos191-alt/zetaphy-chain/main/v/<sha256>.sh` ต้องตอบ 200
3. **แล้วค่อย** merge pull request ที่ย้าย pin บน `main` workflow `cloud-init-published` บน `main` ต้องผ่าน
4. หลัง merge: คัดลอกไฟล์เดียวกันทับ `setup-node.sh` สาธารณะ (ตัว "ล่าสุด") และ `README.md`

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

- **ทุก claim ใช้ความสูงเดียวกัน** (internal review 2026-11-12, Z-43): heartbeat แต่ละครั้ง (`SaphanCheckpointer`, body 224 ไบต์)
  ส่งความสูงบล็อกของ ZETAPHY มาพร้อม supply; lockbox เก็บไว้เป็น `snapshotHeight` (`SaphanCheckpointer.lastHeight()` บน ZETAPHY
  คือเลขเดียวกัน) claim ต้องเป็นของความสูงนั้นพอดี ไม่ก่อนและไม่หลัง แต่ละบัญชีจึงนับครั้งเดียว ในสถานะเดียวกับที่ supply มาจาก
  และ claim รวมกันได้เท่ายอดในสถานะนั้น heartbeat แบบเก่า 192 ไบต์ (ไม่มีความสูง) ยังทำให้ route มีชีวิตอยู่ แต่ล้าง snapshot:
  จ่ายแบบ forced ไม่ได้จนกว่าจะมี heartbeat ที่มีความสูง
- `prove(account, snapshotHeight, balance, proof)`: `balanceOf[account]` ของ token(X) = `balance` ในสถานะของ ZETAPHY ที่ความสูง
  snapshot ซึ่ง `StarkLightClient` ยืนยัน app hash แล้ว; IAVL path ของ key `0x02 || token || keccak256(account, 3)` และ multistore
  path ของ `evm` (โค้ดตรวจหลักฐานชุดเดียวกับ proven release) ใครก็ prove ให้ใครก็ได้ เงินไปที่ account เท่านั้น ครั้งเดียวต่อบัญชี
  ต่อ snapshot ถ้ามี heartbeat มาระหว่างนั้น (ZETAPHY กลับมาแล้วเงียบอีก) claim ของ snapshot เก่าจะไม่ถูกจ่าย และหลักฐานที่
  snapshot ใหม่แทนที่ได้
- `finalize(account)` หลังช่วงรอ 3 วัน: lockbox จ่ายให้ account (`forcedPay` ตรวจความสูงซ้ำ) ตามสัดส่วนกับ supply ของ token(X)
  ใน heartbeat ล่าสุด (proof of reserves) ครั้งเดียวต่อ address และรวมแล้วไม่เป็นหนี้เกิน supply นั้น หลังการจ่ายแบบ forced
  ครั้งแรก จะไม่รับ heartbeat หรือ exit root อีก snapshot จึงขยับไม่ได้; ถ้า exit root มาทันเวลา เส้นทาง forced จะปิด
- `src/forcedexit.js forcedExitArgs({ proof, height, holder, token, snapshotHeight })` แปลงคำตอบ `eth_getProof(token, [slot], H)`
  (ICS23 ops) เป็น argument ของ `prove` หลังตรวจ key, spec ของ leaf IAVL, store `evm` และ (ถ้าใส่ `snapshotHeight` จาก
  `ZetaphyForcedExit.snapshotHeight()`) ว่า H คือความสูง snapshot หลักฐานที่บล็อก H ตรวจกับ `appHashAt(H)` คือ app hash ใน
  header H ขอได้จาก archive node ใดก็ได้ที่ความสูง snapshot; checkpoint ของกระเป๋าเองอยู่ที่ความสูงอื่น (ดูด้านล่าง)

governance ตั้ง forced exit ครั้งเดียว (`setForcedExit` ห้ามตั้งระหว่าง escape) เหมือน checkpointer สิ่งที่ไม่ครอบคลุม:
release ที่รออยู่ใน lockbox และ lock ที่ ZETAPHY ไม่เคย mint (exit root ของ validator ครอบคลุมส่วนนั้น)

### สิ่งที่โหนดของเชนต้องมีเพื่อให้ forced exit สมบูรณ์ (ไม่ได้แก้ในงานนี้)

1. **พิสูจน์รูปแบบ `eth_getProof` ของ cosmos/evm บน devnet**: ว่า `storageProof[].proof` คือ `[IAVL CommitmentProof, multistore CommitmentProof]`
   ที่ IAVL version H-1 (คือตรวจกับ app hash ของ header H) ตามที่ `src/forcedexit.js` สมมติไว้ ถ้าไม่ใช่ ให้มี JSON-RPC
   `zetaphy_storageProof(address, slot, height)` ที่คืน ICS23 existence proof สองชุดนั้นพร้อมความสูงของ header
2. **`zetaphy_pqCertificate(height)`** บน EVM JSON-RPC (header H, tx ใบรับรองในบล็อก H+1, ชุด validator และ vote key ที่ H)
   เพื่อให้กระเป๋าที่รู้จักแค่ EVM RPC เก็บใบรับรองได้โดยไม่ต้องใช้พอร์ต CometBFT
3. ทำแล้ว: heartbeat ส่งความสูงมาและ claim ผูกกับความสูงนั้น ที่ยังต้องมี: StarkLightClient ยืนยัน ZETAPHY บนเชนต้นทางแต่ละเชน
   อย่างน้อยทุกความสูงของ heartbeat (prover ต้องรัน; ถ้า `appHashAt` ไม่มีความสูง snapshot forced exit เริ่มไม่ได้) และกระเป๋าเก็บ
   `eth_getProof` ของตัวเองที่ความสูงของ heartbeat ล่าสุด (`SaphanCheckpointer.lastHeight()`) เพื่อให้ผู้ถือไม่ต้องพึ่ง archive node
4. ทางเลือก: token(X) บันทึก root ของยอดคงเหลือไว้ใน state เพื่อให้หลักฐานเดียวครอบคลุมผู้ถือทุกคน (ไม่ต้องคัดค้านทีละบัญชี)

## เทสต์ (ผลบนเครื่องตอนเขียน)

```
node --test audit/tools/no-downgrade.test.js      # ผ่าน 19 (mutation 12 กรณี: การลดเวอร์ชันโดยตั้งใจทุกกรณีต้องไม่ผ่าน)
node --test audit/tools/verify-release.test.js    # ผ่าน 12 (Z-49: รายชื่อ handler เมื่อไม่มีบันทึก, ไม่มีทางไม่เซ็น, ความใหม่, start guard ถอยกลับ)
node --test audit/tools/join-validator-release.test.js   # ผ่าน 9 (ติดตั้งเฉพาะ release ที่ตรวจแล้ว)
node --test audit/tools/cloud-init-published.test.js     # ผ่าน 7 (ไฟล์ที่ cloud-init pin ไว้เผยแพร่แล้ว)
cd zetaphy-network && node --test test/zetaphybounty.test.js test/forcedexit.test.js   # ผ่าน 10 + 9
cd zetaphy-network && forge test --match-path 'audit/invariants/{ZetaphyBounty,ForcedExit}.inv.t.sol'   # ผ่าน 13
cd zetaphy-wallet && npm test                      # ผ่าน 40 (ใหม่ 3: rollback alarm)
```
