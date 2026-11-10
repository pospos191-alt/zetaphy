import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createHash, randomBytes, sign } from "node:crypto";
import { canonical, createSwdClient, decodeTransaction, inspectTransaction, solAmountString, SwdApiError, verifyAttestation, SWD_MINT } from "../src/index";

// ---- a tiny wire-format transaction builder for the tests (legacy / v0)
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58dec(s: string): number[] {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  while (out.length < 32) out.unshift(0);
  return out;
}
const sv = (n: number) => { const o: number[] = []; do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const le = (v: bigint | number, n: number) => { const o: number[] = []; let x = BigInt(v); for (let i = 0; i < n; i++) { o.push(Number(x & 255n)); x >>= 8n; } return o; };
type Ix = { program: string; accounts: string[]; data: number[] };
function buildTx(o: { keys: string[]; signers: number; ixs: Ix[]; v0?: boolean; lookups?: number; signed?: boolean }): string {
  const idx = (k: string) => { const i = o.keys.indexOf(k); if (i < 0) throw new Error("key " + k); return i; };
  const msg: number[] = [];
  if (o.v0) msg.push(0x80);
  msg.push(o.signers, 0, 0, ...sv(o.keys.length));
  for (const k of o.keys) msg.push(...b58dec(k));
  msg.push(...Array(32).fill(7));
  msg.push(...sv(o.ixs.length));
  for (const ix of o.ixs) {
    msg.push(idx(ix.program), ...sv(ix.accounts.length), ...ix.accounts.map((a) => (a === "LOOKUP" ? o.keys.length : idx(a))), ...sv(ix.data.length), ...ix.data);
  }
  if (o.v0) {
    const n = o.lookups ?? 0;
    msg.push(...sv(n));
    for (let i = 0; i < n; i++) msg.push(...Array(32).fill(9), ...sv(1), 0, ...sv(0));
  }
  const sigs = Array.from({ length: o.signers }, () => Array(64).fill(o.signed ? 1 : 0)).flat();
  return Buffer.from([...sv(o.signers), ...sigs, ...msg]).toString("base64");
}
const BUYER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const ATTACKER = "HUj3cyrb8eoZDJ6CWFSkQxjxDvK8Wn8PPcnYZbFEsWLx";
const WSOL_ATA = "4T8mq3mX7nB2cR8tY4wZ1aS6dF5gH3jK2kP9o5867iN";
const SYS = "11111111111111111111111111111111", CB = "ComputeBudget111111111111111111111111111111", TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const EVIL_PROGRAM = "Evi1Program111111111111111111111111111111111";
const transferIx = (from: string, to: string, lamports: bigint): Ix => ({ program: SYS, accounts: [from, to], data: [...le(2, 4), ...le(lamports, 8)] });
/** what a real Jupiter buy looks like: compute budget, wrap SOL into the buyer's wSOL account, the route, close wSOL back */
function buyTx(extra: Ix[] = [], o: { feePayer?: string; signers?: number; signed?: boolean; lamports?: bigint; extraKeys?: string[] } = {}) {
  const payer = o.feePayer ?? BUYER;
  const keys = [payer, ...(payer !== BUYER ? [BUYER] : []), ...(o.extraKeys ?? []), WSOL_ATA, ATTACKER, SYS, CB, TOK, JUP, EVIL_PROGRAM].filter((k, i, a) => a.indexOf(k) === i);
  return buildTx({
    keys, signers: o.signers ?? 1, v0: true, lookups: 1, signed: o.signed,
    ixs: [
      { program: CB, accounts: [], data: [2, ...le(200_000, 4)] },
      transferIx(BUYER, WSOL_ATA, o.lamports ?? 100_000_000n),
      { program: TOK, accounts: [WSOL_ATA], data: [17] },
      { program: JUP, accounts: [BUYER, WSOL_ATA, "LOOKUP"], data: [1, 2, 3] },
      { program: TOK, accounts: [WSOL_ATA, BUYER, BUYER], data: [9] },
      ...extra,
    ],
  });
}

type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, init });
    return handler(new URL(u), init);
  }) as typeof fetch;
  return { f, calls };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const BASE = "https://example.test";

