// Tests for scripts/program-watch.mjs against a fake Solana JSON-RPC, a fake GitHub API and a fake Telegram,
// all served by one local HTTP server. Run: node --test scripts/program-watch.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  base58encode, base58decode, executableHash, parseProgramData, run, configFromEnv, UPGRADEABLE_LOADER,
} from "./program-watch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PROGRAM_ID = "3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL";
const PD_BYTES = randomBytes(32); const PROGRAMDATA = base58encode(PD_BYTES);
const VAULT_BYTES = randomBytes(32); const VAULT = base58encode(VAULT_BYTES);
const ATTACKER = base58encode(randomBytes(32));

const elf = (seed) => Buffer.concat([Buffer.from("\x7fELF"), createHash("sha256").update(seed).digest(), Buffer.from([1, 2, 3])]);
const exeHashOf = (b) => createHash("sha256").update(b).digest("hex");
const GOOD = elf("release-1"); const OLD = elf("release-0"); const EVIL = elf("evil");

// mutable fake chain state
const chain = { so: GOOD, slot: 1000, authority: VAULT_BYTES, padding: 4096, programOwner: UPGRADEABLE_LOADER, rpcDown: false };
const sent = [];
let server, base;

function programAccount() {
  const d = Buffer.alloc(36); d.writeUInt32LE(2, 0); PD_BYTES.copy(d, 4); return d;
}
function programDataAccount() {
  const h = Buffer.alloc(45); h.writeUInt32LE(3, 0); h.writeBigUInt64LE(BigInt(chain.slot), 4);
  if (chain.authority) { h[12] = 1; Buffer.from(chain.authority).copy(h, 13); }
  return Buffer.concat([h, chain.so, Buffer.alloc(chain.padding)]); // zero padded like a real ProgramData
}
const release = (tag, devSo, mainSo, published) => ({
  tag_name: tag, draft: false, prerelease: false, published_at: published,
  assets: [{ name: "release.json", browser_download_url: `${base}/dl/${tag}/release.json` }],
  _manifest: { schema: 1, tag, builds: {
    devnet: { features: "", file: "swd_amm-devnet.so", executable_hash: exeHashOf(devSo) },
    mainnet: { features: "mainnet,v2-only", file: "swd_amm-mainnet.so", executable_hash: exeHashOf(mainSo) } } },
});
let releases = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.url === "/rpc") {
        if (chain.rpcDown) return json(503, {});
        const { method, params } = JSON.parse(body);
        assert.equal(method, "getAccountInfo");
        let acc = null;
        if (params[0] === PROGRAM_ID) acc = { owner: chain.programOwner, executable: true, data: [programAccount().toString("base64"), "base64"] };
        else if (params[0] === PROGRAMDATA) acc = { owner: UPGRADEABLE_LOADER, executable: false, data: [programDataAccount().toString("base64"), "base64"] };
        return json(200, { jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: acc } });
      }
      if (req.url.startsWith("/gh/repos/o/r/releases")) return json(200, releases.map(({ _manifest, ...r }) => r));
      const m = req.url.match(/^\/dl\/([^/]+)\/release\.json$/);
      if (m) { const r = releases.find((x) => x.tag_name === m[1]); return r ? json(200, r._manifest) : json(404, {}); }
      if (req.url.startsWith("/tg/botTOKEN/sendMessage")) { sent.push(JSON.parse(body)); return json(200, { ok: true }); }
      json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  releases = [release("program-v1.1.0", GOOD, elf("m1"), "2026-11-10T00:00:00Z"), release("program-v1.0.0", OLD, elf("m0"), "2026-10-01T00:00:00Z")];
});
after(() => server.close());

const env = (extra = {}) => ({
  DEVNET_PROGRAM_ID: PROGRAM_ID, DEVNET_RPC_URL: `${base}/rpc`, GITHUB_API_URL: `${base}/gh`, GITHUB_REPOSITORY: "o/r",
  EXPECTED_AUTHORITY_DEVNET: VAULT, ALERT_TELEGRAM_BOT_TOKEN: "TOKEN", ALERT_TELEGRAM_CHAT_ID: "42", TELEGRAM_API_URL: `${base}/tg`, ...extra,
});
const reset = () => { Object.assign(chain, { so: GOOD, slot: 1000, authority: VAULT_BYTES, programOwner: UPGRADEABLE_LOADER, rpcDown: false }); sent.length = 0; };

test("base58 round trip and known vectors", () => {
  assert.equal(base58encode(new Uint8Array(32)), "11111111111111111111111111111111");
  assert.equal(base58encode(base58decode(UPGRADEABLE_LOADER)), UPGRADEABLE_LOADER);
  assert.equal(base58decode(PROGRAM_ID).length, 32);
  const x = randomBytes(32); assert.deepEqual(Buffer.from(base58decode(base58encode(x))), x);
});

test("executable hash ignores the zero padding (= solana-verify get-program-hash)", () => {
  assert.equal(executableHash(Buffer.concat([GOOD, Buffer.alloc(100)])), exeHashOf(GOOD));
  const pd = parseProgramData(programDataAccount());
  assert.equal(pd.slot, 1000); assert.equal(pd.authority, VAULT); assert.equal(pd.executableHash, exeHashOf(GOOD));
});

test("healthy program: latest release + expected authority -> ok, nothing sent", async () => {
  reset();
  const r = await run(env());
  assert.equal(r.exitCode, 0, JSON.stringify(r.findings));
  assert.deepEqual(r.findings, []);
  assert.equal(r.report[0].lastDeploySlot, 1000);
  assert.deepEqual(r.report[0].knownAs, ["program-v1.1.0 (devnet)"]);
  assert.equal(sent.length, 0);
});

