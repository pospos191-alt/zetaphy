[English](ZETAPHY-MAINNET-PROCEDURE.md) | **ภาษาไทย**

# ZETAPHY mainnet (ZTPHY): ขั้นตอนลงมือเปิดตัว

คำสั่งทีละขั้นสำหรับด่านต่างๆ ใน [ZETAPHY-MAINNET-RUNBOOK.th.md](ZETAPHY-MAINNET-RUNBOOK.th.md) ไม่มีอะไรในนี้ทำงานเอง
ไม่มี workflow ใดสร้าง genesis ของ mainnet หรือเปิดโหนด mainnet เจ้าของโครงการเป็นผู้รันทุกขั้นเอง

**การตัดสินใจของเจ้าของ: mainnet เปิดตัวด้วย validator ตัวเดียว** ที่โครงการดูแลเอง และจะเพิ่ม validator ภายหลัง
ความเสี่ยงพูดตรงๆ: ผู้ที่คุมเครื่องนั้น (หรือคีย์ของมัน) คุมเชนได้ทั้งหมด หยุดเชนได้ เลือกไม่รับธุรกรรมได้ และถ้าใช้ไบนารีที่แก้แล้ว
ก็เปลี่ยนกฎของเชนได้ การป้องกันทุกอย่างในเอกสารนี้ถูกผู้ดูแลคนเดียวนั้นถอดออกได้ ถ้าเครื่องหายและไม่มีสำรองคีย์ เชนจะหยุด
ต้องแจ้งผู้ใช้ (ข้อความประกาศด้านล่าง) และการ audit ภายนอก (ด่าน 1) ก็ยังไม่เสร็จ ประกาศก็บอกเรื่องนี้ด้วย

เครื่องมือ (ใน `zetaphy-chain/mainnet/`):

| ไฟล์ | หน้าที่ |
|---|---|
| `make-genesis.sh` | `draft` / `finalize` / `verify` genesis จาก config ที่มีแต่ที่อยู่ ไม่เคยถือ private key |
| `mainnet.example.env` | config พร้อมค่าที่เสนอ ที่อยู่ในไฟล์เป็นค่าปลอมซึ่งสคริปต์ปฏิเสธ |
| `genesis_tool.py` | การตรวจและการแก้ไขที่ `make-genesis.sh` เรียกใช้ |
| `test-make-genesis.sh` | เทสต์: input ที่ไม่ปลอดภัยถูกปฏิเสธทุกกรณี `--e2e` รันผลลัพธ์เป็นเชน validator เดียว (CI: `security.yml` job zetaphy-chain) |

`zetaphy-chain/setup-node.sh` มีโหมด pinned chain สำหรับ mainnet: `GENESIS_FILE` + `GENESIS_SHA256` +
`GENESIS_EVM_CHAIN_ID` ติดตั้งโหนดของ genesis นั้นเท่านั้น ไม่สร้าง genesis ของ testnet ไม่มี faucet ไม่มี test keyring
ไม่ส่งธุรกรรมเอง และไม่เปิด RPC สาธารณะเว้นแต่ `PUBLIC_RPC=1` ถ้าไม่ตั้งตัวแปรเหล่านี้ จะตั้ง testnet เหมือนเดิมทุกอย่าง

ป้าย: **[อ่าน]** อ่านอย่างเดียว · **[เปลี่ยนไฟล์]** เขียนไฟล์ · **[เปลี่ยนเชน]** ส่งธุรกรรม ·
**[เปลี่ยนการตั้งค่า]** เปลี่ยนค่าของเครื่องหรือโหนด (ผู้ใช้, firewall, service, config) **หยุด** หมายถึง ห้ามทำต่อ ต้องหาสาเหตุก่อน

## ค่าที่เสนอ (เจ้าของต้องยืนยัน)

| รายการ | ค่าที่เสนอ | ตั้งที่ |
|---|---|---|
| Chain id / EVM chain id | `zetaphy_3659-1` / `3659` (ไม่มีไฟล์ `eip155-3659` ใน ethereum-lists/chains ณ 2026-11-12; testnet คือ 77390) | `CHAIN_ID`, `EVM_CHAIN_ID` |
| เหรียญ | ZTPHY, หน่วยฐาน `azetaphy`, หน่วยแสดง `ztphy`, 18 ทศนิยม | `DENOM`, `DISPLAY_DENOM`, `SYMBOL` |
| ปริมาณ | 1,000,000,000 ZTPHY คงที่ (ไม่มีเงินเฟ้อ) | `TOTAL_SUPPLY` |
| การแบ่ง | rewards 50% · SWD airdrop 20% · community 15% · liquidity & partners 10% (จ่ายให้ validator 1,000,000 และ multisig ของ circuit 1,000) · team 5% (ล็อก 1 ปี แล้วทยอยปลดถึงปีที่ 4) | `ALLOC_*` |
| Self-bond | 500,000 ZTPHY | `SELF_BOND` |
| ราคา gas ต่ำสุด | 1 gwei = `1000000000azetaphy` ต่อ gas (เท่า testnet) | `MIN_GAS_PRICE` |
| Governance | โหวต 5 วัน, expedited 1 วัน, ช่วงวางมัดจำ 14 วัน, มัดจำ 10,000 ZTPHY (expedited 50,000) วาง 25% ตอนยื่น, quorum 33.4%, threshold 50%, veto 33.4% | `GOV_*` |
| Staking / slashing | unbonding 21 วัน, commission ต่ำสุด 5%, window 10,000 บล็อก, ต้องเซ็น 5%, double-sign 5% | `STAKING_*`, `SLASHING_*` |
| เวลา genesis | ตกลงกันภายหลัง | `GENESIS_TIME` |
| ที่อยู่ | เจ้าของเป็นผู้ให้; แนะนำ multisig สำหรับทุกกองเงิน | `ALLOC_*`, `CIRCUIT_AUTHORITY` |

