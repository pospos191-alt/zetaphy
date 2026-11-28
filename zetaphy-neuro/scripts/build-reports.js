#!/usr/bin/env node
// Neuro's public token reports: one static page per token (9 languages), found by search engines.
// People search "is <token> safe?" every day; these pages answer with Neuro's reproducible code check and lead
// back to the live checker and to ZETAPHY. Static files only (Cloudflare Pages, free): no server, no wallet.
//
// Which tokens: the new and trending pools GeckoTerminal lists on Ethereum, BNB Chain, Base and Arbitrum (its free
// public API), the token that is not a known coin (WETH, USDC… are skipped). Each is read with src/reader.js exactly
// like the website does (same rules, same trade simulation), so a page and a live check agree on the day it was made.
// A token whose name or symbol carries a link is never published (it would turn this site into its advertising).
//
//   node scripts/build-reports.js run   --out <dir> [--store <old store.json>] [--max-new 120] [--refresh 40] [--cap 1200]
//       [อ่าน] the chains + GeckoTerminal; writes <dir>/store.json (what was read) and <dir>/reports/ (the pages)
//   node scripts/build-reports.js render --out <dir> --store <store.json>   pages again from a store (wording changes)
//   node scripts/build-reports.js check <dir>       refuses anything but the expected files (cf-pages.yml runs it
//                                                    before copying <dir>/reports into the site)
// .github/workflows/neuro-reports.yml runs it every 6 hours and keeps the result on the `neuro-reports` branch.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CHAINS } from '../src/chains.js';
import { explain, uiText, LANGS } from '../src/explain.js';
import { knownToken } from '../src/known-tokens.js';

export const ORIGIN = 'https://neuro.sawasdeecoin.com';
export const HUB = 'https://app.sawasdeecoin.com';
/** Neuro chain key -> GeckoTerminal network id (only EVM chains: the trade simulation and the LP check run there). */
export const GECKO = { eth: 'eth', bsc: 'bsc', base: 'base', arbitrum: 'arbitrum' };
export const LANG_ORDER = ['en', 'th', 'zh', 'es', 'ko', 'ja', 'ru', 'vi', 'id'];
export const LANG_NAME = { en: 'English', th: 'ไทย', zh: '中文', es: 'Español', ko: '한국어', ja: '日本語', ru: 'Русский', vi: 'Tiếng Việt', id: 'Bahasa Indonesia' };
// The hub's "What is ZETAPHY?" page has 8 languages (no Indonesian).
const ABOUT = (l) => `${HUB}/about/${l === 'en' || l === 'id' ? '' : `${l}.html`}`;
const LEVELS = ['high', 'medium', 'low', 'info'];
export const STORE_VERSION = 1;