describe("audit", () => {
  it("calls /api/audit with chain, address, lang and drops the full report", async () => {
    const { f, calls } = mockFetch(() => json({ ok: true, audit: { chain: "sol", address: SWD_MINT, level: "low", report: { big: 1 }, permalink: "p" } }));
    const swd = createSwdClient({ baseUrl: BASE + "/", fetch: f });
    const a = await swd.audit("sol", SWD_MINT, { lang: "th" });
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe(`${BASE}/api/audit`);
    expect(u.searchParams.get("chain")).toBe("sol");
    expect(u.searchParams.get("address")).toBe(SWD_MINT);
    expect(u.searchParams.get("lang")).toBe("th");
    expect(a.level).toBe("low");
    expect(a.report).toBeUndefined();
  });
  it("keeps the report with full: true", async () => {
    const { f } = mockFetch(() => json({ ok: true, audit: { level: "high", report: { big: 1 } } }));
    expect((await createSwdClient({ baseUrl: BASE, fetch: f }).audit("eth", "0xabc", { full: true })).report).toEqual({ big: 1 });
  });
  it("turns { ok: false } into SwdApiError with the API's code", async () => {
    const { f } = mockFetch(() => json({ ok: false, code: "bad_chain", error: "chain must be one of" }, 400));
    const err = await createSwdClient({ baseUrl: BASE, fetch: f }).audit("nope", "x").catch((e) => e);
    expect(err).toBeInstanceOf(SwdApiError);
    expect(err.code).toBe("bad_chain");
    expect(err.status).toBe(400);
  });
  it("auditTx uses /api/audit/tx?hash=", async () => {
    const { f, calls } = mockFetch(() => json({ ok: true, tx: { found: true, level: "info", overall: "medium" } }));
    const t = await createSwdClient({ baseUrl: BASE, fetch: f }).auditTx("sol", "5sig");
    expect(new URL(calls[0].url).pathname).toBe("/api/audit/tx");
    expect(new URL(calls[0].url).searchParams.get("hash")).toBe("5sig");
    expect(t.overall).toBe("medium");
  });
  it("builds badge and permalink URLs", () => {
    const swd = createSwdClient({ baseUrl: BASE, fetch: (() => {}) as unknown as typeof fetch });
    expect(swd.badgeUrl("sol", SWD_MINT)).toBe(`${BASE}/api/audit/badge?chain=sol&address=${SWD_MINT}`);
    expect(swd.permalink("osmosis", "factory/osmo1x/name")).toBe(`${BASE}/audit/osmosis/factory/osmo1x/name`);
  });
});

describe("supply", () => {
  it("reads both plain-text numbers", async () => {
    const { f } = mockFetch((u) => new Response(u.pathname.endsWith("total") ? "1000000000\n" : "750000000.5", { status: 200 }));
    expect(await createSwdClient({ baseUrl: BASE, fetch: f }).supply()).toEqual({ total: "1000000000", circulating: "750000000.5" });
  });
  it("fails on 503 unavailable", async () => {
    const { f } = mockFetch(() => new Response("unavailable", { status: 503 }));
    await expect(createSwdClient({ baseUrl: BASE, fetch: f }).supply()).rejects.toBeInstanceOf(SwdApiError);
  });
});

