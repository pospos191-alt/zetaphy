[English](SAPHAN-NEURO-VALIDATOR.md) | **ภาษาไทย**

# Neuro validator: ผู้ยืนยันคนที่สองของสะพาน Saphan ที่เป็นอิสระ

ตอนนี้กุญแจดอกเดียวบน sentry เซ็นรับรองทุกข้อความ ZETAPHY -> BSC / Base (ISM บนเหรียญปลายทางเป็น **1 จาก 1**) ถ้ากุญแจถูกขโมย
คนร้ายเสก ZTPHY ที่ไม่มีหนุนได้ถึงเพดาน มีแค่เวลารอ 1 ชม. กับ guardian veto ที่หยุดได้ Neuro validator คือผู้เซ็นคนที่สองบน
**คนละเครื่อง คนละคลาวด์ คนละกุญแจ** เมื่อ ISM บนเหรียญปลายทางเป็น **2 จาก 2** (validator ของ Hyperlane ของเรา + Neuro validator)
กุญแจบน sentry ดอกเดียวจะเสกอะไรไม่ได้เลย

| | |
|---|---|
| ตัวเซ็น | [`zetaphy-network/scripts/neuro-validator.js`](../zetaphy-network/scripts/neuro-validator.js) ([`src/neurovalidator.js`](../zetaphy-network/src/neurovalidator.js)) |
| เครื่องของมัน | [`neuro-validator-host.sh`](../zetaphy-network/scripts/neuro-validator-host.sh): VM e2-micro ของ Google Cloud (ฟรี), Docker, systemd |
| การเปลี่ยน ISM | [`saphan-ism.js`](../zetaphy-network/scripts/saphan-ism.js): ISM ใหม่ผ่าน factory ของ Hyperlane ตั้งผ่าน timelock ของแต่ละเส้นทาง (48 ชม.) |
| Test | `cd zetaphy-network && node --test test/neurovalidator.test.js` |

## มันเซ็นอะไร

มันติดตาม merkle tree ของ Mailbox (`InsertedIntoTree` ของ MerkleTreeHook) สร้าง tree เอง และไม่เซ็นอะไรเลยถ้า root หรือจำนวน
ไม่ตรงกับของ hook แต่ละรายการใหม่ มันอ่านธุรกรรมแล้วเซ็นข้อความ (checkpoint แบบ message-id ในรูปแบบเดียวกับที่ validator ของ
Hyperlane เก็บ) **เฉพาะเมื่อ**:

1. `Dispatch` ของ Mailbox มาจาก vault **ของเรา** ไปยัง domain และเหรียญปลายทางของเส้นทางนั้น
2. เนื้อข้อความระบุ vault, เหรียญปลายทาง และเชนเดียวกัน
3. vault ส่ง `Sent(nonce, sender, to, amount, messageId)` ของข้อความนี้ในธุรกรรมเดียวกัน และตรงกับเนื้อข้อความ
4. จำนวนไม่เกินเพดาน mint ต่อวันของปลายทาง
5. **Neuro**: ผู้ส่งและผู้รับไม่อยู่ใน ThreatRegistry (`isContractHeld`) ข้อความที่ถูกพักไม่ถูกปฏิเสธถาวร: มันรอ ตรวจซ้ำทุกรอบ
   และเซ็นเมื่อ Neuro ยกเลิกการพัก

อย่างอื่น (ข้อความของแอปอื่น ข้อความปลอม) จะไม่ถูกเซ็นเลย relayer จึงส่งผ่าน ISM แบบ 2 จาก 2 ไม่ได้ ส่วนขากลับ (BSC / Base ->
ZETAPHY) ต้องใช้ validator ของ Hyperlane 3 จาก 5 อยู่แล้ว ไม่เปลี่ยน

## ข้อจำกัด (อ่านก่อนพึ่งพา)

- **มันมองเห็น ZETAPHY ผ่าน RPC ของ sentry** (ยังไม่มี node สาธารณะอื่น) จึงกันกรณีกุญแจ validator ถูกขโมย ซึ่งเป็นการโจมตีที่เป็นไปได้
  มากที่สุด แต่ถ้าคนร้ายคุม node บน sentry ได้ทั้งเครื่อง อาจป้อนเชนปลอมให้ผู้เซ็นทั้งสองได้ ถ้ามี full node ที่สองที่ไหนก็ได้
  (validator ของชุมชน) ข้อนี้จะหายไป