ค่าธรรมเนียมที่ 1 gwei: โอน (21,000 gas) ประมาณ 0.000021 ZTPHY, swap (~150,000 gas) ประมาณ 0.00015 ZTPHY
base fee แบบ EIP-1559 เริ่มที่ค่าต่ำสุดและไม่ลดต่ำกว่านั้น (feemarket `min_gas_price`) ค่าธรรมเนียมต่ำทำให้การ spam ถูกลงบนเชนที่มี
validator เดียว การจำกัดต่อ IP ของ rpc-guard และ gas limit ต่อบล็อก (30M) ช่วยจำกัดไว้

Constitution เปิดตั้งแต่บล็อก 1: ค่า governance และ staking ข้างบนกลายเป็นพื้นขั้นต่ำที่ proposal ภายหลังลดไม่ได้ (โหวตสั้นลง, quorum
ต่ำลง, unbonding สั้นลง, เงินเฟ้อใหม่, เปลี่ยน denom) เลือกครั้งเดียวให้ถูก

## 1. เครื่อง [เปลี่ยนการตั้งค่า]

- **M-GEN**: เครื่องสะอาดสำหรับทำ genesis (laptop ที่ลง OS ใหม่ก็ได้) ดาวน์โหลด release แล้วทำงานแบบ offline ไม่เคยถือคีย์ของกองเงิน
- **M-VAL**: validator เป็น VM ใหม่ ไม่ใช่ VM ของ testnet และไม่ใช่เครื่อง RPC สาธารณะ (Ubuntu 24.04, 4 vCPU, RAM 16 GB,
  SSD 200 GB) SSH ด้วยคีย์เท่านั้น เปิดพอร์ต P2P 26656 **ให้เฉพาะที่อยู่ของ M-SENTRY** ไม่เปิดพอร์ตอื่นสู่สาธารณะ
- **M-SENTRY**: sentry node และ RPC สาธารณะ อยู่อีกเครื่อง (ถ้าทำได้ให้ต่างผู้ให้บริการ) พอร์ต 26656, 80, 443
- **ผู้เซ็น**: อุปกรณ์ของสมาชิก multisig แต่ละคน (hardware wallet ถ้ารองรับชนิดคีย์ หรือเครื่อง offline) ถือโดยคนละคน

หยุด ถ้า M-VAL ต้องใช้เครื่องร่วมกับโหนด testnet หรือ RPC สาธารณะใดๆ

## 2. Chain id [อ่าน]

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/chains/eip155-3659.json
#   ควรได้ 404 (ว่าง)
curl -s https://chainid.network/chains.json | jq '[.[] | select(.chainId == 3659)] | length'
#   ควรได้ 0
```

หยุด ถ้าอันใดแสดงว่ามีผู้ใช้แล้ว ให้เลือกเลขอื่น (`CHAIN_ID=zetaphy_<id>-1`, `EVM_CHAIN_ID=<id>`) ก่อนเปิดตัวให้เปิด pull request
ที่ `ethereum-lists/chains` สำหรับ `eip155-3659` (ชื่อ, ZTPHY, 18 ทศนิยม, RPC ของขั้น 12) เพื่อจดทะเบียนเลขนี้ให้เชนนี้

## 3. Release [อ่าน] [เปลี่ยนไฟล์]

Mainnet ใช้ release ที่ตรึงไว้ในด่าน 5 (`REL=zetaphyd-<hex 12 ตัว>`, commit `COMMIT`) ซึ่งต้องมีโหมด pinned chain ของ
`setup-node.sh` นี้ (release ที่ build จากการเปลี่ยนแปลงนี้เป็นต้นไป) บนเครื่องที่ออนไลน์:

```bash
REL=zetaphyd-<12 hex>; COMMIT=<40 hex>; mkdir -p ~/rel && cd ~/rel
for f in RELEASE.json SHA256SUMS zetaphyd-provenance.sigstore.json zetaphyd-linux-amd64; do
  curl -fsSLO "https://github.com/pospos191-alt/zetaphy/releases/download/$REL/$f"; done
for f in setup-node.sh verify-release.sh mainnet/make-genesis.sh mainnet/genesis_tool.py mainnet/mainnet.example.env; do
  curl -fsSL "https://raw.githubusercontent.com/pospos191-alt/zetaphy/$COMMIT/zetaphy-chain/$f" -o "$(basename $f)"; done