describe("buySwdTransaction", () => {
  const account = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  it("POSTs { account } with ?amount= and decodes the transaction", async () => {
    const tx = buyTx();
    const { f, calls } = mockFetch(() => json({ type: "transaction", transaction: tx, message: "0.1 SOL → ~123 SWD" }));
    const r = await createSwdClient({ baseUrl: BASE, fetch: f }).buySwdTransaction({ account, amountSol: 0.1, slippageBps: 100 });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/api/actions/buy-swd");
    expect(u.searchParams.get("amount")).toBe("0.1");
    expect(u.searchParams.get("slippageBps")).toBe("100");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ account });
    expect(Array.from(r.bytes)).toEqual(Array.from(Buffer.from(tx, "base64")));
    expect(r.message).toContain("SWD");
    expect(r.inspection?.problems).toEqual([]);
    expect(r.inspection?.solOutLamports).toBe(100_000_000n);
    expect(r.inspection?.usesLookupTables).toBe(true);
  });
  it("refuses bad input before any request", async () => {
    const { f, calls } = mockFetch(() => json({}));
    const swd = createSwdClient({ baseUrl: BASE, fetch: f });
    await expect(swd.buySwdTransaction({ account: "not-an-address", amountSol: 0.1 })).rejects.toMatchObject({ code: "bad_input" });
    await expect(swd.buySwdTransaction({ account, amountSol: 51 })).rejects.toMatchObject({ code: "bad_input" });
    await expect(swd.buySwdTransaction({ account, amountSol: "0.0001" })).rejects.toMatchObject({ code: "bad_input" });
    await expect(swd.buySwdTransaction({ account, amountSol: 1, slippageBps: 5000 })).rejects.toMatchObject({ code: "bad_input" });
    expect(calls).toHaveLength(0);
  });
  it("passes the Action's error message through", async () => {
    const { f } = mockFetch(() => json({ message: "no route right now" }, 422));
    await expect(createSwdClient({ baseUrl: BASE, fetch: f }).buySwdTransaction({ account, amountSol: "0.05" })).rejects.toThrow("no route right now");
  });
  // ---- attack tests: a compromised / impersonated server (or a wrong SWD_API_BASE) answers with a hostile transaction
  const serve = (tx: string) => createSwdClient({ baseUrl: BASE, fetch: mockFetch(() => json({ type: "transaction", transaction: tx, message: "0.1 SOL → ~123 SWD" })).f });
  const refused = async (tx: string, why: RegExp, extra: Record<string, unknown> = {}) => {
    const err = await serve(tx).buySwdTransaction({ account, amountSol: 0.1, ...extra }).catch((e) => e);
    expect(err).toBeInstanceOf(SwdApiError);
    expect(err.code).toBe("unsafe_transaction");
    expect(err.message).toMatch(why);
  };
  it("attack: an extra SOL transfer to the attacker is refused", () => refused(buyTx([transferIx(BUYER, ATTACKER, 5_000_000_000n)]), /lamports out of the account/));
  it("attack: a bigger 'wrap' than the amount asked for is refused", () => refused(buyTx([], { lamports: 2_000_000_000n }), /more than/));
  it("attack: a site fee within the margin passes", async () => {
    const r = await serve(buyTx([transferIx(BUYER, ATTACKER, 1_000_000n)])).buySwdTransaction({ account, amountSol: 0.1 });
    expect(r.inspection?.solOutLamports).toBe(101_000_000n);
  });
  it("attack: an unlimited SPL approval for the attacker is refused", () =>
    refused(buyTx([{ program: TOK, accounts: [WSOL_ATA, ATTACKER, BUYER], data: [4, ...le((1n << 64n) - 1n, 8)] }]), /SPL Approve/));
  it("attack: SetAuthority / close-to-attacker / token transfer signed by the buyer are refused", async () => {
    await refused(buyTx([{ program: TOK, accounts: [WSOL_ATA, BUYER], data: [6, 2, 1, ...b58dec(ATTACKER)] }]), /SetAuthority/);
    await refused(buyTx([{ program: TOK, accounts: [WSOL_ATA, ATTACKER, BUYER], data: [9] }]), /CloseAccount/);
    await refused(buyTx([{ program: TOK, accounts: [WSOL_ATA, ATTACKER, BUYER], data: [3, ...le(5n, 8)] }]), /SPL transfer/);
  });
  it("attack: System Assign of the buyer's account (wallet takeover) is refused", () =>
    refused(buyTx([{ program: SYS, accounts: [BUYER], data: [...le(1, 4), ...b58dec(EVIL_PROGRAM)] }]), /Assign/));
  it("attack: an unknown program (it could drain by CPI with the buyer's signature) is refused unless allowed", async () => {
    const tx = buyTx([{ program: EVIL_PROGRAM, accounts: [BUYER], data: [1] }]);
    await refused(tx, /unknown programs: Evi1Program/);
    const r = await serve(tx).buySwdTransaction({ account, amountSol: 0.1, allowPrograms: [EVIL_PROGRAM] });
    expect(r.inspection?.programs).toContain(EVIL_PROGRAM);
  });
  it("attack: the server as fee payer, an extra signer, or a pre-signed transaction is refused", async () => {
    await refused(buyTx([], { feePayer: ATTACKER, signers: 2 }), /fee payer is HUj3/);
    await refused(buyTx([], { signers: 2, extraKeys: [ATTACKER] }), /other signers/);
    await refused(buyTx([], { signed: true }), /already \(partly\) signed/);
  });
  it("attack: malformed bytes are a bad_response, never returned", async () => {
    const good = Buffer.from(buyTx(), "base64");
    for (const bad of [good.subarray(0, good.length - 3), Buffer.concat([good, Buffer.from([0])]), Buffer.from([1, 2, 3])]) {
      const err = await serve(bad.toString("base64")).buySwdTransaction({ account, amountSol: 0.1 }).catch((e) => e);
      expect(err.code).toBe("bad_response");
    }
  });
  it("unsafeSkipChecks returns the bytes as they came (the caller's own risk)", async () => {
    const r = await serve(buyTx([transferIx(BUYER, ATTACKER, 5_000_000_000n)])).buySwdTransaction({ account, amountSol: 0.1, unsafeSkipChecks: true });
    expect(r.inspection).toBeUndefined();
  });
  it("decodeTransaction / inspectTransaction work on their own (legacy too)", () => {
    const legacy = Buffer.from(buildTx({ keys: [BUYER, ATTACKER, SYS], signers: 1, ixs: [transferIx(BUYER, ATTACKER, 7n)] }), "base64");
    const d = decodeTransaction(legacy);
    expect(d.version).toBe("legacy");
    expect(d.feePayer).toBe(BUYER);
    expect(inspectTransaction(d, BUYER).solOutLamports).toBe(7n);
    expect(inspectTransaction(d, ATTACKER).problems[0]).toMatch(/fee payer/);
  });

  it("solAmountString normalizes numbers", () => {
    expect(solAmountString(0.05)).toBe("0.05");
    expect(solAmountString(1)).toBe("1");
    expect(() => solAmountString(NaN)).toThrow();
  });
});