/** The page's own words (the findings come from src/lang/*.js). */
export const TEXT = {
  en: { title: (s, c) => `Is ${s} safe? ${c} token contract check`, checked: 'Checked on', recheck: 'Check again now (live)', findings: 'What the contract allows', latest: 'Latest token checks', onChain: (c) => `Token checks on ${c}`, token: 'Token', result: 'Result', date: 'Date', all: 'All checks', snapshot: 'This page is a snapshot from the date above. The contract may have changed since; check again for its current state.', about: 'Neuro is a free token checker from ZETAPHY, a post-quantum blockchain. It reads public chain data and never asks to connect a wallet.', aboutLink: 'What is ZETAPHY?', badge: 'Show this result on your site', badgeHow: 'Copy this HTML. The badge links to this page and shows the result of the date above.', explorer: 'Open in explorer', open: 'Open Neuro' },
  th: { title: (s, c) => `${s} ปลอดภัยไหม? ตรวจสัญญาเหรียญบน ${c}`, checked: 'ตรวจเมื่อ', recheck: 'ตรวจใหม่ตอนนี้ (สด)', findings: 'สัญญานี้ทำอะไรได้บ้าง', latest: 'ผลตรวจเหรียญล่าสุด', onChain: (c) => `ผลตรวจเหรียญบน ${c}`, token: 'เหรียญ', result: 'ผล', date: 'วันที่', all: 'ผลตรวจทั้งหมด', snapshot: 'หน้านี้เป็นผลตรวจ ณ วันที่ด้านบน สัญญาอาจเปลี่ยนไปแล้ว กดตรวจใหม่เพื่อดูสถานะปัจจุบัน', about: 'Neuro เป็นเครื่องมือตรวจเหรียญฟรีจาก ZETAPHY บล็อกเชนต้านควอนตัม อ่านข้อมูลสาธารณะบนเชนเท่านั้น และไม่เคยขอให้เชื่อมกระเป๋า', aboutLink: 'ZETAPHY คืออะไร?', badge: 'แสดงผลนี้บนเว็บของคุณ', badgeHow: 'คัดลอก HTML นี้ไปวาง ป้ายจะลิงก์มาที่หน้านี้และแสดงผลตรวจ ณ วันที่ด้านบน', explorer: 'เปิดใน explorer', open: 'เปิด Neuro' },
  zh: { title: (s, c) => `${s} 安全吗？${c} 代币合约检查`, checked: '检查日期', recheck: '立即重新检查（实时）', findings: '该合约允许做什么', latest: '最新代币检查', onChain: (c) => `${c} 上的代币检查`, token: '代币', result: '结果', date: '日期', all: '全部检查', snapshot: '本页是上述日期的快照。合约此后可能已更改；请重新检查以查看当前状态。', about: 'Neuro 是 ZETAPHY（一条抗量子区块链）提供的免费代币检查工具。它只读取公开链上数据，从不要求连接钱包。', aboutLink: '什么是 ZETAPHY？', badge: '在您的网站上显示此结果', badgeHow: '复制这段 HTML。徽章链接到本页，显示上述日期的结果。', explorer: '在浏览器中打开', open: '打开 Neuro' },
  es: { title: (s, c) => `¿Es seguro ${s}? Revisión del contrato del token en ${c}`, checked: 'Revisado el', recheck: 'Revisar de nuevo ahora (en vivo)', findings: 'Lo que permite el contrato', latest: 'Últimas revisiones de tokens', onChain: (c) => `Revisiones de tokens en ${c}`, token: 'Token', result: 'Resultado', date: 'Fecha', all: 'Todas las revisiones', snapshot: 'Esta página es una instantánea de la fecha indicada. El contrato puede haber cambiado; revíselo de nuevo para ver su estado actual.', about: 'Neuro es un verificador de tokens gratuito de ZETAPHY, una blockchain poscuántica. Lee datos públicos de la cadena y nunca pide conectar una billetera.', aboutLink: '¿Qué es ZETAPHY?', badge: 'Muestre este resultado en su sitio', badgeHow: 'Copie este HTML. La insignia enlaza a esta página y muestra el resultado de la fecha indicada.', explorer: 'Abrir en el explorador', open: 'Abrir Neuro' },
  ko: { title: (s, c) => `${s}은(는) 안전한가요? ${c} 토큰 컨트랙트 검사`, checked: '검사일', recheck: '지금 다시 검사 (실시간)', findings: '이 컨트랙트가 할 수 있는 것', latest: '최신 토큰 검사', onChain: (c) => `${c} 토큰 검사`, token: '토큰', result: '결과', date: '날짜', all: '전체 검사', snapshot: '이 페이지는 위 날짜의 스냅샷입니다. 이후 컨트랙트가 바뀌었을 수 있으니 현재 상태는 다시 검사하세요.', about: 'Neuro는 양자 내성 블록체인 ZETAPHY의 무료 토큰 검사기입니다. 공개 체인 데이터만 읽으며 지갑 연결을 요구하지 않습니다.', aboutLink: 'ZETAPHY란?', badge: '내 사이트에 이 결과 표시', badgeHow: '이 HTML을 복사하세요. 배지는 이 페이지로 연결되며 위 날짜의 결과를 보여 줍니다.', explorer: '탐색기에서 열기', open: 'Neuro 열기' },
  ja: { title: (s, c) => `${s} は安全？ ${c} のトークンコントラクトチェック`, checked: 'チェック日', recheck: '今すぐ再チェック（ライブ）', findings: 'このコントラクトでできること', latest: '最新のトークンチェック', onChain: (c) => `${c} のトークンチェック`, token: 'トークン', result: '結果', date: '日付', all: 'すべてのチェック', snapshot: 'このページは上記の日付時点のスナップショットです。その後コントラクトが変わっている可能性があるため、現在の状態は再チェックしてください。', about: 'Neuro は耐量子ブロックチェーン ZETAPHY の無料トークンチェッカーです。公開チェーンデータだけを読み、ウォレット接続を求めません。', aboutLink: 'ZETAPHY とは？', badge: 'この結果をサイトに表示', badgeHow: 'この HTML をコピーしてください。バッジはこのページにリンクし、上記の日付の結果を表示します。', explorer: 'エクスプローラーで開く', open: 'Neuro を開く' },
  ru: { title: (s, c) => `Безопасен ли ${s}? Проверка контракта токена в ${c}`, checked: 'Проверено', recheck: 'Проверить снова (сейчас)', findings: 'Что позволяет контракт', latest: 'Последние проверки токенов', onChain: (c) => `Проверки токенов в ${c}`, token: 'Токен', result: 'Результат', date: 'Дата', all: 'Все проверки', snapshot: 'Эта страница — снимок на указанную дату. С тех пор контракт мог измениться; проверьте снова, чтобы увидеть текущее состояние.', about: 'Neuro — бесплатная проверка токенов от ZETAPHY, постквантового блокчейна. Читает только публичные данные сети и никогда не просит подключить кошелёк.', aboutLink: 'Что такое ZETAPHY?', badge: 'Показать результат на своём сайте', badgeHow: 'Скопируйте этот HTML. Значок ведёт на эту страницу и показывает результат на указанную дату.', explorer: 'Открыть в обозревателе', open: 'Открыть Neuro' },
  vi: { title: (s, c) => `${s} có an toàn không? Kiểm tra hợp đồng token trên ${c}`, checked: 'Kiểm tra ngày', recheck: 'Kiểm tra lại ngay (trực tiếp)', findings: 'Hợp đồng cho phép làm gì', latest: 'Kiểm tra token mới nhất', onChain: (c) => `Kiểm tra token trên ${c}`, token: 'Token', result: 'Kết quả', date: 'Ngày', all: 'Tất cả kiểm tra', snapshot: 'Trang này là ảnh chụp tại ngày ở trên. Hợp đồng có thể đã thay đổi; hãy kiểm tra lại để xem trạng thái hiện tại.', about: 'Neuro là công cụ kiểm tra token miễn phí của ZETAPHY, một blockchain kháng lượng tử. Chỉ đọc dữ liệu công khai trên chuỗi và không bao giờ yêu cầu kết nối ví.', aboutLink: 'ZETAPHY là gì?', badge: 'Hiển thị kết quả này trên trang của bạn', badgeHow: 'Sao chép HTML này. Huy hiệu liên kết tới trang này và hiển thị kết quả của ngày ở trên.', explorer: 'Mở trong explorer', open: 'Mở Neuro' },
  id: { title: (s, c) => `Apakah ${s} aman? Pemeriksaan kontrak token di ${c}`, checked: 'Diperiksa pada', recheck: 'Periksa lagi sekarang (langsung)', findings: 'Apa yang diizinkan kontrak', latest: 'Pemeriksaan token terbaru', onChain: (c) => `Pemeriksaan token di ${c}`, token: 'Token', result: 'Hasil', date: 'Tanggal', all: 'Semua pemeriksaan', snapshot: 'Halaman ini adalah cuplikan pada tanggal di atas. Kontrak mungkin sudah berubah; periksa lagi untuk melihat keadaan saat ini.', about: 'Neuro adalah pemeriksa token gratis dari ZETAPHY, blockchain pascakuantum. Hanya membaca data publik di chain dan tidak pernah meminta menghubungkan dompet.', aboutLink: 'Apa itu ZETAPHY?', badge: 'Tampilkan hasil ini di situs Anda', badgeHow: 'Salin HTML ini. Lencana menautkan ke halaman ini dan menampilkan hasil pada tanggal di atas.', explorer: 'Buka di explorer', open: 'Buka Neuro' },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Contract-written text, made safe to show: no control or bidi characters, bounded length. */
export const clean = (s, max = 40) => {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const LINKY = /(https?:|www\.|\.(com|io|org|net|xyz|app|finance|vip|top|site|claim|gift|pro|cc|me|co|link|live|fun)\b|t\.me|\bclaim\b|\bairdrop\b|\breward)/i;
export const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ''));
export const pagePath = (chain, address, lang = 'en') => `/reports/${chain}/${address.toLowerCase()}/${lang === 'en' ? '' : `${lang}.html`}`;
export const dateOf = (iso) => String(iso ?? '').slice(0, 10);