jq -r '.scripts["verify-release.sh"]' RELEASE.json; sha256sum verify-release.sh   # สองค่านี้ต้องเท่ากัน
bash verify-release.sh --dir . --arch amd64 --setup setup-node.sh --installed-bin /nonexistent --record-file /tmp/none.json
#   บรรทัดสุดท้ายควรเป็น: VERIFIED zetaphyd-linux-amd64 (commit <COMMIT>)
curl -fsSLO https://github.com/CosmWasm/wasmvm/releases/download/v3.0.9/libwasmvm.x86_64.so
echo "0d41aa842c004a6aa138291d1f9f99818479fec7aef024d419e4ad244f858ee4  libwasmvm.x86_64.so" | sha256sum -c
```

หยุด ถ้ามีบรรทัด `REFUSED` หรือ hash ไม่ตรง คัดลอก `~/rel` ไป M-GEN และ M-VAL (USB หรือ scp) แล้วรัน
`sha256sum -c SHA256SUMS --ignore-missing` ที่นั่น แต่ละเครื่อง `sudo install -m 644 libwasmvm.x86_64.so /usr/local/lib/ &&
sudo ldconfig` (หรือ `export LD_LIBRARY_PATH=~/rel`)

## 4. สร้าง multisig แบบ offline [เปลี่ยนไฟล์]

ผู้มีสิทธิ์ตัด circuit breaker ต้องเป็น multisig (อย่างน้อย 2 จาก 2 คีย์ที่ต่างกัน แนะนำ 2-of-3) กองเงิน (rewards, airdrop,
community, liquidity, team) ก็ควรเป็น multisig ที่มีสมาชิกของตัวเอง

สมาชิกแต่ละคน บนอุปกรณ์ของตัวเอง:

```bash
zetaphyd keys add m1 --keyring-backend file --keyring-dir ~/zkeys --algo eth_secp256k1   # ตั้งรหัสผ่าน; จดคำบนกระดาษ
zetaphyd keys show m1 -p --keyring-backend file --keyring-dir ~/zkeys > m1.pub.json        # สาธารณะ: ส่งไฟล์นี้
```

ผู้ประสานงานบน M-GEN ใช้แค่ public key:

```bash
for m in m1 m2 m3; do zetaphyd keys add $m --pubkey "$(cat $m.pub.json)" --keyring-backend file --keyring-dir ~/ms; done
zetaphyd keys add circuit-ms --multisig m1,m2,m3 --multisig-threshold 2 --keyring-backend file --keyring-dir ~/ms
zetaphyd keys show circuit-ms -p --keyring-backend file --keyring-dir ~/ms > circuit-authority.pubkey.json
zetaphyd keys show circuit-ms -a --keyring-backend file --keyring-dir ~/ms                  # ที่อยู่
```

สมาชิกทุกคนทำสี่คำสั่งสุดท้ายซ้ำบนเครื่องตัวเอง และต้องได้ที่อยู่เดียวกัน หยุด ถ้าไม่ตรง

## 5. คีย์ของ validator บน M-VAL [เปลี่ยนการตั้งค่า] [เปลี่ยนไฟล์]

```bash
sudo useradd -m -s /bin/bash zetaphy
sudo install -m 755 ~/rel/zetaphyd-linux-amd64 /usr/local/bin/zetaphyd
sudo -iu zetaphy
zetaphyd init zetaphy-validator-0 --chain-id zetaphy_3659-1 --home ~/.zetaphy > /dev/null
zetaphyd keys add validator --keyring-backend file --keyring-dir ~/.zetaphy-keys --algo eth_secp256k1
#   รหัสผ่านยาวๆ; จด 24 คำบนกระดาษ เก็บ offline; ห้ามใช้ test backend
zetaphyd keys show validator -a --keyring-backend file --keyring-dir ~/.zetaphy-keys      # -> ALLOC_VALIDATOR
```

`~/.zetaphy/config/priv_validator_key.json` คือ consensus key: สำรองแบบ offline (เข้ารหัส) ตอนนี้เลย พร้อม
`pq_vote_key.seed` เมื่อขั้น 11 สร้างแล้ว ภายหลังใช้ remote signer (Horcrux, `zetaphy-chain/horcrux/`) แทนไฟล์คีย์ได้

## 6. Config บน M-GEN [เปลี่ยนไฟล์]

```bash
cp ~/rel/mainnet.example.env mainnet.env      # ไว้ข้าง circuit-authority.pubkey.json จากขั้น 4
```

ใส่ที่อยู่ทุก `ALLOC_*`, `CIRCUIT_AUTHORITY`, `GENESIS_TIME` (UTC อย่างน้อยหนึ่งวันหลังขั้น 10) และยืนยันค่าที่เสนอทีละค่า
การจัดสรรเขียนเป็น `<ที่อยู่> <จำนวน ZTPHY เต็มหน่วย>` และ `vesting <เริ่ม> <จบ>` สำหรับ team หรือ treasury

## 7. Genesis ฉบับร่าง [เปลี่ยนไฟล์]

```bash
ZETAPHYD=~/rel/zetaphyd-linux-amd64 bash ~/rel/make-genesis.sh draft mainnet.env out
```

ควรเห็น `draft genesis: out/genesis.draft.json` และสรุป: chain id, เหรียญ, การจัดสรรแต่ละรายการ, `circuit authority …
(multisig 2 of 3)`, `from block 1 chain guard, shield, invariant-firewall layer, security core, constitution ON`,
`gentxs 0` หยุด ถ้าเห็น `REFUSED: …` ซึ่งบอกปัญหา (ที่อยู่ปลอมหรือผิด, ยอดจัดสรรไม่เท่าปริมาณรวม, ผู้มีสิทธิ์ circuit เป็นคีย์เดี่ยวหรือไม่มี,
chain id ของ testnet, ช่วงโหวตต่ำกว่าหนึ่งวัน, คีย์ที่ไม่รู้จัก, …) ส่งร่างให้ผู้ถือกองเงิน แต่ละคนรัน
`make-genesis.sh verify mainnet.env genesis.draft.json --draft` และตรวจที่อยู่และจำนวนของตน

## 8. Gentx บน M-VAL [เปลี่ยนไฟล์]

```bash
cp genesis.draft.json ~/.zetaphy/config/genesis.json      # ในฐานะผู้ใช้ zetaphy
zetaphyd genesis gentx validator 500000000000000000000000azetaphy --keyring-backend file --keyring-dir ~/.zetaphy-keys \
  --chain-id zetaphy_3659-1 --home ~/.zetaphy --moniker zetaphy-validator-0 --commission-rate 0.05 \
  --commission-max-rate 0.20 --commission-max-change-rate 0.01 --gas-prices 1000000000azetaphy \
  --ip <ที่อยู่ของ M-VAL ที่ M-SENTRY เข้าถึงได้> --output-document ~/gentx.json