describe("MCP tools", () => {
  it("sends tools/call and returns structuredContent", async () => {
    const { f, calls } = mockFetch(() => json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { mint: SWD_MINT } } }));
    const r = await createSwdClient({ baseUrl: BASE, fetch: f }).info();
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("swd_info");
    expect(r.mint).toBe(SWD_MINT);
  });
  it("throws on a tool error", async () => {
    const { f } = mockFetch(() => json({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "bad mint" }] } }));
    await expect(createSwdClient({ baseUrl: BASE, fetch: f }).tokenInfo("sol", "x")).rejects.toMatchObject({ code: "tool_error" });
  });
});

describe("canonical JSON", () => {
  it("sorts keys, escapes non-ASCII, drops undefined", () => {
    expect(canonical({ b: 1, a: "ไทย", c: undefined, d: [null, true] })).toBe('{"a":"\\u0e44\\u0e17\\u0e22","b":1,"d":[null,true]}');
    expect(() => canonical({ x: 1.5 })).toThrow();
  });
});

// A real Ed25519 signature (node:crypto) and a placeholder ML-DSA key/signature, checked with a stand-in verifier.
function makeAttestation() {
  const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const edPub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const mlPub = randomBytes(1312);
  const mlSig = randomBytes(2420);
  const payload = {
    kind: "contract",
    chain: "sol",
    subject: SWD_MINT,
    reader: "neuro",
    engine: "neuro@test report-v1 verdict-v1",
    reportHash: "0x" + "ab".repeat(32),
    verdict: "0x" + "cd".repeat(32),
    level: "low",
    observedAt: "2026-11-07T00:00:00.000Z",
    site: "https://swd-zetaphy.sawasdeecoin.com",
    url: `https://swd-zetaphy.sawasdeecoin.com/audit/sol/${SWD_MINT}`,
  };
  const payloadHash = "0x" + sha(canonical(payload)).toString("hex");
  const mlId = "mldsa44-" + sha(mlPub).toString("hex").slice(0, 16);
  const edId = "ed25519-" + sha(edPub).toString("hex").slice(0, 16);
  const msg = Buffer.from(`swd.audit-attestation.v1\n${payloadHash}\nml-dsa-44:${mlId}\ned25519:${edId}`);
  const att = {
    format: "swd.audit-attestation.v1",
    payload,
    payloadHash,
    id: "0x" + sha(msg).toString("hex"),
    sigs: {
      mldsa44: { keyId: mlId, publicKey: mlPub.toString("base64"), sig: mlSig.toString("base64") },
      ed25519: { keyId: edId, publicKey: edPub.toString("base64"), sig: sign(null, msg, privateKey).toString("base64") },
    },
  };
  const keys = [
    { alg: "ML-DSA-44" as const, keyId: mlId, publicKey: mlPub.toString("base64"), status: "current" as const },
    { alg: "Ed25519" as const, keyId: edId, publicKey: edPub.toString("base64"), status: "current" as const },
  ];
  return { att, keys, mlSig };
}

describe("verifyAttestation", () => {
  it("checks hashes, ids and Ed25519; stays incomplete without an ML-DSA verifier", async () => {
    const { att } = makeAttestation();
    const r = await verifyAttestation(att);
    expect(r.problems).toEqual([]);
    expect(r.ed25519).toBe(true);
    expect(r.mldsa44).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.ok).toBe(false);
  });
  it("is ok and trusted with an ML-DSA verifier and the published keys", async () => {
    const { att, keys, mlSig } = makeAttestation();
    const r = await verifyAttestation(JSON.stringify(att), { keys, mldsaVerify: (_pk, _m, sig) => Buffer.from(sig).equals(mlSig) });
    expect(r.ok).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.signer).toBe("current");
    expect(r.trusted).toBe(true);
  });
  it("catches a changed payload", async () => {
    const { att } = makeAttestation();
    att.payload.level = "info";
    const r = await verifyAttestation(att, { mldsaVerify: () => true });
    expect(r.ok).toBe(false);
    expect(r.problems).toContain("payload_hash");
  });
  it("catches a forged Ed25519 signature and an unknown signer", async () => {
    const { att } = makeAttestation();
    const other = makeAttestation();
    att.sigs.ed25519.sig = other.att.sigs.ed25519.sig;
    const r = await verifyAttestation(att, { keys: other.keys, mldsaVerify: () => true });
    expect(r.problems).toContain("ed25519_sig");
    expect(r.problems).toContain("key_unknown");
    expect(r.trusted).toBe(false);
  });
  it("never throws on junk", async () => {
    expect((await verifyAttestation("{not json")).problems).toEqual(["not_json"]);
    expect((await verifyAttestation(null)).ok).toBe(false);
  });
});
