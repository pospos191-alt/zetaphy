# เช็กลิสต์ส่ง SWD Guard ขึ้น Chrome Web Store

ใช้เวลาประมาณ 1 ชั่วโมงสำหรับการกรอกครั้งแรก การตรวจของ Google ปกติใช้ 1–3 วัน (บางครั้งนานถึง 2–3 สัปดาห์)

ไฟล์ทุกอย่างที่ต้องใช้เตรียมไว้แล้วในโฟลเดอร์นี้ (`integrations/chrome-swd-guard/`):

| ใช้ทำอะไร | ไฟล์ |
| --- | --- |
| แพ็กเกจที่อัปโหลด | `dist/swd-guard-0.1.0.zip` (สร้างด้วย `sh scripts/zip.sh`) |
| ข้อความหน้า Store 8 ภาษา + คำตอบแท็บ Privacy | `store/listing.md` |
| ภาพหน้าจอ 1280×800 (ไทย) | `store/screenshots/1-badge-th.png`, `2-popup-th.png`, `3-phishing-th.png`, `4-options-th.png` |
| ภาพหน้าจอ 1280×800 (อังกฤษ และภาษาอื่น) | `store/screenshots/1-badge-en.png`, `2-popup-en.png`, `3-phishing-en.png`, `4-options-en.png` |
| ภาพโปรโมตเล็ก 440×280 | `store/promo/small-promo-440x280.png` |
| ภาพโปรโมต Marquee 1400×560 | `store/promo/marquee-1400x560.png` |
| ไอคอน 128×128 | `icons/icon128.png` |
| นโยบายความเป็นส่วนตัว | `PRIVACY.md` → ต้องขึ้นเว็บที่ **https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy** |

ภาพทั้งหมดถ่ายจากหน้าจอจริงของส่วนขยาย (ไม่ใช่ภาพวาด) โดยจำลองเครือข่ายทั้งหมดและใช้ข้อมูลเหรียญตัวอย่าง
ถ้าแก้ UI แล้วอยากถ่ายใหม่: `node store/make-assets.mjs` (ต้องมี Playwright + Chromium และฟอนต์ไทย เช่น `fonts-noto-core`)

## ก่อนเริ่ม (ครั้งเดียว)

- [ ] มีบัญชี Google ที่จะใช้เป็นเจ้าของถาวร (แนะนำบัญชีขององค์กร ไม่ใช่บัญชีส่วนตัวของพนักงาน)
- [ ] เปิดการยืนยันตัวตน 2 ขั้น (2-Step Verification) ในบัญชี Google นั้น — Store บังคับ
- [ ] สมัครที่ https://chrome.google.com/webstore/devconsole และจ่ายค่าธรรมเนียม **US$5** (ครั้งเดียว)
- [ ] แท็บ **Account**: กรอก Publisher name (เช่น "SAWASDEE COIN (SWD)") และยืนยันอีเมลติดต่อ (Contact email ต้องยืนยันก่อนส่งตรวจได้)
- [ ] (ไม่บังคับ) ยืนยันโดเมน sawasdeecoin.com ใน Google Search Console เพื่อให้แสดงเป็นเว็บทางการ

## 1. เตรียมไฟล์ (นักพัฒนา)

- [ ] ทีมยืนยันรายชื่อเว็บหลอกใน `data/phishing-domains.json` แล้ว
- [ ] `version` ใน `manifest.json` = `0.1.0` สำหรับการอัปโหลดครั้งแรก (ครั้งต่อไปต้องสูงกว่าเดิมทุกครั้ง และแก้ `package.json` ให้ตรงกัน)
- [ ] `npm test` ผ่าน (unit test + static check)
- [ ] `node test/e2e.playwright.mjs` ผ่าน (ไม่บังคับ แต่แนะนำ)
- [ ] `sh scripts/zip.sh` → ได้ `dist/swd-guard-0.1.0.zip` (สคริปต์จะล้มเองถ้ามีไฟล์เกินมา เช่น test, store/, เอกสาร)
- [ ] ทดลอง Load unpacked ใน Chrome ของจริงหนึ่งรอบ (ดูขั้นตอนใน README.th.md)
- [ ] เว็บ swd-zetaphy.sawasdeecoin.com **ออนไลน์** และ `/api/audit` ตอบได้ (ผู้ตรวจของ Google จะลองใช้จริง)
- [ ] หน้า **https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy** เปิดได้และเนื้อหาตรงกับ `PRIVACY.md`

## 2. อัปโหลดแพ็กเกจ

- [ ] Developer Dashboard → **Items** → **+ New item** → เลือกไฟล์ `dist/swd-guard-0.1.0.zip`
- [ ] ระบบอ่านชื่อ (`SWD Guard`) คำอธิบายสั้น และภาษาทั้ง 8 จาก `_locales` ให้อัตโนมัติ

## 3. แท็บ Store listing