```

จำนวนคือ `SELF_BOND` ในหน่วย azetaphy (500,000 × 10^18) `gentx.json` เป็นข้อมูลสาธารณะ คัดลอกไป M-GEN

## 9. Genesis ฉบับสุดท้ายและ sha256 [เปลี่ยนไฟล์]

```bash
ZETAPHYD=~/rel/zetaphyd-linux-amd64 bash ~/rel/make-genesis.sh finalize mainnet.env out gentx.json
```

ควรเห็นสรุปที่มี `gentxs 1` แล้ว `GENESIS_SHA256=<hex 64 ตัว>`; ใน `out/` มี `genesis.json`, `genesis.sha256`, `chain.json`
หยุด ถ้า `REFUSED` (เช่น gentx ที่ bond จำนวนอื่น หรือทำสำหรับ chain id อื่น)

## 10. เผยแพร่ [เปลี่ยนไฟล์]

เผยแพร่ `genesis.json`, `genesis.sha256`, `chain.json`, `mainnet.env` และ `circuit-authority.pubkey.json` (ทั้งหมดเป็นข้อมูลสาธารณะ:
มีแต่ที่อยู่และ public key) เช่นเป็น release ของ repository เจ้าของและสมาชิก multisig เซ็น sha256 อย่างเปิดเผย (signed tag หรือ
ข้อความที่เซ็น) ใครก็ตรวจได้:

```bash
ZETAPHYD=<zetaphyd ที่ตรวจแล้ว> bash make-genesis.sh verify mainnet.env genesis.json   # [อ่าน] ควรได้: OK  sha256 <sha>
```

จด chain id, sha256 และลายเซ็นในด่าน 6 ของ runbook

## 11. ติดตั้งโหนด validator [เปลี่ยนการตั้งค่า]

คัดลอก `genesis.json` ที่เผยแพร่ไปที่ `/home/zetaphy/genesis.json` และเทียบ `sha256sum` กับค่าที่เผยแพร่

```bash
sudo GENESIS_FILE=/home/zetaphy/genesis.json GENESIS_SHA256=<sha> GENESIS_EVM_CHAIN_ID=3659 \
  ZETAPHYD_BIN=$HOME/rel/zetaphyd-linux-amd64 bash ~/rel/setup-node.sh
sudo bash ~/rel/verify-release.sh --dir ~/rel --arch amd64 --setup ~/rel/setup-node.sh --record   # [เปลี่ยนไฟล์]
```

ควรเห็น `5/8 genesis of zetaphy_3659-1 (pinned, sha256 <sha>)` และ `ZETAPHY node of zetaphy_3659-1 is starting`,
`Public RPC: none on this machine (PUBLIC_RPC=0)` โหนดรอจนถึง `GENESIS_TIME` ค่าที่ pin เก็บใน
`/etc/zetaphy/pinned-chain.env`: การรันครั้งต่อไป (`sudo zetaphy-validator update`, timer อัปเกรด) อยู่กับ genesis นี้และปฏิเสธ
genesis อื่น หยุด ถ้าสคริปต์บอก `refused:` อย่าใช้ `zetaphy-validator install`, `check`, `unjail` หรือ
`setup-node.sh --become-validator` บน mainnet: เป็นของ testnet (test keyring, chain id ของ testnet)

## 12. Sentry และ RPC สาธารณะ บน M-SENTRY [เปลี่ยนการตั้งค่า]

ทำขั้นเรื่อง release แบบขั้น 3 แล้ว:

```bash
sudo GENESIS_FILE=$HOME/genesis.json GENESIS_SHA256=<sha> GENESIS_EVM_CHAIN_ID=3659 ZETAPHYD_BIN=$HOME/rel/zetaphyd-linux-amd64 \
  PUBLIC_RPC=1 PUBLIC_HOST=rpc.<โดเมนของคุณ> PEERS=<node id ของ M-VAL>@<ip ของ M-VAL>:26656 bash ~/rel/setup-node.sh
