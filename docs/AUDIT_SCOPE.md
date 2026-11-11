# swd-amm — Audit Scope

**Moved.** The audit scope and the full audit package now live in
[`AUDIT_README.md`](../AUDIT_README.md) and [`audit-package/`](../audit-package/)
(2026-11-11):

- Scope = the mainnet build `anchor build -- --features mainnet,v2-only`:
  SWDMM v2 + governance + timelock + Pyth reader, **2,600 nSLOC**, 23 instructions.
  The constant-product (`cp.rs`, `cp_math.rs`) and DLMM (`dlmm.rs`, `dlmm_math.rs`)
  pool types are compiled out (full program: 4,820 nSLOC, 38 instructions).
  → [`audit-package/SCOPE.md`](../audit-package/SCOPE.md)
- Trust model, invariants (with fuzz / Kani evidence), known issues, threat model,
  prior findings (F-1..F-6 and earlier), questions for auditors, error-code and
  instruction tables: see the package index in `AUDIT_README.md`.
- One-command build / test / fuzz / prove: `bash audit-package/tools/verify-all.sh <build|test|fuzz|kani>`.
