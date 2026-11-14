# แอร์ดรอป ZTPHY: รายชื่อ สัญญารับเหรียญ และหน้ารับเหรียญ

> **testnet ปิดถาวรแล้วเมื่อ 2026-11-14** ตอนนี้ ZETAPHY mainnet (`zetaphy_3659-1`, chain 3659) เป็นเครือข่ายเดียว ที่หน้านี้เขียนว่า testnet หมายถึง testnet ที่ปิดแล้ว (หรือ devnet) ดู[ประกาศ mainnet](ZETAPHY-MAINNET-NOTICE.th.md)

[English](AIRDROP.md)

> **เปิดรอบที่ 1 แล้ว (ผู้ถือ SWD, เมนเน็ตเชน 3659):** ผูกกระเป๋า Solana ให้ทันก่อน 4 ธ.ค. 2026 เวลา 14:00 UTC (21:00 น. เวลาไทย)
> วันเวลา กติกา และวิธีทำทีละขั้น: [AIRDROP-ROUND1.th.md](AIRDROP-ROUND1.th.md) · หน้าผูกกระเป๋า: `https://app.sawasdeecoin.com/airdrop-link.html`

> **เจ้าของตัดสินใจ 2026-11-14: แอร์ดรอปแบบส่งให้เลยบน mainnet** คนละ 10 ZTPHY ให้กระเป๋า Ethereum ที่ใช้งานอยู่ 100,000 ใบ
> (1,000,000 ZTPHY จากกอง Community) ส่งด้วย `gov.sh airdrop`: หัวข้อ 7 ด้านล่าง

วิธีที่เจ้าของโครงการจ่าย ZTPHY (เหรียญหลักของเชน ZETAPHY) ให้คนราว 100,000 คนที่ถือกระเป๋า EVM ของตัวเอง
โดยไม่มีใครต้องให้อะไรนอกจากที่อยู่ สัญญารับเหรียญ (หัวข้อ 1-6) ให้คนกดรับเอง ส่วนกระเป๋า Ethereum ที่ใช้งานอยู่ เจ้าของตัดสินใจ
เมื่อ 2026-11-14 ให้ส่งให้เลยแทน (หัวข้อ 7) ยังไม่มีอะไรถูก deploy และไม่มีเหรียญเคลื่อนจนกว่าเจ้าของจะทำตามขั้นตอนด้านล่าง

| ส่วน | อยู่ที่ |
|---|---|
| สัญญารับเหรียญ | `zetaphy-network/contracts/ZtphyMerkleDistributor.sol` (artifact `artifacts/ZtphyMerkleDistributor.json`) |
| เครื่องมือทำรายชื่อ | `zetaphy-network/airdrop/cli.js` (`from-csv`, `push-list`, `link-message`, `link-solana`, `merge`, `merkle`, `verify`, `init-code`; คำสั่งเดิม `snapshot`, `allocate`, `merkle` ยังใช้ได้) |
| ส่งให้เลย (หัวข้อ 7) | `zetaphy-chain/gov.sh airdrop` (mainnet: `AIRDROP_MAINNET=1`), `gov.sh transfer` (การโอนของ multisig) |
| คิวรีจากเชนสาธารณะ | `zetaphy-network/airdrop/queries/active-evm-wallets.sql` (BigQuery ฟรี) |
| หน้ารับเหรียญ | hub แท็บ Agents การ์ด "รับแอร์ดรอป" (`zetaphy-hub/airdrop.js`, 8 ภาษา) |
| การทดสอบ | `zetaphy-network/test/distributor.test.js`, `test/airdrop-evm.test.js`, `audit/invariants/MerkleDistributor.inv.t.sol`, `zetaphy-hub/test/airdrop.test.mjs`, `test/airdrop.e2e.mjs` |

## 1. ทำงานอย่างไร

1. เจ้าของสร้างรายชื่อ `(index, address, amount)` นอกเชน แล้วเผยแพร่ทั้งหมด (`list.csv`) พร้อม `summary.json`
   (จำนวน ยอดรวม Merkle root และ sha256 ของรายชื่อ) และไฟล์เล็กแยกตามที่อยู่ (`shards/`)
2. deploy `ZtphyMerkleDistributor` หนึ่งตัวต่อหนึ่งรอบ โดยกำหนด root ยอดรวมและจำนวนรายการ เวลาเริ่มรับ เวลาปิดรับ
   ที่อยู่ `returnTo` (กองทุนชุมชน / governance) และ `guardian` (ไม่บังคับ) ค่าเหล่านี้เปลี่ยนไม่ได้ตลอดไป ไม่มี owner หรือ admin
3. กองแอร์ดรอปโอนเหรียญเข้าสัญญาเท่ากับยอดรวมพอดี
4. ระหว่างโอนเงินเข้าจนถึง `claimStart` (ช่วงตรวจ เช่น 3-7 วัน) ใครก็คำนวณ root ใหม่จากรายชื่อที่เผยแพร่ได้
   (`cli.js verify`) ถ้ารายชื่อผิด guardian เรียก `abort()` แล้วใครก็เรียก `sweep()` ส่งเหรียญกลับ `returnTo` ได้ทันที
   guardian ทำได้เฉพาะตอนที่ยังไม่มีใครรับเท่านั้น ส่งเหรียญไปที่อื่น หยุดรอบที่กำลังรับ หรือขวางการรับไม่ได้
5. ตั้งแต่ `claimStart` ถึง `claimDeadline` แต่ละที่อยู่ในรายชื่อรับได้ครั้งเดียว (`claim(index, account, amount, proof)`)
   ใครจะเป็นคนส่งคำขอก็ได้ (ผู้ส่งแทน ผู้สนับสนุน หรือเจ้าตัว) แต่เหรียญไปที่ `account` ในรายชื่อเท่านั้น
   `claimMany` ให้ผู้ส่งแทนจ่ายค่าแก๊สให้หลายคนในธุรกรรมเดียว (รายการที่รับไปแล้วจะถูกข้าม)
6. หลังหมดเวลา ใครก็เรียก `sweep()` ได้ เหรียญที่เหลือไปที่ `returnTo` เท่านั้น

Leaf = `keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint256 amount))))` (แฮชสองชั้น
แบบ StandardMerkleTree ของ OpenZeppelin ทำให้ leaf ไม่มีทางถูกมองเป็นโหนดภายใน) โหนดภายในแฮชคู่ที่เรียงแล้ว
โหนดสุดท้ายที่เหลือเดี่ยวเลื่อนขึ้นไปเฉย ๆ index = ลำดับหลังเรียงตามที่อยู่ตัวพิมพ์เล็ก การจัดสรรเดิมจึงได้ root เดิมเสมอ
การรับถูกบันทึกเป็น bitmap (256 รายการต่อหนึ่ง storage word)

