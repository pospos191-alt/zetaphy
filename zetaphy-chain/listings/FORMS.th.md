[English](FORMS.md) | **ภาษาไทย**

# แบบฟอร์มขอลงรายชื่อในกระเป๋าเงิน (เจ้าของโครงการกรอกเอง)

คำตอบพร้อมคัดลอกไปวาง สำหรับกระเป๋าเงินที่รับเชนใหม่ผ่านแบบฟอร์มหรือติดต่อฝ่ายธุรกิจ ไม่ใช่ผ่าน pull request บน GitHub
ส่วน registry ที่รับ pull request (chainlist, Keplr, Cosmos chain registry, TokenPocket, Cosmostation, Ping.pub)
อยู่ใน [README.th.md](README.th.md)

**ส่งที่ไหน** ระบุที่ส่งเฉพาะเมื่อตรวจได้จากเว็บไซต์หรือ GitHub ของผู้ให้บริการเอง ตอนเตรียมไฟล์นี้ (2026-11-14) เครื่องที่ใช้เตรียม
เปิดเว็บไซต์ของผู้ให้บริการไม่ได้ ส่วนใหญ่จึงเขียนว่า **ยังไม่ได้ตรวจสอบ** ให้หาแบบฟอร์มเองจากเว็บไซต์ทางการ (พิมพ์ที่อยู่เว็บเอง
ไม่ใช่กดจากโฆษณาในผลค้นหาหรือข้อความส่วนตัว) และอย่าจ่ายเงินให้ใครที่ติดต่อมาก่อนเพื่อเสนอลงรายชื่อให้

## คำตอบที่ใช้ร่วมกัน

ใช้กับทุกแบบฟอร์มด้านล่าง คัดลอกตามนี้ทุกตัวอักษร (ค่าในแบบฟอร์มส่วนใหญ่เป็นภาษาอังกฤษ จึงคงไว้เป็นภาษาอังกฤษ)

| ช่อง | คำตอบ |
| --- | --- |
| ชื่อเชน / เครือข่าย | ZETAPHY |
| ประเภทเชน | EVM-compatible Layer 1 (Cosmos SDK with cosmos/evm, CometBFT consensus) |
| EVM chain id | 3659 (hex `0xe4b`) |
| Cosmos chain id | `zetaphy_3659-1` |
| เหรียญหลัก | ชื่อ ZETAPHY, สัญลักษณ์ ZTPHY, ทศนิยม 18 หลัก (base denom `azetaphy`) |
| รูปแบบ address | EVM `0x…` บัญชีเดียวกันในรูปแบบ Cosmos คือ `zetaphy1…` (bech32 prefix `zetaphy`) |
| Coin type (slip44) | 60, อัลกอริทึมกุญแจ `eth_secp256k1` |
| EVM RPC (HTTPS) | https://rpc.sawasdeecoin.com |
| EVM websocket | ไม่มีแบบสาธารณะ |
| CometBFT RPC / websocket | https://rpc.sawasdeecoin.com/rpc, wss://rpc.sawasdeecoin.com/rpc/websocket |
| Cosmos REST | https://rpc.sawasdeecoin.com/rest |
| gRPC | ไม่มีแบบสาธารณะ |
| Block explorer | https://explorer.sawasdeecoin.com/?network=mainnet (หน้าธุรกรรม `…/?network=mainnet#/tx/<hash>` หน้า address `…/?network=mainnet#/address/<address>`) |
| เว็บไซต์ | https://app.sawasdeecoin.com |
| Faucet | https://app.sawasdeecoin.com/?tab=earn |
| ซอร์สโค้ด | https://github.com/pospos191-alt/zetaphy |
| Genesis | 2026-11-13 14:00 UTC, sha256 `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667` |
| Validator | 1 ตัว ดูแลโดยโครงการ ZETAPHY |
| Security audit | ยังไม่มี (ยังไม่ผ่าน audit จากภายนอกที่เป็นอิสระ) |
| CoinGecko / CoinMarketCap | ยังไม่ได้ลงรายชื่อ |
| อีเมลติดต่อ | sawasdeecoin@gmail.com (อีเมลเดียวกับที่อยู่ในไฟล์ Keplr แล้ว) |
| บัญชีโซเชียล | `<X account>`, `<Telegram>`, `<Discord>` ยังไม่มี เว้นว่างไว้หรือกรอกเมื่อมีแล้ว |
| รายชื่ออื่น | chainlist.org (`chainlist/eip155-3659.json`), Keplr, Cosmos chain registry เตรียมไว้ในโฟลเดอร์นี้ เขียนว่า "ส่งแล้ว" หรือ "ลงรายชื่อแล้ว" เมื่อเป็นจริงแล้วเท่านั้น |

**โลโก้ที่ต้องแนบ**

