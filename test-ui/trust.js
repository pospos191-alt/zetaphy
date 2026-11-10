// Trust panel: lets anyone check, from the chain itself, who controls the
// SWD AMM program — not just take this website's word for it.
// Reads: the program account -> its ProgramData (upgrade authority, last
// deploy slot, the deployed bytes -> SHA-256 + embedded security.txt), the
// program's GlobalConfig (pool-creation pause, governance authority), the
// timelock settings, the RPC's genesis hash (which cluster it really is) and,
// when config.js names one, the Squads multisig that should own the authority.
// The byte parsers below are pure functions (tests/trust.test.mjs).

export const BPF_UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const SQUADS_V4_PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
export const GENESIS = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet",
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG": "devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
};
const PROGRAMDATA_HEADER = 45; // u32 tag(3) + u64 slot + Option<Pubkey>(1 + 32)

const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => BigInt(u32(b, o)) | (BigInt(u32(b, o + 4)) << 32n);
const i64 = (b, o) => BigInt.asIntN(64, u64(b, o));
const u16 = (b, o) => b[o] | (b[o + 1] << 8);

/** Upgradeable-loader Program account -> the ProgramData address bytes (tag 2), else null. */
export function parseProgramAccount(bytes) {
  if (!bytes || bytes.length < 36 || u32(bytes, 0) !== 2) return null;
  return { programData: bytes.slice(4, 36) };
}

/** Upgradeable-loader ProgramData account (tag 3) -> { slot, authority (32 bytes | null), elf }. */
export function parseProgramData(bytes) {
  if (!bytes || bytes.length < PROGRAMDATA_HEADER || u32(bytes, 0) !== 3) return null;
  const hasAuth = bytes[12] === 1;
  return {
    slot: u64(bytes, 4),
    authority: hasAuth ? bytes.slice(13, 45) : null,
    elf: bytes.slice(PROGRAMDATA_HEADER),
  };
}