ทำไมไม่มีปุ่มหยุด: กุญแจหยุดอาจถูกใช้แช่แข็งรอบที่กำลังรับ (เซ็นเซอร์) หรือทำหาย ความผิดพลาดราคาแพงอย่างเดียวที่สัญญายังแก้ได้
คือ root ผิดก่อนมีใครได้รับ ซึ่ง `claimStart` กับ `abort` ครอบคลุมพอดี กันซ้อนอีกชั้น: ไม่มีการรับใดทำให้ยอดจ่ายเกิน
`totalAllocated` ใช้ index `>= leafCount` หรือจ่ายเกินเงินที่สัญญามี

## 2. ที่อยู่มาจากไหน

มีสามแหล่ง ทุกแหล่งได้ JSON รูปแบบเดียวกัน `{allocations: [{address, amount}]}` และ `merge` รวมยอดต่อที่อยู่

### 2a. ลงทะเบียน (`from-csv`)

เก็บ **เฉพาะที่อยู่ EVM** (`0x…`) ไม่ต้องใช้ชื่อ อีเมล เบอร์โทร ประเทศ บัญชีโซเชียล หรือลายเซ็นกระเป๋า เพราะเหรียญไปที่
ที่อยู่นั้นเอง พิมพ์ผิดก็แค่เสียสิทธิ์ของตัวเอง ไอเดีย:

- ฟอร์มธรรมดา (เครื่องมือฟอร์มใดก็ได้) ช่องเดียว "ที่อยู่ ZETAPHY / EVM ของคุณ (0x…)" ปิดการเก็บอีเมลและการติดตามผู้ตอบ
  แล้วส่งออกเป็น CSV ถ้าเครื่องมือรองรับ ให้ตรวจ checksum (EIP-55) ฝั่งผู้ใช้
- ใน hub: คนเชื่อมกระเป๋าแล้วกด "ลงทะเบียน" เก็บแค่ที่อยู่
- ห้ามขอ seed phrase, private key, ลายเซ็น "ยืนยัน" หรือการอนุมัติโทเคน และเขียนบอกไว้บนฟอร์ม

```bash
node airdrop/cli.js from-csv signups.csv --each 1000 --pool 20000000 > signups.json        # คนละ 1,000 ZTPHY
node airdrop/cli.js from-csv signups.csv --equal --pool 20000000 --cap 5000 > signups.json  # แบ่งกองเท่ากัน มีเพดาน
node airdrop/cli.js from-csv given.csv > given.json            # address,amount (ZTPHY) หรือ address,amount_wei ตามที่ให้
```

`from-csv` ตรวจ checksum EIP-55 ของที่อยู่ที่มีตัวพิมพ์ใหญ่ปนเล็ก ตัดรายการซ้ำ (ไม่สนตัวพิมพ์ เก็บแถวแรก) ที่อยู่ศูนย์
precompile และที่อยู่สงวน (ต่ำกว่า `0x…10000` ซึ่งเป็นที่อยู่ precompile ของ Ethereum และ ZETAPHY) ที่อยู่ที่ไม่ใช่คนแน่ ๆ
(burn `0x…dEaD`, `0xdead…`, ตัวแทน `0xEeee…`) ที่อยู่ใน `--exclude <ไฟล์>` และถ้าใส่ `--rpc <URL>` จะตัดสัญญาออกด้วย
(`eth_getCode` ไม่ใช่ `0x` ถามเป็นชุด อ่านอย่างเดียว EOA ที่ delegate แบบ EIP-7702 ยังเป็นกุญแจของคนจึงเก็บไว้)
ยอดรวมต้องไม่เกินกอง รายงานบอกทุกแถวที่ถูกตัดพร้อมบรรทัดและเหตุผล รายชื่อลงทะเบียนปลอมเป็นหลายคนได้ง่าย (คนเดียวหลายที่อยู่)
จึงควรให้จำนวนน้อย ใช้เพดาน หรือใช้แหล่งที่เข้มกว่าด้านล่าง

### 2b. ผู้ถือ SWD (Solana) -> ที่อยู่ EVM (`link-solana`)

SWD อยู่บน Solana แต่แอร์ดรอปจ่ายที่อยู่ EVM ผู้ถือแต่ละคนเซ็นด้วยกระเป๋า Solana ที่ถือ SWD ตอน snapshot ข้อความนี้พอดี:

```
ZETAPHY airdrop: link <solanaOwner> to <0xEVM แบบ checksum EIP-55> on <chainId>
```

(`node airdrop/cli.js link-message <solanaOwner> <0xEVM> --chain-id 77390` พิมพ์ข้อความให้) Phantom, Solflare และ
Backpack เซ็นไบต์ UTF-8 ตรง ๆ ด้วย `signMessage` หน้าเล็ก ๆ สำหรับฟอร์ม:

```js
const msg = `ZETAPHY airdrop: link ${solanaOwner} to ${evmChecksummed} on ${chainId}`;
const { signature } = await window.solana.signMessage(new TextEncoder().encode(msg), 'utf8');
// ส่ง { solana: solanaOwner, evm: evmChecksummed, chainId, signature: base58(signature) }
```

chain id อยู่ในข้อความ ลิงก์ของ testnet จึงเอาไปใช้ซ้ำบน mainnet ไม่ได้ เครื่องมือตรวจ ed25519 แบบเข้ม RFC 8032
(`@noble/curves` ซึ่งเป็น dependency อยู่แล้ว) และรับลายเซ็นแบบ base58, 0x-hex หรือ base64

```bash
node airdrop/cli.js snapshot --mint <SWD mint> > snapshot.json
node airdrop/cli.js allocate snapshot.json --min 1000000 --cap-bps 100 > swd.json   # ตัดเศษ + เพดานวาฬ
node airdrop/cli.js link-solana swd.json links.json --chain-id <chain id ของ ZETAPHY> > linked.json
```

กติกา: เจ้าของ Solana หนึ่งคนผูกที่อยู่ EVM ได้หนึ่งที่ (ระเบียนเดิมซ้ำนับครั้งเดียว ถ้าผูกสองที่อยู่ต่างกันถือว่าขัดแย้ง
เจ้าของนั้นจะถูกเว้นและรายงาน) เจ้าของ Solana หลายคนผูกที่อยู่ EVM เดียวกันได้ (คนเดียวหลายกระเป๋า ยอดจะรวมกัน)
ข้อความผิด chain id ผิด สลับที่อยู่ EVM คนอื่นเซ็น หรือลายเซ็นถูกแก้ จะถูกปฏิเสธพร้อมเหตุผล ผู้ถือที่ไม่ได้ผูก **ไม่ได้รับในรอบนี้**
`unlinked` แสดงรายชื่อพร้อมจำนวน เพื่อจ่ายในรอบถัดไปได้ กระเป๋าฮาร์ดแวร์ที่เซ็นแบบ "off-chain message" ของ Solana (Ledger)
ได้ไบต์ต่างออกไป ยังไม่รองรับ (เรื่องค้าง)

