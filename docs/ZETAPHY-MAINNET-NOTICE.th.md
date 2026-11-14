[English](ZETAPHY-MAINNET-NOTICE.md) | **ภาษาไทย**

# ZETAPHY mainnet: ประกาศ

ZETAPHY mainnet (`zetaphy_3659-1`, EVM chain id 3659, เหรียญ ZTPHY) มีเวลาเริ่มเชน (genesis) **13 พฤศจิกายน 2026 เวลา 14:00 UTC
(21:00 น. เวลาไทย)** genesis sha256 คือ `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`
([ไฟล์ที่เผยแพร่](../zetaphy-chain/mainnet/zetaphy_3659-1/README.th.md))

**ตอนนี้ ZETAPHY มีเพียง mainnet เครือข่ายเดียว** testnet (`zetaphy_77390-1`, EVM chain id 77390, https://rpc.sawasdeecoin.com)
ปิดถาวรเมื่อ **14 พฤศจิกายน 2026** (เจ้าของโครงการตัดสินใจ) เหรียญ สัญญา และ RPC ของ testnet ไม่มีแล้ว อย่าส่งอะไรไปที่ chain 77390

## ก่อนใช้งาน

ขณะนี้ ZETAPHY mainnet ทำงานบน validator เพียงตัวเดียวที่โครงการ ZETAPHY ดูแลเอง และโค้ดยังไม่ผ่านการตรวจสอบ (audit) จากภายนอก
ที่เป็นอิสระ จนกว่าจะมี validator อิสระเพิ่มและเผยแพร่ผล audit โครงการสามารถหยุดหรือเปลี่ยนแปลงเชนได้
**โปรดใช้เฉพาะจำนวนที่ยอมเสียได้**

## ใช้งานอย่างปลอดภัย

- address, RPC และประกาศทางการ เผยแพร่ใน repo นี้เท่านั้น
- โครงการไม่เคยขอคำกู้กระเป๋า (recovery phrase), private key หรือให้จ่ายเงิน ไม่ว่าเพื่อรับ airdrop หรือเรื่องใด
- ตรวจ genesis ด้วยตัวเอง: `sha256sum -c genesis.sha256` ในโฟลเดอร์ที่เผยแพร่

## สิ่งที่ล็อกไว้ตั้งแต่บล็อกแรก

- จำนวนเหรียญ: 1,000,000,000 ZTPHY ไม่มีการผลิตเพิ่ม ค่าธรรมเนียมครึ่งหนึ่งและ address dEaD ถูกเผาทิ้ง
- เหรียญของทีม: ล็อก 1 ปี แล้วทยอยปลดจนครบปีที่ 4
- chain guard, shield, invariant firewall, security core และรัฐธรรมนูญ ทำงานอยู่
- กุญแจดอกเดียวสั่ง circuit-breaker ไม่ได้ ต้องเป็น governance หรือ multisig circuit-breaker แบบ 2 จาก 3 เท่านั้น

## ข้อความสั้นสำหรับแอป เว็บไซต์ และโพสต์โซเชียล

> ZETAPHY mainnet (zetaphy_3659-1, EVM 3659, ZTPHY) เริ่มเชนวันที่ 13 พ.ย. 2026 ขณะนี้ทำงานบน validator ตัวเดียวที่โครงการ
> ดูแลเอง และโค้ดยังไม่ผ่านการตรวจสอบ (audit) จากภายนอกที่เป็นอิสระ จนกว่าจะมี validator อิสระเพิ่มและเผยแพร่ผล audit
> โครงการสามารถหยุดหรือเปลี่ยนแปลงเชนได้ โปรดใช้เฉพาะจำนวนที่ยอมเสียได้ Genesis sha256 ca0efb15…0a94667 รายละเอียด:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.th.md

แจ้งปัญหาความปลอดภัย: [SECURITY.md](../SECURITY.md)
