# DefiLlama TVL adapter ของ SWD AMM — วิธีส่งให้ DefiLlama

ไฟล์ `index.js` ในโฟลเดอร์นี้คือ "adapter" ที่ DefiLlama ใช้คำนวณ TVL (มูลค่าเงินที่ฝากอยู่ใน SWD AMM)
DefiLlama ไม่ได้ให้เรากรอกตัวเลขเอง เขาจะรันโค้ดนี้เองทุกชั่วโมง โค้ดจะหา pool ทุกอันของโปรแกรม swd_amm
บน Solana แล้วรวมยอดเหรียญใน vault ของแต่ละ pool

> **สำคัญ: ยังส่งไม่ได้จนกว่าจะ deploy บน mainnet แล้ว** ตอนนี้ `PROGRAM_ID` ในไฟล์เป็น id ของ devnet
> บน mainnet จะได้ TVL = 0 และ DefiLlama จะไม่รับโปรเจกต์ที่ยังไม่มีเงินจริงบน mainnet

## สิ่งที่ต้องมีก่อน

1. โปรแกรม swd_amm deploy บน mainnet แล้ว (ดู `docs/DEFI_LISTING.th.md` และ `docs/MAINNET_RUNBOOK.md`)
2. มี pool จริงที่มีสภาพคล่องจริงอย่างน้อย 1 pool
3. บัญชี GitHub (ใช้บัญชีเดียวกับที่ดูแล repo zetaphy ได้)
4. เครื่องที่ลง Node.js (เวอร์ชัน 20 ขึ้นไป) และ git

## ขั้นตอน (ทำบนเครื่องของคุณเอง ไม่ต้องใช้ private key ใด ๆ)

1. **แก้ PROGRAM_ID** — เปิด `index.js` เปลี่ยนบรรทัด
   `const PROGRAM_ID = '3zKYY…'` เป็น program id ของ mainnet (ได้จากตอน deploy, คำสั่ง `solana address -k <program-keypair.json>`)
   แล้วลบคำว่า `// TODO: mainnet program id` ออก
2. **Fork repo ของ DefiLlama** — เข้า https://github.com/DefiLlama/DefiLlama-Adapters กดปุ่ม **Fork** (มุมขวาบน)
3. **Clone และติดตั้ง**
   ```bash
   git clone https://github.com/<ชื่อ GitHub ของคุณ>/DefiLlama-Adapters.git
   cd DefiLlama-Adapters
   npm install
   ```
4. **วางไฟล์** — สร้างโฟลเดอร์ `projects/swd-amm/` แล้วคัดลอก `index.js` จากโฟลเดอร์นี้ไปไว้เป็น `projects/swd-amm/index.js`
5. **ทดสอบ**
   ```bash
   node test.js projects/swd-amm/index.js
   ```
   ผลที่ถูกต้อง: แสดงรายการเหรียญและยอด TVL รวมเป็น USD ที่ไม่ใช่ 0 และไม่มี error
   - ถ้าขึ้น error เรื่อง RPC / rate limit: ใส่ RPC ของตัวเอง เช่น `export SOLANA_RPC=https://<rpc ส่วนตัวของคุณ>` แล้วรันใหม่
     (ชื่อตัวแปรนี้ตามที่ DefiLlama ใช้อยู่ในตอนที่เขียน — **ยังไม่ได้ยืนยัน** ให้ดู README ของ repo เขา)
   - ถ้า TVL = 0: เช็คว่า PROGRAM_ID เป็นของ mainnet และมี pool ที่มีเงินแล้ว
6. **Commit และ push ไปที่ fork ของคุณ**
   ```bash
   git checkout -b add-swd-amm
   git add projects/swd-amm/index.js
   git commit -m "Add SWD AMM (Solana DEX) TVL adapter"
   git push origin add-swd-amm
   ```
7. **เปิด Pull Request** — เข้า fork ของคุณบน GitHub กด **Compare & pull request** ไปที่ `DefiLlama/DefiLlama-Adapters` branch `main`
   แล้วกรอกฟอร์มใน PR template (ด้านล่าง)
8. **รอ reviewer ของ DefiLlama** — เขาอาจขอแก้ (เช่น ให้ใช้ helper อื่น) ให้ตอบใน PR และ push แก้ใน branch เดิม
   ปกติใช้เวลาเป็นวันถึงสัปดาห์ (ประมาณการ ไม่ได้ยืนยัน)

## ข้อมูลที่ PR template ของ DefiLlama ถาม (เตรียมไว้ก่อน)

ข้อมูลชุดนี้อิงจาก template ที่ DefiLlama ใช้ในช่วงที่เขียน — **ยังไม่ได้ยืนยันกับหน้าปัจจุบัน** ให้กรอกตาม template ที่ขึ้นจริงใน PR

| ช่อง | คำตอบที่เตรียมไว้ / ที่ต้องกรอกเอง |
|---|---|
| Name (ชื่อโปรเจกต์) | SWD AMM |
| Twitter/X link | (ใส่ของโปรเจกต์) |
| List of audit links if any | ยังไม่มี — ใส่ลิงก์รายงาน audit เมื่อมี |
| Website link | https://swd-zetaphy.sawasdeecoin.com |
| Logo (High resolution, ควรเป็น PNG/SVG สี่เหลี่ยมจัตุรัส) | ไฟล์จาก `brand/` ใน repo |
| Current TVL | ยอดที่ได้จาก `node test.js` |
| Treasury addresses | Squads vault (ถ้าต้องการให้แสดง treasury แยก) |
| Chain | Solana |
| Coingecko ID / CoinMarketCap ID | ของเหรียญ SWD ถ้ามี (ไม่มีก็เว้นได้) |
| Short description | Solana AMM: constant-product, DLMM and SWDMM v2 (Meteora-DAMM-v2-style) pools with scheduled and dynamic fees |
| Token address and ticker if any | mint ของ SWD และ ticker `SWD` |
| Category | Dexs (หรือ "Dexes" ตามรายการใน template) |
| Oracle Provider(s) | Pyth (ใช้เป็น price guard ใน pool บางแบบ) |
| Implementation details | อธิบายสั้น ๆ: TVL = ยอดใน vault ของทุก pool ที่หาได้ด้วย getProgramAccounts |
| Documentation/Proof | ลิงก์ไป repo https://github.com/pospos191-alt/zetaphy และหน้า program บน Solscan |
| forkedFrom | ไม่ได้ fork ใคร (เขียนเอง; SWDMM v2 ออกแบบตามแนว Meteora DAMM v2 แต่ไม่ใช่โค้ดของเขา) |
| methodology | อยู่ในไฟล์แล้ว (`methodology:`) |
| Github org/user | pospos191-alt |

## หมายเหตุ

- DefiLlama อาจไม่นับ (หรือแยกเป็นหมวด "pool2") เงินใน pool ที่จับคู่กับเหรียญของโปรเจกต์เอง (SWD) — **ไม่ได้ยืนยัน** เป็นการตัดสินของ reviewer
- อยากให้ DefiLlama แสดง **Volume** ด้วย ต้องเขียน adapter อีกตัวใน repo `DefiLlama/dimension-adapters` (อ่าน event `V2Swapped` / `SwapExecuted`) — ยังไม่ได้ทำ
- ไฟล์นี้เช็คแล้วด้วย `node --check` และทดสอบตรรกะแบบ offline (จำลอง RPC) แต่ **ยังไม่เคยรันกับ RPC จริง** เพราะยังไม่มี pool บน mainnet
