#!/usr/bin/env node
// Search engines: the "What is ZETAPHY?" pages (8 languages), robots.txt, sitemap.xml and the IndexNow key for
// every ZETAPHY site. One source for all of them:
//   build.mjs                -> the hub's (dist/about/, dist/robots.txt, dist/sitemap.xml, dist/<key>.txt)
//   node seo.mjs --write     -> the other sites' robots.txt, sitemap.xml and key file (committed; a test checks them)
//   node seo.mjs --indexnow  -> tells Bing, Yandex, Seznam and Naver (IndexNow) about every page, after a deploy
// Google reads sitemap.xml through robots.txt; Search Console speeds it up (zetaphy-hub/README.md).
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABOUT } from './about-content.mjs';
import { LANG_CODES } from './i18n.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const ORIGIN = {
  hub: 'https://app.sawasdeecoin.com',
  neuro: 'https://neuro.sawasdeecoin.com',
  swap: 'https://swap.sawasdeecoin.com',
  wallet: 'https://wallet.sawasdeecoin.com',
  nft: 'https://nft.sawasdeecoin.com',
  explorer: 'https://explorer.sawasdeecoin.com',
};
export const REPO_URL = 'https://github.com/pospos191-alt/zetaphy';
/** The project's official e-mail (Cloudflare Email Routing; explorers' token-info forms want it listed on the site). */
export const CONTACT_EMAIL = 'zetaphy.chain@sawasdeecoin.com';
/** Who builds ZETAPHY (explorers' token-info reviews ask for the team and their public profiles). Facts only. */
export const TEAM = [{
  name: 'Mr.poterposter',
  profiles: [['X', 'https://x.com/SWD_SAWASDEE'], ['GitHub', 'https://github.com/pospos191-alt']],
  role: { en: 'Founder & Lead Developer', th: 'ผู้ก่อตั้งและนักพัฒนาหลัก', zh: '创始人兼首席开发者', es: 'Fundador y desarrollador principal', ko: '창업자 겸 수석 개발자', ja: '創業者・リード開発者', ru: 'Основатель и ведущий разработчик', vi: 'Nhà sáng lập & Lập trình viên chính' },
  bio: {
    en: 'Builds ZETAPHY end to end: the post-quantum chain (mainnet since November 2026), the Neuro token checker, the Saphan bridge to BNB Chain and Base, and the apps on this site. All of the code is public on GitHub.',
    th: 'สร้าง ZETAPHY ทั้งระบบ: เชนต้านควอนตัม (mainnet ตั้งแต่พฤศจิกายน 2026), ตัวตรวจเหรียญ Neuro, สะพาน Saphan ไป BNB Chain และ Base และแอปทั้งหมดบนเว็บนี้ โค้ดทั้งหมดเปิดเผยบน GitHub',
    zh: '从头到尾构建 ZETAPHY：抗量子区块链（2026 年 11 月起主网运行）、Neuro 代币检查器、通往 BNB Chain 和 Base 的 Saphan 跨链桥，以及本网站上的应用。全部代码在 GitHub 上公开。',
    es: 'Construye ZETAPHY de principio a fin: la cadena poscuántica (mainnet desde noviembre de 2026), el verificador de tokens Neuro, el puente Saphan a BNB Chain y Base, y las aplicaciones de este sitio. Todo el código es público en GitHub.',
    ko: 'ZETAPHY 전체를 만듭니다: 양자 내성 체인(2026년 11월부터 메인넷), Neuro 토큰 검사기, BNB Chain과 Base로 가는 Saphan 브리지, 그리고 이 사이트의 앱들. 모든 코드는 GitHub에 공개되어 있습니다.',
    ja: 'ZETAPHY を一から構築しています：耐量子チェーン（2026 年 11 月からメインネット）、Neuro トークンチェッカー、BNB Chain と Base への Saphan ブリッジ、このサイトのアプリ。コードはすべて GitHub で公開しています。',
    ru: 'Создаёт ZETAPHY целиком: постквантовую сеть (mainnet с ноября 2026 года), проверку токенов Neuro, мост Saphan в BNB Chain и Base и приложения этого сайта. Весь код открыт на GitHub.',
    vi: 'Xây dựng ZETAPHY từ đầu đến cuối: chuỗi kháng lượng tử (mainnet từ tháng 11/2026), công cụ kiểm tra token Neuro, cầu Saphan sang BNB Chain và Base, và các ứng dụng trên trang này. Toàn bộ mã nguồn công khai trên GitHub.',
  },
}];
const TEAM_HEADING = { en: 'Team', th: 'ทีม', zh: '团队', es: 'Equipo', ko: '팀', ja: 'チーム', ru: 'Команда', vi: 'Đội ngũ' };
const CONTACT_LABEL = { en: 'Contact', th: 'ติดต่อ', zh: '联系', es: 'Contacto', ko: '연락처', ja: '連絡先', ru: 'Контакты', vi: 'Liên hệ' };
// IndexNow (indexnow.org): a public key; the file <key>.txt on each site proves the site is ours. Not a secret.
export const INDEXNOW_KEY = '064679038019a2fde97fc74c5983f6aa';