### 2c. ผู้รับจากเชนสาธารณะ (ย้อนหลัง, `active-evm-wallets.sql`)

เพื่อเข้าถึงผู้ใช้จริงที่ยังไม่รู้จัก ZETAPHY ให้เลือกกระเป๋า EVM ที่คนใช้งานจริงบนเชนสาธารณะ private key เดียวกันคุมที่อยู่เดียวกัน
บน ZETAPHY (EVM, `eth_secp256k1`) EOA ของ Ethereum จึงรับที่นี่ได้ด้วยกระเป๋าที่มีอยู่แล้ว ส่วนกระเป๋าแบบสัญญา (Safe, smart account)
**ไม่มี** ที่อยู่เดียวกันบน ZETAPHY และไม่มีทางรับได้ จึงตัดออก

เกณฑ์ของคิวรี (พารามิเตอร์ทั้งหมดอยู่ด้านบน `DECLARE …`):

| กฎ | ค่าเริ่มต้น | เหตุผล |
|---|---|---|
| ธุรกรรมที่ส่งสำเร็จในช่วงเวลา | >= 10 | กระเป๋าที่ใช้จริง |
| จำนวนเดือนที่มีกิจกรรม | >= 3 | ไม่ใช่ใช้ครั้งเดียว |
| กิจกรรมล่าสุด | ภายใน 6 เดือนก่อน `window_end` | ยังใช้อยู่ |
| กิจกรรมแรกในช่วงเวลา | >= 6 เดือนก่อน `window_end` | ไม่ใช่กระเป๋าฟาร์มใหม่ |
| ธุรกรรมรวมในช่วงเวลา | <= 50,000 | ไม่ใช่ exchange / บอท |
| วันที่มากที่สุด | <= 500 ธุรกรรม | ไม่ใช่บอท / ตัวรวมธุรกรรม |
| ไม่ใช่สัญญา | anti-join กับ `crypto_ethereum.contracts` (+ `--rpc` ภายหลัง) | ต้องเป็นกุญแจที่เซ็นที่นี่ได้ |
| ผลลัพธ์ | 100,000 อันดับแรกตามจำนวนวันที่ใช้งาน คอลัมน์ `address,score` | |

**คนเหล่านี้ไม่ได้ลงทะเบียน** ค่าเริ่มสำหรับพวกเขาคือให้กดรับเอง (สัญญานี้) มีตัวตรวจสิทธิ์สาธารณะ (การ์ดใน hub ใช้กับที่อยู่ใดก็ได้
ไม่ต้องใช้กระเป๋า) ประกาศชัดเจนในช่องทางทางการของโครงการ และมีเส้นตาย หลังจากนั้นเหรียญที่ไม่มีคนรับกลับไปกองทุนชุมชน
**เจ้าของตัดสินใจ 2026-11-14:** สำหรับกระเป๋า Ethereum ที่ใช้งานอยู่ 100,000 ใบ เจ้าของเลือกส่งให้เลยคนละ 10 ZTPHY แทน (หัวข้อ 7)
โดยรู้ว่าเขาไม่ได้ขอ สิ่งที่ไม่เปลี่ยน: ห้าม DM และห้ามขอกุญแจ seed phrase ลายเซ็น หรือการอนุมัติ ใครขอคือมิจฉาชีพ และประกาศต้อง
บอกไว้ การส่งเหรียญให้คนที่ไม่ได้ขอครั้งอื่นต้องให้เจ้าของตัดสินใจใหม่ทุกครั้ง

วิธีรันในโปรเจกต์ Google Cloud ของเจ้าของเอง (ฟรี 1 TB ต่อเดือน):

1. console.cloud.google.com -> สร้าง (หรือเลือก) โปรเจกต์ -> BigQuery -> "+ Compose a new query"
2. More -> Query settings -> Advanced -> **Maximum bytes billed** = `150000000000` (150 GB) ถ้าพลาดคิวรีจะล้มแทนที่จะคิดเงิน
3. วาง `airdrop/queries/active-evm-wallets.sql` ปรับบรรทัด `DECLARE` (`window_end`, `lookback_months`, …)
   คิวรีอ่านราว 60 ไบต์ต่อธุรกรรมในช่วงเวลา (`from_address`, `block_timestamp`, `receipt_status`) ช่วง 24 เดือนราว 60-70 GB
   รันได้ราว 15 ครั้งในโควตาฟรี (ตัวประมาณของ editor สำหรับสคริปต์ที่ใช้ DECLARE อาจแสดงทั้งตาราง แต่ตอนรันจริงยังตัด partition
   ถ้าอยากเห็นค่าประมาณที่ถูก ให้ใส่วันที่ตรง ๆ แทนสักครั้ง)
4. รัน แล้ว Save results -> CSV (ไฟล์ในเครื่อง 100,000 แถวราว 5 MB) หรือ Google Drive
5. ป้อนให้ CLI โดยตรวจสัญญาซ้ำบน Ethereum:

```bash
node airdrop/cli.js from-csv active.csv --weight score --cap 5000 --pool 100000000 --rpc https://<Ethereum RPC> > active.json
node airdrop/cli.js from-csv active.csv --equal --pool 100000000 --rpc https://<Ethereum RPC> > active.json
```

`--weight score` แบ่งตามสัดส่วนคะแนนพร้อมเพดานต่อที่อยู่ (คนที่ชนเพดานได้เพดาน ที่เหลือแบ่งส่วนที่เหลือ) `--equal` ให้ทุกคนเท่ากัน
`--min-score N` ตัดคะแนนต่ำ

ตัวกรองบัญชีปลอม (Sybil): กฎกิจกรรมในคิวรี เพดานวันที่มากที่สุดและปริมาณ การตัดสัญญา และเพดานต่อที่อยู่ มีให้แล้ว
การจับกลุ่มกระเป๋าที่ได้เงินจากแหล่งเดียวกันในช่วงสั้น ๆ เป็นตัวกรองที่แรงกว่าและเป็น **ขั้นถัดไป** (ต้องใช้ `traces` / กราฟการโอน
ยังไม่ได้ทำ) ถ้าต้องการหนึ่งคนหนึ่งสิทธิ์อย่างเคร่งครัด ใช้แอร์ดรอปตัวตน zero-knowledge (`contracts/PrivateAirdrop.sol`,
[docs/future/zk-identity.md](future/zk-identity.md)) แทนรายชื่อที่อยู่

