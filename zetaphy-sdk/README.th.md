# @zetaphy/sdk: AI บนเชนของ ZETAPHY สำหรับทุกแอป

เพิ่ม Neuro ของ ZETAPHY ลงในกระเป๋า, DEX, launchpad, บอท หรือเว็บไซต์ได้ในไม่กี่บรรทัด:
- สัญญานี้ถูก flag หรือไม่
- ป้าย Neuro ของสัญญานี้เป็นอย่างไร
- ขอให้ตรวจใหม่

ทุกอย่าง**ทำงานผ่าน ZETAPHY mainnet** (chain 3659):
- คำตอบมาจากสัญญาบน ZETAPHY
- การขอตรวจใหม่คืองานบน NeuroJobs ของ ZETAPHY จ่ายค่าธรรมเนียมเป็น ZTPHY
- runner อิสระเป็นผู้ตรวจ และงานจะปิดเมื่ออย่างน้อย 2 ใน 3 ได้ผลตรงกัน

SDK นี้ไม่มี dependency ใช้ได้ทั้งในเบราว์เซอร์และ Node 18 ขึ้นไป

```js
import { createNeuro } from '@zetaphy/sdk';
const neuro = createNeuro();                                    // ZETAPHY mainnet, RPC สาธารณะ

await neuro.isFlagged({ chainId: 56, address: '0xToken' });     // { flagged: true, reason: 'owner-can-block-transfers' }
await neuro.badge('0xContractOnZetaphy');                       // ป้าย Neuro หรือ null
await neuro.fee();                                              // ค่าตรวจหนึ่งครั้ง (หน่วย wei ของ ZTPHY)
await neuro.canCheck('bsc');                                    // ตอนนี้รับตรวจเหรียญบน BNB Chain หรือไม่

// ขอตรวจใหม่ จ่ายจากกระเป๋าของผู้ใช้บน ZETAPHY (SDK สลับกระเป๋าไป chain 3659 ให้ก่อน)
const { id } = await neuro.requestCheck(window.ethereum, { chain: 'bsc', address: '0xToken' });
const job = await neuro.waitForJob(id);                         // { status: 'done', verdict: '0x…', … }
```

**ไม่ถูก flag ไม่ได้แปลว่าปลอดภัย** แปลแค่ว่า runner ของ ZETAPHY ยังไม่ได้ flag ให้แสดงว่า "Neuro ไม่มีคำเตือน" ห้ามแสดงว่า "ปลอดภัย"

## สัญญาอนุญาต: ใช้ได้ฟรี โดยต้องใช้ผ่าน ZETAPHY
โค้ดอยู่ภายใต้ Business Source License 1.1 (ไฟล์ `LICENSE` ที่ root ของ repository) ข้อ Additional Use Grant อนุญาตให้ทุกคนสร้าง รัน และให้บริการแอป บอท เครื่องมือ และบริการ**ที่เชื่อมต่อกับ Official ZETAPHY Network** ใช้งานจริงได้ฟรี

ถ้าจะนำโค้ดของ Neuro ไปรันเป็นเครือข่ายแยก หรือทำบริการคู่แข่งที่ไม่ผ่าน ZETAPHY ต้องขอสัญญาอนุญาตเชิงพาณิชย์จากเจ้าของ

วันที่ 24 ต.ค. 2030 โค้ดจะเปลี่ยนเป็น GPL-2.0-or-later