```

`zetaphyd comet show-node-id --home ~/.zetaphy` บน M-VAL ให้ node id การเข้าถึงสาธารณะผ่าน Caddy และ rpc-guard
(เฉพาะ method ที่อนุญาต, จำกัดต่อ IP) อย่าตั้ง `PUBLIC_HTTP_RPC` ใน `~/.zetaphy/config/config.toml` ของ M-SENTRY ตั้ง
`private_peer_ids = "<node id ของ M-VAL>"`; บน M-VAL ตั้ง `pex = false` แล้วรันคำสั่งของขั้น 11 อีกครั้งพร้อม
`PEERS=<node id ของ M-SENTRY>@<ip ของ M-SENTRY>:26656` และ restart (`sudo systemctl restart zetaphyd`)

## 13. เริ่มเชนและตรวจครั้งแรก [อ่าน]

ถึง `GENESIS_TIME` ทั้งสองโหนดทำงาน บน M-VAL:

```bash
zetaphyd status --home ~/.zetaphy | jq '{net: .node_info.network, h: .sync_info.latest_block_height, power: .validator_info.voting_power}'
#   zetaphy_3659-1, ความสูงเพิ่มขึ้น, power 500000
curl -s -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545
#   "result":"0xe4b"
zetaphyd q bank denom-metadata-by-query-string --denom azetaphy -o json | jq .metadata.symbol     # "ZTPHY"
zetaphyd q gov params -o json | jq .params.voting_period                                          # "120h0m0s"
zetaphyd q feemarket params -o json | jq .params                                                  # base_fee และ min_gas_price 1000000000
zetaphyd q bank balance <ที่อยู่ของการจัดสรรแต่ละรายการ> azetaphy                                  # ตาม mainnet.env
journalctl -u zetaphyd | grep -i 'start guard\|CONSENSUS FAILURE'                                 # ไม่มีอะไร
```

หยุด ถ้าค่าใดต่างจาก genesis ที่เผยแพร่

## 14. Vote key ของ validator [เปลี่ยนเชน]

```bash
zetaphyd tx pq-vote-key --from validator --keyring-backend file --keyring-dir ~/.zetaphy-keys --home ~/.zetaphy \
  --chain-id zetaphy_3659-1 --gas 600000 --gas-prices 1000000000azetaphy -y -o json | jq '{code, txhash}'   # code 0
