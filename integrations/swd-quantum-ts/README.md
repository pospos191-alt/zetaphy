# swd-quantum (TypeScript)

Off-chain library for **SWD Quantum** (`programs/swd_quantum`): quantum-safe
Solana vaults signed with LM-OTS one-time signatures (Winternitz family,
RFC 8554 + NIST SP 800-208, `LMOTS_SHA256_N24_W8`), and the PQ key
commitment registry. Design, threat model, costs: [docs/SWD_QUANTUM.md](../../docs/SWD_QUANTUM.md)
(Thai: [SWD_QUANTUM.th.md](../../docs/SWD_QUANTUM.th.md)).

**UNAUDITED. Not deployed.** Dependencies: `@noble/hashes`; `@solana/web3.js`
1.x as a peer.

```ts
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import * as q from "swd-quantum";

const master = crypto.getRandomValues(new Uint8Array(32)); // BACK THIS UP OFFLINE — it is the vault
const v = q.vaultFromSeed(master, 0, programId);           // v.address = the vault
// open (anyone pays the 0.0015 SOL rent)
tx.add(q.openVaultIx({ payer, id: v.keys.id, key: v.genesisKey, programId }));
// deposit
tx.add(q.depositSolIx({ depositor, vault: v.address, lamports: 1e9, programId }));
tx.add(q.depositTokenIx({ depositor, vault: v.address, mint, from, amount: 100_00000, programId }));
// spend: ALWAYS from the current on-chain state
const state = q.decodeVault((await connection.getAccountInfo(v.address))!.data);
const prep = q.prepareSpendSol({ keys: v.keys, vault: v.address, state, destination, lamports: 5e8, programId });
// prep.instructions = [compute budget, spend_sol]; any fee payer signs the transaction.
```

**One-time-key rule.** After `prepareSpend*` returns, the key `state.seq` is
used. If the transaction does not land, send the **same** instructions again
(new blockhash or fee payer is fine). Never prepare a *different* spend for
the same `seq` — persist the prepared spend before broadcasting.

API: `vaultKeys`, `publicKey`, `sign`, `verify`, `candidateKey`,
`encodeSpendMessage`, `findVaultAddress`, `associatedTokenAddress`,
`decodeVault`, `openVaultIx`, `depositSolIx`, `depositTokenIx`, `spendSolIx`,
`spendTokenIx`, `prepareSpendSol`, `prepareSpendToken`, `spendComputeUnits`;
registry: `mldsaKeyHash`, `pqCommitment`, `findCommitAddress`,
`commitPqKeyIx`, `promotePqKeyIx`, `cancelPqPendingIx`, `decodeCommitment`,
`inForceAt`.

Tests: `npm install && npm test` (node:test). The golden vectors in
`programs/swd_quantum/src/golden_vectors.txt` are checked by both this
library and `cargo test -p swd_quantum`, bit for bit.
