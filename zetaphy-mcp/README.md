# @zetaphy/mcp: ZETAPHY's Neuro for AI assistants

An MCP (Model Context Protocol) server: Claude, Cursor, VS Code and any MCP client can ask "is this token safe?"
and answer with Neuro, ZETAPHY's open token checker, and with ZETAPHY mainnet's on-chain verdicts. Every answer comes
from ZETAPHY: Neuro's published reports and ZETAPHY mainnet (chain 3659). No key, no account, read-only.
ภาษาไทย: [README.th.md](README.th.md)

## Tools

| Tool | What it answers | Source |
| --- | --- | --- |
| `neuro_token_report` | risk level, what the contract allows, the check date, report and live links | `neuro.sawasdeecoin.com/reports/<chain>/<address>/summary.json` |
| `zetaphy_threat_flag` | is the address flagged, and why | ZETAPHY mainnet `ThreatRegistry` |
| `neuro_request_check` | the **unsigned** ZETAPHY transaction that asks ZETAPHY's runners for a fresh check (fee in ZTPHY) | ZETAPHY mainnet `NeuroJobs` |
| `neuro_job` | a check's status and verdict | ZETAPHY mainnet `NeuroJobs` |
| `neuro_latest_checks` | the latest checked tokens, optionally one risk level | `neuro.sawasdeecoin.com/reports/feed.xml` |

Chains: Ethereum (`eth`), BNB Chain (`bsc`), Base (`base`), Arbitrum (`arbitrum`). Every tool is read-only: the
server never holds a key and never sends a transaction (`neuro_request_check` returns it for the user's own wallet).

## Use

Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`) and most clients:

```json
{ "mcpServers": { "zetaphy-neuro": { "command": "npx", "args": ["-y", "@zetaphy/mcp"] } } }
```

Claude Code: `claude mcp add zetaphy-neuro -- npx -y @zetaphy/mcp`. From this repository without npm:
`node zetaphy-mcp/server.js`. Env: `ZETAPHY_RPC` (default `https://rpc.sawasdeecoin.com`), `NEURO_ORIGIN`.

Transport: stdio, one JSON-RPC message per line; protocol versions 2025-06-18, 2025-03-26, 2024-11-05. Tests:
`zetaphy-network/test/mcp.test.js` (the protocol, each tool with the network replaced, and a real child process).

## Publishing (the owner)

1. `@zetaphy/sdk` first (`cd zetaphy-sdk && npm publish --access public`), then `cd zetaphy-mcp && npm publish --access public`.
2. List it where agents look for tools, all free: the official MCP Registry (`mcp-publisher` with the `mcpName`
   in package.json), Smithery, Glama, mcp.so and the `awesome-mcp-servers` list (a pull request).

Licence: BUSL-1.1 with the Additional Use Grant for apps that connect to an Official ZETAPHY Network (LICENSE).
Neuro's results are automated, reproducible code analysis, not investment advice.
