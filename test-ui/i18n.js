// UI text for test-ui/index.html in 8 languages. Each language is its own
// file in i18n/<lang>.js, so a visitor downloads English (the fallback) and
// their own language only — not all eight.
// STRINGS[lang][key] is read by t(key, vars); V2_STR[lang] by tv() (SWDMM v2 pages).
// To add or change text: edit the key in ALL 8 files (tests/i18n.test.mjs fails otherwise).
export const LANGS = ["th", "en", "zh", "ja", "ko", "vi", "es", "ru"];
export const LANG_NAMES = { th: "ไทย", en: "English", zh: "中文", ja: "日本語", ko: "한국어", vi: "Tiếng Việt", es: "Español", ru: "Русский" };

export const STRINGS = {};
export const V2_STR = {};

const loading = new Map();
/** Loads one language (once). Resolves false for an unknown language or a failed download. */
export function loadLang(lang) {
  if (STRINGS[lang]) return Promise.resolve(true);
  if (!LANGS.includes(lang)) return Promise.resolve(false);
  if (!loading.has(lang)) {
    loading.set(lang, import(`./i18n/${lang}.js`).then((m) => {
      STRINGS[lang] = m.default.main;
      V2_STR[lang] = m.default.v2;
      return true;
    }, () => { loading.delete(lang); return false; }));
  }
  return loading.get(lang);
}

/** First visit: the browser's language when it is one of the 8, else English. A saved choice wins. */
export function pickLang(saved, browserLangs) {
  if (LANGS.includes(saved)) return saved;
  const b = (browserLangs || []).map((l) => String(l).slice(0, 2).toLowerCase()).find((l) => LANGS.includes(l));
  return b || "en";
}
