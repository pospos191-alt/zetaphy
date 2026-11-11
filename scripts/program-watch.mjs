#!/usr/bin/env node
// On-chain watch for the swd_amm program (2026-11-11). Read only: no keys, no dependencies (Node 20+ fetch).
//
// For each watched cluster it reads, over plain JSON-RPC, the program account and its ProgramData account:
//   - last deployed slot, upgrade authority (or "none" = immutable)
//   - the executable hash of the deployed bytes (sha256 with the zero padding removed — the same number as
//     `solana-verify get-program-hash` and the "executable_hash" in a program-v* release's release.json)
// and compares them with the latest program-v* GitHub Release (or a pinned hash) and the expected authority.
//
// CRITICAL (exit 1, alert): hash differs from the expected one, authority differs / became immutable,
//                           program missing or not owned by the upgradeable loader.
// NOTICE   (alert once):    redeployed since the last run (slot changed), no release / expected authority to compare.
// WARNING  (no failure):    RPC or GitHub unreachable (public endpoints rate-limit; the next run retries).
//
// Configuration (environment):
//   DEVNET_PROGRAM_ID      default 3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL ("off" disables devnet)
//   DEVNET_RPC_URL         default https://api.devnet.solana.com
//   MAINNET_PROGRAM_ID     set to watch mainnet too
//   MAINNET_RPC_URL        default https://api.mainnet-beta.solana.com
//   EXPECTED_AUTHORITY_DEVNET / EXPECTED_AUTHORITY_MAINNET   upgrade authority that must be on chain
//                          (mainnet: the Squads vault PDA; "none" = must be immutable)
//   EXPECTED_HASH_DEVNET / EXPECTED_HASH_MAINNET   pin an executable hash instead of "latest release" (e.g. after a
//                          rollback to an older release, until a new release is cut)
//   GITHUB_REPOSITORY (default pospos191-alt/zetaphy), GITHUB_API_URL, GITHUB_TOKEN (optional, rate limit)
//   ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID   send alerts to Telegram (optional)
//
// Usage: node scripts/program-watch.mjs [--state <file>] [--json]
// Test:  node --test scripts/program-watch.test.mjs

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const DEFAULT_DEVNET_ID = "3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL";
const PROGRAMDATA_HEADER = 45; // u32 tag + u64 slot + Option<Pubkey> (1 + 32)

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
export function base58decode(str) {
  let n = 0n;
  for (const c of str) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error(`not base58: ${str}`);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of str) { if (c !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

// sha256 of the bytes with trailing zero bytes removed (solana-verify get_binary_hash)
export function executableHash(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return createHash("sha256").update(bytes.subarray(0, end)).digest("hex");
}

export function parseProgramAccount(data) {
  if (data.length < 36 || data.readUInt32LE(0) !== 2) throw new Error("not an upgradeable Program account");
  return { programData: base58encode(data.subarray(4, 36)) };
}

export function parseProgramData(data) {
  if (data.length < PROGRAMDATA_HEADER || data.readUInt32LE(0) !== 3) throw new Error("not a ProgramData account");
  const slot = Number(data.readBigUInt64LE(4));
  const authority = data[12] === 1 ? base58encode(data.subarray(13, 45)) : null;
  const bytes = data.subarray(PROGRAMDATA_HEADER);
  return { slot, authority, executableHash: executableHash(bytes), dataLen: bytes.length };
}

async function rpc(fetchImpl, url, method, params) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(`RPC error ${j.error.code}: ${j.error.message}`);
      return j.result;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw lastErr;
}

export async function getAccount(fetchImpl, url, address) {
  const r = await rpc(fetchImpl, url, "getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
  if (!r || !r.value) return null;
  return { owner: r.value.owner, executable: r.value.executable, data: Buffer.from(r.value.data[0], "base64") };
}

export async function readOnChain(fetchImpl, url, programId) {
  const prog = await getAccount(fetchImpl, url, programId);
  if (!prog) return { missing: true };
  if (prog.owner !== UPGRADEABLE_LOADER) return { wrongOwner: prog.owner };
  const { programData } = parseProgramAccount(prog.data);
  const pd = await getAccount(fetchImpl, url, programData);
  if (!pd) return { missing: true, programData };
  return { programData, ...parseProgramData(pd.data) };
}

// program-v* releases, newest first, each with its parsed release.json
export async function loadReleases(fetchImpl, { api, repo, token, max = 20 }) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "swd-program-watch" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${api}/repos/${repo}/releases?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
  const list = (await res.json())
    .filter((r) => !r.draft && typeof r.tag_name === "string" && r.tag_name.startsWith("program-v"))
    .sort((a, b) => String(b.published_at || b.created_at).localeCompare(String(a.published_at || a.created_at)))
    .slice(0, max);
  const out = [];
  for (const r of list) {
    const asset = (r.assets || []).find((a) => a.name === "release.json");
    if (!asset) continue;
    const ar = await fetchImpl(asset.browser_download_url, { headers: { "user-agent": "swd-program-watch" } });
    if (!ar.ok) continue;
    try { out.push({ tag: r.tag_name, prerelease: !!r.prerelease, manifest: await ar.json() }); } catch { /* skip */ }
  }
  return out;
}

export function findKnown(releases, hash) {
  const hits = [];
  for (const r of releases) {
    for (const [flavour, b] of Object.entries(r.manifest.builds || {})) {
      if (b.executable_hash === hash) hits.push(`${r.tag} (${flavour})`);
    }
  }
  return hits;
}

export async function checkCluster(fetchImpl, c, releases, releasesError, prev) {
  const findings = [];
  const add = (level, msg) => findings.push({ level, msg: `[${c.cluster}] ${msg}` });
  let chain;
  try {
    chain = await readOnChain(fetchImpl, c.rpc, c.programId);
  } catch (e) {
    add("warning", `RPC unreachable (${c.rpc.replace(/\?.*$/, "")}): ${e.message}`);
    return { findings, chain: null };
  }
  if (chain.missing) { add("critical", `program ${c.programId} (or its ProgramData) does not exist`); return { findings, chain }; }
  if (chain.wrongOwner) { add("critical", `program ${c.programId} is owned by ${chain.wrongOwner}, not the upgradeable loader`); return { findings, chain }; }

  // hash
  const latest = releases.find((r) => r.manifest.builds && r.manifest.builds[c.flavour]);
  const expected = c.expectedHash || (latest && latest.manifest.builds[c.flavour].executable_hash);
  const ref = c.expectedHash ? "the pinned EXPECTED_HASH" : latest ? `latest release ${latest.tag} (${c.flavour})` : null;
  const known = findKnown(releases, chain.executableHash);
  if (!expected) {
    add("notice", `no ${releasesError ? `release list (${releasesError})` : `program-v* release with a ${c.flavour} build`} to compare with; on-chain hash ${chain.executableHash}${known.length ? ` = ${known.join(", ")}` : ""}`);
  } else if (chain.executableHash !== expected) {
    add("critical", `on-chain program hash ${chain.executableHash} != ${ref} ${expected}` +
      (known.length ? ` — it is ${known.join(", ")} (an older/other release: rolled back or not upgraded?)` : " — NOT any published release: unknown code is deployed"));
  }

  // authority
  const actual = chain.authority || "none";
  if (c.expectedAuthority) {
    if (actual !== c.expectedAuthority) add("critical", `upgrade authority is ${actual}, expected ${c.expectedAuthority}`);
  } else {
    add("notice", `upgrade authority is ${actual}; set EXPECTED_AUTHORITY_${c.cluster.toUpperCase()} to enforce it`);
  }

  // redeploy since last run
  if (prev && prev.slot !== undefined && prev.slot !== chain.slot) {
    add("notice", `program redeployed: last deployed slot ${prev.slot} -> ${chain.slot} (hash ${prev.executableHash} -> ${chain.executableHash})`);
  }
  return { findings, chain };
}

export function configFromEnv(env) {
  const clusters = [];
  const devId = env.DEVNET_PROGRAM_ID === undefined || env.DEVNET_PROGRAM_ID === "" ? DEFAULT_DEVNET_ID : env.DEVNET_PROGRAM_ID;
  if (devId !== "off") {
    clusters.push({ cluster: "devnet", flavour: "devnet", programId: devId, rpc: env.DEVNET_RPC_URL || "https://api.devnet.solana.com",
      expectedAuthority: env.EXPECTED_AUTHORITY_DEVNET || "", expectedHash: (env.EXPECTED_HASH_DEVNET || "").toLowerCase() });
  }
  if (env.MAINNET_PROGRAM_ID) {
    clusters.push({ cluster: "mainnet", flavour: "mainnet", programId: env.MAINNET_PROGRAM_ID, rpc: env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com",
      expectedAuthority: env.EXPECTED_AUTHORITY_MAINNET || "", expectedHash: (env.EXPECTED_HASH_MAINNET || "").toLowerCase() });
  }
  for (const c of clusters) {
    for (const k of ["programId", "expectedAuthority"]) {
      if (c[k] && c[k] !== "none" && base58decode(c[k]).length !== 32) throw new Error(`${c.cluster} ${k} is not a 32-byte address: ${c[k]}`);
    }
    if (c.expectedHash && !/^[0-9a-f]{64}$/.test(c.expectedHash)) throw new Error(`${c.cluster} EXPECTED_HASH must be 64 hex chars`);
  }
  return {
    clusters,
    github: { api: env.GITHUB_API_URL || "https://api.github.com", repo: env.GITHUB_REPOSITORY || "pospos191-alt/zetaphy", token: env.GITHUB_TOKEN || "" },
    telegram: env.ALERT_TELEGRAM_BOT_TOKEN && env.ALERT_TELEGRAM_CHAT_ID
      ? { token: env.ALERT_TELEGRAM_BOT_TOKEN, chat: env.ALERT_TELEGRAM_CHAT_ID, api: env.TELEGRAM_API_URL || "https://api.telegram.org" } : null,
  };
}

export async function sendTelegram(fetchImpl, tg, text) {
  const res = await fetchImpl(`${tg.api}/bot${tg.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: tg.chat, text, disable_web_page_preview: true }),
  });
  return res.ok;
}

// One full run. Returns { exitCode, findings, report, state }.
export async function run(env, { fetchImpl = fetch, state = {}, now = Date.now() } = {}) {
  const cfg = configFromEnv(env);
  let releases = [], releasesError = "";
  try { releases = await loadReleases(fetchImpl, cfg.github); } catch (e) { releasesError = e.message; }
  const findings = [];
  if (releasesError) findings.push({ level: "warning", msg: `GitHub releases unreachable: ${releasesError}` });
  const newState = { clusters: { ...(state.clusters || {}) }, lastAlert: state.lastAlert || "", lastAlertAt: state.lastAlertAt || 0 };
  const report = [];
  for (const c of cfg.clusters) {
    const r = await checkCluster(fetchImpl, c, releases, releasesError, (state.clusters || {})[c.cluster]);
    findings.push(...r.findings);
    if (r.chain && r.chain.slot !== undefined) {
      newState.clusters[c.cluster] = { slot: r.chain.slot, executableHash: r.chain.executableHash, authority: r.chain.authority };
      report.push({ cluster: c.cluster, programId: c.programId, programData: r.chain.programData, lastDeploySlot: r.chain.slot,
        upgradeAuthority: r.chain.authority || "none", executableHash: r.chain.executableHash, dataLen: r.chain.dataLen,
        knownAs: findKnown(releases, r.chain.executableHash) });
    }
  }
  const critical = findings.filter((f) => f.level === "critical");
  const alertable = findings.filter((f) => f.level === "critical" || f.level === "notice");
  const alertKey = alertable.map((f) => f.msg).join("\n");
  let telegram = "not configured";
  // Sent when the findings change; an unchanged CRITICAL is repeated every 6 hours until someone acts.
  const repeatDue = critical.length > 0 && now - (state.lastAlertAt || 0) >= 6 * 3600 * 1000;
  if (cfg.telegram && alertable.length && (alertKey !== newState.lastAlert || repeatDue)) {
    const text = [`swd_amm program-watch: ${critical.length ? `${critical.length} CRITICAL` : "notice"}`, ...alertable.map((f) => `${f.level.toUpperCase()}: ${f.msg}`),
      "", "Runbook: docs/PROGRAM_ROLLBACK.md"].join("\n");
    try { telegram = (await sendTelegram(fetchImpl, cfg.telegram, text)) ? "sent" : "failed"; } catch { telegram = "failed"; }
    if (telegram === "sent") newState.lastAlertAt = now;
  } else if (cfg.telegram) telegram = "nothing new to send";
  // remember what was alerted only once it reached someone (or no channel is set): a failed send is retried
  if (telegram !== "failed") newState.lastAlert = alertKey;
  return { exitCode: critical.length ? 1 : 0, findings, report, state: newState, telegram };
}

async function main() {
  const args = process.argv.slice(2);
  const si = args.indexOf("--state");
  const statePath = si >= 0 ? args[si + 1] : "";
  let state = {};
  if (statePath) { try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { state = {}; } }
  const r = await run(process.env, { state });
  const gha = !!process.env.GITHUB_ACTIONS;
  if (args.includes("--json")) console.log(JSON.stringify({ report: r.report, findings: r.findings }, null, 2));
  else {
    for (const p of r.report) {
      console.log(`${p.cluster}: program ${p.programId}\n  programdata     ${p.programData}\n  last deployed   slot ${p.lastDeploySlot}\n` +
        `  authority       ${p.upgradeAuthority}\n  executable hash ${p.executableHash}  (${p.dataLen} bytes)\n  matches         ${p.knownAs.join(", ") || "no published release"}`);
    }
    for (const f of r.findings) {
      const kind = f.level === "critical" ? "error" : f.level === "notice" ? "notice" : "warning";
      console.log(gha ? `::${kind} title=program-watch::${f.msg}` : `${f.level.toUpperCase()}: ${f.msg}`);
    }
    console.log(`telegram: ${r.telegram}`);
    console.log(r.exitCode ? "RESULT: CRITICAL — follow docs/PROGRAM_ROLLBACK.md" : "RESULT: ok");
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ["### swd_amm program-watch", "", "| cluster | last deployed slot | upgrade authority | executable hash | matches |", "|---|---|---|---|---|",
      ...r.report.map((p) => `| ${p.cluster} | ${p.lastDeploySlot} | \`${p.upgradeAuthority}\` | \`${p.executableHash}\` | ${p.knownAs.join(", ") || "**none**"} |`),
      "", ...r.findings.map((f) => `- **${f.level}**: ${f.msg}`), ""];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
  if (statePath) { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(r.state, null, 2)); }
  process.exitCode = r.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`program-watch failed: ${e.message}`); process.exitCode = 2; });
}
