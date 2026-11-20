**English** | [ภาษาไทย](TOKEN-REGISTRY.th.md)

# The ZETAPHY token registry: verify a token made on ZETAPHY, in 5 steps

Anyone who made a token on ZETAPHY (chain 3659) can give it a name, a logo and a **verified** mark on the explorer
(`explorer.sawasdeecoin.com`) and in [`zetaphy-tokens/tokenlist.json`](../zetaphy-tokens/tokenlist.json) (the Uniswap
token-list format that wallets and DEX front ends read). Free, no account, no server: the entry is a folder in this
repository, sent as a pull request, and CI re-checks it against the chain. Tool:
[`zetaphy-network/scripts/token-registry.js`](../zetaphy-network/scripts/token-registry.js).

Setup once: `git clone https://github.com/pospos191-alt/zetaphy && cd zetaphy/zetaphy-network && npm ci`.

| Step | Command | What it proves |
|---|---|---|
| 1 [อ่าน] | `node scripts/token-registry.js 1 0xTOKEN` | The token exists on ZETAPHY; prints its name, symbol, decimals, supply, owner(). |
| 2 [อ่าน] | `node scripts/token-registry.js 2 0xTOKEN --input std.json --contract src/My.sol:My --compiler v0.8.26+commit.8a97fa7a` | The source compiles to exactly the code on chain (runtime and constructor). `std.json` is the standard-JSON input you compiled with (Remix "Compilation details", Hardhat `artifacts/build-info`, Foundry `forge verify-contract --show-standard-json-input`). |
| 3 [อ่าน] | `read -rs PW; export PW; node scripts/token-registry.js 3 0xTOKEN --info info.json --logo logo.svg --keystore key.json; unset PW` | The **creator** (the sender of the creation transaction) or the token's `owner()` signs the entry offline: the token, the hash of `info.json` and of the logo. Writes `signature.json`. |
| 4 [เปลี่ยนไฟล์] | `node scripts/token-registry.js 4 0xTOKEN --info info.json --logo logo.svg --input std.json --contract src/My.sol:My --signature signature.json` then `node scripts/token-registry.js list` | Writes `zetaphy-tokens/3659/0xTOKEN/` and runs every check; `list` adds it to `tokenlist.json`. Open a pull request with both. |
| 5 [อ่าน] | `node scripts/token-registry.js 5 0xTOKEN` (or `5 all`) | Every check again, exactly as CI (`.github/workflows/token-registry.yml`) runs it. Merged = shown on the explorer as `SYMBOL (Name) ✓ registry`. |

## info.json

```json
{
  "address": "0xTOKEN",
  "name": "Mango Coin",
  "symbol": "MANGO",
  "decimals": 18,
  "website": "https://mango.example.org",
  "description": "What the token is for, 20-500 characters.",
  "creationTx": "0x…the transaction that created the token",
  "links": { "x": "https://x.com/…", "telegram": "https://t.me/…", "github": "https://github.com/…" }
}
```

`name`, `symbol` and `decimals` must be what the token itself returns. Refused: names or symbols imitating ZTPHY,
ZETAPHY, BZTPHY or well-known tokens (USDT, USDC, ETH, BTC, BNB …), promises of profit, non-https links.

## logo.svg

`width="32" height="32"` on `<svg>`, at most 20 KB, static: no script, no embedded or external image, no animation,
no event attributes, only `#local` references. The signature covers the logo's exact bytes.

## What "verified" means, and what it does not

It means: the published source is the code on chain, the creator (or owner) asked for this entry, and the name and logo
are theirs. It does **not** mean the token is safe or worth anything: an owner can still mint, pause or block if the
code lets it. The explorer's Neuro check reads what the owner can do; read it before you buy.
