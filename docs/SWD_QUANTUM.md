# SWD Quantum — quantum-safe vaults for SWD on Solana

Thai version (for the owner): [SWD_QUANTUM.th.md](SWD_QUANTUM.th.md)

> **Status (2026-11-09): UNAUDITED DRAFT. Not deployed on any cluster.**
> Order: localnet tests (CI) → devnet → **independent audit (including the
> cryptography)** → mainnet with the program made **immutable**. Do not put
> real SWD in a vault before the audit.

Program: `programs/swd_quantum` (Anchor 0.31.1). Off-chain library:
`integrations/swd-quantum-ts` (TypeScript, `@noble/hashes` only, web3.js 1.x
as a peer). Tests: `cargo test -p swd_quantum`, `tests/swd_quantum.ts`
(`anchor test`), `npm test` in the library.

This brings ZETAPHY's quantum-safety design
([future/quantum-safe-settlement.md](future/quantum-safe-settlement.md)) to
Solana: a place where SWD can sit that a quantum computer cannot steal from,
and a QuantumRescue-style pre-commitment for ordinary wallets.

## 1. The problem in plain words

- Every Solana wallet address **is** an Ed25519 public key. A large enough
  quantum computer (Shor's algorithm) can compute the private key from it.
  Nobody can do that today, and nobody knows the year ("Q-day"); public
  estimates keep getting cheaper, and NIST plans for the 2030s.
- On Solana the key is public from the start (it *is* the address), so,
  unlike Bitcoin/Ethereum, "never used" addresses are not safer.
- Hash functions (SHA-256, Keccak) survive quantum computers at today's
  sizes (Grover only halves their bits). Signatures built **only from
  hashes** therefore stay safe.

## 2. What is protected, what is not

| | Protected after Q-day? |
|---|---|
| SOL and tokens **inside an SWD Quantum vault** | **Yes**, if the program is immutable and the seed is kept safe. Only a hash-based one-time signature moves them; no Ed25519 key can. |
| A normal Solana wallet (Phantom, Solflare, a Ledger…) | **No.** It stays Ed25519. Move what you want to keep into a vault before Q-day. |
| The PQ commitment registry entry | It does not protect funds by itself; it is **evidence** that lets SWD/ZETAPHY honour a migration claim later (section 6). |
| A vault while the program still has an upgrade key | **Only as safe as that key** (Ed25519 or a Squads multisig of Ed25519 keys): whoever controls it can replace the program. Make the program immutable before relying on it. |
| Tokens whose mint has a freeze authority | The freeze authority (an Ed25519 key) could **freeze** — not take — vault tokens. Token-2022 mints with a permanent delegate (which *could* take them) are refused at deposit. |
| Solana itself | If quantum computers break validators' keys, the network may halt or fork. A vault protects against key theft, not against the chain failing. |

## 3. How the vault works

**One-time keys (Winternitz / LM-OTS).** A signature reveals intermediate
values of 26 hash chains. Seeing **one** signature does not let anyone sign
anything else (the checksum makes every other message need a chain value
that would have to be un-hashed). Seeing **two different** signatures from
the same key does. So every key signs exactly once.

**Key rotation in place.** The vault stores the *current* one-time public
key K and its index `seq`. Each spend is signed by K over a message that
names the **next** key K′; the program checks the signature, moves exactly
what the message says, and replaces K by K′ (`seq + 1`) in the same
instruction. The vault keeps one stable address.

**Addresses.** Vault PDA = `["swdq-vault", I, K0]`: `I` is a 16-byte
identifier derived from the owner's seed, `K0` the hash of the first
one-time public key. Both are hashes; a quantum attacker gets nothing to
work on.

**Keys from one seed.** One 32-byte master seed gives any number of vaults:

```
I    = SHA256("SWD-QV1/I" || master || u32be(vault_index))[0..16]
SEED = SHA256("SWD-QV1/S" || master || u32be(vault_index))[0..24]
x_q[i] = SHA256(I || u32be(q) || u16be(i) || 0xff || SEED)[0..24]   (RFC 8554 Appendix A)
```

### Instructions

| Instruction | Who signs | What it does |
|---|---|---|
| `open_vault(I, K0)` | any payer (rent) | creates the vault PDA; anyone may open it — the content is fixed by the seeds |
| `deposit_sol(amount)` | depositor | adds SOL (a plain transfer to the vault address works too) |
| `deposit_token(amount)` | depositor | adds SPL / Token-2022 tokens to the vault's associated token account (created on first use, depositor pays); refuses unsafe mints and short arrivals |
| `spend_sol(C, y, amount, K′)` | **one-time signature**; any fee payer | sends lamports to the signed destination; the vault keeps its rent-exempt minimum |
| `spend_token(C, y, amount, flags, K′)` | **one-time signature**; any fee payer | sends tokens from the signed vault token account to the signed destination token account; with flag 1 closes the emptied source **into the vault** |
| `commit_pq_key / promote_pq_key / cancel_pq_pending` | wallet / anyone / wallet | the registry (section 6) |

There is deliberately **no close**: closing would let anyone re-open the
same address with the already-used first key. The vault's rent
(0.0015 SOL) stays in it for good.

### The signed message (254 bytes, fixed layout)

`"SWD-QVAULT-MSG-1"` ‖ action ‖ program id ‖ vault ‖ opened_slot ‖ seq ‖
next key K′ ‖ mint ‖ token program ‖ source ‖ destination ‖ amount ‖ flags
(`programs/swd_quantum/src/message.rs` has offsets). LM-OTS hashes it as
`Q = H(I ‖ u32(seq) ‖ 0x8181 ‖ C ‖ message)`.

### Guards (each has a test)

| Attack | Guard |
|---|---|
| Replay of a used signature | `seq` and K change on every spend; the old next key now equals the current key (`KeyReuse`), and the signature no longer verifies |
| Signature reuse / second signature from one key | in-place rotation; `K′ ≠ K, K0, 0` on chain; the library signs deterministically and only for the on-chain `seq` |
| Message malleability | fixed-length message, every field bound, domain tag; any changed byte of amount, destination, next key, C or a chain value → `BadSignature` |
| Signature for another vault / cluster / earlier vault at the same address | vault address, program id and `opened_slot` are in the message; signed actions need `slot > opened_slot` |
| Wrong mint / wrong token program | mint, token program, source and destination are signed; Anchor constraints tie accounts to mint and program |
| Token-2022 transfer fee, transfer hook, permanent delegate, non-transferable, confidential transfers | deposit: allowlist of extensions (unknown ones refused); spend: active transfer hook refused, and **exact-delta check** (source −amount, destination +amount) → `PartialTransfer` |
| Partial transfers | the same exact-delta check, on deposit too |
| Rent theft | lamports only leave to the signed destination; the vault keeps its rent; token-account rent goes back into the vault |
| Closing to the wrong account | the only close is of an emptied vault token account, and its destination is the vault itself |
| Front-running by an RPC / leader | anyone may submit a signed spend, but it can only do exactly what the owner signed |

### Parameters and why

**LMOTS_SHA256_N24_W8** (RFC 8554 §4 with the SHA-256/192 sets of NIST
SP 800-208, type code 8): n = 24 bytes, w = 8, p = 26 chains.

- **Standardised.** LM-OTS is the one-time layer of LMS, approved by NIST
  (SP 800-208) for exactly this "stateful hash-based signature" use.
- **Security.** 192-bit hashes: ~192-bit classical, ~96-bit generic quantum
  (Grover) preimage security — the strength class of AES-192 key search,
  above ML-DSA-44 (NIST category 2). Every hash is tweaked with I, q, chain
  and step, so attacking many keys at once does not help.
- **Fits one transaction.** Signature = 24 + 26 × 24 = **648 bytes**. A
  token spend is **1064 / 1232 bytes** (168 spare), a SOL spend 964: no
  signature buffer account, no multi-transaction flow, no lookup table.
  W4 would need 51 chains (1248 bytes), N32 (128-bit quantum) 34 × 32 =
  1088 bytes — neither fits with the accounts.
- **Fits the compute budget.** Verification hashes = 255 × (⌊checksum/256⌋
  + 2): 510 … 6375, mean ≈ 3315. The signer grinds the randomizer C (4096
  tries by default, ~20 ms in JS) and typically lands at 2040–2295 hashes.
- **SHA-256 vs Keccak.** Both are Solana syscalls with the same price
  (`sol_sha256` / `sol_keccak256`: 85 CU + 1 CU per 2 bytes). SHA-256 is
  what LMS/XMSS standardise.

**Measured on a local validator (Agave 3.1.10, `tests/swd_quantum.ts`):**

| What | Result |
|---|---|
| CU per chain hash (fit) | ~147 CU, plus ~8k CU fixed (SOL) |
| `spend_sol`, default grind | 307,766 CU (2040 hashes) – 345,251 CU (2295) |
| `spend_sol`, no grind (typical) | 457,707 CU (3060 hashes) – 495,192 CU (3315) |
| worst case (6375 hashes, no grind) | ~945k CU of the 1.4M limit |
| `spend_token` (SPL Token) | 356,208 CU (2295 hashes); with close of the source 286k–324k CU |
| `spend_token` (Token-2022) | 315k–353k CU |
| `deposit_token` incl. ATA creation | 43k–47k CU |
| `commit_pq_key` | 8,241 CU |
| tx size | `spend_sol` 964 B, `spend_token` 1064 B (limit 1232) |

The library requests `152 × hashes + 40k` (SOL) / `+ 80k` (token) CU.

### ML-DSA on Solana: why not (yet)

We measured it instead of guessing (a throwaway SBF probe, not committed):

- **Sizes.** ML-DSA-44 public key 1312 B + signature 2420 B = 3732 B: three
  times the transaction limit, so key and signature must be uploaded into a
  buffer account over ≥ 4 transactions first.
- **Hashing.** ML-DSA uses SHAKE128/256. Solana's syscalls give finished
  SHA-256/Keccak-256 digests, not the Keccak-f permutation or SHAKE, so it
  must run in software: **one Keccak-f[1600] costs ~11,400 CU** in SBF
  (measured: 1 permutation 11.5k, 10 permutations 114k). One ML-DSA-44
  verification needs roughly 100 permutations (ExpandA alone ≈ 80) →
  ~1.1M CU before any NTT arithmetic; with ~13 NTTs and the rest we estimate
  1.5–2M CU, over the 1.4M per-transaction limit.
- **Code.** The RustCrypto `ml-dsa` 0.1.2 crate compiles for SBF but its
  verifier needs a ~95 KB stack frame (SBF allows 4 KB per frame); it
  aborts with an access violation. A rewrite with account-backed buffers,
  split over 2–3 compute transactions plus the uploads, is possible but is a
  large, audit-heavy project.
- **Conclusion.** Feasible only as a multi-transaction, hand-optimised
  verifier (≈ 6–8 transactions per spend). LM-OTS does it in **one
  transaction at ~0.3M CU**. If Solana ever adds an ML-DSA/SHAKE syscall or
  precompile, revisit.

### Prior art

Dean Little's [solana-winternitz-vault](https://github.com/deanmlittle/solana-winternitz-vault)
(and the `solana-winternitz` crate, MIT, Blueshift) showed the approach:
a PDA from the hash of a Winternitz public key, `split` that sends an
amount and moves the remainder to a new vault, then closes the old one. We
studied its design and copied no code. Differences, on purpose:

- **Checksum.** Its signature as studied (32 chains of 8-bit digits of the
  message hash) has no checksum chains. Without a checksum, whoever sees a
  signature can forge any message whose digest bytes are all ≥ the signed
  ones by hashing chains forward — about 2^46 hash trials for a random
  target, an offline GPU job for a malicious RPC that holds back the
  original transaction. LM-OTS has the checksum.
- **In-place rotation** instead of split-and-close: a stable address,
  deposits after a spend are not stranded, any number of mints, no rent
  paid per spend, no re-open-with-used-key hazard.
- **Tokens** (SPL Token and Token-2022), the opened-slot binding, and a
  standard parameter set with a key-generation procedure from one seed.

### Comparison with ZETAPHY's ML-DSA chain

| | ZETAPHY native PQ accounts | SWD Quantum vault on Solana |
|---|---|---|
| Signature | ML-DSA-44 (FIPS 204), many-time | LM-OTS N24_W8 (RFC 8554 / SP 800-208), one-time per key |
| Where verified | chain ante handler / precompile 0x…0900 | inside this program (`sol_sha256`) |
| State the user must keep | the ML-DSA key | the seed; the chain holds `seq` |
| Signature size | 2420 B | 648 B |
| Scope | the whole account, every action | only what is inside the vault |
| Q-day rule | the chain refuses ECDSA from a voted height | none needed: a vault never accepts Ed25519 |

## 4. Rules for users (the seed and the one-time-key rule)

1. **The 32-byte master seed is the vault.** Whoever has it can spend; if
   it is lost, the funds are lost — nobody (not SWD, not ZETAPHY) can
   recover them. Keep it offline, on paper or metal, in two places. It is
   not your Phantom recovery phrase and must not be stored in a browser.
2. **One key, one message.** Once a spend is signed, that exact signature
   is the only thing that may ever be sent for that `seq`. If the
   transaction does not land, **send the same signature again** (any fee
   payer, a new blockhash — the one-time signature does not include the
   blockhash). Never sign a *different* spend for the same `seq`: two
   signatures from one key can be combined into a forgery. The library
   signs deterministically and only for the `seq` it reads from the chain.
3. Always build a spend from the vault's **current** on-chain state.
4. Deposit tokens with `deposit_token` (it refuses mints that are not
   safe for a vault). Tokens of a refused mint sent directly to the vault's
   token account may be impossible to withdraw.

## 5. Costs

| Item | Cost | Who / when |
|---|---|---|
| Vault account (94 B) | **0.00154512 SOL** rent, permanent (never closed) | whoever opens it, once |
| Vault token account per mint | 0.00203928 SOL rent | first depositor; returned **into the vault** when closed by a full withdrawal with flag 1 |
| Each spend | 5,000 lamports base fee + optional priority fee for ~0.31–0.36M CU (e.g. at 10,000 micro-lamports/CU ≈ 0.0000035 SOL) | the fee payer (anyone) |
| PQ commitment record (126 B) | 0.00176784 SOL rent | the wallet, once |
| Program deploy (352 KB) | ≈ 2.45 SOL rent for the program data (plus the same again temporarily for the deploy buffer) | the deployer |

## 6. PQ key commitment registry (QuantumRescue-style)

**What it does.** A wallet signs (with its Ed25519 key, today, while that
key is still trustworthy) `commit_pq_key(c)` with

```
c = keccak256("SWD QuantumCommit v1" || wallet (32) || keccak256(ML-DSA-44 public key, 1312 B) || secret (32))
```

stored in the PDA `["swdq-commit", wallet]`. A new commitment (or a revoke,
`c = 0`) takes effect only **7 days** later (mainnet build; 8 seconds on
devnet/localnet builds so it can be tried); until then the previous one
stays in force. `promote_pq_key` (anyone) tidies a matured change;
`cancel_pq_pending` (the wallet) withdraws one that has not matured. Every
change emits an event (`PqCommitted`, `PqPromoted`, `PqPendingCancelled`).
The key-hash is the same `keccak256(pk)` as ZETAPHY's QuantumRescue.

**What it is for.** After a future Q-day, SWD/ZETAPHY announces a cut-off
time T. For a wallet W, the honoured commitment is the one in force at T
(`PqCommitment::in_force_at(T)` / `inForceAt` in the library, or replaying
the events). A claimant reveals the ML-DSA-44 public key and the secret and
signs a migration message with that ML-DSA key; if the hash matches, the
claim (an airdrop of W's SWD balance at a snapshot, a balance on ZETAPHY, a
QuantumRescue controller) can be honoured **off-chain or on ZETAPHY**.

**What it does NOT do.** It does not move or lock any funds on Solana, does
not verify ML-DSA, and does not stop a quantum attacker from emptying the
normal wallet after Q-day. Its value is: an attacker who breaks W's key
**after** T, or **less than 7 days before** T, cannot replace W's
commitment. An attacker who could break keys secretly long before T could
commit for W too — the events let wallets alert their owners to commitments
they did not make, and the cut-off should be announced early. Keep the
ML-DSA key (its seed) and the secret offline; losing them makes the
commitment worthless.

## 7. Deploy

### Devnet first

```bash
solana-keygen new -o target/deploy/swd_quantum-keypair.json   # never commit it (gitignored)
anchor keys list   # paste swd_quantum's id into Anchor.toml AND declare_id! in programs/swd_quantum/src/lib.rs
anchor build -p swd_quantum
anchor deploy -p swd_quantum --provider.cluster devnet
```

Then with the library: generate a **devnet-only** master seed, open a
vault, deposit devnet SOL and a test mint, make several spends (watch `seq`
and the CU in the explorer), try a commit → wait → promote → rotate →
cancel. Run for at least a week.

### Mainnet (after the independent audit)

1. Build the audited commit with `anchor build -p swd_quantum -- --features mainnet`
   (7-day commitment delay) and record `sha256sum target/deploy/swd_quantum.so`;
   publish a verified build.
2. Deploy, check `solana program show`, then **make it immutable**:
   `solana program set-upgrade-authority <PROGRAM_ID> --final`. Until this
   is done, the vaults are only as quantum-safe as the upgrade key.
   (If upgrades are kept for a while, hold the authority in Squads and say
   so publicly; plan the `--final` date.)
3. Only then announce vaults for real funds, with small limits first.

## 8. Tests

- `cargo test -p swd_quantum` — golden vectors shared with the TS library
  (keys, chains, K0/K1, message bytes, signature, vault PDA, commitment);
  every message byte / C / chain / key index / identifier change breaks
  the signature; the checksum blocks forward forgery (20,000 random digit
  vectors); verification-cost formula and bounds; message layout; the
  commitment in-force rule.
- `integrations/swd-quantum-ts`: `npm test` (node:test) — the same golden
  vectors, tampering, deterministic signing, grinding, instruction layouts,
  transaction sizes, account decoding, `inForceAt`.
- `tests/swd_quantum.ts` (`anchor test`, CI's program job) — open (and the
  second open fails), the opened-slot guard, SOL deposits, spend with an
  unrelated fee payer, replay, malleability of every field, next-key reuse,
  a signature for another vault, the wrong seed, the rent floor, CU across
  grind levels; tokens: deposit with ATA creation, spend, replay, wrong
  mint / destination / token program / source, full withdrawal + close into
  the vault, Token-2022 with metadata pointer (works), transfer fee
  (deposit refused, spend `PartialTransfer`), permanent delegate (refused),
  tx sizes; registry: commit, `NoChange`, promote too early / after the
  delay by a third party, rotation keeps the old one in force, cancel, a
  stranger cannot cancel.
- The LM-OTS code was compared by reading against an independent RFC 8554
  implementation (python-hsslms, type 8). Running it against our vectors is
  left for the auditor (it was not executed in this environment).

## 9. Open risks

- **Unaudited**, including the cryptographic code. Rolled-in-house hash
  chains must be reviewed against RFC 8554 / SP 800-208 by a specialist.
- **Upgrade authority** (section 2): the biggest practical risk until
  `--final`.
- **User error is the main failure mode**: losing the seed, or signing two
  different spends with one key (e.g. a wallet that retries by re-signing).
  Wallet UX must persist "signed for `seq`" before broadcasting.
- 96-bit generic quantum security per hash is below the 128 bits of N32;
  we chose N24 to keep one transaction. An N32 variant would need a
  signature buffer account.
- Freeze authorities on mints (Ed25519) can freeze vault tokens.
- Compute prices or syscall costs could change in a future Solana release;
  the worst case (~0.95M CU) has ~30% headroom, the default grind ~75%.
- The registry is only as useful as the off-chain process that honours it
  after Q-day; that process is not written yet.
