# Wallet listings (ready to submit)

## Mainnet `zetaphy_3659-1` (EVM 3659)

- `chainlist/eip155-3659.json` → ethereum-lists/chains `_data/chains/` (chainlist.org)
- `keplr/zetaphy_3659.json` → chainapsis/keplr-chain-registry `cosmos/`; `keplr/images/zetaphy_3659/*.png` → its `images/zetaphy_3659/`
- `cosmos-chain-registry/zetaphy/` → cosmos/chain-registry `zetaphy/` (chain.json, assetlist.json, images; used by Leap, Cosmostation,
  Mintscan and most Cosmos apps; checked against that repo's chain.schema.json and assetlist.schema.json)

Public RPC: https://129-221-199-191.sslip.io (EVM JSON-RPC at `/`, CometBFT at `/rpc`, REST at `/rest`, through rpc-guard). Check that each path
answers before submitting (`curl -s https://129-221-199-191.sslip.io/rpc/status`, `curl -s https://129-221-199-191.sslip.io/rest/cosmos/base/tendermint/v1beta1/node_info`).

## Testnet `zetaphy_77390-1`


- `chainlist/eip155-77390.json` → ethereum-lists/chains `_data/chains/` (chainlist.org; chain ID 77390 was free on 22 Oct 2026)
- `keplr/zetaphy_77390.json` → chainapsis/keplr-chain-registry `cosmos/`; `keplr/images/zetaphy_77390/*.png` → its `images/zetaphy_77390/`

Both registries check that the RPC answers, so submit while https://rpc.sawasdeecoin.com is up.
