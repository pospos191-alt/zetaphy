#!/usr/bin/env bash
# One entry point for the auditor: build, test, fuzz, prove.
#
#   bash audit-package/tools/verify-all.sh build   # anchor build (mainnet,v2-only) + sha256 + IDL check
#   bash audit-package/tools/verify-all.sh test    # cargo tests (both feature sets) + localnet TS suites
#   bash audit-package/tools/verify-all.sh fuzz    # fuzz regression + exhaustive + LiteSVM stateful run
#   bash audit-package/tools/verify-all.sh kani    # the 6 completing Kani proofs (~6 min)
#   bash audit-package/tools/verify-all.sh all     # all of the above (~25-40 min, first build longest)
#
# Needs: Solana CLI 3.1.10, Anchor 0.31.1, Rust stable (>= 1.97.1 for LiteSVM), Node 20 + yarn,
# and for `kani`: cargo install --locked kani-verifier && cargo kani setup.
# Uses a local solana-test-validator on RPC_PORT (default 8899); no mainnet access needed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

build() {
  step "anchor build --features mainnet,v2-only (the audited binary)"
  anchor build -p swd_amm -- --features mainnet,v2-only
  sha256sum target/deploy/swd_amm.so
  ls -l target/deploy/swd_amm.so
  python3 - <<'PY'
import json
n = {i["name"] for i in json.load(open("target/idl/swd_amm.json"))["instructions"]}
assert len(n) == 23 and "swap" not in n and "initialize_pool" not in n, sorted(n)
print("IDL: 23 instructions, no CP/DLMM")
PY
  python3 audit-package/tools/nsloc.py --v2-only
  python3 audit-package/tools/gen_tables.py --check
}

test_() {
  [ -f node_modules/.yarn-integrity ] || yarn install --frozen-lockfile
  step "cargo test (full build, then v2-only)"
  cargo test -p swd_amm
  cargo test -p swd_amm --features v2-only
  step "mainnet,v2-only binary: v2-only suite (24 h timelock enforced)"
  anchor build -p swd_amm -- --features mainnet,v2-only
  SWD_MAINNET_BUILD=1 scripts/localnet-test.sh tests/v2-only.ts
  step "v2-only binary (5 s timelock): v2 + governance + security suites"
  anchor build -p swd_amm -- --features v2-only
  scripts/localnet-test.sh tests/v2-only.ts tests/swdmm_v2.ts tests/security-review.ts
}

fuzz() {
  step "fuzz regression: corpus + crash reproducers + seeded runs + exhaustive small domains"
  SWD_FUZZ_CASES="${SWD_FUZZ_CASES:-30000}" cargo test --release --manifest-path programs/swd_amm/fuzz/Cargo.toml -- --nocapture
  step "LiteSVM stateful differential fuzz of the built v2-only .so"
  anchor build -p swd_amm -- --features v2-only   # the harness uses a 5 s timelock (not the mainnet bound)
  SWD_SVM_SEEDS="${SWD_SVM_SEEDS:-150}" SWD_SVM_STEPS="${SWD_SVM_STEPS:-150}" \
    cargo test --release --manifest-path programs/swd_amm/litesvm/Cargo.toml -- --nocapture
}

kani() {
  step "Kani proofs"
  (cd programs/swd_amm/kani && cargo kani)
}

case "${1:-}" in
  build) build ;;
  test) test_ ;;
  fuzz) fuzz ;;
  kani) kani ;;
  all) build; test_; fuzz; kani ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
