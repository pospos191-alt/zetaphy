// Every UI language has every English key, with the same {placeholders}.
// Run: node --test i18n.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { LANGS, STRINGS, V2_STR } from "../i18n.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("the 8 languages: th en zh ja ko vi es ru", () => {
  assert.deepEqual([...LANGS].sort(), ["en", "es", "ja", "ko", "ru", "th", "vi", "zh"]);
});

for (const [name, table] of [["STRINGS", STRINGS], ["V2_STR", V2_STR]]) {
  test(`${name}: no language misses a key or a {placeholder}`, () => {
    const problems = [];
    for (const lang of LANGS) {
      for (const [k, en] of Object.entries(table.en)) {
        const v = table[lang]?.[k];
        if (v == null) problems.push(`${lang}.${k} missing`);
        else if (ph(v) !== ph(en)) problems.push(`${lang}.${k} placeholders {${ph(v)}} ≠ {${ph(en)}}`);
      }
    }
    assert.deepEqual(problems.slice(0, 20), []);
  });
}

test("every data-i18n key used by index.html exists in English", () => {
  const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
  const used = new Set([...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => !k.includes("${") && !(k in STRINGS.en)); // ${…}: built at runtime
  assert.deepEqual(missing, []);
});

test("the language picker offers exactly the 8 languages", () => {
  const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
  const sel = html.match(/<select id="lang-select">([\s\S]*?)<\/select>/)[1];
  const opts = [...sel.matchAll(/value="(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(opts, [...LANGS].sort());
});
