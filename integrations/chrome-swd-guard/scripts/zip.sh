#!/bin/sh
# Builds the upload file for the Chrome Web Store: dist/swd-guard-<version>.zip
# Only what the extension needs goes in (manifest, _locales, icons, src, data); no tests, scripts, docs, store/
# images, node_modules or hidden / editor files. The script fails if anything else ends up in the zip.
set -eu
cd "$(dirname "$0")/.."
node scripts/check.mjs
node --test test/common.test.mjs >/dev/null
VERSION=$(node -p "require('./manifest.json').version")
mkdir -p dist
OUT="dist/swd-guard-$VERSION.zip"
rm -f "$OUT"
zip -q -r -X -D "$OUT" manifest.json _locales icons src data -x '*/.*' '.*' '*~' '*.swp' '*.orig' '*.map'
BAD=$(unzip -Z1 "$OUT" | grep -Ev '^(manifest\.json|_locales/|icons/|src/|data/)' || true)
BAD="$BAD$(unzip -Z1 "$OUT" | grep -E '(^|/)\.|\.(md|mjs|py|sh)$' || true)"
if [ -n "$BAD" ]; then
  echo "unexpected files in $OUT:" >&2
  echo "$BAD" >&2
  exit 1
fi
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
unzip -l "$OUT" | tail -1