```

สำรอง `~/.zetaphy/config/pq_vote_key.seed` แบบ offline คู่กับ `priv_validator_key.json`

## 15. ตรวจผู้มีสิทธิ์ circuit และ constitution [อ่าน] [เปลี่ยนเชน]

1. Constitution ปฏิเสธ proposal ที่ทำให้โหวตสั้นลง (ถูกปฏิเสธก่อนเข้าบล็อก ไม่เสียอะไร): สร้าง proposal
   `/cosmos.gov.v1.MsgUpdateParams` จาก `q gov params` โดยตั้ง `voting_period` เป็น `600s` แล้วส่งด้วย `tx gov submit-proposal`
   ควรเห็น `constitution is in force`
2. คีย์เดี่ยวตัด breaker ไม่ได้: `zetaphyd tx circuit trip /cosmos.bank.v1beta1.MsgSend --from validator …` ได้ code 4,
   `only governance or the circuit authority can trip or reset the circuit breaker`
3. ซ้อม (ก่อนประกาศเชน): multisig ตัด `MsgSend`, การโอนล้มเหลวด้วย `is tripped by the circuit breaker`, แล้ว multisig reset
   สมาชิกเซ็นแบบ offline: `tx circuit trip <url> --from circuit-ms --generate-only` (ใส่ field ของข้อความกลับด้วย `jq` แบบที่
   `zetaphy-chain/test-anti-rollback.sh` ทำ), `tx sign … --multisig <ที่อยู่> --sign-mode amino-json` โดยสมาชิกสองคน,
   `tx multisign`, `tx broadcast` ซึ่ง `zetaphy-chain/mainnet/test-make-genesis.sh` ทำแบบนี้ทุกขั้น

หยุด ถ้าข้อ 1 หรือ 2 ผ่าน

## 16. สัญญาที่จ่ายด้วย ZTPHY และส่งสิทธิ์ admin ให้ governance [อ่าน] [เปลี่ยนไฟล์] [เปลี่ยนเชน]

เครื่องมือ: `zetaphy-launch/launch.js --network mainnet` (`src/mainnet.js` อธิบายว่าต่างจากการ launch ของ testnet ตรงไหนและเพราะอะไร)
และ `zetaphy-chain/gov.sh` ซึ่งอยู่ในโหมด mainnet เองบนโหนดที่ pin ไว้ สิ่งที่ launch deploy (ด่าน 8 ของ runbook): guardian multisig;
Neuro (`NeuroControl` + `NeuroJobs`, `ThreatRegistry`, `ThreatReports`); สะพาน Saphan ฝั่ง ZETAPHY (`BridgeGuard` + `BridgeAirlock` +
`NeuroLane`) แบบ**ปิด**; DEX (factory + router ไม่มีโทเคนทดสอบ ไม่เติม pool); `ZetaphyBounty` (เติมเงิน ไม่มีคีย์ admin); แล้วจึง
`ZetaphyTimelock` และการส่งมอบสิทธิ์ Neuro มาก่อนสะพานและ DEX เพราะทั้งสองอ่านค่าจาก Neuro; timelock มาท้ายสุดเพื่อให้ช่วง bootstrap
(deployer เป็น proposer คนเดียวที่ delay ศูนย์ สำหรับ batch ของการส่งมอบเท่านั้น) กินเวลาแค่ไม่กี่นาที ในโหมดนี้ไม่มีของเฉพาะ testnet เลย:
ไม่มี faucet ไม่มี stablecoin ทดสอบหรือ StableGateway ไม่มีราคาตายตัว ไม่มี DLMM ที่ยังไม่ audit ไม่มีตลาด NFT ไม่เขียน config ของเว็บแอป

สิ่งที่ launch บังคับบน mainnet:

- เชนไม่มีค่าตั้งต้น: ต้องมี `--network mainnet` และ `--chain chain.json` (ขั้น 8) และ/หรือ `--pin` + `--genesis` (ไฟล์ pin ของโหนดกับ
  genesis ที่ pin ไว้ ตรวจ sha256) ทุกแหล่งต้องตรงกัน ปฏิเสธ id ของ testnet และปฏิเสธ RPC ที่ตอบ `eth_chainId` ต่างออกไปก่อนเซ็นอะไรเลย
  ทุกธุรกรรมใส่ id นั้น
- ไม่รับคีย์แบบข้อความธรรมดา: `--keystore` (keystore JSON ที่เข้ารหัส สิทธิ์ไฟล์ 600; ถาม passphrase ทางเทอร์มินัล หรือส่งผ่าน pipe ด้วย
  `--passphrase-stdin` ถอดรหัสในหน่วยความจำเท่านั้น) หรือ `--remote-signer` (clef กับ hardware wallet, web3signer, Frame: ตรวจธุรกรรม
  ที่เซ็นแล้วทีละ field ก่อนส่ง) ปฏิเสธ `--key-file`, `ZETAPHY_DEPLOYER_KEY`, `ZETAPHY_DEPLOYER_KEY_FILE`, `ZETAPHY_PASSPHRASE`
  รวมทั้ง `--devnet` และ `--redo`
- ค่าตั้งมาจาก deploy config (`zetaphy-launch/mainnet.example.json`): ปฏิเสธที่อยู่ปลอม key ที่ไม่รู้จัก field ที่ดูเหมือนความลับ delay ของ
  timelock หรือ bounty ต่ำกว่า 48 ชม. โทเคนสะพานที่ชื่อมีคำว่า "test" และ deployer ในบทบาทใดๆ governance, proposer เพิ่มเติม และ
  guardian ที่มีอยู่แล้วต้องมี code ของสัญญา (หรือเป็น `gov`)
- `--dry-run` พิมพ์ทุกสัญญา อาร์กิวเมนต์ของ constructor ทุกการเรียก และ gas กับค่าใช้จ่ายเป็น ZTPHY โดยไม่ส่งและไม่เขียนอะไร
  การรันจริงต้องมี `--confirm-chain <EVM chain id>` ด้วย
- ไฟล์ state (`zetaphy-launch/state/<EVM chain id>.json`) เก็บแค่ที่อยู่ ขั้นที่ล้มเหลวรันต่อด้วย `--resume` ตอนท้ายการส่งมอบให้สิทธิ์ admin
  ทุกอย่างแก่ timelock (delay ≥ 48 ชม. proposer/canceller คือ gov module ใครก็ execute ได้) ให้สวิตช์ฉุกเฉินแก่ guardian multisig
  deployer สละสิทธิ์ แล้ว `verify` ตรวจบนเชนว่าไม่มี EOA และไม่ใช่ deployer ที่ถือสิทธิ์ใดๆ บนสัญญาใดของรอบนี้

### 16.1 คีย์ของ deployer บนเครื่องของมันเอง [เปลี่ยนไฟล์]

คีย์ใหม่ ใช้เฉพาะขั้นนี้ (ด่าน 4) ห้ามอยู่บน M-VAL หรือ M-SENTRY จะเป็น keystore ที่เข้ารหัส:

```bash
cast wallet new ~/zetaphy-deployer          # foundry; ถาม passphrase; พิมพ์ที่อยู่และไฟล์ keystore
chmod 600 ~/zetaphy-deployer/*
```

หรือ hardware wallet ผ่าน clef (Ledger/Trezor เสียบไว้): `clef --chainid 3659 --http` แล้วใช้
`--remote-signer http://127.0.0.1:8550 --signer-method account_signTransaction --signer-address 0x<บัญชีของมัน>` แทน `--keystore`
ด้านล่าง กดยืนยันทุกธุรกรรมบนอุปกรณ์

### 16.2 Deploy config [เปลี่ยนไฟล์]

```bash
cp zetaphy-launch/mainnet.example.json ~/mainnet-deploy.json
```

กรอก: `governance` `"gov"`; `guardianOwners` (3 คนที่ต่างกัน ใช้ hardware wallet; หรือ `guardian` = multisig ที่มีอยู่แล้ว);
`communityFund` (ที่อยู่ของกองทุนชุมชน แบบ 0x ของ zetaphy1…: `zetaphyd debug addr <zetaphy1…>`); `bridge.lockbox`
(`<source chain id>:0x<lockbox>`; ลบ `bridge` ออกถ้ายังไม่ deploy สะพาน); `bounty.committee` ไฟล์นี้มีแต่ค่าสาธารณะ
ที่อยู่ทุกตัวในตัวอย่างเป็นค่าปลอมและถูกปฏิเสธ

### 16.3 Dry run [อ่าน]

คัดลอก `chain.json` (ขั้น 8) มาไว้ข้างกัน แล้ว (`$RPC` = https RPC ของ sentry จากขั้น 12 หรือ `http://127.0.0.1:8545` ผ่าน SSH tunnel ไป M-SENTRY):

```bash
node zetaphy-launch/launch.js --network mainnet --rpc "$RPC" --chain chain.json \
  --deploy-config ~/mainnet-deploy.json --keystore ~/zetaphy-deployer/<ไฟล์ keystore> --dry-run
#   ZETAPHY mainnet zetaphy_3659-1 (EVM chain 3659, genesis sha256 <ค่าที่เผยแพร่>)
#   แผน: ทุก "deploy <Contract>(<argument>=<value>, …)" พร้อม gas ทุกการเรียก แล้ว
#   total: 12 contract(s), about 46 call(s), ~40,000,000 gas … : the deployer needs <N> ZTPHY
#   dry run: nothing signed, nothing sent, no state written
```

บนเครื่องที่มีโหนดที่ pin ไว้ ใส่ `--pin /etc/zetaphy/pinned-chain.env --genesis ~/.zetaphy/config/genesis.json` เพิ่มได้ (ทุกแหล่งต้องตรงกัน)
ตรวจอาร์กิวเมนต์ของ constructor ทุกตัวเทียบกับ deploy config, delay (`delay 172800 s`), `enabled = false  CLOSED` ของ route สะพาน
และต้องไม่มี `Test`, `StableGateway`, `Dlmm` หรือ faucet โผล่มา หยุด ถ้ามีอะไรต่างไป

### 16.4 เติมเงินให้ deployer [เปลี่ยนเชน]

จำนวนที่ dry run พิมพ์ (รวม `fund` ของ bounty แล้ว) จาก liquidity multisig (`zetaphyd debug addr 0x<deployer>` ให้ zetaphy1… ของมัน)
สมาชิกเซ็นแบบ offline เหมือนขั้น 15:

```bash
zetaphyd tx bank send <liquidity multisig zetaphy1…> <deployer zetaphy1…> <N>azetaphy --chain-id zetaphy_3659-1 \
  --gas 200000 --gas-prices 1000000000azetaphy --generate-only > fund.json
zetaphyd tx sign fund.json --multisig <liquidity multisig zetaphy1…> --from <สมาชิก> --sign-mode amino-json --chain-id zetaphy_3659-1 --output-document m1.json   # สมาชิก 2 คน คนละไฟล์
zetaphyd tx multisign fund.json <ชื่อคีย์ multisig> m1.json m2.json --chain-id zetaphy_3659-1 > signed.json
bash zetaphy-chain/gov.sh broadcast signed.json                                                    # บน M-VAL: โหมด mainnet
```

รัน 16.3 อีกครั้ง: `deployer balance` ต้องพอสำหรับ `the deployer needs`

### 16.5 Deploy และส่งมอบสิทธิ์ [เปลี่ยนเชน]

```bash
node zetaphy-launch/launch.js --network mainnet --rpc "$RPC" --chain chain.json \
  --deploy-config ~/mainnet-deploy.json --keystore ~/zetaphy-deployer/<ไฟล์ keystore> --confirm-chain 3659
#   ถาม passphrase ของ keystore; แล้วทีละขั้น: guardian neuro threats reports bridge dex bounty wire timelock handover verify
#   … checked on-chain: N admin role(s) belong to the timelock; no EOA and not the deployer holds a timelock role …
#   … checked on-chain: no EOA and not the deployer 0x… holds a role on any contract of this run; the bridge is closed
```

ถ้าขั้นใดล้มเหลว: แก้สาเหตุแล้วรันคำสั่งเดิมพร้อม `--resume` (ขั้นที่เสร็จแล้วถูกเก็บไว้; ห้ามใช้ `--fresh` บน mainnet เมื่อ deploy สัญญาไปแล้ว)
หยุด ถ้าเห็น `the handover check failed` หรือ `the mainnet check failed`: ห้ามประกาศที่อยู่ใดๆ หาสาเหตุก่อน

### 16.6 ตรวจ แล้วเผยแพร่ที่อยู่ [อ่าน]

```bash
node zetaphy-launch/launch.js --network mainnet --rpc "$RPC" --chain chain.json --deploy-config ~/mainnet-deploy.json \
  --keystore ~/zetaphy-deployer/<ไฟล์ keystore> --check     # อ่านอย่างเดียว: ไม่ถาม passphrase ไม่เซ็นอะไร ใครก็รันได้
cast call --rpc-url "$RPC" <timelock> 'getMinDelay()(uint256)'                                    # 172800
cast call --rpc-url "$RPC" <timelock> 'getRoleMember(bytes32,uint256)(address)' $(cast keccak PROPOSER_ROLE) 0   # 0x7b5Fe22B…3dF2 (gov)
cast call --rpc-url "$RPC" <NeuroControl, ThreatRegistry, BridgeGuard, BridgeAirlock, DEX factory> 'governance()(address)'   # timelock
```

เผยแพร่ `zetaphy-launch/state/3659.json` (มีแต่ที่อยู่) และ verify source ของทุกสัญญา (Sourcify, ด่าน 8)

### 16.7 เลิกใช้ deployer [เปลี่ยนเชน] [เปลี่ยนไฟล์]

ส่งเงินที่เหลือกลับ liquidity pool แล้วทำลาย keystore (หรือล้างบัญชีใน hardware wallet):
`cast send --rpc-url "$RPC" --keystore ~/zetaphy-deployer/<ไฟล์ keystore> <liquidity 0x…> --value <ยอดคงเหลือหักค่า gas>`
แล้ว `shred -u ~/zetaphy-deployer/*` มันไม่มีสิทธิ์ใดเหลืออยู่แล้ว (16.5 ตรวจแล้ว)

### 16.8 Governance บน M-VAL: gov.sh โหมด mainnet

บนโหนดที่ pin ไว้ `gov.sh` อ่าน chain id จาก genesis ที่ pin ไว้ (ตรวจ sha256) ตรวจว่าโหนดให้บริการ chain นั้นก่อนเซ็น ใช้ file keyring ใน
`~/.zetaphy-keys` (`--keyring-backend file|os|ledger`; ปฏิเสธ `test`) ใส่ `min_deposit` เต็มจำนวนของเชน (10,000 ZTPHY) ใน proposal
และปฏิเสธ `airdrop` (เหรียญ faucet ของ testnet)

```bash
bash zetaphy-chain/gov.sh status                                                                 # [อ่าน]
bash zetaphy-chain/gov.sh vote <id> yes --from validator                                         # [เปลี่ยนเชน] file keyring ถาม passphrase
bash zetaphy-chain/gov.sh vote <id> yes --keyring-backend ledger --from <คีย์ ledger>             # [เปลี่ยนเชน] ยืนยันบนอุปกรณ์
bash zetaphy-chain/gov.sh propose-upgrade <name> <height> "<summary>" \
  --from <gov multisig zetaphy1…> --generate-only up.json                                          # [เปลี่ยนไฟล์] ยังไม่เซ็น แล้ว tx sign / multisign
bash zetaphy-chain/gov.sh broadcast signed.json                                                   # [เปลี่ยนเชน]
bash zetaphy-chain/gov.sh invariant-firewall <InvariantFirewall 0x…> --from <proposer>           # [เปลี่ยนเชน] เมื่อ deploy แล้ว (ด้านล่าง)
```

ยังไม่อยู่ในชุด mainnet ของ launch (ค้างอยู่): `InvariantFirewall` (ต้องใช้สัญญา audit ชุด SS1, docs/CHAIN-FIREWALL.md), RewardVault
สำหรับ rewards pool, oracle (ต้องมี pool ของ DEX กับ stablecoin จริง), NeuroIdentity, QuantumWalletFactory, ComputeMarket, ตลาด NFT
และ DLMM แต่ละตัวต้องมีขั้น mainnet ที่ผ่านการรีวิวของตัวเองก่อน deploy ห้ามรันขั้นของ launch แบบ testnet กับ mainnet (มันปฏิเสธเชนนี้อยู่แล้ว)

## 17. เพิ่ม validator [เปลี่ยนการตั้งค่า] [เปลี่ยนเชน]

ผู้ดูแลรายใหม่: ทำขั้น 3 และ 11 บนเครื่องของตัวเองด้วย `genesis.json` และ sha256 ที่เผยแพร่, `PEERS=` sentry, รอ sync แล้วใช้คีย์
file keyring และเงินของตัวเอง: `zetaphyd tx staking create-validator <validator.json> --from <คีย์> --keyring-backend file …`
และขั้น 14 ตั้งแต่ 4 validator ขึ้นไป power cap ของ chain guard (3333 bps) ปฏิเสธการ delegate ที่เกิน 1/3 โครงการจึงย้าย stake
ออกจาก validator ของตัวเอง อัปเดตด่าน 2 ใน runbook เมื่อมี validator เข้าร่วม

## 18. การดูแลระบบ

การเฝ้าดูและแจ้งเตือน (บล็อกที่พลาด, ความสูง, start guard, เหตุการณ์ circuit breaker, แผนอัปเกรด); ห้ามกู้
`priv_validator_state.json` หรือ `zetaphy_sign_state.json` จากสำเนาเก่า; ใช้แต่ release ที่เซ็นแล้ว (`sudo zetaphy-validator update`)

## ประกาศสาธารณะ (สำหรับแอปและเว็บไซต์)

ใส่ข้อความนี้ในที่ที่ผู้ใช้เห็นเครือข่าย (ยังไม่ได้ใส่ใน UI) ประกาศฉบับเต็มของ `zetaphy_3659-1`:
[ZETAPHY-MAINNET-NOTICE.th.md](ZETAPHY-MAINNET-NOTICE.th.md)

> **EN:** ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not
> yet completed an independent external audit. Until more independent validators join and the audit is published,
> the project can halt or change the chain. Use it only with amounts you can afford to lose. Details:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-RUNBOOK.md

> **TH:** ขณะนี้ ZETAPHY mainnet ทำงานบน validator เพียงตัวเดียวที่โครงการ ZETAPHY ดูแลเอง และโค้ดยังไม่ผ่านการตรวจสอบ
> (audit) จากภายนอกที่เป็นอิสระ จนกว่าจะมี validator อิสระเพิ่มและเผยแพร่ผล audit โครงการสามารถหยุดหรือเปลี่ยนแปลงเชนได้
> โปรดใช้เฉพาะจำนวนที่ยอมเสียได้ รายละเอียด:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-RUNBOOK.th.md