/** The tokens of a GeckoTerminal pools response (`?include=base_token,quote_token`): the side that is not a known coin. */
export function geckoTokens(json, chain) {
  const net = GECKO[chain];
  if (!net || !Array.isArray(json?.data)) return [];
  const inc = new Map((json.included ?? []).filter((x) => x?.type === 'token').map((x) => [x.id, x.attributes ?? {}]));
  const out = [];
  for (const p of json.data) {
    const side = (k) => {
      const id = p?.relationships?.[k]?.data?.id ?? '';
      const address = id.startsWith(`${net}_`) ? id.slice(net.length + 1) : inc.get(id)?.address;
      return isAddress(address) ? { address: address.toLowerCase(), name: inc.get(id)?.name, symbol: inc.get(id)?.symbol } : null;
    };
    const base = side('base_token'), quote = side('quote_token');
    const pick = [base, quote].find((t) => t && !knownToken(chain, t.address));
    if (!pick) continue;
    out.push({ chain, ...pick, pool: String(p?.attributes?.address ?? '').toLowerCase() || undefined, liquidityUsd: Number(p?.attributes?.reserve_in_usd) || 0 });
  }
  return out;
}

/** Whether a read report may be published. */
export function publishable(rep) {
  const f = rep?.analysis?.findings;
  if (!Array.isArray(f) || !rep.token?.symbol) return false;
  if (f.some((x) => x.id === 'name-has-link' || x.id === 'no-code' || x.id === 'not-erc20')) return false;
  return !LINKY.test(`${rep.token.name ?? ''} ${rep.token.symbol ?? ''}`);
}

