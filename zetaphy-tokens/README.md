# zetaphy-tokens

The ZETAPHY token registry: one folder per verified token made on ZETAPHY (`3659/<address>/`: `info.json`, `logo.svg`,
`source.json`, `signature.json`) and `tokenlist.json`, built from the entries that pass. How to add a token, in 5 steps:
[docs/TOKEN-REGISTRY.md](../docs/TOKEN-REGISTRY.md) ([ภาษาไทย](../docs/TOKEN-REGISTRY.th.md)). CI re-checks every entry
against the chain (`.github/workflows/token-registry.yml`).

Maintainers, after merging an entry: `cd zetaphy-explorer && npm run build` rewrites `labels.json` so the explorer shows
the token as `SYMBOL (Name) ✓ registry` (the explorer's tests fail while it is stale).
