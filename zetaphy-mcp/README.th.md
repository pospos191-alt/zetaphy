# @zetaphy/mcp: Neuro ของ ZETAPHY สำหรับผู้ช่วย AI

MCP (Model Context Protocol) server ที่ให้ Claude, Cursor, VS Code และโปรแกรมที่รองรับ MCP ถามได้ว่า "เหรียญนี้ปลอดภัยไหม"
แล้วตอบด้วยผลจาก Neuro เครื่องมือตรวจเหรียญแบบเปิดของ ZETAPHY และผลตัดสินที่บันทึกบนเชน ZETAPHY mainnet คำตอบทุกข้อมาจาก
ZETAPHY คือรายงานที่ Neuro เผยแพร่ และ ZETAPHY mainnet (chain 3659) ไม่ต้องใช้ key ไม่ต้องสมัครบัญชี และอ่านอย่างเดียว
English: [README.md](README.md)

## เครื่องมือ

| เครื่องมือ | ตอบอะไร | แหล่งข้อมูล |
| --- | --- | --- |
| `neuro_token_report` | ระดับความเสี่ยง สัญญาทำอะไรได้บ้าง วันที่ตรวจ ลิงก์รายงานและลิงก์ตรวจสด | `neuro.sawasdeecoin.com/reports/<chain>/<address>/summary.json` |
| `zetaphy_threat_flag` | ที่อยู่นี้ถูกติดธงหรือไม่ และเพราะอะไร | `ThreatRegistry` บน ZETAPHY mainnet |
| `neuro_request_check` | ธุรกรรม ZETAPHY ที่**ยังไม่ได้เซ็น** สำหรับขอให้ตัวรันของ ZETAPHY ตรวจใหม่ (ค่าธรรมเนียมเป็น ZTPHY) | `NeuroJobs` บน ZETAPHY mainnet |
| `neuro_job` | สถานะและผลตัดสินของงานตรวจ | `NeuroJobs` บน ZETAPHY mainnet |
| `neuro_latest_checks` | เหรียญที่ตรวจล่าสุด เลือกเฉพาะระดับความเสี่ยงเดียวได้ | `neuro.sawasdeecoin.com/reports/feed.xml` |

เครือข่ายที่รองรับ: Ethereum (`eth`), BNB Chain (`bsc`), Base (`base`), Arbitrum (`arbitrum`) ทุกเครื่องมืออ่านอย่างเดียว
server ไม่เก็บ key และไม่ส่งธุรกรรมเอง (`neuro_request_check` คืนธุรกรรมให้ผู้ใช้เซ็นในกระเป๋าของตัวเอง)

## วิธีใช้

Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`) และโปรแกรมส่วนใหญ่:

```json
{ "mcpServers": { "zetaphy-neuro": { "command": "npx", "args": ["-y", "@zetaphy/mcp"] } } }
```

Claude Code: `claude mcp add zetaphy-neuro -- npx -y @zetaphy/mcp` ถ้าใช้จาก repo นี้โดยไม่ผ่าน npm:
`node zetaphy-mcp/server.js` ตัวแปร env ที่ตั้งได้: `ZETAPHY_RPC` (ค่าเริ่มต้น `https://rpc.sawasdeecoin.com`) และ `NEURO_ORIGIN`

## เผยแพร่ (เจ้าของโปรเจกต์ทำ)

1. เผยแพร่ `@zetaphy/sdk` ก่อน (`cd zetaphy-sdk && npm publish --access public`) แล้วจึงเผยแพร่ `cd zetaphy-mcp && npm publish --access public`
2. ลงรายชื่อในที่ที่ AI agent ใช้หาเครื่องมือ ทั้งหมดฟรี: MCP Registry ทางการ (ใช้ `mcp-publisher` กับ `mcpName` ใน
   package.json), Smithery, Glama, mcp.so และรายการ `awesome-mcp-servers` (ส่งเป็น pull request)

สัญญาอนุญาต: BUSL-1.1 พร้อม Additional Use Grant สำหรับแอปที่เชื่อมต่อกับ Official ZETAPHY Network (LICENSE)
ผลของ Neuro เป็นการวิเคราะห์โค้ดอัตโนมัติที่ใครก็ตรวจซ้ำได้ ไม่ใช่คำแนะนำการลงทุน
