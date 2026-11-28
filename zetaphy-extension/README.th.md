# Neuro Guard โดย ZETAPHY (ส่วนขยายเบราว์เซอร์)

ดูว่าสัญญาของเหรียญทำอะไรได้บ้าง **ก่อน** กดซื้อ เมื่อเปิดหน้าเหรียญหรือหน้า pool บน DEX Screener, GeckoTerminal,
PancakeSwap, Uniswap, Etherscan, BscScan, BaseScan หรือ Arbiscan จะมีกล่องเล็กมุมขวาล่างแสดงผลตรวจ Neuro ของเหรียญนั้น
ได้แก่ ระดับความเสี่ยง สิ่งที่พบหลัก ๆ วันที่ตรวจ ลิงก์ไปรายงานเต็ม และลิงก์ตรวจสด ถ้า Neuro ยังไม่มีรายงานของเหรียญนั้น
กล่องจะมีปุ่ม "ตรวจตอนนี้" ให้กดไปตรวจสดแทน

ใช้ได้กับ Chrome และ Firefox (Manifest V3) เขียนด้วย JavaScript ล้วน ไม่ต้อง build ไม่มี dependency และไม่โหลดโค้ดจากอินเทอร์เน็ต
English: [README.md](README.md) · [PRIVACY.md](PRIVACY.md)

## ผลตรวจมาจากไหน

มาจากหน้าผลตรวจเหรียญสาธารณะของ Neuro (`zetaphy-neuro/scripts/build-reports.js` อัปเดตทุก 6 ชั่วโมง) คือไฟล์ static
`https://neuro.sawasdeecoin.com/reports/<chain>/<address>/summary.json` ถ้าเป็นหน้า pool (DEX Screener, GeckoTerminal)
ส่วนขยายจะถาม API สาธารณะของเว็บนั้นก่อนว่า pool นี้เป็นของเหรียญอะไร (`api.dexscreener.com` ก่อน แล้วจึง
`api.geckoterminal.com`) กล่องจะแสดงเฉพาะ `summary.json` ที่ตรงกับเหรียญที่ถาม มีระดับความเสี่ยงที่รู้จัก และข้อความยาวไม่เกินที่กำหนด
ลิงก์ทั้งหมดในกล่องส่วนขยายสร้างเอง ไม่เอาลิงก์จากไฟล์

เครือข่ายที่รองรับ: Ethereum, BNB Chain, Base, Arbitrum

## สิทธิ์ที่ขอ (และเหตุผล)

| สิทธิ์ | เหตุผล |
| --- | --- |
| `host_permissions`: `neuro.sawasdeecoin.com`, `api.dexscreener.com`, `api.geckoterminal.com` | อ่านผลตรวจ และหาเหรียญของ pool |
| content script บน 8 เว็บข้างต้น | อ่านที่อยู่หน้าเว็บ และแสดงกล่องผลตรวจ |

ไม่ขอสิทธิ์ API ใดเลย (ไม่มี `tabs`, `storage`, `cookies`, `webRequest`, `history`, `<all_urls>`) ไม่มี host เสริม
ไม่รับข้อความจากภายนอก และไม่มีไฟล์ที่หน้าเว็บอื่นเข้าถึงได้ กล่องผลตรวจอยู่ใน Shadow DOM แบบปิด และใส่ข้อความทุกบรรทัดด้วย
`textContent` (`scripts/check.mjs` จะไม่ยอมให้มี `eval`, `new Function`, `innerHTML` หรือ URL ที่ไม่ได้อนุญาต)

## คำสั่ง

```
npm test                 # ตรวจแบบ static + unit test
npm run test:browser     # ทดสอบใน Chromium (CHROMIUM_PATH ไม่ใส่ก็ได้)
npm run zip              # dist/neuro-guard-0.1.0.zip สำหรับอัปโหลดขึ้น Chrome Web Store / Firefox Add-ons
```

## เผยแพร่ (เจ้าของโปรเจกต์ทำ)

- **Firefox Add-ons:** ฟรี เข้า addons.mozilla.org → Developer Hub → Submit a New Add-on → อัปโหลดไฟล์ zip
- **Chrome Web Store:** ค่าลงทะเบียนนักพัฒนาครั้งเดียว $5 แล้วอัปโหลดไฟล์ zip ช่อง privacy policy ใส่ลิงก์ของ
  [PRIVACY.md](PRIVACY.md) ฉบับสาธารณะ และช่อง single purpose ใส่ "shows Neuro's token check on token pages"
- **Edge Add-ons:** ฟรี ใช้ไฟล์ zip เดียวกันได้