## 3. สร้าง ตรวจ และเผยแพร่รายชื่อ

```bash
node airdrop/cli.js merge signups.json linked.json active.json --pool 200000000 > round.json
node airdrop/cli.js merkle round.json --out round1 --chain-id <chain id> --pool 200000000
node airdrop/cli.js verify round1
```

`round1/` มี `summary.json`, `list.csv` (`index,address,amount` หน่วยย่อยทศนิยม 18 ตำแหน่ง) และ
`shards/<N ตัวอักษร hex แรกของที่อยู่>.json` (เลือก N ให้ไฟล์หนึ่งมีราว 256 รายการ: 100,000 คน -> 4,096 ไฟล์ ไฟล์ละราว 30 KB)
`verify` สร้างทุกอย่างใหม่จาก `list.csv`: sha256 ลำดับ ความไม่ซ้ำ จำนวน ยอดรวม root และทุกรายการกับหลักฐานใน shard
วัดบนเครื่องนี้: 100,000 แถว `from-csv` ราว 3 วินาที `merkle` ราว 8 วินาที `verify` ราว 10 วินาที

เผยแพร่ `round1/` เป็นไฟล์ static: ใส่ใน `zetaphy-hub/airdrop/` (การ build ของ hub คัดลอกไปที่ `/airdrop/`) หรือโฮสต์ https ใดก็ได้
และประกาศ root กับ `listSha256` จาก `summary.json` ใครก็รัน `verify` เองได้ หลัง deploy แล้ว
`verify round1 --rpc <ZETAPHY RPC> --distributor 0x…` ตรวจ root ยอดรวม และจำนวนรายการของสัญญาด้วย

## 4. Deploy, โอนเงินเข้า, รับ, กวาดคืน

เจ้าของต้องตัดสินใจก่อน: กองของรอบนี้ แบ่งเท่ากันหรือตามสัดส่วน เพดาน `claimStart` (ช่วงตรวจหลังโอนเงิน)
`claimDeadline` (เช่น 90-180 วัน) `returnTo` (ที่อยู่กองทุนชุมชนหรือโมดูล governance) และ guardian (multisig หรือไม่มี)

**Testnet** (บันทึก: testnet ปิดถาวรแล้วเมื่อ 2026-11-14 คำสั่งเหล่านี้จึงไม่มีเชนให้รันแล้ว ดู mainnet ด้านล่าง):

```bash
INIT=$(node airdrop/cli.js init-code round1 --start 2026-12-01T00:00:00Z --deadline 2027-03-01T00:00:00Z \
        --return-to 0x<กองทุนชุมชน> --guardian 0x<multisig> | jq -r .initCode)
zetaphy pq native deploy "$INIT" --gas 3000000        # จากบัญชี PQ native (เติมเงินก่อน) พิมพ์ที่อยู่สัญญา
# หรือจากกุญแจ EVM ของ testnet:  cast send --create "$INIT" --rpc-url https://rpc.sawasdeecoin.com --interactive
node airdrop/cli.js verify round1 --rpc https://rpc.sawasdeecoin.com --distributor 0x<ที่อยู่นั้น>
```

จากนั้นโอน `summary.total` พอดีจากกุญแจ community ของ testnet (โอนแบบ EVM เข้าสัญญาจะมี event `Funded`
ส่งแบบ bank ของ Cosmos ไปที่ที่อยู่นั้นก็ได้ สัญญาใช้แค่ยอดคงเหลือ) แล้วบันทึก
`zetaphy-network/deployments/airdrop-77390.json`:

```json
{ "chainId": 77390, "contracts": { "airdropDistributor": "0x…" }, "list": "./airdrop/" }
```

การ์ดใน hub จะเติมค่าให้เอง (`build.mjs` อ่านไฟล์นี้)

**Mainnet**: deploy เมื่อมีเครื่องมือ deploy สัญญาของ mainnet แล้วเท่านั้น (`docs/ZETAPHY-MAINNET-PROCEDURE.md`)
ด้วย `init-code` เดียวกัน กองแอร์ดรอป (20% ของ supply, 200,000,000 ZTPHY) เป็น multisig ตั้งแต่ genesis: โอน `summary.total`
พอดีเข้าสัญญาด้วย bank send จาก multisig (หรือข้อเสนอ governance ถ้ากองเป็น module account) ประกาศที่อยู่สัญญา root และ
`listSha256` ในทุกช่องทางทางการก่อน `claimStart`
บันทึกไว้ใน `zetaphy-network/deployments/airdrop-3659.json` (`{ "chainId": 3659, "contracts": { "airdropDistributor": "0x…" }, "list": "…" }`)
แล้ว hub ที่ build ครั้งถัดไปจะแสดงการ์ดรับ airdrop บน mainnet (`build.mjs` ใส่ไว้ใน `hub-config.json` ส่วน `mainnet` ส่วน testnet ใช้ไฟล์ของตัวเอง)

**การรับ**: คนเปิด hub แท็บ Agents "รับแอร์ดรอป" ตรวจที่อยู่แล้วกดรับ การ์ดอ่าน `summary.json` กับ shard เดียว ตรวจหลักฐานในเบราว์เซอร์
กับ root **บนเชน** (รายชื่อที่ไม่ตรงกับสัญญาจะถูกปฏิเสธ) แสดงจำนวนและช่วงเวลา แล้วส่ง `claim` คนที่ยังไม่มี ZTPHY จ่ายแก๊ส ใช้ faucet ได้
หรือส่งข้อมูลการเรียกที่แสดงให้ผู้ส่งแทน / ผู้สนับสนุน (เปลี่ยนผู้รับเงินไม่ได้) โครงการเปิดผู้ส่งแทนแบบนี้เองได้ด้วย `claimMany`

**หลังเส้นตาย**: ใครก็เรียก `sweep()` ส่วนที่เหลือไปที่ `returnTo` ผู้ถือ SWD ที่ยังไม่ได้รับ จ่ายในรอบถัดไปได้ (สัญญาใหม่ รายชื่อใหม่)

## 5. ค่าใช้จ่ายสำหรับ 100,000 การรับ

วัดใน `test/distributor.test.js` บนต้นไม้ 100,000 leaf (ลึก 17) ต่อธุรกรรมรับหนึ่งครั้ง รวม 21,000 พื้นฐานและ calldata
ไปยังบัญชีผู้รับที่ยังไม่เคยมี (กรณีปกติบนเชนใหม่):

