# @zetaphy/sdk: ZETAPHY's on-chain AI for any app

Add ZETAPHY's Neuro to a wallet, a DEX, a launchpad, a bot or a website in a few lines:
- is a contract flagged?
- what is its Neuro badge?
- request a fresh check.

Everything **runs through ZETAPHY mainnet** (chain 3659):
- the answers are what ZETAPHY's contracts hold;
- a fresh check is a job on ZETAPHY's NeuroJobs, paid in ZTPHY;
- independent runners carry it out, and it is settled when at least 2 of 3 agree.

The SDK has no dependencies. It runs in browsers and in Node 18+.

```js
import { createNeuro } from '@zetaphy/sdk';
const neuro = createNeuro();                                    // ZETAPHY mainnet, public RPC

await neuro.isFlagged({ chainId: 56, address: '0xToken' });     // { flagged: true, reason: 'owner-can-block-transfers' }
await neuro.badge('0xContractOnZetaphy');                       // { uid, reportHash, skill, model, by, time } or null
await neuro.fee();                                              // the ZTPHY (wei) a check costs
await neuro.canCheck('bsc');                                    // NeuroJobs takes checks for BNB Chain right now?

// a fresh check, paid from the user's wallet on ZETAPHY (the SDK switches the wallet to chain 3659 first)
const { id } = await neuro.requestCheck(window.ethereum, { chain: 'bsc', address: '0xToken' });
const job = await neuro.waitForJob(id);                         // { status: 'done', verdict: '0x…', … }
```

| Function | What it returns | Network |
|---|---|---|
| `isFlagged({ chainId, address })` | `{ flagged, reason }` from ThreatRegistry | read from ZETAPHY |
| `isCodeFlagged(codeHash)` | the same, for EVM code by its hash | read from ZETAPHY |
| `badge(address)` | NeuroAttest's attestation of a ZETAPHY contract, or `null` | read from ZETAPHY |
| `fee()`, `canCheck(chain)` | the minimum fee; whether a chain is accepted and Neuro is not paused | read from ZETAPHY |
| `requestTx({ chain, address })` | `{ to, data, value, chainId }` for any wallet library | build only |
| `requestCheck(provider, { chain, address })` | `{ id, hash }` once the request is in a ZETAPHY block | sends one transaction on ZETAPHY |
| `getJob(id)`, `waitForJob(id)` | `status`, the agreed `verdict` hash, commits and reveals | read from ZETAPHY |

`reason` is one of:
- `cannot-sell-in-simulation`
- `unlimited-mint`
- `owner-can-block-transfers`
- `owner-can-move-holder-funds`
- `same-name-as-known-token`
- `sweeps-approved-tokens`
- `other`

**Not flagged does not mean safe.** It only means ZETAPHY's runners have not flagged it. Show it as "no warning from Neuro", never as "safe".

## Licence: free to use, through ZETAPHY
The code is under the Business Source License 1.1 (`LICENSE` at the repository root). Its Additional Use Grant lets anyone build, run and offer apps, bots, tools and services **that connect to an Official ZETAPHY Network**, in production and for free.

Using Neuro's code to run a separate network, or a competing service that does not go through ZETAPHY, needs a commercial licence from the Licensor.

On 2030-10-24 the code becomes GPL-2.0-or-later.