- PNG 256x256: `zetaphy-hub/zetaphy-256.png` ใน repo นี้ และที่
  https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/zetaphy-hub/zetaphy-256.png กับ
  https://app.sawasdeecoin.com/zetaphy-256.png
- SVG: `zetaphy-hub/logo.svg`
- IPFS: `ipfs://bafkreiazxgczetev7j2mxdv4i5htnbhyx4fhtmngspqao4mit22o667giq`

ถ้าแบบฟอร์มขอขนาดอื่น ให้ย่อขยายจาก SVG อย่ายืดไฟล์ PNG

**คำอธิบายสั้น (ไม่เกินประมาณ 160 ตัวอักษร ใช้ภาษาอังกฤษตามแบบฟอร์ม)**

> ZETAPHY: an EVM Layer 1 on the Cosmos SDK with post-quantum signatures and Neuro scam protection. Single project-run validator; not yet audited.

**คำอธิบายยาว (วางทั้งย่อหน้า เพราะมีคำเตือนความเสี่ยงอยู่ด้วย)**

> ZETAPHY is an EVM-compatible Layer 1 built on the Cosmos SDK with cosmos/evm and CometBFT. Besides normal
> eth_secp256k1 keys, accounts and validator votes can use post-quantum ML-DSA-44 signatures, and Neuro scam protection
> checks contracts and publishes its findings on chain in a ThreatRegistry that the ZETAPHY wallet reads before you sign.
> The native coin is ZTPHY (18 decimals). ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY
> project, and its code has not yet completed an independent external audit. Until more independent validators join and
> the audit is published, the project can halt or change the chain. Use it only with amounts you can afford to lose.

ความหมาย: ZETAPHY เป็น Layer 1 ที่รองรับ EVM สร้างบน Cosmos SDK กับ cosmos/evm และ CometBFT นอกจากกุญแจ eth_secp256k1
ปกติแล้ว บัญชีและการโหวตของ validator ใช้ลายเซ็นทนควอนตัม ML-DSA-44 ได้ และระบบกันโกง Neuro ตรวจสัญญาแล้วบันทึกผลบนเชนใน
ThreatRegistry ที่กระเป๋า ZETAPHY อ่านก่อนให้ผู้ใช้เซ็น เหรียญหลักคือ ZTPHY (ทศนิยม 18 หลัก) ขณะนี้ ZETAPHY mainnet ทำงานบน
validator เพียงตัวเดียวที่โครงการ ZETAPHY ดูแลเอง และโค้ดยังไม่ผ่านการตรวจสอบ (audit) จากภายนอกที่เป็นอิสระ จนกว่าจะมี
validator อิสระเพิ่มและเผยแพร่ผล audit โครงการสามารถหยุดหรือเปลี่ยนแปลงเชนได้ โปรดใช้เฉพาะจำนวนที่ยอมเสียได้

## Rabby / DeBank: ขอเพิ่มเชน

- **ส่งที่ไหน:** ยังไม่ได้ตรวจสอบ RabbyHub/Rabby บน GitHub ไม่มีแบบฟอร์มหรือคำแนะนำสำหรับขอเพิ่มเชน (ตรวจ README และ
  `.github/` แล้ว) เปิดเว็บ rabby.io และ debank.com จากเครื่องที่ใช้เตรียมไม่ได้
- **ช่องที่ต้องกรอก:** คำตอบที่ใช้ร่วมกันด้านบน ที่น่าจะถาม: ชื่อเชน, chain id, สัญลักษณ์และทศนิยมของเหรียญ, RPC URL,
  explorer URL, โลโก้, เว็บไซต์, ช่องทางติดต่อ
- **โลโก้:** PNG 256x256
- **ได้อะไร:** ZETAPHY อยู่ในรายการเครือข่ายของ Rabby ผู้ใช้สลับไปได้โดยไม่ต้องพิมพ์ RPC และ (ถ้า DeBank ทำดัชนีเชนนี้)
  เห็นยอดเงินในหน้า portfolio ของ Rabby และ DeBank
- **ไม่ได้อะไร:** ไม่มีราคา ZTPHY (ยังไม่มีแหล่งราคาตลาด) ไม่มีหน้าโปรโตคอลของแอป ZETAPHY บน DeBank (เป็นการเชื่อมต่ออีกแบบ)
  และไม่ใช่การรับรอง ระหว่างนี้ผู้ใช้เพิ่ม ZETAPHY เองเป็น custom network ด้วย RPC และ chain id ด้านบนได้

## OKX Web3 Wallet

- **ส่งที่ไหน:** ยังไม่ได้ตรวจสอบ README ของ wallet SDK ในองค์กร okx บน GitHub บอกเฉพาะช่องทางแจ้งช่องโหว่ (HackerOne /
  หน้า feedback ของ OKX) ซึ่งไม่ใช่ช่องทางลงรายชื่อ เปิดเว็บ web3.okx.com จากเครื่องที่ใช้เตรียมไม่ได้
