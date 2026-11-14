# Wallet listings (ready to submit)

## Mainnet `zetaphy_3659-1` (EVM 3659)

- `chainlist/eip155-3659.json` → ethereum-lists/chains `_data/chains/` (chainlist.org)
- `keplr/zetaphy_3659.json` → chainapsis/keplr-chain-registry `cosmos/`; `keplr/images/zetaphy_3659/*.png` → its `images/zetaphy_3659/`
- `cosmos-chain-registry/zetaphy/` → cosmos/chain-registry `zetaphy/` (chain.json, assetlist.json, images; used by Leap, Cosmostation,
  Mintscan and most Cosmos apps; checked against that repo's chain.schema.json and assetlist.schema.json)

Public RPC: https://129-221-199-191.sslip.io (EVM JSON-RPC at `/`, CometBFT at `/rpc`, REST at `/rest`, through rpc-guard). Check that each path
answers before submitting (`curl -s https://129-221-199-191.sslip.io/rpc/status`, `curl -s https://129-221-199-191.sslip.io/rest/cosmos/base/tendermint/v1beta1/node_info`).

## Testnet `zetaphy_77390-1`: shut down 2026-11-14

The testnet was shut down for good on 2026-11-14 (owner decision); mainnet is the only network. Do not submit its files
(`chainlist/eip155-77390.json`, `keplr/zetaphy_77390.json`): its RPC (https://rpc.sawasdeecoin.com) no longer answers, so
the registries would reject them. They stay here as a record only.

ไทย: testnet ปิดถาวรเมื่อ 2026-11-14 ตอนนี้มีเพียง mainnet เครือข่ายเดียว อย่าส่งไฟล์ของ testnet ไปยัง registry (RPC ไม่ตอบแล้ว)
