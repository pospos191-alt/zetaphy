# ZETAPHY launch kit

Thai guide: [LAUNCH-KIT.th.md](LAUNCH-KIT.th.md). The posts below are ready to copy. The owner posts them; nothing here is posted automatically.

**Facts every post may use (and nothing beyond them)**
- ZETAPHY is a **testnet** Layer 1: Cosmos SDK + EVM (cosmos/evm).
  - EVM chain ID 77390.
  - Cosmos chain ID `zetaphy_77390-1`.
- **Quantum-safe:** ML-DSA-44 (FIPS 204) signatures, post-quantum block finality certificates, accounts that only accept post-quantum keys.
- **Neuro:** 35 AI features in 8 groups. They run in the browser, on chain and across chains.
- **Saphan bridge:** proof-checked releases, an escape hatch, Bitcoin SPV, proof of reserves, intents, bundles, ML-KEM sealed orders, offline transfers, privacy pool.
- **Security inside the node:** an invariant firewall (nodes refuse transactions that break a protocol's registered rules), an exploit market, economic bounds and specs-to-proofs.
- **Apps:**
  - app.sawasdeecoin.com (hub)
  - wallet / swap / nft / explorer / neuro .sawasdeecoin.com
- **Code:** github.com/pospos191-alt/zetaphy (open source).
- **Always say:** testnet only; coins have no value; not yet audited by an external firm.

## 0. Before posting (check every box)

- [ ] `https://rpc.sawasdeecoin.com/rpc/status` answers in a browser. The public RPC pauses when the VM nears its free monthly traffic; it reopens on the 1st.
- [ ] app.sawasdeecoin.com shows the latest block (not "–").
- [ ] "Add network" in MetaMask works, and the faucet sends test ZETAPHY.
- [ ] neuro / explorer / swap / nft / wallet open.

More visitors means more RPC traffic. Post when the month has just started, not near its end.

## 1. Chain registries (wallets and lists find the chain by themselves)

| Where | What it gives | State |
|---|---|---|
| ethereum-lists/chains → chainlist.org, chainid.network | "Add to MetaMask" from public lists | The icon is on the fork `pospos191-alt/chains`, branch `add-zetaphy-icon`. The chain file is in `zetaphy-chain/wallets/ethereum-lists/eip155-77390.json`. |
| chainapsis/keplr-chain-registry | ZETAPHY in Keplr's chain list | Prepared on the fork `pospos191-alt/keplr-chain-registry`, branch `zetaphy-testnet`. |
| cosmos/chain-registry (`testnets/`) | Cosmos tools (Cosmos Directory, Skip, etc.) | The files are in `zetaphy-chain/wallets/chain-registry/zetaphytestnet`; a fork is still to be made. |

Their checks call the RPC, so open these pull requests only while the RPC is up. Claude opens them on request (they appear under the owner's GitHub account).

## 2. X (Twitter)

Post 1, with the 4 images from the poster artifact:

> Quantum-safe. Security built in. 🛡️
>
> ZETAPHY is a Layer 1 testnet with:
> • ML-DSA post-quantum signatures + finality
> • 35 AI features (Neuro)
> • 16 bridge safety tools (Saphan)
> • 8 defenses inside the node
>
> Try it free 👇 app.sawasdeecoin.com
> Testnet only · not yet externally audited

Reply 1:

> Why post-quantum now? Keys signed today can be stored and broken later ("harvest now, decrypt later"). ZETAPHY accounts can require ML-DSA (FIPS 204) keys only, and blocks carry post-quantum finality certificates.

Reply 2:

> Security as a chain rule: protocols register their invariants, and every node refuses a transaction that would break them, before it lands in a block. Code + docs: github.com/pospos191-alt/zetaphy

## 3. Hacker News (Show HN)

Title: `Show HN: ZETAPHY – an open-source testnet with post-quantum signatures and an invariant firewall in the node`

> I've been building ZETAPHY, a Cosmos SDK + EVM testnet, to try two ideas:
>
> 1. Post-quantum by default where it matters. Accounts can require ML-DSA-44 (FIPS 204) keys only, blocks carry post-quantum finality certificates, and the built-in wallet signs with ML-DSA.
> 2. Security as a node rule. A protocol registers invariants; nodes check each transaction against them and refuse ones that would break them (docs/CHAIN-FIREWALL.md in the repo).
>
> Around it: an in-browser AI risk checker (Neuro, plain JS, no GPU), a bridge with proof-checked releases and an escape hatch, offline payment cheques, and ZK proof of personhood.
>
> It's a testnet: coins have no value and there has been no external audit yet. Feedback on the firewall design and the PQ account model is very welcome.
>
> App: https://app.sawasdeecoin.com · Code: https://github.com/pospos191-alt/zetaphy

## 4. Reddit

- r/cosmosnetwork, r/ethdev, r/CryptoTechnology, r/QuantumComputing (only the PQ angle).
- Read each subreddit's self-promotion rule first. Post at most one per day.
- Use the Show HN text with a subreddit-specific first line, for example: "A Cosmos EVM chain where accounts can be post-quantum only".

## 5. Telegram / Discord announcement

> 📢 ZETAPHY testnet is open
> Quantum-safe Layer 1 · 35 AI features · Saphan bridge · security inside the node
> 1) Add the network: app.sawasdeecoin.com → "Add network"
> 2) Get free test ZETAPHY from the faucet or by mining in the browser
> 3) Try swap, stake, NFTs and Neuro token checks
> Testnet only, coins have no value, not yet externally audited.

