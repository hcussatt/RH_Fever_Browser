#!/bin/sh
# Serves the Megamix browser build (build/ctr/web, made by build-local.sh or build-web.sh) and opens
# it in the default browser. Usage: tools/ctr-harness/play.sh [port]
cd "$(dirname "$0")/../.." || exit 1
if [ ! -f build/ctr/web/index.html ]; then
  echo "No build/ctr/web yet: run tools/ctr-harness/build-local.sh first" >&2
  exit 1
fi
exec node tools/serve.mjs --open=/build/ctr/web/ "${1:-8090}"
