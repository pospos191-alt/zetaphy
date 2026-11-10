// Unit tests for the trust panel parsers, the token check, the program
// error table and the network config. Run: node --test trust.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseProgramAccount, parseProgramData, trimTrailingZeros, sha256Hex, parseSecurityTxt,
  parseGlobalConfig, parseGovernanceSettings, parseSquadsMultisig, classifyAuthority, renderTrust, readTrust,
} from "../trust.js";
import { normalizeLevel, normalizeAuditResponse, checkTokenAudit, _resetTokenAuditCache } from "../token-audit.js";
import { PROGRAM_ERRORS, findProgramError } from "../program-errors.js";
import { NETWORKS, PROJECT, networkUsable, programIdFor } from "../config.js";

const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const le64 = (n) => { const b = []; let v = BigInt(n); for (let i = 0; i < 8; i++) { b.push(Number(v & 255n)); v >>= 8n; } return b; };
const fill = (n, v) => Array(n).fill(v);

test("Program account -> ProgramData address", () => {
  const bytes = Uint8Array.from([...le32(2), ...fill(32, 7)]);
  assert.deepEqual([...parseProgramAccount(bytes).programData], fill(32, 7));
  assert.equal(parseProgramAccount(Uint8Array.from([...le32(3), ...fill(32, 7)])), null);
});

test("ProgramData: slot, authority (or none), program bytes", () => {
  const elf = [0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 0, 0, 0];
  const withAuth = Uint8Array.from([...le32(3), ...le64(123456789), 1, ...fill(32, 9), ...elf]);
  const p = parseProgramData(withAuth);
  assert.equal(p.slot, 123456789n);
  assert.deepEqual([...p.authority], fill(32, 9));
  assert.deepEqual([...trimTrailingZeros(p.elf)], [0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]);
  const immutable = Uint8Array.from([...le32(3), ...le64(5), 0, ...fill(32, 0), ...elf]);
  assert.equal(parseProgramData(immutable).authority, null);
});