## 6. Thai communities (Facebook groups, LINE OpenChat, Pantip)

> 🛡️ ZETAPHY: บล็อกเชนทดลอง (testnet) ที่ปลอดภัยจากคอมพิวเตอร์ควอนตัม
> • ลายเซ็น post-quantum (ML-DSA มาตรฐาน FIPS 204)
> • AI ตรวจความเสี่ยง 35 ฟีเจอร์ (Neuro) รันในเบราว์เซอร์ ไม่ต้องใช้การ์ดจอ
> • บริดจ์ Saphan ที่มีทางออกฉุกเฉิน และโหนดที่ปฏิเสธธุรกรรมอันตรายเอง
> ลองฟรี: app.sawasdeecoin.com (รับเหรียญทดลองฟรี)
> ⚠️ เป็น testnet เหรียญไม่มีมูลค่า และยังไม่ผ่าน audit จากภายนอก

## 7. Article (dev.to / Medium) outline

1. The problem: signatures made today can be broken later, and audits miss bugs.
2. Post-quantum accounts and finality on a Cosmos EVM chain (what changed in the node, and the cost).
3. The invariant firewall: register, simulate, refuse (with a small example protocol).
4. Neuro in the browser: plain-JS checks, no GPU, verdicts provable with zkML.
5. What is not done yet (external audit, mainnet), and how to help: run a node, try the apps, file issues.

## 8. Grants and testnet programs (one-paragraph description)

> ZETAPHY is an open-source Cosmos SDK + EVM testnet researching post-quantum accounts (ML-DSA, FIPS 204), post-quantum finality, and node-level invariant enforcement for DeFi protocols, with an in-browser AI risk checker and a proof-checked bridge. Everything runs on free infrastructure today; funding would go to an external security audit and to community validators.

Places: Gitcoin Grants rounds, Interchain Foundation / Cosmos ecosystem programs, testnet quest sites (Galxe, Zealy: free tiers).

## 9. One-line entry for "awesome" lists

`- [ZETAPHY](https://github.com/pospos191-alt/zetaphy) - Cosmos SDK + EVM testnet with ML-DSA post-quantum accounts and finality, and a node-level invariant firewall.`

Candidates: awesome-cosmos, awesome-post-quantum, awesome-blockchain-security. Each needs its own pull request, which Claude opens on request.
