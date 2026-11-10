// SWD AMM web app — network settings.
// ============================================================================
// This is the ONE file to edit when the program goes to mainnet.
// Read README.md / README.th.md ("Switching to mainnet") before changing it.
//
// A network shows up in the Network menu only when it is usable:
//   enabled: true  AND  programId is a real program address  AND  rpc is set.
// Until then mainnet stays greyed out with "coming after the audit".
// Never put a private key or an API secret here: this file is public.
// ============================================================================

export const NETWORKS = {
  devnet: {
    enabled: true,
    // Solana test network: test tokens, no real value.
    cluster: "devnet",                                  // used for explorer links
    rpc: "https://api.devnet.solana.com",
    programId: "3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL", // Anchor.toml [programs.devnet]
    faucet: true,                                       // "Request Devnet SOL" (api/devnet-faucet.js)
    testTokens: true,                                   // shows the "test tokens, no value" banner
    // Optional: the Squads multisig that should hold the upgrade authority.
    // When set, the Trust panel checks that the authority is its vault.
    squadsMultisig: "",
    squadsVaultIndex: 0,
  },

  mainnet: {
    // Stays false until: independent audit passed -> scripts/deploy-mainnet.sh run
    // -> upgrade authority handed to the Squads vault. Then set all four below.
    enabled: false,
    cluster: "mainnet-beta",
    rpc: "",          // a mainnet RPC URL that allows browser calls (e.g. a Helius/Triton/QuickNode URL meant for the web)
    programId: "",    // printed by `bash scripts/deploy-mainnet.sh deploy --execute`; NOT the devnet id
    faucet: false,    // never on mainnet
    testTokens: false,
    squadsMultisig: "", // the Squads multisig account (not the vault) from scripts/deploy-mainnet.sh handover
    squadsVaultIndex: 0,
  },

  // Your own computer (solana-test-validator); offered automatically when the
  // page is opened from 127.0.0.1 / localhost, and always in the menu.
  localnet: {
    enabled: true,
    cluster: "custom",
    rpc: "http://127.0.0.1:8899",
    programId: "3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL", // Anchor.toml [programs.localnet]
    faucet: true,
    testTokens: true,
    squadsMultisig: "",
    squadsVaultIndex: 0,
  },
};

// Shown in the Trust panel (top bar → shield). Keep these honest.
export const PROJECT = {
  name: "SWD AMM",
  sourceUrl: "https://github.com/pospos191-alt/zetaphy/tree/main/programs/swd_amm",
  securityPolicyUrl: "https://github.com/pospos191-alt/zetaphy/blob/main/SECURITY.md",
  // Private vulnerability reports (GitHub). security.txt inside the program, when present, is shown too.
  securityContactUrl: "https://github.com/pospos191-alt/zetaphy/security/advisories/new",
  audit: {
    status: "none",   // "none" | "in-progress" | "passed" — change only when a report is published
    auditor: "",      // e.g. the audit firm's name
    reportUrl: "",    // public link to the report
    // sha256 of the audited program build (from the audit report / scripts/deploy-mainnet.sh build);
    // the Trust panel compares it with the program hash it reads from the chain.
    programSha256: "",
  },
  // Public token checker; it may be slow or down — the app never waits on it to let you trade.
  tokenAuditApi: "https://swd-zetaphy.sawasdeecoin.com/api/audit",
};

const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** true when a network has everything it needs to be offered in the menu */
export function networkUsable(net) {
  return !!(net && net.enabled && PUBKEY_RE.test(net.programId || "") && /^https?:\/\//.test(net.rpc || ""));
}

/** the program id the page should talk to for a network name ("custom" uses devnet's) */
export function programIdFor(name) {
  const net = NETWORKS[name];
  if (networkUsable(net)) return net.programId;
  return NETWORKS.devnet.programId;
}