const plain = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

/** What the store keeps of a report: what explain() and the page need, nothing that changes every block. */
export function slim(rep, now) {
  return {
    chain: rep.chain, address: rep.address.toLowerCase(),
    token: { name: clean(rep.token?.name, 60), symbol: clean(rep.token?.symbol, 24) },
    analysis: { level: rep.analysis.level, findings: rep.analysis.findings.map((x) => ({ id: x.id, severity: x.severity, ...(x.params ? { params: plain(x.params) } : {}) })) },
    reportHash: rep.reportHash, checkedAt: now,
  };
}

/** Old entries + this run's, newest check per token, at most `cap` (the most recently listed first). */
export function mergeStore(old, fresh, { cap = 1200 } = {}) {
  const by = new Map();
  for (const e of [...(old?.entries ?? []), ...fresh]) {
    const k = `${e.chain}:${e.address}`;
    const prev = by.get(k);
    if (!prev) { by.set(k, e); continue; }
    by.set(k, { ...(e.checkedAt >= prev.checkedAt ? e : prev), firstSeen: [prev.firstSeen, e.firstSeen].filter(Boolean).sort()[0], listedAt: [prev.listedAt, e.listedAt].filter(Boolean).sort().at(-1) });
  }
  const entries = [...by.values()].sort((a, b) => String(b.listedAt ?? b.checkedAt).localeCompare(String(a.listedAt ?? a.checkedAt)) || a.address.localeCompare(b.address)).slice(0, cap);
  return { version: STORE_VERSION, entries };
}

