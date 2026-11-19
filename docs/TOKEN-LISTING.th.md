[English](TOKEN-LISTING.md) | **ภาษาไทย**

# หน้าเหรียญ ZTPHY บน explorer ใน 5 ขั้นตอน

โลโก้ เว็บไซต์ และคำอธิบายที่ BscScan / BaseScan แสดงสำหรับ ZTPHY บนเชนของเขา ฟรี ไม่มีธุรกรรมถูกส่ง ใช้เครื่องมือเดียว
[`zetaphy-network/scripts/token-listing.js`](../zetaphy-network/scripts/token-listing.js) ค่าทั้งหมดมาจาก
[`token-listing.json`](../zetaphy-network/token-listing.json) ไฟล์ตั้งค่าของเส้นทาง และไฟล์ state รันบน Oracle Cloud Shell ใน
`~/zetaphy/zetaphy-network` (`git pull` ก่อน) ใช้ `--route bsc` หรือ `--route base`

| ขั้น | คำสั่ง | สิ่งที่ทำ |
|---|---|---|
| 1 [อ่าน] | `node scripts/token-listing.js 1 --route bsc` | ตรวจว่า bytecode บนเชนตรงกับใน repo และ verify บน Sourcify ถ้าแท็บ Contract บน explorer มีเครื่องหมายถูกสีเขียว แปลว่าขั้น 2 เสร็จแล้ว |
| 2 [เปลี่ยนไฟล์] | `node scripts/token-listing.js 2 --route bsc` | เขียนไฟล์สำหรับ "Verify and Publish" ลง `~/verify` และพิมพ์ค่าที่ต้องกรอก แล้วกรอกฟอร์มของ explorer |
| 3 [อ่าน] | `read -rs PW; export PW; node scripts/token-listing.js 3 --route bsc; unset PW` | บน explorer: Verify Address Ownership, owner = deployer, เลือก "sign message manually" วางข้อความที่ได้ เครื่องมือจะเซ็นด้วย keystore ของ deployer (เซ็นเฉพาะข้อความยืนยันความเป็นเจ้าของของ explorer นั้นสำหรับเหรียญนั้น อย่างอื่นจะไม่ยอมเซ็น) แล้วนำลายเซ็นไปวางกลับ |
| 4 [อ่าน] | `node scripts/token-listing.js 4 --route bsc` | พิมพ์ทุกช่องของฟอร์ม "Token Update" (โลโก้ อีเมล คำอธิบาย ข้อความว่าไม่มี ICO พร้อม vault เพดาน และ pool) คัดลอกไปวาง แล้วส่งคำขอครั้งเดียว |
| 5 [อ่าน] | `node scripts/token-listing.js 5 --route bsc` | ตรวจว่าโลโก้ (SVG และ PNG 32x32) และอีเมลออนไลน์อยู่ตามที่ฟอร์มระบุ explorer จะตอบทางอีเมล (`zetaphy.chain@` เข้า sawasdeecoin@gmail.com) ภายในไม่กี่วันถึงหลายสัปดาห์ |

หมายเหตุ

- ถ้า RPC ปฏิเสธ (403 หรือ "could not coalesce") ให้ระบุตัวอื่น: `BSC_RPC=https://bsc-dataseed.bnbchain.org node scripts/token-listing.js 1 --route bsc`
- อีเมลต้องอยู่บนโดเมนของโปรเจกต์และประกาศไว้บนเว็บ: มีอยู่ในหน้า about ทุกภาษา (`/about/`)
- อย่าจ่ายเงินให้ใครที่เสนอลิสต์ "ด่วน" ฟอร์มเหล่านี้ฟรี ส่งคำขอครั้งเดียวต่อเหรียญ ส่งซ้ำจะยิ่งช้า
- BNB Smart Chain ทำครบแล้วเมื่อ 2026-11-19 (verify สัญญา ยืนยันความเป็นเจ้าของ และส่ง Token Update)
