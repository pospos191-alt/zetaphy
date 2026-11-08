// Where this page's API is (server/http.js answers it).
// 2026-11-08: the pages moved to Cloudflare Pages (static files only: docs/CLOUDFLARE-PAGES.md), and the API kept its
// own address on Vercel, neuro-api.sawasdeecoin.com. So the public sites (Neuro's own, and the ZETAPHY hub that shows
// it under /neuro/web/) call that address directly: each visitor is counted and rate-limited by their own address,
// not by a proxy's. Anywhere else (the Vercel URL itself, localhost with scripts/serve.js) the API is same-origin.
export const API_HOST = 'https://neuro-api.sawasdeecoin.com';
const PUBLIC_HOSTS = ['neuro.sawasdeecoin.com', 'app.sawasdeecoin.com', 'zetaphy-neuro.pages.dev', 'zetaphy-hub.pages.dev', 'zetaphy-hub.vercel.app'];
export const apiBase = (host) => (PUBLIC_HOSTS.includes(host) ? API_HOST : '');
export const api = (path) => apiBase(location.host) + path;