test("sha256Hex", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("security.txt embedded in a binary", () => {
  const body = ["name", "SWD AMM", "contacts", "link:https://example.org/sec", "auditors", "None yet", ""].join("\0");
  const bin = new TextEncoder().encode(`\x01\x02junk=======BEGIN SECURITY.TXT V1=======\0${body}=======END SECURITY.TXT V1=======\0tail`);
  assert.deepEqual(parseSecurityTxt(bin), { name: "SWD AMM", contacts: "link:https://example.org/sec", auditors: "None yet" });
  assert.equal(parseSecurityTxt(new TextEncoder().encode("no block here")), null);
});

test("GlobalConfig / GovernanceSettings layouts", () => {
  const gc = Uint8Array.from([...fill(8, 0), ...fill(32, 1), ...fill(32, 2), 1, 254]);
  const g = parseGlobalConfig(gc);
  assert.equal(g.poolCreationPaused, true);
  assert.deepEqual([...g.governance], fill(32, 1));
  const gs = Uint8Array.from([...fill(8, 0), ...le64(86400), 0xe8, 0x03, ...fill(32, 3), ...le64(4), 255]);
  assert.deepEqual({ ...parseGovernanceSettings(gs), treasury: undefined }, { timelockSecs: 86400, protocolFeeShareBps: 1000, treasury: undefined });
});

test("Squads v4 multisig: threshold / members", () => {
  const ms = Uint8Array.from([...fill(8, 0), ...fill(32, 1), ...fill(32, 0), 2, 0, ...le32(0), ...le64(10), ...le64(0), 0, 254, ...le32(3), ...fill(33 * 3, 1)]);
  assert.deepEqual(parseSquadsMultisig(ms), { threshold: 2, timeLock: 0, members: 3 });
  assert.equal(parseSquadsMultisig(Uint8Array.from(fill(40, 0))), null);
});

test("who controls the program", () => {
  assert.equal(classifyAuthority({ authority: null }), "immutable");
  assert.equal(classifyAuthority({ authority: "V", squadsVault: "V", isOnCurve: false }), "squads");
  assert.equal(classifyAuthority({ authority: "P", isOnCurve: false }), "pda");
  assert.equal(classifyAuthority({ authority: "K", isOnCurve: true }), "single");
});

test("renderTrust: honest audit status, escapes chain text, mainnet notice", () => {
  const t = (k, v) => k + (v ? JSON.stringify(v) : "");
  const html = renderTrust({
    programId: "Prog111", deployed: true, authorityKind: "single", authority: "Auth111", lastDeploySlot: 5,
    securityTxt: { name: "<img src=x onerror=alert(1)>" }, governanceInitialized: true, poolCreationPaused: false, errors: [],
  }, { t, explorer: (a) => `https://explorer.solana.com/address/${a}`, project: PROJECT, mainnetLive: false });
  assert.match(html, /trAuthSingle/);
  assert.match(html, /tr-bad/);
  assert.match(html, /trAuditNone/);
  assert.match(html, /trMainnetSoon/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("token check: level words, response shapes, never throws", async () => {
  assert.equal(normalizeLevel("low"), "low");
  assert.equal(normalizeLevel("HIGH"), "high");
  assert.equal(normalizeLevel("critical"), "critical");
  assert.equal(normalizeLevel("medium"), "medium");
  assert.equal(normalizeLevel(""), "unknown");
  assert.deepEqual(normalizeAuditResponse({ ok: true, audit: { level: "high", verdict: "v", findings: [{ title: "mint authority" }], permalink: "https://x/a" } }, 200),
    { status: "ok", level: "high", verdict: "v", findingsCount: 1, topFindings: ["mint authority"], permalink: "https://x/a" });
  assert.equal(normalizeAuditResponse({ ok: true, audit: { level: "low", permalink: "javascript:alert(1)" } }, 200).permalink, "");
  assert.equal(normalizeAuditResponse(null, 502).status, "unavailable");
  assert.equal(normalizeAuditResponse({ ok: false, code: "not_found" }, 404).status, "not_found");

  _resetTokenAuditCache();
  const down = await checkTokenAudit("Mint1111111111111111111111111111111111111111", { api: "https://x/api/audit", fetch: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(down.status, "unavailable");
  const slow = await checkTokenAudit("Mint2222222222222222222222222222222222222222", { api: "https://x/api/audit", timeoutMs: 50, fetch: (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  assert.deepEqual([slow.status, slow.error], ["unavailable", "timeout"]);
  let calls = 0;
  const ok = () => checkTokenAudit("Mint3333333333333333333333333333333333333333", { api: "https://x/api/audit", fetch: async (u) => { calls++; assert.match(u, /chain=sol&address=Mint3/); return { status: 200, json: async () => ({ ok: true, audit: { level: "low" } }) }; } });
  assert.equal((await ok()).level, "low");
  await ok();
  assert.equal(calls, 1, "a good answer is cached");
  assert.equal((await checkTokenAudit("So11111111111111111111111111111111111111112", { api: "x" })).known, true);
});

test("program errors: every enum, readable lookup", () => {
  const codes = Object.keys(PROGRAM_ERRORS).map(Number);
  assert.ok(codes.length >= 90, `${codes.length} errors`);
  for (const base of [6000, 6100, 6200, 6300, 8000, 8500]) assert.ok(PROGRAM_ERRORS[base], `code ${base}`);
  assert.equal(findProgramError("failed: custom program error: 0x1770").code, 6000);
  assert.equal(findProgramError("Program log: AnchorError ... Error Number: 6101. Error Message: x").code, 6101);
  assert.equal(findProgramError("custom program error: 0x2134").name, "InvalidTimelockDelay");
  assert.equal(findProgramError("insufficient lamports"), null);
  for (const [, [, msg, cat]] of Object.entries(PROGRAM_ERRORS)) {
    assert.ok(msg.length > 3);
    assert.ok(["slippage", "paused", "auth", "oracle", "timelock", "allow", "liquidity", "math", "input"].includes(cat));
  }
});

test("network config: devnet usable, mainnet off until a real id + RPC", () => {
  assert.equal(networkUsable(NETWORKS.devnet), true);
  assert.equal(networkUsable(NETWORKS.mainnet), false, "mainnet must stay disabled until the audit + deploy");
  assert.equal(NETWORKS.mainnet.faucet, false);
  assert.equal(programIdFor("mainnet"), NETWORKS.devnet.programId);
  assert.equal(networkUsable({ enabled: true, programId: "not-an-id", rpc: "https://x" }), false);
  assert.equal(networkUsable({ enabled: true, programId: NETWORKS.devnet.programId, rpc: "" }), false);
  assert.equal(PROJECT.audit.status, "none");
});

test("readTrust: an RPC call that never answers times out and the other steps still run", async () => {
  class PK {
    constructor(v) { this.v = String(v); }
    toBase58() { return this.v; }
    toString() { return this.v; }
    static findProgramAddressSync(_seeds, prog) { return [new PK(`pda-of-${prog}`), 255]; }
  }
  let accountReads = 0;
  const connection = {
    getGenesisHash: () => new Promise(() => {}), // hangs forever
    getAccountInfo: async () => { accountReads++; return null; },
  };
  const started = Date.now();
  const r = await readTrust({ connection, PublicKey: PK, programId: "Prog1111", network: "devnet", project: {}, stepTimeoutMs: 50 });
  assert.ok(Date.now() - started < 2000, "readTrust finished");
  assert.ok(r.errors.some((e) => e.startsWith("genesis:") && /no answer/.test(e)), JSON.stringify(r.errors));
  assert.equal(r.deployed, false);
  assert.ok(accountReads >= 1);
});
