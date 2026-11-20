[English](TOKEN-REGISTRY.md) | **ภาษาไทย**

# ทะเบียนเหรียญของ ZETAPHY: ยืนยันเหรียญที่สร้างบน ZETAPHY ใน 5 ขั้นตอน

ใครก็ตามที่สร้างเหรียญบน ZETAPHY (เชน 3659) ใส่ชื่อ โลโก้ และเครื่องหมาย **verified** บน explorer (`explorer.sawasdeecoin.com`)
และใน [`zetaphy-tokens/tokenlist.json`](../zetaphy-tokens/tokenlist.json) ได้ (รูปแบบ token list ของ Uniswap ที่กระเป๋าและหน้าเว็บ DEX
อ่านได้) ฟรี ไม่ต้องมีบัญชี ไม่มีเซิร์ฟเวอร์: ข้อมูลคือโฟลเดอร์หนึ่งใน repo นี้ ส่งเป็น pull request และ CI ตรวจกับเชนซ้ำทุกครั้ง เครื่องมือ:
[`zetaphy-network/scripts/token-registry.js`](../zetaphy-network/scripts/token-registry.js)

ติดตั้งครั้งเดียว: `git clone https://github.com/pospos191-alt/zetaphy && cd zetaphy/zetaphy-network && npm ci`

| ขั้น | คำสั่ง | พิสูจน์อะไร |
|---|---|---|
| 1 [อ่าน] | `node scripts/token-registry.js 1 0xTOKEN` | เหรียญมีอยู่จริงบน ZETAPHY และแสดงชื่อ สัญลักษณ์ ทศนิยม supply และ owner() |
| 2 [อ่าน] | `node scripts/token-registry.js 2 0xTOKEN --input std.json --contract src/My.sol:My --compiler v0.8.26+commit.8a97fa7a` | ซอร์สคอมไพล์ออกมาตรงกับโค้ดบนเชนทุกไบต์ (ทั้ง runtime และ constructor) `std.json` คือ standard-JSON input ที่ใช้คอมไพล์ (Remix "Compilation details", Hardhat `artifacts/build-info`, Foundry `forge verify-contract --show-standard-json-input`) |
| 3 [อ่าน] | `read -rs PW; export PW; node scripts/token-registry.js 3 0xTOKEN --info info.json --logo logo.svg --keystore key.json; unset PW` | **ผู้สร้าง** (ผู้ส่งธุรกรรมที่สร้างเหรียญ) หรือ `owner()` ของเหรียญเซ็นข้อมูลแบบออฟไลน์ ครอบที่อยู่เหรียญ ค่า hash ของ `info.json` และของโลโก้ แล้วเขียนไฟล์ `signature.json` |
| 4 [เปลี่ยนไฟล์] | `node scripts/token-registry.js 4 0xTOKEN --info info.json --logo logo.svg --input std.json --contract src/My.sol:My --signature signature.json` แล้ว `node scripts/token-registry.js list` | เขียนโฟลเดอร์ `zetaphy-tokens/3659/0xTOKEN/` แล้วตรวจทุกข้อ `list` จะเพิ่มเหรียญลงใน `tokenlist.json` จากนั้นเปิด pull request พร้อมทั้งสองอย่าง |
| 5 [อ่าน] | `node scripts/token-registry.js 5 0xTOKEN` (หรือ `5 all`) | ตรวจทุกข้ออีกครั้งแบบเดียวกับที่ CI รัน (`.github/workflows/token-registry.yml`) เมื่อ merge แล้ว explorer จะแสดงเป็น `SYMBOL (Name) ✓ registry` |

## info.json

ใช้รูปแบบตามฉบับภาษาอังกฤษ ([TOKEN-REGISTRY.md](TOKEN-REGISTRY.md)) `name`, `symbol` และ `decimals` ต้องตรงกับที่ตัวเหรียญตอบ
ระบบจะปฏิเสธ: ชื่อหรือสัญลักษณ์ที่เลียนแบบ ZTPHY, ZETAPHY, BZTPHY หรือเหรียญที่รู้จักกันดี (USDT, USDC, ETH, BTC, BNB …),
คำสัญญาว่าได้กำไร และลิงก์ที่ไม่ใช่ https

## logo.svg

ต้องมี `width="32" height="32"` บน `<svg>` ขนาดไม่เกิน 20 KB และเป็นรูปนิ่ง: ไม่มีสคริปต์ ไม่มีรูปฝังหรือรูปภายนอก ไม่มีแอนิเมชัน
ไม่มี attribute ของ event และอ้างอิงได้เฉพาะ `#local` ลายเซ็นครอบไฟล์โลโก้ทุกไบต์

## "verified" หมายถึงอะไร และไม่ได้หมายถึงอะไร

หมายถึง: ซอร์สที่เผยแพร่คือโค้ดบนเชนจริง ผู้สร้าง (หรือ owner) เป็นคนขอลงทะเบียนเอง และชื่อกับโลโก้เป็นของเขา **ไม่ได้**หมายความว่าเหรียญ
ปลอดภัยหรือมีมูลค่า owner ยัง mint หยุดการโอน หรือบล็อกกระเป๋าได้ถ้าโค้ดอนุญาต ใช้ตัวตรวจ Neuro บน explorer ดูว่า owner ทำอะไรได้บ้าง
ก่อนตัดสินใจซื้อ