| กรณี | แก๊ส |
|---|---|
| รับใน bitmap word ที่ถูกใช้แล้ว (255 จากทุก 256 การรับ) | ~79,500 |
| การรับแรกใน bitmap word (1 จากทุก 256) | ~96,600 |
| การรับแรกสุดของรอบ | ~115,700 |
| `claimMany` 20 การรับต่อธุรกรรม (ผู้ส่งแทน) | ~57,300 ต่อการรับ |

ที่ 1 gwei: ราว 0.00008 ZTPHY ต่อผู้รับ 100,000 การรับรวมราว 8.0 ZTPHY ผู้รับจ่ายเอง (หรือราว 5.7 ZTPHY ถ้าผู้สนับสนุนรวมส่งทั้งหมด)
เทียบกับการส่งให้ (push) ที่โครงการจ่าย: โอนธรรมดา 100,000 ครั้ง ครั้งละ 21,000 แก๊ส = 2.1e9 แก๊ส = ราว 2.1 ZTPHY
หรือ 35,000-38,000 แก๊สต่อคนจากสัญญา multi-send (บัญชีใหม่ในการ call เสียเพิ่ม 25,000) = ราว 3.6 ZTPHY ส่วน `MsgMultiSend`
ของ Cosmos (`zetaphy-chain/gov.sh airdrop` บน mainnet ด้วย `AIRDROP_MAINNET=1` หัวข้อ 7) อยู่ในช่วงใกล้กัน การ push ถูกกว่าในแง่แก๊ส
แต่ส่งเหรียญให้ 100,000 ที่อยู่ที่ไม่ได้ขอ ต้องเซ็นธุรกรรมจำนวนมาก (จึงต้องใช้กุญแจร้อน ไม่ใช่ multisig ของกอง) และทิ้งเหรียญไว้ในกระเป๋า
ที่ไม่ใช้แล้ว แบบกดรับเก็บเหรียญเหล่านั้นไว้ในกองทุนชุมชน เจ้าของชั่งข้อนี้แล้วเลือกส่งให้เลยสำหรับกระเป๋า Ethereum ที่ใช้งานอยู่
(2026-11-14 หัวข้อ 7)

## 6. รายการตรวจ (เจ้าของ)

1. ตัดสินใจกองต่อรอบ แบ่งเท่าหรือถ่วงน้ำหนัก เพดาน เวลาเริ่ม เส้นตาย `returnTo` และ guardian
2. เก็บที่อยู่ (ฟอร์มที่มีแค่ที่อยู่ ลิงก์ Solana ผลจาก BigQuery) ไม่เก็บข้อมูลส่วนบุคคลอื่น
3. `from-csv` / `link-solana` / `merge` -> `merkle` -> `verify` อ่านรายงานแถวที่ถูกตัดทุกครั้ง
4. ทำรอบ testnet ให้ครบก่อน (deploy โอนเงิน รับจากกระเป๋าทดสอบ abort ในรอบทดสอบที่สอง sweep)
5. Mainnet: deploy, `verify --rpc` โอนเงินจาก multisig ของกอง ประกาศ (สัญญา root sha256 เส้นตาย และ "เราไม่ขอกุญแจหรือลายเซ็น")
   รอช่วงตรวจ แล้วเปิดรับ
6. หลังเส้นตาย: `sweep()` และรายงานยอดที่รับไปกับยอดที่คืน

## 7. Push airdrop on mainnet (owner decision 2026-11-14) — แอร์ดรอปแบบส่งให้เลยบน mainnet (เจ้าของตัดสินใจ 2026-11-14)

**การตัดสินใจ** สำหรับกระเป๋า Ethereum ที่ใช้งานอยู่ในหัวข้อ 2c เจ้าของเลือก**ส่งให้เลย (push)** แทนสัญญารับเหรียญ:
**คนละ 10 ZTPHY ให้ 100,000 ที่อยู่ รวม 1,000,000 ZTPHY** จาก**กอง Community** (multisig 2 ใน 3) multisig โอน
1,000,100 ZTPHY (ยอดแอร์ดรอปบวก 100 ZTPHY ไว้จ่ายแก๊ส) ไปที่กุญแจร้อน (hot key) ใหม่ชื่อ `airdrop` ใน keyring แบบไฟล์ที่เข้ารหัส
บนเครื่อง validator แล้วกุญแจนี้ส่งเป็นชุดด้วย `gov.sh airdrop` สัญญารับเหรียญ (หัวข้อ 1-6) ยังเป็นวิธีจ่ายผู้ถือ SWD และรอบต่อไป

**คนเหล่านี้ไม่ได้ขอ** เหรียญจะโผล่ในกระเป๋าของเขาบน ZETAPHY เอง (เชน 3659 ที่อยู่เดียวกับบน Ethereum) มิจฉาชีพจะลอกข่าวไปทำ
หน้า "กดรับ" ปลอม ประกาศต้องบอกทุกภาษาและทุกช่องทางทางการว่า: *เหรียญอยู่ในกระเป๋าคุณแล้ว ไม่มีอะไรต้องกดรับ ไม่มีอะไรต้องจ่าย
โครงการจะไม่ DM หาคุณ ไม่ขอ seed phrase กุญแจส่วนตัว ลายเซ็น หรือการอนุมัติ (approve) ใครขอคือมิจฉาชีพ* คนที่ไม่อยากได้ก็ไม่ต้องทำอะไร

### gov.sh ทำอะไรบน mainnet

`AIRDROP_MAINNET=1 gov.sh airdrop <รายชื่อ> [ZTPHY ต่อคน ค่าเริ่ม 10] [กุญแจ ค่าเริ่ม airdrop]` บนโหนดที่ pin เชนไว้:

- ปฏิเสธถ้าไม่มี `AIRDROP_MAINNET=1` ถ้าใช้ `--keyring-backend test` และถ้าใช้ `--generate-only` (multisig เซ็น 556 ธุรกรรม
  ไม่ไหว จึงต้องย้ายเหรียญไปกุญแจร้อนก่อน)
- เป็นการซ้อม (dry run) เว้นแต่ตั้ง `SEND=1` หรือเจ้าของตอบ `y` ก่อนถามจะแสดงจำนวนที่อยู่ ยอดรวม จำนวนชุด ราคาแก๊สที่ใช้จริง
  (ค่าต่ำสุดใน genesis หรือ base fee ของ feemarket ถ้าสูงกว่า) เงินสำรองค่าแก๊ส แก๊สที่จำลองของชุดแรก แก๊สและค่าธรรมเนียมโดยประมาณ
  ของทั้งหมด และเวลาที่คาด