const levelOf = (e) => (LEVELS.includes(e.analysis?.level) ? e.analysis.level : 'info');
const levelName = (e, l) => (LANGS[l] ?? LANGS.en).LEVEL?.[levelOf(e)] ?? LANGS.en.LEVEL[levelOf(e)];
const chainName = (c) => CHAINS[c]?.name ?? c;

function head({ lang, title, description, path, alternates, ld }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${ORIGIN}${path}">
${(alternates ?? []).map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN}${p}">`).join('\n')}
<meta property="og:type" content="article">
<meta property="og:site_name" content="Neuro by ZETAPHY">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${ORIGIN}${path}">
<meta property="og:image" content="${ORIGIN}/web/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/web/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/web/report.css">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n` : ''}</head>`;
}

const langNav = (cur, hrefOf) => `<nav class="langs" aria-label="Language">${LANG_ORDER.map((l) => (l === cur ? `<b>${LANG_NAME[l]}</b>` : `<a href="${hrefOf(l)}" hreflang="${l}" lang="${l}">${LANG_NAME[l]}</a>`)).join(' ')}</nav>`;
const top = (lang, nav) => `<body>\n<header><a class="brand" href="/web/"><img src="/web/logo.svg" alt="" width="28" height="28"><span>Neuro</span></a>${nav}</header>\n<main>`;
const foot = (lang) => {
  const t = TEXT[lang] ?? TEXT.en;
  return `<aside class="about"><p>${esc(t.about)}</p><p><a href="${ABOUT(lang)}">${esc(t.aboutLink)}</a> · <a href="/web/">${esc(t.open)}</a> · <a href="/reports/${lang === 'en' ? '' : `${lang}.html`}">${esc(t.latest)}</a></p></aside>
</main>
<footer><p>${esc(uiText(lang).disclaimer)} <a href="/web/legal.html">${esc(uiText(lang).correction)}</a></p></footer>
</body>
</html>
`;
};

/** One token's page in one language. */
export function reportPage(e, lang = 'en') {
  const t = TEXT[lang] ?? TEXT.en;
  const sym = e.token.symbol || '?';
  const name = e.token.name || sym;
  const x = explain({ analysis: e.analysis }, lang);
  const title = `${t.title(sym, chainName(e.chain))} | Neuro`;
  const description = clean(`${x.title}. ${x.lines.filter((l) => l.severity === 'high' || l.severity === 'medium').slice(0, 2).map((l) => l.text).join(' ')} ${t.checked} ${dateOf(e.checkedAt)}.`, 300);
  const path = pagePath(e.chain, e.address, lang);
  const alternates = [...LANG_ORDER.map((l) => [l, pagePath(e.chain, e.address, l)]), ['x-default', pagePath(e.chain, e.address)]];
  const live = `/web/?chain=${encodeURIComponent(e.chain)}&address=${e.address}`;
  const badge = `${ORIGIN}/reports/${e.chain}/${e.address}/badge.svg`;
  const embed = `<a href="${ORIGIN}${pagePath(e.chain, e.address)}"><img src="${badge}" alt="Neuro check: ${esc(levelName(e, 'en'))}" width="190" height="20"></a>`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', name: title, description, url: `${ORIGIN}${path}`, inLanguage: lang, dateModified: e.checkedAt, ...(e.firstSeen ? { datePublished: e.firstSeen } : {}),
        isPartOf: { '@type': 'WebSite', name: 'Neuro by ZETAPHY', url: `${ORIGIN}/web/` }, publisher: { '@type': 'Organization', name: 'ZETAPHY', url: `${HUB}/` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Neuro', item: `${ORIGIN}/web/` },
        { '@type': 'ListItem', position: 2, name: t.onChain(chainName(e.chain)), item: `${ORIGIN}/reports/${e.chain}/` },
        { '@type': 'ListItem', position: 3, name: `${sym}`, item: `${ORIGIN}${path}` }] },
    ],
  };
  return `${head({ lang, title, description, path, alternates, ld })}
${top(lang, langNav(lang, (l) => (l === 'en' ? './' : `./${l}.html`)))}
<p class="crumbs"><a href="/reports/${e.chain}/">${esc(t.onChain(chainName(e.chain)))}</a></p>
<h1>${esc(t.title(sym, chainName(e.chain)))}</h1>
<p class="token">${esc(name)} (${esc(sym)}) · <code>${e.address}</code> · <a href="${esc(CHAINS[e.chain]?.explorer ?? '')}${e.address}" rel="nofollow noopener">${esc(t.explorer)}</a></p>
<p class="written">${esc(uiText(lang).asWritten)}</p>
<section class="verdict lv-${levelOf(e)}"><h2>${esc(x.title)}</h2><p>${esc(t.checked)} <time datetime="${esc(e.checkedAt)}">${esc(dateOf(e.checkedAt))}</time></p>
<p><a class="btn" href="${live}">${esc(t.recheck)}</a></p></section>
<section><h2>${esc(t.findings)}</h2>
<ul class="findings">
${x.lines.map((l) => `<li class="sv-${esc(l.severity)}">${esc(l.text)}</li>`).join('\n')}
</ul>
<p class="note">${esc(t.snapshot)}</p></section>
<section class="embed"><h2>${esc(t.badge)}</h2><p><img src="./badge.svg" alt="" width="190" height="20"></p><p>${esc(t.badgeHow)}</p><pre><code>${esc(embed)}</code></pre></section>
${foot(lang)}`;
}

