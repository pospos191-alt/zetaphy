#!/bin/sh
# Builds the upload file for the Chrome Web Store and Firefox Add-ons: dist/neuro-guard-<version>.zip
# Only what the extension needs goes in (manifest, icons, src); the script fails if anything else ends up in it.
set -eu
cd "$(dirname "$0")/.."
node scripts/check.mjs
node --test test/extension.test.mjs >/dev/null
VERSION=$(node -p "require('./manifest.json').version")
mkdir -p dist
OUT="dist/neuro-guard-$VERSION.zip"
rm -f "$OUT"
zip -q -r -X -D "$OUT" manifest.json icons src -x '*/.*' '.*' '*~' '*.swp' '*.orig' '*.map'
BAD=$(unzip -Z1 "$OUT" | grep -Ev '^(manifest\.json|icons/icon(16|32|48|128)\.png|src/(detect|background|content)\.js)$' || true)
if [ -n "$BAD" ]; then echo "unexpected files in $OUT:" >&2; echo "$BAD" >&2; exit 1; fi
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