- `MAX_EACH` ค่าเริ่ม 10 บน mainnet ยอดที่มากกว่านั้นถูกปฏิเสธ เว้นแต่ตั้ง `MAX_EACH` เองโดยตั้งใจ
- ปฏิเสธถ้ากุญแจมีน้อยกว่ายอดรวมบวกเงินสำรองค่าแก๊ส = จำนวนชุด x `MAX_TX_GAS` x ราคาแก๊ส (เพดานบน เพราะไม่มีชุดไหนใช้เกิน
  `MAX_TX_GAS` ได้)
- ทุกบรรทัดต้องเป็นที่อยู่ที่สะอาด (รายชื่อมาจาก `push-list` ด้านล่าง) ที่อยู่ศูนย์ precompile และที่อยู่ระบบ (ต่ำกว่า
  `0x…10000`) ที่อยู่เผาทิ้ง และ checksum ผิด นับเป็นบรรทัดเสีย มีบรรทัดเสียแม้บรรทัดเดียวก็หยุดก่อนส่งอะไร `0x…` แปลงเป็น
  `zetaphy1…` ใน bash (100,000 ที่อยู่ใช้ราวหนึ่งนาที) และการแปลงครั้งแรกถูกเทียบกับ `zetaphyd debug addr`
- **มีธุรกรรมค้างได้ทีละหนึ่ง และต้องยืนยันว่าเข้าบล็อกแล้ว** ทุกชุด: จำลองก่อน (`--gas auto --gas-adjustment 1.5 --generate-only` จำลองด้วยกุญแจสาธารณะของกุญแจนั้นเอง ไม่เซ็นอะไร)
  ปฏิเสธถ้า gas limit เกิน `MAX_TX_GAS` (ค่าเริ่ม 10,000,000 สูงสุด 15,000,000) เขียน `<ledger>.pending` (sequence,
  timeout height, ที่อยู่) แล้ว broadcast ด้วยแก๊สนั้นและ `--timeout-height` = บล็อกปัจจุบัน + 12 (ราวหนึ่งนาที) บันทึก tx hash
  ลงไฟล์ pending ถาม `q tx <hash>` ซ้ำจนเข้าบล็อก และเฉพาะเมื่อ code เป็น 0 จึงใส่ที่อยู่ลง ledger
  (`~/.zetaphy/airdrop-zetaphy_3659-1-paid.txt`) แล้วลบไฟล์ pending จากนั้นรอบล็อกถัดไปก่อนส่งชุดต่อไป
- **ถ้าล้มเหลวจะหยุดและบอกชื่อชุด** (`STOPPED at batch 17/556: …`): โหนดปฏิเสธ (CheckTx) ล้มในบล็อก (code, log) หรือไม่เข้าบล็อก
  ภายใน timeout height ที่อยู่เหล่านั้นไม่อยู่ใน ledger รันคำสั่งเดิมอีกครั้ง มันส่งเฉพาะที่อยู่ที่ยังไม่ได้รับ
- **ไม่มีทางจ่ายซ้ำ** ถ้าไม่มีบล็อกยืนยันชุดหนึ่งภายใน `AIRDROP_TIMEOUT` (180 วินาที) เช่นเชนหยุด ชุดนั้นค้างใน `<ledger>.pending`
  และการรันหยุด การรันครั้งถัดไปเคลียร์มันก่อน: หาจาก hash (หรือถ้า zetaphyd ตายก่อนพิมพ์ hash ก็หาจาก sequence ของผู้ส่ง
  `tx.acc_seq`) ถ้าเข้าบล็อกด้วย code 0 ที่อยู่จะลง ledger และไม่ถูกส่งอีก ถ้าล้ม หรือเชนเลย timeout height แล้วและ sequence
  ของผู้ส่งไม่ขยับ ธุรกรรมนั้นเข้าบล็อกไม่ได้อีกแล้ว ที่อยู่จะถูกส่งใหม่ ถ้าไม่ใช่ทั้งสองแบบ จะปฏิเสธ ("cannot tell yet") และไม่ส่งอะไร
- `flock` บน ledger: รันสองตัวพร้อมกันไม่ได้
- กับ keyring แบบไฟล์ ถามรหัสผ่านครั้งเดียว แล้วส่งให้ zetaphyd แต่ละครั้งทาง stdin (ไม่เขียนลงไฟล์ ไม่ใส่ในอาร์กิวเมนต์หรือ
  ตัวแปรสภาพแวดล้อม)

### ขนาดชุดและแก๊ส (เป็นค่าประมาณ วัดจริงด้วยการซ้อม)

`MsgMultiSend` ไปบัญชีที่ยังไม่มี ต่อหนึ่งปลายทาง ด้วยค่าแก๊สมาตรฐานของ Cosmos SDK (อ่าน 1,000 + 3 ต่อไบต์ เขียน 2,000 + 30
ต่อไบต์ 10 ต่อไบต์ของธุรกรรม):

| ต่อปลายทาง | แก๊ส (ประมาณ) |
|---|---|
| ราว 90 ไบต์ในธุรกรรม (ที่อยู่ จำนวน denom) | ~900 |
| ยอดเงินของผู้รับ: อ่าน เขียน ดัชนี denom | ~8,000-9,000 |
| บัญชีใหม่: ตรวจว่ามีไหม เลขบัญชีถัดไป บัญชีและดัชนีเลขบัญชี | ~12,000-14,000 |
| account guard ของ ZETAPHY ดูทุกปลายทาง (`setup-node.sh` กรณี `MsgMultiSend`) | ยังไม่ได้วัด |
| **รวม** | **~23,000 วางแผนที่ 25,000-35,000** |

ดังนั้น `BATCH` ค่าเริ่มบน mainnet คือ **180**: 180 x 35,000 x 1.5 (gas adjustment) + ส่วนคงที่ (ลายเซ็น ค่าธรรมเนียม) ราว 9.6M
แก๊ส ต่ำกว่าเพดาน 10M เป็นหนึ่งในสามของบล็อก (`max_gas` 30,000,000) ธุรกรรมขนาดราว 17 KB (บล็อกรับได้ 22 MB) ถ้าการซ้อม
แสดง gas limit เกินเพดาน จะพิมพ์ `BATCH` ที่พอดีให้ **ยังไม่ได้วัดบนเชน**: แก๊สจริงของ `MsgMultiSend` บน ZETAPHY ตัวเลขจริงตัวแรก
คือผลจำลองชุดแรกตอนซ้อม

