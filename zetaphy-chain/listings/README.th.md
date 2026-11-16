[English](README.md) | **ภาษาไทย**

# ไฟล์ลงรายชื่อในกระเป๋าเงิน (พร้อมส่ง)

## Mainnet `zetaphy_3659-1` (EVM 3659)

| โฟลเดอร์ / ไฟล์ | ส่งไปที่ | ได้อะไร |
| --- | --- | --- |
| `chainlist/eip155-3659.json` | ethereum-lists/chains `_data/chains/` | chainlist.org และกระเป๋าที่อ่านรายการนั้น |
| `keplr/zetaphy_3659.json`, `keplr/images/zetaphy_3659/*.png` | chainapsis/keplr-chain-registry `cosmos/` และ `images/zetaphy_3659/` | Keplr |
| `cosmos-chain-registry/zetaphy/` | cosmos/chain-registry `zetaphy/` (chain.json, assetlist.json, images) | Leap, Mintscan และแอป Cosmos ส่วนใหญ่ ตรวจกับ chain.schema.json และ assetlist.schema.json ของ repo นั้นแล้ว |
| `tokenpocket/chain-3659.json` | TP-Lab/networklist-org `chains.json` | รายการเครือข่ายของ TokenPocket ("Easy Add") และ chainlist.tokenpocket.pro |
| `cosmostation/chain/zetaphy/` | CosmosLabsKR/chainlist `chain/zetaphy/` | กระเป๋า Cosmostation (มือถือและส่วนขยายเบราว์เซอร์) ส่วน Mintscan ขึ้นกับ Cosmostation จะเปิดให้หรือไม่ |
| `pingpub/` | ping-pub/ping.pub `chains/mainnet/zetaphy.json` และ `logos/zetaphy.png` | explorer ping.pub (เฉพาะเมื่อมี validator อิสระ 10 ตัวขึ้นไป ดูด้านล่าง) |
| `FORMS.th.md` | Rabby / DeBank, OKX Wallet, Bitget Wallet, SafePal (แบบฟอร์ม ไม่ใช่ pull request) | คำตอบพร้อมวาง |
| `DIRECTORIES.th.md`, `awesome-cosmos/` | DappRadar, cosmos/awesome-cosmos, forum.cosmos.network | ข้อความและ patch พร้อมส่ง |

RPC สาธารณะ: https://rpc.sawasdeecoin.com (EVM JSON-RPC ที่ `/`, CometBFT ที่ `/rpc`, websocket ที่ `/rpc/websocket`,
REST ที่ `/rest` ผ่าน rpc-guard ไม่มี gRPC สาธารณะ) ตรวจว่าแต่ละ path ตอบก่อนส่ง
(`curl -s https://rpc.sawasdeecoin.com/rpc/status`,
`curl -s https://rpc.sawasdeecoin.com/rest/cosmos/base/tendermint/v1beta1/node_info`) เพราะผู้รีวิวจะทดสอบ

คำอธิบายแบบข้อความอิสระทุกจุดในไฟล์เหล่านี้มีประโยคเตือนความเสี่ยงจาก
[docs/ZETAPHY-MAINNET-NOTICE.th.md](../../docs/ZETAPHY-MAINNET-NOTICE.th.md) อยู่ด้วย ถ้าแก้ไขให้คงไว้

## วิธีส่ง pull request ผ่านเบราว์เซอร์

ทุกเป้าหมายบน GitHub ด้านล่างทำแบบเดียวกัน ไม่ต้องติดตั้งเครื่องมือใด:

1. เข้าสู่ระบบ GitHub เปิด repo เป้าหมาย กด **Fork** (มุมขวาบน) แล้ว **Create fork**
2. ใน fork ของคุณ ไปที่โฟลเดอร์เป้าหมาย กด **Add file → Upload files** แล้วลากไฟล์มาวาง (ลากทั้งโฟลเดอร์ได้ โฟลเดอร์ย่อยยังอยู่ครบ)
   หรือ **Add file → Create new file** แล้ววาง JSON ถ้าต้องแก้ไฟล์ที่มีอยู่ (TokenPocket, awesome-cosmos) ให้เปิดไฟล์แล้วกดรูปดินสอ
3. ด้านล่างเลือก **Create a new branch for this commit** เขียนข้อความสั้น ๆ เช่น `Add ZETAPHY mainnet` แล้วกด
   **Commit changes / Propose changes**
