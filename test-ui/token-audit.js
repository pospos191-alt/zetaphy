// Token safety check through the public SWD Audit API
// (GET <api>?chain=sol&address=<mint>&lang=<lang> -> { ok, audit: { level, verdict, findings, permalink } }).
// The API can be slow (a first audit reads the chain) or down: this module never
// throws and never blocks a trade — a failure just reads "unavailable".
// Results are kept for 10 minutes (memory + sessionStorage).

const TTL_MS = 10 * 60 * 1000;
const CACHE_KEY = "swd-amm-token-audit-v1";
const mem = new Map(); // mint -> { at, result } | { at, pending: Promise }

// Native SOL / wSOL needs no check.
export const KNOWN_SAFE = new Set(["So11111111111111111111111111111111111111112"]);

/** API level (whatever words it uses) -> low | medium | high | critical | unknown */
export function normalizeLevel(raw) {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return "unknown";
  if (/crit|scam|malic|danger|honeypot|rug/.test(s)) return "critical";
  if (/high|severe|bad/.test(s)) return "high";
  if (/med|moderate|warn|caution/.test(s)) return "medium";
  if (/low|safe|info|pass|ok|clean|none|minimal/.test(s)) return "low";
  const n = Number(s);
  if (Number.isFinite(n)) return n >= 80 ? "critical" : n >= 60 ? "high" : n >= 30 ? "medium" : "low";
  return "unknown";
}

/** API body -> { status: "ok" | "not_found" | "unavailable", level, verdict, findings, permalink } */
export function normalizeAuditResponse(body, httpStatus) {
  if (httpStatus === 404 || body?.code === "not_found" || /not.?found|no.?account|unknown address/i.test(String(body?.error || ""))) {
    return { status: "not_found", level: "unknown" };
  }
  if (!body || body.ok === false || !body.audit) return { status: "unavailable", level: "unknown", error: body?.error || (httpStatus ? `HTTP ${httpStatus}` : "no response") };
  const a = body.audit;
  const findings = Array.isArray(a.findings) ? a.findings : [];
  const permalink = /^https:\/\//.test(String(a.permalink || "")) ? String(a.permalink) : "";
  return {
    status: "ok",
    level: normalizeLevel(a.level ?? a.risk ?? a.riskLevel ?? a.risk_level ?? a.score),
    verdict: typeof a.verdict === "string" ? a.verdict.slice(0, 200) : "",
    findingsCount: findings.length,
    topFindings: findings.slice(0, 3).map((f) => String(f?.title || f?.name || f?.message || f).slice(0, 140)),
    permalink,
  };
}

function loadStore() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function saveStore(store) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(store)); } catch {}
}

/** Cached result right now (or null) — for code that must not wait. */
export function peekTokenAudit(mint) {
  if (KNOWN_SAFE.has(mint)) return { status: "ok", level: "low", known: true };
  const hit = mem.get(mint);
  if (hit?.result && Date.now() - hit.at < (hit.short ? 60_000 : TTL_MS)) return hit.result;
  const s = loadStore()[mint];
  if (s && Date.now() - s.at < TTL_MS) { mem.set(mint, s); return s.result; }
  return null;
}

/**
 * Checks one mint. Resolves within ~timeoutMs, always (never rejects).
 * opts: { api, lang, timeoutMs, fetch }
 */
export function checkTokenAudit(mint, opts = {}) {
  const cached = peekTokenAudit(mint);
  if (cached) return Promise.resolve(cached);
  const hit = mem.get(mint);
  if (hit?.pending) return hit.pending;
  const doFetch = opts.fetch || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const url = `${opts.api}?${new URLSearchParams({ chain: "sol", address: mint, lang: opts.lang || "en" })}`;
  const pending = (async () => {
    let result;
    try {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => ctl?.abort(), timeoutMs);
      let r;
      try { r = await doFetch(url, { headers: { accept: "application/json" }, signal: ctl?.signal, credentials: "omit", referrerPolicy: "no-referrer" }); }
      finally { clearTimeout(timer); }
      const body = await r.json().catch(() => null);
      result = normalizeAuditResponse(body, r.status);
    } catch (e) {
      result = { status: "unavailable", level: "unknown", error: e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 120) };
    }
    // Only good answers are cached for 10 minutes; an outage is retried on the next check.
    if (result.status !== "unavailable") {
      const entry = { at: Date.now(), result };
      mem.set(mint, entry);
      const store = loadStore(); store[mint] = entry; saveStore(store);
    } else {
      mem.set(mint, { at: Date.now(), result, short: true }); // an outage: ask again after a minute
    }
    return result;
  })();
  mem.set(mint, { at: Date.now(), pending });
  return pending;
}

/** for tests */
export function _resetTokenAuditCache() { mem.clear(); try { sessionStorage.removeItem(CACHE_KEY); } catch {} }