/** A list of checks (the latest, or one chain's). */
export function indexPage(entries, lang = 'en', chain = null) {
  const t = TEXT[lang] ?? TEXT.en;
  const h = chain ? t.onChain(chainName(chain)) : t.latest;
  const base = chain ? `/reports/${chain}/` : '/reports/';
  const path = `${base}${lang === 'en' ? '' : `${lang}.html`}`;
  const alternates = [...LANG_ORDER.map((l) => [l, `${base}${l === 'en' ? '' : `${l}.html`}`]), ['x-default', base]];
  const chains = [...new Set(entries.map((e) => e.chain))].sort();
  const rows = entries.map((e) => `<tr><td><a href="${pagePath(e.chain, e.address, lang)}">${esc(e.token.symbol || '?')}</a> <span class="muted">${esc(e.token.name)}</span></td><td>${esc(chainName(e.chain))}</td><td class="lv-${levelOf(e)}">${esc(levelName(e, lang))}</td><td>${esc(dateOf(e.checkedAt))}</td></tr>`).join('\n');
  return `${head({ lang, title: `${h} | Neuro by ZETAPHY`, description: `${h}: ${entries.length} · ${t.about}`, path, alternates })}
${top(lang, langNav(lang, (l) => `${base}${l === 'en' ? '' : `${l}.html`}`))}
<h1>${esc(h)}</h1>
<p class="chains">${chain ? `<a href="/reports/${lang === 'en' ? '' : `${lang}.html`}">${esc(t.all)}</a> · ` : ''}${chains.filter((c) => c !== chain).map((c) => `<a href="/reports/${c}/${lang === 'en' ? '' : `${lang}.html`}">${esc(chainName(c))}</a>`).join(' · ')}</p>
<div class="tbl"><table><thead><tr><th>${esc(t.token)}</th><th>Chain</th><th>${esc(t.result)}</th><th>${esc(t.date)}</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
${foot(lang)}`;
}

const BADGE_COLOR = { high: '#c92a5a', medium: '#d9480f', low: '#8a6d00', info: '#5c636a' };
/** A shields-style badge (no script, no external font). */
export function badgeSvg(e) {
  const lv = levelOf(e), label = 'Neuro check', value = LANGS.en.LEVEL[lv];
  const lw = 74, vw = 116, w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(`${label}: ${value}`)}"><title>${esc(`${label}: ${value} (${dateOf(e.checkedAt)})`)}</title><rect width="${lw}" height="20" fill="#3b5bdb"/><rect x="${lw}" width="${vw}" height="20" fill="${BADGE_COLOR[lv]}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14">${esc(value.length > 18 ? value.slice(0, 17) + '…' : value)}</text></g></svg>\n`;
}