/** Static sites other than the hub: folder served at the site's root, and its pages. */
export const SITES = {
  neuro: { dir: 'zetaphy-neuro', pages: ['/web/', '/web/stats.html'] },
  swap: { dir: 'zetaphy-dex/web', pages: ['/'] },
  wallet: { dir: 'zetaphy-wallet', pages: ['/'] },
  nft: { dir: 'zetaphy-nft/web', pages: ['/'] },
  explorer: { dir: 'zetaphy-explorer', pages: ['/'] },
};

/** The ZTPHY token contracts on other chains (the Saphan routes deployed; test/seo.test.mjs checks them against
 *  zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json). */
export const ZTPHY_CONTRACTS = [{ chain: 'BNB Smart Chain', chainId: 56, address: '0x68aa0f0144605024eCe1aDccFCC1626352779569', explorer: 'https://bscscan.com/token/0x68aa0f0144605024eCe1aDccFCC1626352779569' }];

/** Who publishes every ZETAPHY site, with the logo search engines show next to results (Organization, schema.org). */
export const orgLd = () => ({
  '@type': 'Organization', '@id': `${ORIGIN.hub}/#org`, name: 'ZETAPHY', alternateName: ['ZTPHY', 'SawasdeeCoin'], url: `${ORIGIN.hub}/`,
  logo: { '@type': 'ImageObject', url: `${ORIGIN.hub}/zetaphy-256.png`, width: 256, height: 256 },
  email: CONTACT_EMAIL,
  founder: TEAM.map((m) => ({ '@type': 'Person', name: m.name, jobTitle: m.role.en, sameAs: m.profiles.map(([, u]) => u) })),
  sameAs: [REPO_URL, `${ORIGIN.explorer}/`, `${ORIGIN.neuro}/web/`],
});
/** The home page's structured data: the organisation (logo) and the site it publishes. */
export const homeLd = () => ({ '@context': 'https://schema.org', '@graph': [orgLd(), { '@type': 'WebSite', '@id': `${ORIGIN.hub}/#site`, name: 'ZETAPHY', alternateName: 'ZTPHY', url: `${ORIGIN.hub}/`, publisher: { '@id': `${ORIGIN.hub}/#org` } }] });
export const homeLdTag = () => `<script type="application/ld+json">${ld(homeLd())}</script>`;