- **ช่องที่ต้องกรอก:** คำตอบที่ใช้ร่วมกันด้านบน และมักถามเพิ่ม: สถานะโครงการ (mainnet เปิดตั้งแต่ 2026-11-13), จำนวน
  validator (1), สถานะ audit (ยังไม่มี), จำนวนผู้ใช้หรือธุรกรรมต่อวัน (ใส่ตัวเลขจริงจาก explorer ในวันที่ส่ง หรือเว้นว่าง)
  และผู้ติดต่อ
- **โลโก้:** PNG 256x256 และ SVG ถ้าแบบฟอร์มรับ
- **ได้อะไร:** ZETAPHY เป็นเครือข่ายที่ OKX Wallet รองรับ (ส่ง รับ ดูยอด อาจมีหน้า explorer ในแอป) ผู้ใช้เห็น ZTPHY
  และโลโก้โดยไม่ต้องเพิ่ม custom network
- **ไม่ได้อะไร:** ไม่ใช่การลงรายชื่อในตลาด OKX (คนละทีม คนละขั้นตอน) ไม่มีเส้นทาง swap หรือราคา เว้นแต่ DEX aggregator
  ของ OKX จะเพิ่ม ZETAPHY แยกต่างหาก และไม่รับประกันว่าจะได้รับการพิจารณา กระเป๋าใหญ่มักต้องการผู้ใช้จำนวนมากและ audit ก่อน

## Bitget Wallet

- **ส่งที่ไหน:** ยังไม่ได้ตรวจสอบ เปิดเว็บของ Bitget จากเครื่องที่ใช้เตรียมไม่ได้ และไม่พบ repo สำหรับลงรายชื่อของ Bitget
  Wallet บน GitHub หน้า "application for listing" ของ Bitget เป็นของ **ตลาด Bitget** ไม่ใช่เครือข่ายใน Bitget Wallet
  อย่าใช้หน้านั้นสำหรับเรื่องนี้
- **ช่องที่ต้องกรอก:** คำตอบที่ใช้ร่วมกันด้านบน และมักถามเพิ่ม: สถานะโครงการ, สถานะ audit (ยังไม่มี), ขนาดชุมชน
  (ตัวเลขจริงเท่านั้น) และผู้ติดต่อ
- **โลโก้:** PNG 256x256
- **ได้อะไร:** ZETAPHY เป็นเครือข่ายที่ Bitget Wallet รองรับ (ดูยอด ส่งและรับ ZTPHY พร้อมโลโก้)
- **ไม่ได้อะไร:** ไม่ใช่การลงรายชื่อในตลาด Bitget ไม่มีราคาหรือ swap เว้นแต่จะเพิ่มแยก และไม่มี launchpad หรือการโปรโมต

## SafePal: ขอเพิ่มเชน

- **ส่งที่ไหน (เชน):** ยังไม่ได้ตรวจสอบ repo เอกสารของ SafePal บน GitHub (SafePalWallet/safepal-docs) ไม่มีหน้าขอเพิ่มเชน
- **ส่งที่ไหน (แอป ตรวจแล้ว):** ไฟล์ `docs/Connect-wallet/apply-list-for-dapp.md` ใน repo นั้นลิงก์ไปแบบฟอร์มลงรายชื่อ
  **dApp** ของ SafePal https://forms.gle/Tqxy6dHhhhR6CvS9A ใช้ลงรายชื่อ dApp (เช่น hub ที่ https://app.sawasdeecoin.com)
  ใน dApp browser ของ SafePal ไม่ได้เพิ่มเครือข่าย ZETAPHY และ dApp บนเชนที่ SafePal ยังไม่รองรับอาจถูกปฏิเสธ
- **ช่องที่ต้องกรอก:** คำตอบที่ใช้ร่วมกันด้านบน สำหรับแบบฟอร์ม dApp: ชื่อ "ZETAPHY hub", เว็บไซต์, คำอธิบายสั้นและยาวด้านบน,
  โลโก้ และ address ของสัญญาจาก [DIRECTORIES.th.md](DIRECTORIES.th.md#address-ของสัญญา)
- **โลโก้:** PNG 256x256
- **ได้อะไร:** ถ้าลงรายชื่อเชน ZTPHY จะแสดงในแอป SafePal และอาจรวมถึงกระเป๋าฮาร์ดแวร์ ถ้าลงรายชื่อ dApp hub จะแสดงใน
  dApp browser ของ SafePal
- **ไม่ได้อะไร:** การรองรับในเฟิร์มแวร์กระเป๋าฮาร์ดแวร์เป็นการตัดสินใจและกำหนดเวลาของ SafePal เอง ไม่มีราคา และไม่ใช่การลงรายชื่อในตลาด