export function sitemap(entries) {
  const chains = [...new Set(entries.map((e) => e.chain))].sort();
  const urls = [];
  for (const l of LANG_ORDER) urls.push(['/reports/' + (l === 'en' ? '' : `${l}.html`), null]);
  for (const c of chains) for (const l of LANG_ORDER) urls.push([`/reports/${c}/${l === 'en' ? '' : `${l}.html`}`, null]);
  for (const e of entries) for (const l of LANG_ORDER) urls.push([pagePath(e.chain, e.address, l), dateOf(e.checkedAt)]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, d]) => `<url><loc>${ORIGIN}${p}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}

/** {path under the output dir: content} for every page. */
export function renderAll(store) {
  const entries = store.entries.filter((e) => CHAINS[e.chain] && isAddress(e.address));
  const files = {};
  const byDate = [...entries].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  for (const l of LANG_ORDER) {
    const suffix = l === 'en' ? 'index.html' : `${l}.html`;
    files[`reports/${suffix}`] = indexPage(byDate.slice(0, 300), l);
    for (const c of [...new Set(entries.map((e) => e.chain))]) files[`reports/${c}/${suffix}`] = indexPage(byDate.filter((e) => e.chain === c).slice(0, 500), l, c);
    for (const e of entries) files[`reports/${e.chain}/${e.address}/${suffix}`] = reportPage(e, l);
  }
  for (const e of entries) files[`reports/${e.chain}/${e.address}/badge.svg`] = badgeSvg(e);
  files['reports/sitemap.xml'] = sitemap(entries);
  return files;
}

/** Refuses a reports dir with anything but the files renderAll writes (cf-pages.yml copies it into the site). */
export function checkDir(dir, { maxFiles = 15000, maxBytes = 400_000 } = {}) {
  const root = join(dir, 'reports');
  if (!existsSync(root)) throw new Error(`${root}: missing`);
  const ok = /^reports\/(?:(?:index|[a-z]{2})\.html|sitemap\.xml|[a-z]+\/(?:index|[a-z]{2})\.html|[a-z]+\/0x[0-9a-f]{40}\/(?:(?:index|[a-z]{2})\.html|badge\.svg))$/;
  let n = 0;
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f), s = statSync(p);
      if (s.isDirectory()) { walk(p); continue; }
      const rel = relative(dir, p).split(sep).join('/');
      if (!s.isFile() || !ok.test(rel)) throw new Error(`unexpected file ${rel}`);
      if (s.size > (rel === 'reports/sitemap.xml' ? 20_000_000 : maxBytes)) throw new Error(`${rel}: too large`);
      const m = /^reports\/([a-z]+)\//.exec(rel);
      if (m && !CHAINS[m[1]]) throw new Error(`unknown chain in ${rel}`);
      if (++n > maxFiles) throw new Error(`more than ${maxFiles} files`);
    }
  };
  walk(root);
  if (!existsSync(join(root, 'index.html')) || !existsSync(join(root, 'sitemap.xml'))) throw new Error('index.html or sitemap.xml missing');
  return n;
}

// ---------------------------------------------------------------- the run (network)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gecko(path, fetchImpl = fetch) {
  for (let i = 0; i < 3; i++) {
    const r = await fetchImpl(`https://api.geckoterminal.com/api/v2/${path}`, { headers: { accept: 'application/json' } });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`GeckoTerminal ${path}: HTTP ${r.status}`);
    await sleep(20000);
  }
  throw new Error(`GeckoTerminal ${path}: no answer`);
}