/** about/ path of a language: English at about/, the others at about/<lang>.html. */
export const aboutPath = (lang) => (lang === 'en' ? '/about/' : `/about/${lang}.html`);
export const HUB_PAGES = ['/', ...LANG_CODES.map(aboutPath), '/validators.html', '/forecasts.html', '/audit.html', '/audits.html', '/got-ztphy.html'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// Line icons (24×24, currentColor) for the about pages' cards and diagrams.
const ICON = {
  coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5h-4a1.5 1.5 0 0 0 0 3h3a1.5 1.5 0 0 1 0 3h-4M12 7.5V9M12 15.5V17"/>',
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7.5 10 6 12.5 6 15a6 6 0 0 0 6 6z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9"/>',
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  image: '<path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4"/><circle cx="15.5" cy="9" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  server: '<path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 3.5 5 3.5 8s-1 5.5-3.5 8c-2.5-2.5-3.5-5-3.5-8s1-5.5 3.5-8z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5"/>',
  play: '<path d="M7 4l12 8-12 8z"/>',
  graph: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8M18 8l-5 8"/>',
  chart: '<path d="M4 20h16M7 16v-4M12 16V8M17 16V9"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  paste: '<path d="M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M8 11h8M8 15h5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
};
const icon = (k, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
// per section, per item (same order in every language; a test checks the counts)
export const ITEM_ICONS = [['coin', 'flame', 'clock', 'flask'], ['grid', 'key', 'swap', 'image', 'search', 'server'], ['globe', 'chat', 'play', 'graph', 'chart', 'spark', 'shield', 'eye'], ['coin', 'key', 'clock', 'shield']];
const FLOW_ICONS = ['paste', 'search', 'play', 'shield'];

/** Three blocks in a row, each with its transactions and its post-quantum certificate. */
const blockFigure = (b) => `<figure class="chainfig">
<div class="blocks" role="img" aria-label="${esc(`${b.label}: ${b.tx}; ${b.cert}, ${b.sig}`)}">
${['N', 'N+1', 'N+2'].map((n) => `<div class="blk"><div class="blk-h">#${n}</div><div class="blk-r">${icon('list')}<span>${esc(b.tx)}</span></div><div class="blk-r pq">${icon('shield')}<span>${esc(b.cert)}</span></div></div>`).join('<span class="link" aria-hidden="true"></span>')}
</div>
<figcaption>${esc(b.label)}: ${esc(b.cert)}, ${esc(b.sig)}</figcaption>
</figure>`;

/** Neuro's four steps. */
const flowFigure = (f) => `<figure class="flowfig">
<figcaption>${esc(f.h)}</figcaption>
<ol class="flow">
${f.steps.map((t, i) => `<li><span class="n">${i + 1}</span>${icon(FLOW_ICONS[i], 'ic big')}<span>${esc(t)}</span></li>`).join('\n')}
</ol>
</figure>`;

export const robotsTxt = (origin) => `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;

/** sitemap.xml; `alternates`: {path: [[hreflang, path], …]} for pages in several languages. */
export function sitemapXml(origin, pages, alternates = {}) {
  const url = (p) => {
    const alt = (alternates[p] ?? []).map(([l, q]) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${origin}${q}"/>`).join('');
    return `  <url>\n    <loc>${origin}${p}</loc>${alt}\n  </url>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${pages.map(url).join('\n')}\n</urlset>\n`;
}

const aboutAlternates = () => [...LANG_CODES.map((l) => [l, aboutPath(l)]), ['x-default', aboutPath('en')]];
export const hubSitemap = () => sitemapXml(ORIGIN.hub, HUB_PAGES, Object.fromEntries(LANG_CODES.map((l) => [aboutPath(l), aboutAlternates()])));

/** A feature card: icon, name (the text before ": ") and what it does. */
const card = (text, ic) => {
  const i = text.indexOf(': ');
  const [name, rest] = i > 0 && i < 40 ? [text.slice(0, i), text.slice(i + 2)] : ['', text];
  return `<li>${icon(ic)}<div>${name ? `<b>${esc(name)}</b>` : ''}<span>${esc(rest)}</span></div></li>`;
};

/** One "What is ZETAPHY?" page: static HTML, no script (the JSON-LD block is data). */
export function aboutPage(lang) {
  const c = ABOUT[lang];
  const self = `${ORIGIN.hub}${aboutPath(lang)}`;
  const href = (l) => (l === 'en' ? './' : `./${l}.html`);
  const names = { en: 'English', th: 'ไทย', zh: '中文', es: 'Español', ko: '한국어', ja: '日本語', ru: 'Русский', vi: 'Tiếng Việt' };
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      orgLd(),
      { '@type': 'WebSite', '@id': `${ORIGIN.hub}/#site`, name: 'ZETAPHY', alternateName: 'ZTPHY', url: `${ORIGIN.hub}/`, publisher: { '@id': `${ORIGIN.hub}/#org` } },
      { '@type': 'WebPage', name: c.title, description: c.description, url: self, inLanguage: lang, isPartOf: { '@id': `${ORIGIN.hub}/#site` } },
      { '@type': 'SoftwareApplication', name: 'Neuro ZETAPHY', applicationCategory: 'SecurityApplication', operatingSystem: 'Web',
        url: `${ORIGIN.neuro}/web/`, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
      { '@type': 'SoftwareSourceCode', name: 'ZETAPHY', codeRepository: REPO_URL },
    ],
  };
  const figure = [blockFigure(c.block), null, flowFigure(c.flow)];
  const sections = c.sections.map((s, n) => `<section>
<h2>${esc(s.h)}</h2>
${s.p ? `<p>${esc(s.p)}</p>\n` : ''}${figure[n] ? `${figure[n]}\n` : ''}${s.items ? `<ul class="cards">\n${s.items.map((t, k) => card(t, ITEM_ICONS[n][k])).join('\n')}\n</ul>\n` : ''}${s.note ? `<p class="note">${esc(s.note)}</p>\n` : ''}${s === c.sections.at(-1) ? `<p><a href="${REPO_URL}">github.com/pospos191-alt/zetaphy</a> · <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>\n` : ''}</section>`).join('\n');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(c.description)}">
<link rel="canonical" href="${self}">
${aboutAlternates().map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN.hub}${p}">`).join('\n')}
<meta property="og:type" content="website">
<meta property="og:site_name" content="ZETAPHY">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:url" content="${self}">
<meta property="og:image" content="${ORIGIN.hub}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="icon" href="../zetaphy-256.png" type="image/png" sizes="256x256">
<link rel="apple-touch-icon" href="../zetaphy-256.png">
<link rel="stylesheet" href="./about.css">
<script type="application/ld+json">${ld(data)}</script>
</head>
<body>
<header>
<a class="brand" href="../"><img src="../logo.svg" alt="" width="32" height="32"><span>ZETAPHY</span></a>
<nav aria-label="${esc(c.langs)}">${LANG_CODES.map((l) => (l === lang ? `<b>${names[l]}</b>` : `<a href="${href(l)}" hreflang="${l}" lang="${l}">${names[l]}</a>`)).join(' ')}</nav>
</header>
<main>
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(c.lead)}</p>
<p class="cta"><a class="btn" href="../">${esc(c.open)}</a> <a class="btn alt" href="${ORIGIN.neuro}/web/">${esc(c.check)}</a></p>
${sections}
<section id="team">
<h2>${esc(TEAM_HEADING[lang] ?? TEAM_HEADING.en)}</h2>
${TEAM.map((m) => `<p><b>${esc(m.name)}</b> · ${esc(m.role[lang] ?? m.role.en)}</p>
<p>${esc(m.bio[lang] ?? m.bio.en)}</p>
<p>${m.profiles.map(([k, u]) => `<a href="${u}" rel="me">${esc(k)}</a>`).join(' · ')}</p>`).join('\n')}
<p>${esc(CONTACT_LABEL[lang] ?? CONTACT_LABEL.en)}: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</section>
</main>
<footer><p>${esc(c.notice)}</p></footer>
</body>
</html>
`;
}

/** llms.txt (llmstxt.org): the "What is ZETAPHY?" facts in plain Markdown for AI assistants and answer engines. */
export function llmsTxt() {
  const c = ABOUT.en;
  const sec = c.sections.map((s) => [`## ${s.h}`, s.p ?? '', ...(s.items ?? []).map((i) => `- ${i}`), s.note ?? ''].filter(Boolean).join('\n')).join('\n\n');
  return `# ZETAPHY (ZTPHY)\n\n> ${c.description}\n\n${c.lead}\n\n${sec}\n\n## Links\n\n- [What is ZETAPHY? (8 languages)](${ORIGIN.hub}/about/)\n- [App: wallet, swap, staking, NFT](${ORIGIN.hub}/)\n- [Did you get ZTPHY? Check an address](${ORIGIN.hub}/got-ztphy.html)\n- [Neuro token checker](${ORIGIN.neuro}/web/)\n- [Explorer](${ORIGIN.explorer}/)\n- [Source code](${REPO_URL})\n- Contact: ${CONTACT_EMAIL}\n${TEAM.map((m) => `- Team: ${m.name}, ${m.role.en} (${m.profiles.map(([k, u]) => `[${k}](${u})`).join(', ')})`).join('\n')}\n${ZTPHY_CONTRACTS.map((t) => `- ZTPHY on ${t.chain} (chain ${t.chainId}): ${t.address} ([explorer](${t.explorer}))`).join('\n')}\n- Logo: ${ORIGIN.hub}/zetaphy-256.png\n\n${c.notice}\n`;
}

/** {relative path: content} of the hub's search files, written into dist/ by build.mjs. */
export function hubSeoFiles() {
  return {
    ...Object.fromEntries(LANG_CODES.map((l) => [aboutPath(l).slice(1).replace(/\/$/, '/index.html'), aboutPage(l)])),
    'robots.txt': robotsTxt(ORIGIN.hub),
    'llms.txt': llmsTxt(),
    'sitemap.xml': hubSitemap(),
    [`${INDEXNOW_KEY}.txt`]: INDEXNOW_KEY,
  };
}

/** {repo path: content} of the other sites' search files (committed). */
export function siteSeoFiles() {
  const out = {};
  for (const [k, s] of Object.entries(SITES)) {
    out[`${s.dir}/robots.txt`] = robotsTxt(ORIGIN[k]);
    out[`${s.dir}/sitemap.xml`] = sitemapXml(ORIGIN[k], s.pages);
    out[`${s.dir}/${INDEXNOW_KEY}.txt`] = INDEXNOW_KEY;
  }
  return out;
}

/** Every page of every site, by host, for IndexNow. */
export function allUrls() {
  return { hub: HUB_PAGES.map((p) => ORIGIN.hub + p), ...Object.fromEntries(Object.entries(SITES).map(([k, s]) => [k, s.pages.map((p) => ORIGIN[k] + p)])) };
}

async function indexNow() {
  for (const [k, urlList] of Object.entries(allUrls())) {
    const host = new URL(ORIGIN[k]).host;
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${ORIGIN[k]}/${INDEXNOW_KEY}.txt`, urlList }),
    });
    console.log(`${host}: ${res.status} (${urlList.length} pages)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) for (const [p, c] of Object.entries(siteSeoFiles())) writeFileSync(join(ROOT, p), c);
  else if (process.argv.includes('--indexnow')) await indexNow();
  else { console.error('usage: node seo.mjs --write | --indexnow'); process.exit(2); }
}