**เวลาและค่าใช้จ่าย** สำหรับ 100,000 ที่อยู่: 556 ชุด แต่ละชุดรอบล็อกของมันแล้วรออีกหนึ่งบล็อก (บล็อกละ 5 วินาที) ราว 11 วินาที
ต่อชุด: **ราว 1 ชั่วโมง 40 นาที** ค่าธรรมเนียม (Cosmos คิดตาม gas limit ไม่ใช่แก๊สที่ใช้จริง): ~100,000 x 23,000 x 1.5 = ~3.5e9
แก๊ส **ราว 3.5 ZTPHY ที่ 1 gwei** (ราว 5.3 ZTPHY ถ้าปลายทางละ 35,000) การตรวจเงินสำรองขอ 6 ZTPHY (556 x 10M x 1 gwei)
100 ZTPHY ที่โอนเผื่อไว้ครอบคลุมหลายเท่า ส่งทีละหนึ่งธุรกรรมใช้บล็อกไม่เกินหนึ่งในสาม ธุรกรรมของคนอื่นยังเข้าได้ และ mempool
ไม่มีวันเต็ม ("บัสไม่เต็ม")

### คำสั่งของเจ้าของ

รันบน**เครื่อง validator** (129.221.162.14 ผู้ใช้ `zetaphy` keyring `~/.zetaphy-keys`) ผ่าน SSH หรือ Oracle Cloud Shell
ส่วนขั้นทำรายชื่อรันใน Oracle Cloud Shell **ห้ามรันบนคอมพิวเตอร์ของคุณเอง** ข้อยกเว้นเดียวคือลายเซ็น multisig: สมาชิกแต่ละคน
เซ็นที่ที่เก็บกุญแจสมาชิกของตน (หัวข้อ 4 ของ [ZETAPHY-MAINNET-PROCEDURE.th.md](ZETAPHY-MAINNET-PROCEDURE.th.md)) ส่งไปเฉพาะ
ไฟล์ที่ยังไม่เซ็น และส่งกลับมาเฉพาะไฟล์ลายเซ็น ป้าย: **[อ่าน]** อ่านอย่างเดียว **[เปลี่ยนไฟล์]** เขียนไฟล์ **[เปลี่ยนเชน]**
ส่งธุรกรรม **[เปลี่ยนการตั้งค่า]** เปลี่ยนการตั้งค่า

**1. รายชื่อ** (Oracle Cloud Shell; ไฟล์ CSV จาก BigQuery ของหัวข้อ 2c บันทึกจาก BigQuery แล้วอัปโหลดผ่านเมนู Cloud Shell
ปุ่ม Upload; Node.js 20 ขึ้นไป):

```bash
git clone --depth 1 https://github.com/pospos191-alt/zetaphy.git ~/zetaphy                     # [เปลี่ยนไฟล์]
cd ~/zetaphy/zetaphy-network && npm ci --no-audit --no-fund                                     # [เปลี่ยนไฟล์]
node airdrop/cli.js push-list ~/active.csv --rpc https://ethereum-rpc.publicnode.com \
  --max 100000 --out ~/push.txt                                                                 # [เปลี่ยนไฟล์]
#   push-list: N addresses (10 ZTPHY each = …); dropped …: {…}; contracts checked on …; sha256 of the list <S>
scp ~/push.txt <ผู้ใช้ SSH ของคุณ>@129.221.162.14:/tmp/push.txt                                 # [เปลี่ยนไฟล์]
```

`push-list` ตัดที่อยู่เสียและ checksum ผิด ที่ซ้ำ ที่อยู่ศูนย์ precompile และที่อยู่สงวน ที่อยู่เผาทิ้งและที่อยู่แทน
บัญชีโมดูลและ preinstall ของ ZETAPHY ที่อยู่ใน `--exclude <file>` แล้วตัด**สัญญาบน Ethereum** ทุกตัว (`eth_getCode` บังคับ:
ที่อยู่สัญญาที่โน่นไม่มีกุญแจที่นี่ เหรียญที่ส่งไปจะหาย EOA ที่ delegate แบบ EIP-7702 ยังอยู่) เรียงคะแนนสูงก่อนและเก็บไม่เกิน
`--max` RPC สาธารณะจำกัดอัตราการขอ (1,000 คำขอ คำขอละ 100 address) `push-list` จะรอแล้วลองใหม่เองเมื่อถูกปฏิเสธ (สูงสุด 8 ครั้ง รอเริ่ม 2 วินาทีแล้วเพิ่มเท่าตัว) และ `--rpc` ใส่ได้หลายตัวคั่นด้วยจุลภาค ระบบจะสลับใช้ ถ้ายังไม่ผ่าน ให้รันใหม่ด้วย `--batch 20 --pause 500` และ RPC สองตัว เช่น `--rpc https://ethereum-rpc.publicnode.com,https://eth.drpc.org`

**2. ย้ายไปเครื่อง validator และ gov.sh** (SSH ไป 129.221.162.14):

```bash
sudo install -o zetaphy -g zetaphy -m 600 /tmp/push.txt /home/zetaphy/push.txt && rm /tmp/push.txt   # [เปลี่ยนไฟล์]
sudo -iu zetaphy
sha256sum ~/push.txt; wc -l ~/push.txt                     # [อ่าน] ต้องตรงกับ sha256 ที่ push-list พิมพ์ ราว 100000 บรรทัด
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/zetaphy-chain/gov.sh -o ~/gov.sh   # [เปลี่ยนไฟล์]
```

(gov.sh จาก `main` หลังรวมการเปลี่ยนแปลงนี้แล้ว)

**3. กุญแจร้อน** (คุณพิมพ์รหัสผ่านเอง keyring แบบไฟล์มีรหัสผ่านเดียวสำหรับทั้ง `~/.zetaphy-keys` จึงเป็นรหัสเดียวกับกุญแจอื่นในนั้น):

```bash
zetaphyd keys add airdrop --keyring-backend file --keyring-dir ~/.zetaphy-keys --algo eth_secp256k1   # [เปลี่ยนไฟล์]
#   จด 24 คำลงกระดาษ เก็บแบบออฟไลน์จนแอร์ดรอปจบ
zetaphyd keys show airdrop -a --keyring-backend file --keyring-dir ~/.zetaphy-keys                      # [อ่าน] -> <airdrop zetaphy1…>
```

**4. multisig ของ Community โอน 1,000,100 ZTPHY เข้ากุญแจนี้** (ขั้น `--generate-only` ของ gov.sh แล้วลายเซ็น 2 ใน 3):