/** Candidates: new + trending pools of every chain (GeckoTerminal allows ~30 calls a minute: one every 2.5 s). */
export async function candidates({ fetchImpl = fetch, pause = 2500, log = () => {} } = {}) {
  const out = [];
  for (const [chain, net] of Object.entries(GECKO)) {
    for (const kind of ['trending_pools', 'new_pools']) {
      try {
        const got = geckoTokens(await gecko(`networks/${net}/${kind}?include=base_token,quote_token&page=1`, fetchImpl), chain);
        log(`${chain} ${kind}: ${got.length}`);
        out.push(...got);
      } catch (e) { log(`${chain} ${kind}: ${e.message}`); }
      await sleep(pause);
    }
  }
  const seen = new Set();
  return out.filter((t) => { const k = `${t.chain}:${t.address}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function run(o) {
  // loaded here: the reader needs the trade simulation's EVM (npm ci); `check` and `render` need no install
  const { readContract } = await import('../src/reader.js');
  const now = new Date().toISOString();
  const old = o.store && existsSync(o.store) ? JSON.parse(readFileSync(o.store, 'utf8')) : { entries: [] };
  const known = new Map((old.entries ?? []).map((e) => [`${e.chain}:${e.address}`, e]));
  const listed = await candidates({ log: console.log });
  const maxNew = Number(o['max-new'] ?? 120), refresh = Number(o.refresh ?? 40);
  const week = Date.now() - 7 * 86400e3;
  const fresh = listed.filter((t) => !known.has(`${t.chain}:${t.address}`)).slice(0, maxNew);
  const stale = listed.filter((t) => known.has(`${t.chain}:${t.address}`) && Date.parse(known.get(`${t.chain}:${t.address}`).checkedAt) < week).slice(0, refresh);
  // tokens listed again keep their place even when not re-read this run
  const relisted = listed.filter((t) => known.has(`${t.chain}:${t.address}`)).map((t) => ({ ...known.get(`${t.chain}:${t.address}`), listedAt: now }));
  const todo = [...fresh, ...stale];
  const done = [];
  let skipped = 0, failed = 0;
  const work = [...todo];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let t; (t = work.shift());) {
      try {
        const rep = await withTimeout(readContract(t.chain, t.address), 90_000);
        if (!publishable(rep)) { skipped++; continue; }
        const prev = known.get(`${t.chain}:${t.address}`);
        done.push({ ...slim(rep, now), firstSeen: prev?.firstSeen ?? now, listedAt: now });
      } catch (e) { failed++; console.log(`${t.chain} ${t.address}: ${String(e.message).slice(0, 120)}`); }
    }
  }));
  const store = mergeStore(old, [...relisted, ...done], { cap: Number(o.cap ?? 1200) });
  console.log(`listed ${listed.length}, read ${todo.length} (new ${fresh.length}, refreshed ${stale.length}): published ${done.length}, skipped ${skipped}, failed ${failed}; store ${store.entries.length}`);
  return store;
}

function write(out, store) {
  rmSync(join(out, 'reports'), { recursive: true, force: true });
  for (const [p, c] of Object.entries(renderAll(store))) { mkdirSync(join(out, p, '..'), { recursive: true }); writeFileSync(join(out, p), c); }
  writeFileSync(join(out, 'store.json'), JSON.stringify(store) + '\n');
  console.log(`wrote ${checkDir(out)} files to ${join(out, 'reports')}`);
}

const argsOf = (a) => { const o = { _: [] }; for (let i = 0; i < a.length; i++) a[i].startsWith('--') ? (o[a[i].slice(2)] = a[++i]) : o._.push(a[i]); return o; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = argsOf(process.argv.slice(2));
  const cmd = o._[0];
  try {
    if (cmd === 'run') { if (!o.out) throw new Error('--out'); write(o.out, await run(o)); }
    else if (cmd === 'render') { if (!o.out || !o.store) throw new Error('--out and --store'); write(o.out, JSON.parse(readFileSync(o.store, 'utf8'))); }
    else if (cmd === 'check') console.log(`ok: ${checkDir(o._[1] ?? '.')} files`);
    else throw new Error('usage: build-reports.js run|render|check (see the top of the file)');
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
