#!/bin/sh
# Serve the built games locally: ./serve.sh [--open] [port]
set -eu
cd "$(dirname "$0")"
[ -f dist/index.html ] || { echo "Nothing built yet. Run ./build.sh with your ISO first." >&2; exit 1; }
cd dist
exec node ../tools/serve.mjs "$@"
