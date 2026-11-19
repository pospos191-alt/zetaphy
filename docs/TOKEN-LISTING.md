**English** | [ภาษาไทย](TOKEN-LISTING.th.md)

# ZTPHY's token page on an explorer, in 5 steps

The logo, website and description that BscScan / BaseScan show for ZTPHY on their chain. Free; no transaction is sent.
One tool, [`zetaphy-network/scripts/token-listing.js`](../zetaphy-network/scripts/token-listing.js); the values come from
[`token-listing.json`](../zetaphy-network/token-listing.json), the route config and its state file. Run it on Oracle Cloud
Shell in `~/zetaphy/zetaphy-network` (`git pull` first). `--route bsc` or `--route base`.

| Step | Command | What you do |
|---|---|---|
| 1 [อ่าน] | `node scripts/token-listing.js 1 --route bsc` | Checks the bytecode on the chain is the committed one and verifies it on Sourcify. A green tick on the explorer's Contract tab means step 2 is done already. |
| 2 [เปลี่ยนไฟล์] | `node scripts/token-listing.js 2 --route bsc` | Writes the "Verify and Publish" files to `~/verify` and prints the form; fill the explorer's form with them. |
| 3 [อ่าน] | `read -rs PW; export PW; node scripts/token-listing.js 3 --route bsc; unset PW` | Explorer: Verify Address Ownership, owner = the deployer, "sign message manually". Paste the message: the tool signs it with the deployer's keystore (only that explorer's ownership message for that token; anything else is refused). Paste the signature back. |
| 4 [อ่าน] | `node scripts/token-listing.js 4 --route bsc` | Prints every field of the "Token Update" form (logos, e-mail, description, the no-ICO text with the vault, cap and pool). Paste them; send the request once. |
| 5 [อ่าน] | `node scripts/token-listing.js 5 --route bsc` | Checks the logos (32x32 SVG, PNG) and the e-mail are online where the form says. The explorer answers by e-mail (`zetaphy.chain@` arrives in sawasdeecoin@gmail.com) in days to weeks. |

Notes

- If an RPC refuses (403, "could not coalesce"), name another: `BSC_RPC=https://bsc-dataseed.bnbchain.org node scripts/token-listing.js 1 --route bsc`.
- The e-mail must be on the project's domain and listed on the site: it is on every about page (`/about/`).
- Never pay for a "fast" listing; the forms are free. One request per token: sending it again only delays it.
- Done for BNB Smart Chain on 2026-11-19 (contract verified, ownership verified, Token Update sent).
