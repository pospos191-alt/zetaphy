// Neuro Guard content script: on a token or pool page of the listed sites, a small card (closed Shadow DOM,
// bottom-right) shows Neuro's result for that token, or a "check now" link when Neuro has no report yet.
// Text only (textContent), no page data read except the URL, nothing injected into the page's own DOM tree.
/* global NG, chrome */
(function () {
  "use strict";
  const lang = NG.langOf(navigator.language);
  const ui = NG.UI[lang];
  const COLORS = { high: "#d6336c", medium: "#e8590c", low: "#a07d00", info: "#868e96" };
  let host = null, shown = "", closed = new Set();

  const CSS = `:host{all:initial}
.card{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:340px;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Thai",sans-serif;color:#16181d;background:#fff;border:1px solid #e3e6eb;border-left:6px solid var(--c);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 12px}
@media (prefers-color-scheme:dark){.card{color:#e9ecf1;background:#171a21;border-color:#2a2f3a;border-left-color:var(--c)}}
.top{display:flex;gap:8px;align-items:center;justify-content:space-between}
.t{font-weight:600}.lv{font-weight:700;color:var(--c);font-size:15px;margin:4px 0}
.x{all:unset;cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;opacity:.7}
ul{margin:4px 0;padding-left:18px}li{margin:2px 0;overflow-wrap:anywhere}
.m{opacity:.75;font-size:12px}a{color:#3b5bdb;font-weight:600;text-decoration:none;margin-right:12px}
@media (prefers-color-scheme:dark){a{color:#7b96ff}}`;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function link(text, href) {
    const a = el("a", null, text);
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    return a;
  }
  function remove() { if (host) { host.remove(); host = null; } }

  function render(key, v) {
    remove();
    if (closed.has(key) || !v || v.none || v.error) return;
    host = document.createElement("neuro-guard");
    const root = host.attachShadow({ mode: "closed" });
    try { const s = new CSSStyleSheet(); s.replaceSync(CSS); root.adoptedStyleSheets = [s]; } catch { root.appendChild(el("style", null, CSS)); }
    const card = el("div", "card");
    const top = el("div", "top");
    top.appendChild(el("span", "t", `${ui.title} · ${ui.by}`));
    const x = el("button", "x", "×");
    x.setAttribute("aria-label", ui.close);
    x.addEventListener("click", () => { closed.add(key); remove(); });
    top.appendChild(x);
    card.appendChild(top);
    if (v.result) {
      const r = v.result;
      const words = (lang === "th" ? r.th : r.en) || r.en;
      card.style.setProperty("--c", COLORS[r.level]);
      card.appendChild(el("div", "lv", `${r.symbol ? r.symbol + ": " : ""}${words ? words.title : r.level}`));
      if (words && words.lines.length) {
        const ul = el("ul");
        for (const l of words.lines.slice(0, 3)) ul.appendChild(el("li", null, l.text));
        card.appendChild(ul);
      }
      if (r.checkedAt) card.appendChild(el("div", "m", `${ui.checked} ${r.checkedAt}`));
      const p = el("div");
      p.appendChild(link(ui.details, r.page));
      p.appendChild(link(ui.check, r.live));
      card.appendChild(p);
    } else {
      card.style.setProperty("--c", "#3b5bdb");
      card.appendChild(el("div", "m", ui.missing));
      const p = el("div");
      p.appendChild(link(ui.check, v.live));
      card.appendChild(p);
    }
    root.appendChild(card);
    (document.body || document.documentElement).appendChild(host);
  }

  function update() {
    const href = location.href;
    const t = NG.detect(href);
    const key = t ? `${t.chain}:${t.address}` : "";
    if (key === shown) return;
    shown = key;
    if (!t) { remove(); return; }
    chrome.runtime.sendMessage({ type: "check", href }, (v) => {
      if (chrome.runtime.lastError) return;
      if (shown === key) render(key, v);
    });
  }

  update();
  // single-page apps change the address without a reload
  setInterval(update, 1000);
})();