```bash
zetaphyd q auth account <Community multisig zetaphy1…> --node tcp://127.0.0.1:26657 -o json   # [อ่าน] account_number N, sequence S
bash ~/gov.sh transfer <airdrop zetaphy1…> 1000100 --from <Community multisig zetaphy1…> \
  --generate-only ~/community-to-airdrop.json                                                  # [เปลี่ยนไฟล์]
#   transfer 1000100 ZTPHY (1000100000000000000000000 azetaphy) from … to … on zetaphy_3659-1
#   unsigned transaction written to …; nothing was sent
# สมาชิก 2 คน แต่ละคนเซ็นที่ที่เก็บกุญแจสมาชิก (ส่งไปแค่ไฟล์นี้):
zetaphyd tx sign community-to-airdrop.json --multisig <Community multisig zetaphy1…> --from <member key> \
  --keyring-backend file --keyring-dir <member keyring> --chain-id zetaphy_3659-1 --sign-mode amino-json \
  --offline --account-number N --sequence S --output-document m1.json                         # [เปลี่ยนไฟล์]
# กลับมาที่เครื่อง validator พร้อมไฟล์ลายเซ็นสองไฟล์ ใน keyring ที่มี multisig (กุญแจสาธารณะเท่านั้น
# ถ้ายังไม่มี: หัวข้อ 4 ของ ZETAPHY-MAINNET-PROCEDURE.th.md, keys add m1..m3 --pubkey, keys add <name> --multisig):
zetaphyd tx multisign ~/community-to-airdrop.json <multisig key name> m1.json m2.json --chain-id zetaphy_3659-1 \
  --keyring-backend file --keyring-dir ~/ms --offline --account-number N --sequence S > ~/signed.json   # [เปลี่ยนไฟล์]
bash ~/gov.sh broadcast ~/signed.json                                                          # [เปลี่ยนเชน]
zetaphyd q bank balances <airdrop zetaphy1…> --node tcp://127.0.0.1:26657                      # [อ่าน] 1000100000000000000000000 azetaphy
```

**5. ซ้อม** (ใน `tmux` เพื่อให้ SSH หลุดแล้วการรันจริงทีหลังไม่หยุด กลับเข้าด้วย `tmux attach -t airdrop`):

```bash
tmux new -s airdrop                                                                            # [อ่าน]
AIRDROP_MAINNET=1 bash ~/gov.sh airdrop ~/push.txt 10 airdrop                                  # [อ่าน] ตอบ N
#   passphrase of the keyring in ~/.zetaphy-keys (asked once for the whole airdrop):
#   mainnet zetaphy_3659-1: key airdrop (file keyring /home/zetaphy/.zetaphy-keys)
#   push airdrop on zetaphy_3659-1 from airdrop (zetaphy1…): 100000 addresses, 1000000 ZTPHY in all; the key has 1000100 ZTPHY
#     skipped: 0 bad, 0 repeated, 0 paid before (/home/zetaphy/.zetaphy/airdrop-zetaphy_3659-1-paid.txt)
#     556 batches of up to 180 addresses, one transaction in flight (each waits for its block, then the next block)
#     gas price 1000000000azetaphy; gas reserve 6 ZTPHY (556 batches x at most 10000000 gas)
#     first batch: 180 outputs, gas limit G (simulated x 1.5; cap 10000000); whole airdrop ~… gas, fee ~… ZTPHY
#     expected time: ~102 minutes (~11 s a batch with 5 s blocks)
#   send 1000000 ZTPHY to 100000 addresses in 556 batches on zetaphy_3659-1? [y/N] N
```

หยุดถ้าจำนวน ยอดรวม หรือราคาแก๊สไม่ตรงที่คาด หรือถ้ามันปฏิเสธ (มันสร้างแค่ไฟล์ ledger เปล่าและ `.lock` ของมัน)

**6. รันจริง และรันต่อ** (คำสั่งเดิม ตอบ `y`):

```bash
AIRDROP_MAINNET=1 bash ~/gov.sh airdrop ~/push.txt 10 airdrop                                  # [เปลี่ยนเชน] ตอบ y
#   batch 1/556: 180 x 10 ZTPHY, tx <hash> in block <H> (code 0); 180 of 100000 paid
#   …
#   airdrop done: 100000 addresses, 1000000 ZTPHY; ledger … (100000 addresses)
```

ถ้าพิมพ์ `STOPPED at batch k/n: …` อ่านเหตุผล แล้วรัน**คำสั่งเดิม**อีกครั้ง ที่อยู่ที่จ่ายแล้วถูกข้าม และชุดที่ค้างใน
`airdrop-zetaphy_3659-1-paid.txt.pending` ถูกเคลียร์ก่อน ถ้าพิมพ์ `refused: cannot tell yet whether that batch was paid`
รอสักครู่ (เชนอาจหยุด ดู `sudo systemctl status zetaphyd`) แล้วรันใหม่ ห้ามลบไฟล์ `.pending` เอง เว้นแต่ `zetaphyd q tx
<txhash ในไฟล์>` แสดงธุรกรรมนั้น และคุณใส่หรือไม่ใส่ที่อยู่ของมันลง ledger ให้ตรงกับผลแล้ว

**7. ตรวจหลังจบ**:

```bash
L=~/.zetaphy/airdrop-zetaphy_3659-1-paid.txt
sort -u $L | wc -l                                                                             # [อ่าน] = จำนวนบรรทัดของ push.txt
ls $L.pending 2>/dev/null || echo "no pending batch"                                           # [อ่าน]
shuf -n 5 $L | while read -r a; do zetaphyd q bank balances "$a" --node tcp://127.0.0.1:26657 -o json | jq -c .balances; done   # [อ่าน] คนละ 10 ZTPHY
zetaphyd q bank balances <airdrop zetaphy1…> --node tcp://127.0.0.1:26657                      # [อ่าน] เหลือราว 94-97 ZTPHY
```

เปิด `0x…` ของผู้รับสักคนใน explorer (เชน 3659) ด้วย: 10 ZTPHY เก็บไฟล์ ledger ไว้ (เป็นบันทึกว่าจ่ายใครแล้ว)

**8. ส่งที่เหลือคืนกอง Community** แล้วเลิกใช้กุญแจร้อน:

```bash
bash ~/gov.sh transfer <Community multisig zetaphy1…> <ยอดคงเหลือลบ 0.01> --from airdrop      # [เปลี่ยนเชน] ตอบ y
zetaphyd keys delete airdrop --keyring-backend file --keyring-dir ~/.zetaphy-keys              # [เปลี่ยนไฟล์] เมื่อยอดเหลือราว 0
```

การทดสอบ (ไม่ใช้เชนจริง zetaphyd ตัวแทนเล่นเป็นเชน): `zetaphy-network/test/govairdrop-mainnet.test.js` (ชุด ธุรกรรมค้างทีละหนึ่ง
ล้มในบล็อก ธุรกรรมหาย เชนหยุดแล้วเข้าบล็อกทีหลัง hash หาย CheckTx ปฏิเสธ เพดานแก๊ส เงินสำรอง `MAX_EACH` และเส้นทาง CSV ->
`push-list` -> `gov.sh`), `test/airdrop-push.test.js`, `test/govairdrop.test.js` (testnet), `test/govmainnet.test.js` (`transfer`)