- **2 จาก 2 แปลว่าถ้าผู้เซ็นคนใดล่ม การโอน ZETAPHY -> ปลายทางจะหยุด** (ไม่มีอะไรหาย ข้อความรออยู่) ระบบเฝ้าระวังจะแจ้ง และ systemd
  จะรีสตาร์ต validator ให้เอง
- relayer อ่าน checkpoint ของ Neuro validator จาก **bucket Cloud Storage ที่เปิดให้อ่านสาธารณะ** (`gs://…`) agent ของ Hyperlane อ่านเลข index ล่าสุดของ validator ที่เก็บบน GCS จากไฟล์ชื่อ `gcsLatestIndexKey` และอ่านที่อยู่ `gs://bucket/folder` เป็น bucket ที่ไม่มีโฟลเดอร์ validator จึงเขียนลายเซ็นและ `gcsLatestIndexKey` ทั้งในโฟลเดอร์และที่ root ของ bucket ซึ่งเป็นที่ที่ relayer อ่าน (25 พ.ย. 2026: ข้อความแรกที่ส่งไป Base ค้างรอให้ลายเซ็นครบจนกว่าจะแก้จุดนี้)

## ขั้นตอนติดตั้ง

### 1. เครื่องและ bucket (Google Cloud Shell) [เปลี่ยนการตั้งค่า]

```bash
BUCKET=zetaphy-neuro-$(openssl rand -hex 3); ZONE=us-central1-a; echo "bucket: $BUCKET"
gcloud storage buckets create gs://$BUCKET --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=allUsers --role=roles/storage.objectViewer
gcloud compute instances create neuro-validator --zone=$ZONE --machine-type=e2-micro --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB --scopes=storage-rw
SA=$(gcloud compute instances describe neuro-validator --zone $ZONE --format='value(serviceAccounts[0].email)')
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin
gcloud compute ssh neuro-validator --zone $ZONE --command "curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/zetaphy-network/scripts/neuro-validator-host.sh -o h.sh && sudo bash h.sh install gs://$BUCKET/neuro"
```

e2-micro ใน us-central1, ดิสก์ 30 GB และ Cloud Storage 5 GB อยู่ใน free tier ของ Google บรรทัดสุดท้ายจะแสดง
**ที่อยู่ของ validator** กุญแจไม่ออกจาก VM

### 2. ประกาศตัว [เปลี่ยนเชน]

ส่ง 0.1 ZTPHY บน ZETAPHY ให้ที่อยู่นั้น แล้วบน VM: `sudo bash h.sh announce --send yes`

### 3. เปลี่ยน ISM ของแต่ละเส้นทางเป็น 2 จาก 2 [เปลี่ยนเชน]

บน Oracle Cloud Shell ใน `~/zetaphy/zetaphy-network` ทำทีละเส้นทาง `bsc` แล้ว `base`:

```bash
KEYFILE=/dev/shm/dk node scripts/saphan-ism.js deploy --route bsc --add 0xNEURO --send yes   # ISM ใหม่ (deployer จ่ายแก๊ส)
read -rs M; export M; node scripts/saphan-ism.js propose --route bsc; unset M                 # guardian คนแรก
read -rs M; export M; node scripts/saphan-ism.js confirm <n> --route bsc; unset M             # guardian คนที่สอง
# 48 ชั่วโมงต่อมา:
KEYFILE=/dev/shm/dk node scripts/saphan-ism.js execute --route bsc --send yes
node scripts/saphan-ism.js status --route bsc                                                # [อ่าน] 2 จาก [...] และประกาศตัวครบ
```

**ก่อน execute** ใช้ `status` เช็กว่า Neuro validator ประกาศตัวแล้ว และ bucket มี `checkpoint_<n>_with_id.json` ของการโอนล่าสุด
ไม่อย่างนั้นการเปลี่ยนจะทำให้เส้นทางหยุดจนกว่ามันจะเซ็น ระบบเฝ้าระวังจะแจ้งการตั้งเวลานี้เป็น CRITICAL ("the ISM … changed")
เป็นเรื่องปกติ