4. กด **Create pull request** กรอกแม่แบบของ repo ถ้ามี แล้วส่ง
5. ติดตาม pull request ตอบผู้รีวิว และแก้ check ที่ไม่ผ่านใน branch เดิม (commit เพิ่มผ่านหน้าเว็บได้)

บาง registry รับเฉพาะ commit ที่ลงลายเซ็น (Verified) commit ที่ทำในหน้าเว็บของ GitHub ถูก GitHub เซ็นให้อัตโนมัติ ขั้นตอนด้านบน
จึงผ่านกฎนี้ ส่วน commit ที่ทำด้วย `git` บนเครื่องของคุณจะไม่มีลายเซ็น เว้นแต่ตั้งค่าการเซ็นไว้

## ขั้นตอนส่งแต่ละที่

### TokenPocket: TP-Lab/networklist-org

- **Repo / path:** https://github.com/TP-Lab/networklist-org ไฟล์เดียวคือ `chains.json` ที่ root
- **สิ่งที่แก้:** เปิด `chains.json` กดรูปดินสอ ไปท้ายสุด ใส่ comma หลัง `}` ตัวสุดท้าย แล้ววาง object ทั้งก้อนจาก
  `tokenpocket/chain-3659.json` ก่อน `]` ตัวสุดท้าย ไม่แก้ส่วนอื่น
- **ตรวจก่อนส่ง:** CI ของ repo รัน ESLint ด้วยกฎ `jsonc/auto` และ `jsonc/comma-dangle` กับ `chains.json` รายการของเราผ่าน
  การตรวจแบบเดียวกันนั้น (ต่อท้าย `chains.json` ของ repo ที่ commit `e2fe433`) และ chain id 3659 กับ short name `zetaphy`
  ยังไม่มีใครใช้
- **โลโก้:** TokenPocket รับเป็น URL ของรูป ไม่ใช่ไฟล์ ไอคอนทั้งสี่ใน `app_resource` ชี้ไปที่โลโก้ 256x256 บน
  raw.githubusercontent.com (URL นั้นตอบ 200 เป็นไฟล์ PNG) มาตรฐานไอคอนใน README เป็นรูปบน tp-statics.tokenpocket.pro
  ซึ่งเปิดไม่ได้ จึงไม่ได้ทำไอคอนแยก "เลือก / ไม่เลือก / โหมดมืด" `app_resource` ไม่บังคับ และหลายรายการใช้ไอคอนเดียวทั้งสี่ช่องแบบนี้
- **ค่าใช้จ่าย:** README ของ repo บอกว่าต้องบริจาคจึงจะ merge PR และไม่คืนเงินถ้า PR ไม่ผ่านเกณฑ์รีวิว โดยชี้ไปที่
  https://help.tokenpocket.pro/developer-en/network/add-chain สำหรับจำนวนเงินและกฎ ตอนเตรียมไฟล์เปิดหน้านั้นไม่ได้
  อ่านหน้านั้นก่อนจ่ายเงินใด ๆ และจ่ายเฉพาะไปยัง address ที่ประกาศในหน้านั้นเท่านั้น

### Cosmostation: CosmosLabsKR/chainlist

- **Repo / path:** https://github.com/CosmosLabsKR/chainlist โฟลเดอร์ `chain/zetaphy/` repo เดิม cosmostation/chainlist
  ประกาศว่าเลิกใช้แล้ว และให้ส่ง pull request ทั้งหมดไปที่ CosmosLabsKR/chainlist
- **ไฟล์:** อัปโหลดโฟลเดอร์ `cosmostation/chain/zetaphy/` เป็น `chain/zetaphy/`: `param_2.json`, `assets_2.json`,
  `resource/chain_zetaphy.png`, `resource/chain_zetaphy_evm.png`, `resource/chain_zetaphy_noti.png`, `asset/ztphy.png`
  URL รูปใน JSON ชี้ไปที่ path เหล่านั้นใน repo นั้น จึงใช้ได้เมื่อ merge แล้ว
- **รูปแบบ:** ทำตาม `mantra` (เป็น cosmos/evm เหมือนกัน ใช้ key type `/cosmos.evm.crypto.v1.ethsecp256k1.PubKey` เดียวกัน),
  `evmos` และ `sei` รูปทำตามของเขา: PNG 192x192 สำหรับเชน EVM และเหรียญ PNG 340x74 สำหรับรูปแจ้งเตือน README ของเขาขอรูปเชน
  แบบ "3D" จากชุด Figma ของเขา ของเราเป็นโลโก้แบบเรียบ อาจถูกขอหรือเขาทำเวอร์ชัน 3D ให้