test("unknown code deployed -> CRITICAL, exit 1, Telegram alert", async () => {
  reset(); chain.so = EVIL; chain.slot = 2000;
  const r = await run(env(), { state: { clusters: { devnet: { slot: 1000, executableHash: exeHashOf(GOOD) } } } });
  assert.equal(r.exitCode, 1);
  assert.ok(r.findings.some((f) => f.level === "critical" && /NOT any published release/.test(f.msg)));
  assert.ok(r.findings.some((f) => f.level === "notice" && /redeployed: last deployed slot 1000 -> 2000/.test(f.msg)));
  assert.equal(sent.length, 1); assert.equal(sent[0].chat_id, "42"); assert.match(sent[0].text, /CRITICAL/);
  assert.doesNotMatch(JSON.stringify(r), /TOKEN/); // the bot token never appears in results
});

test("older release deployed (rollback) -> CRITICAL names the release; pinned EXPECTED_HASH accepts it", async () => {
  reset(); chain.so = OLD;
  let r = await run(env());
  assert.equal(r.exitCode, 1);
  assert.ok(r.findings.some((f) => /it is program-v1\.0\.0 \(devnet\)/.test(f.msg)));
  r = await run(env({ EXPECTED_HASH_DEVNET: exeHashOf(OLD) }));
  assert.equal(r.exitCode, 0, JSON.stringify(r.findings));
});

test("authority changed or made immutable -> CRITICAL", async () => {
  reset(); chain.authority = base58decode(ATTACKER);
  let r = await run(env());
  assert.equal(r.exitCode, 1);
  assert.ok(r.findings.some((f) => f.level === "critical" && f.msg.includes(`upgrade authority is ${ATTACKER}`)));
  chain.authority = null;
  r = await run(env());
  assert.ok(r.findings.some((f) => f.msg.includes("upgrade authority is none")));
  r = await run(env({ EXPECTED_AUTHORITY_DEVNET: "none" }));
  assert.equal(r.exitCode, 0);
});

test("program missing / wrong owner -> CRITICAL", async () => {
  reset(); chain.programOwner = "11111111111111111111111111111111";
  const r = await run(env());
  assert.equal(r.exitCode, 1);
  assert.match(r.findings[0].msg, /not the upgradeable loader/);
  const r2 = await run(env({ DEVNET_PROGRAM_ID: base58encode(randomBytes(32)) }));
  assert.equal(r2.exitCode, 1); assert.match(r2.findings[0].msg, /does not exist/);
});

test("RPC down -> warning only (exit 0); no releases -> notice", async () => {
  reset(); chain.rpcDown = true;
  let r = await run(env());
  assert.equal(r.exitCode, 0);
  assert.ok(r.findings.every((f) => f.level === "warning"));
  chain.rpcDown = false;
  const saved = releases; releases = [];
  r = await run(env());
  releases = saved;
  assert.equal(r.exitCode, 0);
  assert.ok(r.findings.some((f) => f.level === "notice" && /no program-v\* release/.test(f.msg)));
});

test("Telegram dedupe: same notice not re-sent; unchanged critical repeated after 6 h", async () => {
  reset(); chain.so = EVIL;
  const t0 = Date.parse("2026-11-11T00:00:00Z");
  const r1 = await run(env(), { now: t0 });
  assert.equal(sent.length, 1);
  const r2 = await run(env(), { state: r1.state, now: t0 + 3600e3 });
  assert.equal(sent.length, 1); assert.equal(r2.telegram, "nothing new to send"); assert.equal(r2.exitCode, 1);
  await run(env(), { state: r2.state, now: t0 + 7 * 3600e3 });
  assert.equal(sent.length, 2);
});

test("mainnet is watched only when MAINNET_PROGRAM_ID is set; bad config is refused", () => {
  assert.equal(configFromEnv({}).clusters.length, 1);
  assert.equal(configFromEnv({ DEVNET_PROGRAM_ID: "off" }).clusters.length, 0);
  const c = configFromEnv({ MAINNET_PROGRAM_ID: PROGRAM_ID, EXPECTED_AUTHORITY_MAINNET: VAULT });
  assert.deepEqual(c.clusters.map((x) => x.flavour), ["devnet", "mainnet"]);
  assert.throws(() => configFromEnv({ EXPECTED_HASH_DEVNET: "abc" }), /64 hex/);
  assert.throws(() => configFromEnv({ EXPECTED_AUTHORITY_DEVNET: "0OIl" }), /base58/);
});

test("CLI: exit code, state file and step summary", async () => {
  reset(); chain.so = EVIL;
  const dir = mkdtempSync(join(tmpdir(), "pw-"));
  const summary = join(dir, "summary.md");
  const { code, out } = await new Promise((resolve) => {
    execFile(process.execPath, [join(here, "program-watch.mjs"), "--state", join(dir, "s", "state.json")],
      { env: { ...env(), ALERT_TELEGRAM_BOT_TOKEN: "", GITHUB_STEP_SUMMARY: summary, PATH: process.env.PATH } },
      (err, stdout) => resolve({ code: err ? err.code : 0, out: stdout }));
  });
  assert.equal(code, 1, out);
  assert.match(out, /RESULT: CRITICAL/);
  assert.match(out, /telegram: not configured/);
  assert.equal(JSON.parse(readFileSync(join(dir, "s", "state.json"), "utf8")).clusters.devnet.executableHash, exeHashOf(EVIL));
  assert.match(readFileSync(summary, "utf8"), /swd_amm program-watch/);
});