/** The deployed account is padded with zeros past the program's end; hash only the program. */
export function trimTrailingZeros(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.slice(0, end);
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** solana-security-txt block embedded in a program binary -> { name, contacts, … } | null. */
export function parseSecurityTxt(bytes) {
  const BEGIN = "=======BEGIN SECURITY.TXT V1=======\0";
  const END = "=======END SECURITY.TXT V1======="; // its own trailing NUL may be cut by trimTrailingZeros
  const enc = (s) => new TextEncoder().encode(s);
  const find = (needle, from = 0) => {
    outer: for (let i = from; i <= bytes.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  };
  const b = enc(BEGIN), e = enc(END);
  const start = find(b);
  if (start < 0) return null;
  const stop = find(e, start + b.length);
  if (stop < 0) return null;
  const parts = new TextDecoder().decode(bytes.slice(start + b.length, stop)).split("\0");
  const out = {};
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) out[parts[i]] = parts[i + 1];
  return Object.keys(out).length ? out : null;
}

/** swd_amm GlobalConfig: 8 discriminator + governance(32) + emergency(32) + paused(bool) + bump. */
export function parseGlobalConfig(bytes) {
  if (!bytes || bytes.length < 8 + 32 + 32 + 1) return null;
  return { governance: bytes.slice(8, 40), emergency: bytes.slice(40, 72), poolCreationPaused: bytes[72] === 1 };
}

/** swd_amm GovernanceSettings (SWDMM v2 timelock): 8 + timelock_delay_secs(i64) + protocol_fee_share_bps(u16) + treasury(32) + … */
export function parseGovernanceSettings(bytes) {
  if (!bytes || bytes.length < 8 + 8 + 2 + 32) return null;
  return { timelockSecs: Number(i64(bytes, 8)), protocolFeeShareBps: u16(bytes, 16), treasury: bytes.slice(18, 50) };
}

/** Squads v4 Multisig account -> { threshold, timeLock, members } (layout of squads-protocol/v4 state/multisig.rs). */
export function parseSquadsMultisig(bytes) {
  try {
    if (!bytes || bytes.length < 100) return null;
    let o = 8 + 32 + 32; // discriminator, create_key, config_authority
    const threshold = u16(bytes, o); o += 2;
    const timeLock = u32(bytes, o); o += 4;
    o += 8 + 8; // transaction_index, stale_transaction_index
    o += bytes[o] === 1 ? 33 : 1; // rent_collector: Option<Pubkey>
    o += 1; // bump
    const members = u32(bytes, o);
    if (threshold < 1 || members < 1 || members > 1000 || threshold > members) return null;
    return { threshold, timeLock, members };
  } catch {
    return null;
  }
}

/**
 * How much control one party has over the program.
 * immutable  — no upgrade authority: nobody can change the code
 * squads     — the configured Squads multisig's vault holds it (checked on chain)
 * pda        — an off-curve address (a program-controlled vault, e.g. Squads) that config.js does not name
 * single     — an ordinary wallet key: one person can replace the program
 */
export function classifyAuthority({ authority, isOnCurve, squadsVault }) {
  if (!authority) return "immutable";
  if (squadsVault && squadsVault === authority) return "squads";
  return isOnCurve ? "single" : "pda";
}

/** Reads everything the panel shows. Every step is independent: one failure never hides the rest. */
export async function readTrust({ connection, PublicKey, programId, network, project, squadsMultisig, squadsVaultIndex = 0, computeHash = true }) {
  const r = { programId, network, errors: [] };
  const pid = new PublicKey(programId);
  const pda = (seeds, prog = pid) => PublicKey.findProgramAddressSync(seeds, prog)[0];
  const step = async (name, fn) => { try { await fn(); } catch (e) { r.errors.push(`${name}: ${e?.message || e}`); } };

  await step("genesis", async () => {
    const g = await connection.getGenesisHash();
    r.genesis = g;
    r.cluster = GENESIS[g] || "other";
  });

  await step("program", async () => {
    const acc = await connection.getAccountInfo(pid);
    if (!acc) { r.deployed = false; return; }
    r.deployed = true;
    r.executable = !!acc.executable;
    const loader = acc.owner?.toBase58?.() || String(acc.owner);
    r.loader = loader;
    if (loader !== BPF_UPGRADEABLE_LOADER) { r.authorityKind = "immutable"; r.loaderNote = "not-upgradeable-loader"; return; }
    const parsed = parseProgramAccount(new Uint8Array(acc.data));
    if (!parsed) return;
    const pdAddr = new PublicKey(parsed.programData);
    r.programData = pdAddr.toBase58();
    const pd = await connection.getAccountInfo(pdAddr);
    const pdp = pd && parseProgramData(new Uint8Array(pd.data));
    if (!pdp) return;
    r.lastDeploySlot = Number(pdp.slot);
    r.authority = pdp.authority ? new PublicKey(pdp.authority).toBase58() : null;
    let squadsVault = null;
    if (squadsMultisig) {
      try {
        const ms = new PublicKey(squadsMultisig);
        squadsVault = pda([new TextEncoder().encode("multisig"), ms.toBytes(), new TextEncoder().encode("vault"), Uint8Array.of(squadsVaultIndex)], new PublicKey(SQUADS_V4_PROGRAM)).toBase58();
        r.squadsVault = squadsVault;
        const msAcc = await connection.getAccountInfo(ms);
        if (msAcc && (msAcc.owner?.toBase58?.() || String(msAcc.owner)) === SQUADS_V4_PROGRAM) r.squads = parseSquadsMultisig(new Uint8Array(msAcc.data));
      } catch (e) { r.errors.push(`squads: ${e?.message || e}`); }
    }
    r.authorityKind = classifyAuthority({ authority: r.authority, isOnCurve: r.authority ? PublicKey.isOnCurve(new PublicKey(r.authority).toBytes()) : false, squadsVault });
    const elf = trimTrailingZeros(pdp.elf);
    r.programSize = elf.length;
    r.securityTxt = parseSecurityTxt(elf);
    if (computeHash && globalThis.crypto?.subtle) {
      r.programSha256 = await sha256Hex(elf);
      const want = String(project?.audit?.programSha256 || "").toLowerCase();
      if (want) r.hashMatchesAudit = want === r.programSha256;
    }
  });

  await step("governance", async () => {
    const acc = await connection.getAccountInfo(pda([new TextEncoder().encode("global-config")]));
    const g = acc && parseGlobalConfig(new Uint8Array(acc.data));
    r.governanceInitialized = !!g;
    if (g) {
      r.poolCreationPaused = g.poolCreationPaused;
      r.governanceAuthority = new PublicKey(g.governance).toBase58();
    }
  });

  await step("timelock", async () => {
    const acc = await connection.getAccountInfo(pda([new TextEncoder().encode("gov_settings")]));
    const s = acc && parseGovernanceSettings(new Uint8Array(acc.data));
    if (s) r.timelockSecs = s.timelockSecs;
  });
  return r;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https:\/\//.test(String(u || "")) ? esc(u) : "");

/**
 * HTML for the panel. `t(key, vars)` is the page's translator; `explorer(addr)` builds an explorer link.
 * level on each row: ok | warn | bad | info (colour only — the text always says it in words).
 */
export function renderTrust(r, { t, explorer, project, expectedCluster, mainnetLive }) {
  const rows = [];
  const row = (label, value, level = "info") => rows.push(`<div class="tr-row tr-${level}"><div class="tr-k">${label}</div><div class="tr-v">${value}</div></div>`);
  const addr = (a) => `<a class="tr-addr" href="${esc(explorer(a))}" target="_blank" rel="noopener">${esc(a)}</a>`;

  if (r.cluster) {
    const names = { mainnet: "Mainnet", devnet: "Devnet", testnet: "Testnet", other: t("trClusterOther") };
    const ok = !expectedCluster || expectedCluster === r.cluster || expectedCluster === "custom" || expectedCluster === "localnet";
    row(t("trGenesis"), ok ? esc(names[r.cluster]) : esc(t("trGenesisMismatch", { actual: names[r.cluster], expected: expectedCluster })), ok ? "info" : "bad");
  }
  row(t("trProgram"), addr(r.programId));
  if (r.deployed === false) {
    row(t("trStatus"), esc(t("trNotDeployed")), "bad");
  } else if (r.deployed) {
    const kind = r.authorityKind;
    const text = {
      immutable: t("trAuthImmutable"),
      squads: r.squads ? t("trAuthSquads", { threshold: r.squads.threshold, members: r.squads.members }) : t("trAuthSquadsNoInfo"),
      pda: t("trAuthPda"),
      single: t("trAuthSingle"),
    }[kind] || "—";
    const level = { immutable: "ok", squads: "ok", pda: "warn", single: "bad" }[kind] || "info";
    row(t("trUpgradeAuth"), `${esc(text)}${r.authority ? `<br>${addr(r.authority)}` : ""}`, level);
    if (r.lastDeploySlot != null) row(t("trLastDeployed"), esc(r.lastDeploySlot.toLocaleString()));
    if (r.programSha256) {
      let extra = "";
      if (r.hashMatchesAudit === true) extra = `<br><b>${esc(t("trHashMatch"))}</b>`;
      if (r.hashMatchesAudit === false) extra = `<br><b>${esc(t("trHashMismatch"))}</b>`;
      row(t("trProgramHash"), `<code class="tr-hash">${esc(r.programSha256)}</code>${extra}<div class="tr-sub">${esc(t("trHashHint"))}</div>`, r.hashMatchesAudit === false ? "bad" : r.hashMatchesAudit ? "ok" : "info");
    }
  }

  const a = project?.audit || {};
  if (a.status === "passed") {
    const link = safeUrl(a.reportUrl) ? ` · <a href="${safeUrl(a.reportUrl)}" target="_blank" rel="noopener">${esc(t("trAuditReport"))}</a>` : "";
    row(t("trAudit"), esc(t("trAuditPassed", { auditor: a.auditor || "?" })) + link, "ok");
  } else if (a.status === "in-progress") {
    row(t("trAudit"), esc(t("trAuditProgress")), "warn");
  } else {
    row(t("trAudit"), esc(t("trAuditNone")), "warn");
  }

  if (r.governanceInitialized === false) row(t("trGovPause"), esc(t("trGovNotInit")), "warn");
  else if (r.governanceInitialized) {
    row(t("trGovPause"), esc(r.poolCreationPaused ? t("trGovPaused") : t("trGovActive")), r.poolCreationPaused ? "warn" : "ok");
    if (r.governanceAuthority) row(t("trGovAuthority"), addr(r.governanceAuthority));
  }
  if (r.timelockSecs != null) row(t("trTimelock"), esc(t("trTimelockValue", { h: (r.timelockSecs / 3600).toFixed(r.timelockSecs % 3600 ? 1 : 0) })));

  const st = r.securityTxt;
  if (st) {
    const bits = ["name", "contacts", "policy", "source_code", "auditors"].filter((k) => st[k]).map((k) => `<div><span class="tr-sub">${esc(k)}:</span> ${esc(st[k])}</div>`);
    row(t("trSecurityTxt"), bits.join(""));
  } else if (r.deployed) {
    row(t("trSecurityTxt"), esc(t("trSecurityTxtNone")));
  }
  if (safeUrl(project?.sourceUrl)) row(t("trSource"), `<a href="${safeUrl(project.sourceUrl)}" target="_blank" rel="noopener">${esc(project.sourceUrl.replace(/^https:\/\//, ""))}</a>`);
  if (safeUrl(project?.securityContactUrl)) row(t("trContact"), `<a href="${safeUrl(project.securityContactUrl)}" target="_blank" rel="noopener">${esc(t("trContactLink"))}</a>`);
  if (!mainnetLive) row("Mainnet", esc(t("trMainnetSoon")), "warn");
  const errs = r.errors?.length ? `<div class="tr-err">${esc(t("trError", { e: r.errors.join(" · ") }))}</div>` : "";
  return `<div class="tr-list">${rows.join("")}</div>${errs}`;
}