- **ตรวจก่อนส่ง:** CI ของเขารัน `@prantlf/jsonlint` กับ JSON ทั้งหมด ไฟล์ของเราผ่าน และทุก key กับชนิดค่าในไฟล์ของเรามีอยู่ใน
  mantra, evmos หรือ sei ด้วย ไม่มี gRPC สาธารณะ `grpc_endpoint` จึงว่าง Cosmostation อาจต้องการ
- **หมายเหตุ:** คำอธิบายมีเฉพาะภาษาอังกฤษ (เหมือนเชนที่มีอยู่ 6 เชน) ถ้าเขาขอให้เพิ่ม `ko` และ `ja` README ของเขาบอกว่า asset
  ของเครือข่ายที่ยังไม่ได้รับการยืนยันอาจไม่ถูก merge เชนที่มี validator ตัวเดียวอาจต้องรอ

### Ping.pub: ping-pub/ping.pub

- **Repo / path:** https://github.com/ping-pub/ping.pub (ping-pub/mainnet พาไปที่ repo เดียวกัน): `chains/mainnet/zetaphy.json`
  และ `logos/zetaphy.png` repo ping-pub/explorer บอกให้ส่งการลงรายชื่อมาที่นี่
- **ยังไม่ต้องส่ง** README ของเขาบอกว่า "We accept all blockchains which have 10+ independent validators." (รับเฉพาะเชนที่มี
  validator อิสระ 10 ตัวขึ้นไป) ZETAPHY มีตัวเดียว ส่งเมื่อเป็นจริงแล้ว
- **เมื่อส่ง:** ใช้ checklist ในแม่แบบ pull request (เชื่อมกระเป๋า, โอน, delegate, redelegate, unbond, ถอน commission และ reward)
  ทดสอบแต่ละข้อบน mainnet ก่อน และติ๊กเฉพาะข้อที่ใช้ได้ REST ต้องเปิด CORS (`Access-Control-Allow-Origin: *`)
- **ตรวจก่อนส่ง:** CI ของ repo (`scripts/check-config-format.sh`, `jq empty`) ผ่าน และ key กับชนิดค่าตรงกับ evmos, haqq,
  injective และ bitway ไฟล์ทำตามชนิด `LocalChainConfig` ของ explorer (`src/types/chaindata.ts` ใน ping-pub/explorer) มี Keplr
  feature `eth-secp256k1-cosmos` ที่ ZETAPHY ต้องใช้ แต่ยังไม่ได้ทดสอบว่าโค้ดกระเป๋าของ ping.pub ส่งค่านี้ให้ Keplr หรือไม่
- **ตั้ง explorer เอง:** ไฟล์เดียวกันใช้กับ ping-pub/explorer ที่ตั้งเองได้ใน `chains/mainnet/` (เปลี่ยน `logo` เป็น URL เต็ม)

### awesome-cosmos, DappRadar, ฟอรัม Cosmos

ดู [DIRECTORIES.th.md](DIRECTORIES.th.md): บรรทัด หมวด ชื่อและเนื้อหา PR สำหรับ cosmos/awesome-cosmos (patch อยู่ใน
`awesome-cosmos/`) ช่องของ DappRadar พร้อม address ของสัญญา และโพสต์ในฟอรัม

### Rabby / DeBank, OKX Wallet, Bitget Wallet, SafePal

ดู [FORMS.th.md](FORMS.th.md) ที่เหล่านี้รับผ่านแบบฟอร์มหรือติดต่อฝ่ายธุรกิจ ไม่ใช่ pull request ที่ส่งส่วนใหญ่ยังตรวจสอบไม่ได้

## Testnet `zetaphy_77390-1`: ปิดเมื่อ 2026-11-14

testnet ปิดถาวรเมื่อ 2026-11-14 (เจ้าของโครงการตัดสินใจ) ตอนนี้มีเพียง mainnet เครือข่ายเดียว อย่าส่งไฟล์ของ testnet
(`chainlist/eip155-77390.json`, `keplr/zetaphy_77390.json`) ไปยัง registry เพราะ RPC (https://rpc.sawasdeecoin.com) ไม่ตอบแล้ว
registry จะปฏิเสธ เก็บไว้เป็นบันทึกเท่านั้น
