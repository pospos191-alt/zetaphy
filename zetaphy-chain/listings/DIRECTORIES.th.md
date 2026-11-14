[English](DIRECTORIES.md) | **ภาษาไทย**

# รายชื่อแอปและโพสต์ในชุมชน (เจ้าของโครงการเป็นผู้ส่ง)

ข้อความพร้อมส่งสำหรับ DappRadar, รายชื่อ awesome-cosmos และฟอรัม Cosmos ข้อมูลพื้นฐาน (chain id, RPC, โลโก้, คำอธิบายยาว
ที่มีคำเตือนความเสี่ยง) อยู่ใน [FORMS.th.md](FORMS.th.md#คำตอบที่ใช้ร่วมกัน) ไฟล์นี้เพิ่มสิ่งที่แต่ละที่ต้องการ อะไรที่เขียนว่า
**ยังไม่ได้ตรวจสอบ** คือตรวจบนเว็บไซต์นั้นเองไม่ได้ตอนเตรียม (2026-11-14) เครื่องที่ใช้เตรียมเข้า GitHub ได้ แต่เข้าเว็บไซต์เหล่านี้ไม่ได้

ข้อความที่ต้องวางลงในเว็บเหล่านี้เป็นภาษาอังกฤษ จึงคงไว้เป็นภาษาอังกฤษ พร้อมคำอธิบายภาษาไทย

## DappRadar: "submit a dapp"

- **ส่งที่ไหน:** ยังไม่ได้ตรวจสอบ (เปิด dappradar.com ไม่ได้) ใช้ลิงก์ "submit dapp" บนเว็บไซต์ของ DappRadar เอง
- **เชน:** ZETAPHY น่าจะยังไม่อยู่ในรายการเชนของ DappRadar (ยังไม่ได้ตรวจสอบ) **อย่า** เลือกเชนอื่นเช่น Ethereum เพราะสัญญาด้านล่าง
  มีอยู่บน ZETAPHY (chain id 3659) เท่านั้น เลือกเชนผิดทำให้ข้อมูลไม่จริง ถ้าไม่มี ZETAPHY ให้ขอ DappRadar เพิ่มเชนก่อน
  (ในช่องหมายเหตุของแบบฟอร์มหรือทาง support) การติดตามเชนใหม่เป็นการตัดสินใจของ DappRadar
- **โลโก้:** PNG 256x256 (`zetaphy-hub/zetaphy-256.png`) และ SVG ถ้ารับ
- **ลิงก์โซเชียล:** เว็บไซต์ https://app.sawasdeecoin.com, GitHub https://github.com/pospos191-alt/zetaphy,
  `<X account>`, `<Telegram>`, `<Discord>` (ยังไม่มี เว้นว่างไว้)

### รายการหลัก: hub

| ช่อง | คำตอบ |
| --- | --- |
| Name | ZETAPHY hub |
| Website | https://app.sawasdeecoin.com |
| Category | Other (หลายแอปในหน้าเดียว) ถ้าต้องเลือกหมวดเดียว: DeFi เพราะมี swap |
| Short description | Every ZETAPHY app on one page: post-quantum wallet, swap, NFT market, explorer and Neuro scam protection on ZETAPHY mainnet. |
| Long description | ด้านล่าง |

> The ZETAPHY hub puts every ZETAPHY app on one page: a wallet whose accounts can use post-quantum ML-DSA-44 keys, an
> AMM swap, an NFT marketplace, a block explorer, staking and governance, and Neuro scam protection, which
> checks contracts and publishes its findings on chain in a ThreatRegistry that the wallet reads before you sign.
> ZETAPHY is an EVM-compatible Layer 1 built on the Cosmos SDK (chain id 3659, coin ZTPHY). ZETAPHY mainnet currently
> runs on a single validator operated by the ZETAPHY project, and its code has not yet completed an independent
> external audit. Until more independent validators join and the audit is published, the project can halt or change
> the chain. Use it only with amounts you can afford to lose.

ความหมาย: hub รวมแอปของ ZETAPHY ไว้หน้าเดียว ได้แก่ กระเป๋าที่บัญชีใช้กุญแจทนควอนตัม ML-DSA-44 ได้, swap แบบ AMM, ตลาด NFT,
block explorer, staking และ governance และระบบกันโกง Neuro ที่ตรวจสัญญาแล้วบันทึกผลบนเชนใน ThreatRegistry ที่กระเป๋าอ่านก่อน
ให้ผู้ใช้เซ็น ตามด้วยคำเตือนความเสี่ยงเดียวกับใน [ประกาศ mainnet](../../docs/ZETAPHY-MAINNET-NOTICE.th.md)

### ส่วนหลักแต่ละส่วน (ใช้เฉพาะเมื่อ DappRadar ต้องการแยกเป็น dapp ละรายการ)

คำอธิบายยาวของแต่ละส่วนต้องปิดท้ายด้วยคำเตือนความเสี่ยงเดียวกับด้านบน วางต่อท้ายข้อความ

| ส่วน | ที่อยู่ | Category | Short description | สัญญา |
| --- | --- | --- | --- | --- |
| Wallet | https://app.sawasdeecoin.com/?tab=wallet | Other (wallet) | A browser wallet for ZETAPHY whose accounts can be controlled by post-quantum ML-DSA-44 keys, and which checks destinations against Neuro's ThreatRegistry before you sign. | ไม่มีของตัวเอง (ใช้ ThreatRegistry) |
| Swap | https://app.sawasdeecoin.com/?tab=swap | DeFi (exchange) | Swap and provide liquidity on ZETAPHY with constant-product (AMM) pools. No pools exist yet; the DLMM contracts are deployed but their tab is not on mainnet yet. | ZetaphyFactory, ZetaphyRouter (DLMM factory และ router: ใส่เมื่อแท็บ DLMM เปิดบน mainnet แล้วเท่านั้น) |
| Explorer | https://explorer.sawasdeecoin.com/?network=mainnet | Other (explorer) | A block explorer for ZETAPHY that reads the node directly: EVM and Cosmos transactions, addresses, validators with their post-quantum vote keys. | ไม่มี |
| NFT | https://app.sawasdeecoin.com/?tab=nft | Collectibles (marketplace) | Create and trade NFTs on ZETAPHY. | NFT factory, NFT marketplace |
| Neuro | https://app.sawasdeecoin.com/?tab=neuro | Other (security) | Neuro scam protection: contract checks whose results go on chain in a public ThreatRegistry that wallets can read. | NeuroControl, NeuroJobs, ThreatRegistry, ThreatReports |

### Address ของสัญญา

จาก `zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json` (chain id 3659) สอง address ที่ไฟล์นั้นใส่ไว้ใต้ `notUsed`
ตั้งใจไม่ใส่ เพราะไม่ใช่ส่วนหนึ่งของระบบ

| สัญญา | Address |
| --- | --- |
| ZetaphyFactory (AMM) | `0x93463B001483970f8CAE63cd8B60D28F17a1C1AA` |
| ZetaphyRouter (AMM) | `0xa5221A7F25cf10d99446Fde3e95c15b1f696e783` |
| DLMM factory | `0x65fe29Eb6deaBf1ae8929De7E0A793aB394c887a` |
| DLMM router | `0xf6CdF4aD5316aDF8F73E768faB997C1E7C4df43B` |
| NFT factory | `0xc0800dBEbFFC80120f5DC0E6f2a603C00F6AF391` |
| NFT marketplace | `0x0402d6E7af2912D002EfCa7543eb44A3EB3Bbc14` |
| NeuroControl | `0x97F5D7FBc6228aA7A145505AABdbdC7825e161AE` |
| NeuroJobs | `0x5044309622064d21c5D7Ac681f7a4489ca4Ce4fB` |
| ThreatRegistry | `0xaACfc7Cf7148b7AE530c2Ab891D4220E648A2139` |
| ThreatReports | `0x11411E0c35dA30b4a5009827770798ad79881c31` |
| ZetaphyBounty | `0xb73856D25a3547581D36E8F2D9F3601a5DF39eBE` |

รายการเต็ม (vault, oracle, identity, AI map และสัญญาอื่นที่เพิ่มเมื่อ 2026-11-14) อยู่ในไฟล์เดียวกันใต้ `addedOnResume`
รายการบน DappRadar ต้องการเฉพาะสัญญาที่ผู้ใช้เรียกผ่าน dapp นั้น

## awesome-cosmos (cosmos/awesome-cosmos บน GitHub)

**repo นี้ขออะไร** (จาก README และ CONTRIBUTING.md ตรวจบน GitHub ที่ commit `ec1d861`, 2024-11-19):

- เปิด pull request เข้า branch หลัก CI รัน `npx awesome-lint`
- block explorer และกระเป๋าต้องเป็น https และมี Twitter หรือ GitHub ไว้ติดต่อนักพัฒนา กระเป๋าต้องมีผล security audit ที่เผยแพร่แล้วด้วย
  กระเป๋า ZETAPHY จึง **ยังไม่เข้าเกณฑ์**
- หมวด "Ecosystem" ไม่ได้ลงรายชื่อโครงการ (ชี้ไปที่ cosmos.directory) และ "Wallets" ชี้ไปที่ cosmos.network จึงไม่มีบรรทัดให้เพิ่มตรงนั้น

**ที่เข้าเกณฑ์:** ZETAPHY explorer ในหมวด **Block Explorers** (รายการแรก เรียงตามชื่อ จึงต่อท้ายหลัง "Stake ID"):

```markdown
* [ZETAPHY Explorer](https://explorer.sawasdeecoin.com/?network=mainnet) - [Source](https://github.com/pospos191-alt/zetaphy/tree/main/zetaphy-explorer)
```

patch อยู่ที่ [awesome-cosmos/0001-block-explorers-zetaphy.patch](awesome-cosmos/0001-block-explorers-zetaphy.patch)
ใช้กับ commit นั้นได้สะอาด (`git apply --check`) และ `awesome-lint` 2.3.0 ให้ผล 3 error และ 15 warning เท่ากันทั้งก่อนและหลังใส่
ทั้งหมดอยู่ในบรรทัดที่มีอยู่เดิม ไม่มีในบรรทัดใหม่ รายชื่อนี้แก้ครั้งล่าสุดเมื่อปีที่แล้ว การรีวิวอาจช้าหรือไม่มีเลย

**ชื่อ PR:** `Add ZETAPHY Explorer to Block Explorers`

**เนื้อหา PR:** ใช้ข้อความภาษาอังกฤษใน [DIRECTORIES.md](DIRECTORIES.md#awesome-cosmos-cosmosawesome-cosmos-on-github)
ทุกตัวอักษร (บอกว่าเพิ่ม explorer ใด ลิงก์ explorer และซอร์สโค้ด chain id และคำเตือนว่ามี validator ตัวเดียวและยังไม่ผ่าน audit)

**วิธีส่ง (ผ่านหน้าเว็บ):** เปิด https://github.com/cosmos/awesome-cosmos กด **Fork** ใน fork เปิด `README.md` กดรูปดินสอ
เพิ่มบรรทัดต่อจาก `* [Stake ID](https://stake.id)` commit เข้า branch ใหม่ แล้วกด **Contribute → Open pull request**
ใส่ชื่อและเนื้อหาด้านบน

## ฟอรัม Cosmos (forum.cosmos.network): โพสต์แนะนำตัว

- **หมวด:** ยังไม่ได้ตรวจสอบ (เปิดฟอรัมไม่ได้) เลือกหมวดที่ฟอรัมใช้สำหรับเชนใหม่หรือแนะนำโครงการ ถ้าไม่มีให้ใช้หมวดทั่วไป
  และอ่านกฎการโพสต์ของฟอรัมก่อน
- **ชื่อเรื่องและเนื้อหา:** ใช้ข้อความภาษาอังกฤษใน [DIRECTORIES.md](DIRECTORIES.md#cosmos-forum-forumcosmosnetwork-introduction-post)
  ทุกตัวอักษร

สรุปเนื้อหาโพสต์: ZETAPHY คือเชน Cosmos SDK (v0.54) ที่มี EVM ผ่าน cosmos/evm บน CometBFT (chain id `zetaphy_3659-1`, EVM 3659,
เหรียญ ZTPHY) บัญชีใช้กุญแจทนควอนตัม ML-DSA-44 ได้ validator ลงทะเบียนกุญแจโหวต ML-DSA-44 ที่เซ็นคู่กับ ed25519 ได้ มีระบบกันโกง
Neuro ที่บันทึกผลใน ThreatRegistry บนเชน IBC ยังเป็นแผน (เคยทดสอบเส้นทาง Noble บน testnet ที่ปิดไปแล้ว ยังไม่มี channel บน
mainnet) ตามด้วยคำเตือนความเสี่ยงจากประกาศ mainnet ทุกตัวอักษร บอกว่าตอนนี้มี validator ตัวเดียวที่โครงการดูแลเอง และเชิญ validator
อิสระ พร้อมลิงก์คู่มือ validator https://app.sawasdeecoin.com/validators.html และคำสั่งติดตั้ง

```
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/install.sh | sudo bash -s -- validator
```

ก่อนโพสต์ ตรวจว่าคู่มือ validator และคำสั่งติดตั้งยังตรงกัน (เปลี่ยนตาม release) และแก้ "went live on 2026-11-13" เฉพาะเมื่อข้อเท็จจริงเปลี่ยน
