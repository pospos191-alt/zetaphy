# แอร์ดรอป ZTPHY: รายชื่อ สัญญารับเหรียญ และหน้ารับเหรียญ

[English](AIRDROP.md)

> **เปิดรอบที่ 1 แล้ว (ผู้ถือ SWD, เมนเน็ตเชน 3659):** ผูกกระเป๋า Solana ให้ทันก่อน 4 ธ.ค. 2026 เวลา 14:00 UTC (21:00 น. เวลาไทย)
> วันเวลา กติกา และวิธีทำทีละขั้น: [AIRDROP-ROUND1.th.md](AIRDROP-ROUND1.th.md) · หน้าผูกกระเป๋า: `https://app.sawasdeecoin.com/airdrop-link.html`

วิธีที่เจ้าของโครงการจ่าย ZTPHY (เหรียญหลักของเชน ZETAPHY) ให้คนราว 100,000 คนที่ถือกระเป๋า EVM ของตัวเอง
โดยไม่มีใครต้องให้อะไรนอกจากที่อยู่ และโครงการไม่ส่งเหรียญไปหาคนที่ไม่ได้ขอ ยังไม่มีอะไรถูก deploy และไม่มีเหรียญ
เคลื่อนจนกว่าเจ้าของจะทำตามขั้นตอนด้านล่าง (ทำบน testnet ก่อน)

| ส่วน | อยู่ที่ |
|---|---|
| สัญญารับเหรียญ | `zetaphy-network/contracts/ZtphyMerkleDistributor.sol` (artifact `artifacts/ZtphyMerkleDistributor.json`) |
| เครื่องมือทำรายชื่อ | `zetaphy-network/airdrop/cli.js` (`from-csv`, `link-message`, `link-solana`, `merge`, `merkle`, `verify`, `init-code`; คำสั่งเดิม `snapshot`, `allocate`, `merkle` ยังใช้ได้) |
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

**คนเหล่านี้ไม่ได้ลงทะเบียน** แอร์ดรอปจึงต้องเป็นแบบกดรับเอง (สัญญานี้) มีตัวตรวจสิทธิ์สาธารณะ (การ์ดใน hub ใช้กับที่อยู่ใดก็ได้
ไม่ต้องใช้กระเป๋า) ประกาศชัดเจนในช่องทางทางการของโครงการ และมีเส้นตาย หลังจากนั้นเหรียญที่ไม่มีคนรับกลับไปกองทุนชุมชน
**ห้ามส่งเหรียญไปหาโดยที่เขาไม่ได้ขอ** ห้าม DM และห้ามขอกุญแจหรือลายเซ็นใดนอกจากธุรกรรมรับเหรียญ ใครขอมากกว่านั้นคือมิจฉาชีพ
และประกาศต้องบอกไว้

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

**Testnet** (ด้วยเครื่องมือที่มีอยู่):

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
ของ Cosmos (`zetaphy-chain/gov.sh airdrop` เฉพาะ testnet) อยู่ในช่วงใกล้กัน การ push ถูกกว่าในแง่แก๊ส แต่ส่งเหรียญให้ 100,000 ที่อยู่ที่ไม่ได้ขอ
ต้องเซ็นธุรกรรมจำนวนมากด้วยกุญแจของกอง และทิ้งเหรียญไว้ในกระเป๋าที่ไม่ใช้แล้ว แบบกดรับเก็บเหรียญเหล่านั้นไว้ในกองทุนชุมชน

## 6. รายการตรวจ (เจ้าของ)

1. ตัดสินใจกองต่อรอบ แบ่งเท่าหรือถ่วงน้ำหนัก เพดาน เวลาเริ่ม เส้นตาย `returnTo` และ guardian
2. เก็บที่อยู่ (ฟอร์มที่มีแค่ที่อยู่ ลิงก์ Solana ผลจาก BigQuery) ไม่เก็บข้อมูลส่วนบุคคลอื่น
3. `from-csv` / `link-solana` / `merge` -> `merkle` -> `verify` อ่านรายงานแถวที่ถูกตัดทุกครั้ง
4. ทำรอบ testnet ให้ครบก่อน (deploy โอนเงิน รับจากกระเป๋าทดสอบ abort ในรอบทดสอบที่สอง sweep)
5. Mainnet: deploy, `verify --rpc` โอนเงินจาก multisig ของกอง ประกาศ (สัญญา root sha256 เส้นตาย และ "เราไม่ขอกุญแจหรือลายเซ็น")
   รอช่วงตรวจ แล้วเปิดรับ
6. หลังเส้นตาย: `sweep()` และรายงานยอดที่รับไปกับยอดที่คืน