ข้อความทั้งหมดคัดลอกจาก `store/listing.md`

- [ ] **Description** (ภาษาเริ่มต้น English): คัดลอกบล็อก "Detailed description" ของ English
- [ ] เปลี่ยนภาษาที่มุมขวาบนของฟอร์ม แล้ววาง Detailed description ของแต่ละภาษา: ไทย, 简体中文, 日本語, 한국어, Tiếng Việt, Español, Русский
- [ ] **Category**: Productivity → **Tools**
- [ ] **Language**: English (ภาษาหลัก)
- [ ] **Store icon**: `icons/icon128.png`
- [ ] **Screenshots**: ภาษา English อัปโหลด `store/screenshots/*-en.png` ทั้ง 4 ภาพ ตามลำดับ 1→4; ภาษาไทยอัปโหลด `*-th.png` ทั้ง 4 ภาพ (ภาษาอื่นใช้ชุด English)
- [ ] **Small promo tile**: `store/promo/small-promo-440x280.png`
- [ ] **Marquee promo tile**: `store/promo/marquee-1400x560.png`
- [ ] **Official URL**: `https://swd-zetaphy.sawasdeecoin.com` (เลือกได้หลังยืนยันโดเมนใน Search Console)
- [ ] **Homepage URL**: `https://swd-zetaphy.sawasdeecoin.com`
- [ ] **Support URL**: `https://github.com/pospos191-alt/zetaphy/issues`
- [ ] **Mature content**: No
- [ ] ห้ามเพิ่มคำว่า "ปลอดภัย 100%", "รับประกัน", "ป้องกันเงินของคุณ" ฯลฯ — ไม่จริงและทำให้ถูกปฏิเสธ

## 4. แท็บ Privacy practices (ถ้ากรอกไม่ครบจะถูกปฏิเสธ)

คัดลอกจากหัวข้อ "Privacy practices tab" ใน `store/listing.md`

- [ ] **Single purpose description**: วางข้อความจากหัวข้อ "Single purpose description"
- [ ] **Permission justification** ช่องละหนึ่งสิทธิ์: `storage`, `activeTab`, `scripting`, `alarms`, **Host permission** (วางข้อความที่เตรียมไว้)
- [ ] **Are you using remote code?** → **No, I am not using remote code** (ถ้ามีช่องเหตุผล ให้วางข้อความหัวข้อ "Remote code")
- [ ] **Data usage**: ไม่ติ๊กประเภทข้อมูลใดเลย (เหตุผลอยู่ใน listing.md; ถ้าต้องการตีความแบบระวังที่สุด ให้ติ๊กเฉพาะ "Web history" พร้อมคำอธิบายที่เตรียมไว้)
- [ ] ติ๊กยืนยันทั้ง 3 ข้อ (ไม่ขาย/โอนข้อมูล, ไม่ใช้นอกวัตถุประสงค์, ไม่ใช้ประเมินเครดิต)
- [ ] **Privacy policy URL**: `https://swd-zetaphy.sawasdeecoin.com/swd-guard#privacy`

## 5. แท็บ Distribution

- [ ] **Payments**: Free
- [ ] **Visibility**: Public (หรือ Unlisted ถ้าอยากทดสอบกับกลุ่มเล็กก่อน)
- [ ] **Distribution regions**: All regions
- [ ] (ไม่บังคับ) **Test instructions**: วางข้อความหัวข้อ "Test instructions for the reviewer" ใน `store/listing.md`

## 6. ส่งตรวจ

- [ ] กด **Save draft** แล้วตรวจว่าไม่มีช่องสีแดงเหลือ
- [ ] กด **Submit for review** (เลือก "Publish automatically after review" หรือจะกดเผยแพร่เองก็ได้)
- [ ] ถ้าถูกปฏิเสธ อีเมลจะบอกเหตุผลและรหัส (ที่พบบ่อย: เหตุผลการขอสิทธิ์ไม่ชัด, ลิงก์นโยบายความเป็นส่วนตัวเปิดไม่ได้, API ใช้งานไม่ได้ตอนตรวจ, คำโฆษณาเกินจริง) แก้แล้วส่งใหม่ได้

## หลังได้รับอนุมัติ

- [ ] ใส่ลิงก์ Store บนหน้า https://swd-zetaphy.sawasdeecoin.com/swd-guard และในโซเชียล
- [ ] ทุกครั้งที่ออกเวอร์ชันใหม่: เพิ่ม `version` (manifest.json + package.json) → `npm test` → `sh scripts/zip.sh` → Dashboard → **Package** → **Upload new package** → Submit for review
- [ ] ถ้า UI เปลี่ยน: `node store/make-assets.mjs` แล้วเปลี่ยนภาพหน้าจอใน Store listing
- [ ] ตอบรีวิวผู้ใช้ และรับแจ้งเว็บหลอกใหม่ (เพิ่มลงรายชื่อหลังตรวจสอบแล้วเท่านั้น)
