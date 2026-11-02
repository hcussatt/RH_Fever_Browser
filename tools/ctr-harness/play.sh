#!/bin/sh
# Serves the Animal Acrobat browser build (build/ctr/web, made by build-web.sh or unpacked from the
# package) and opens it in the default browser. Usage: tools/ctr-harness/play.sh [port]
cd "$(dirname "$0")/../.." || exit 1
if [ ! -f build/ctr/web/index.html ]; then
  echo "No build/ctr/web yet: unpack the package with  tar xzf animal-acrobat-web.tgz -C build/ctr" >&2
  exit 1
fi
exec node tools/serve.mjs --open=/build/ctr/web/ "${1:-8090}"
