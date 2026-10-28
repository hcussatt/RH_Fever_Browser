#!/bin/sh
# Upload dist/ to the private dev host with the project's Python (docs/dev-host.md).
#   tools/dev-host-upload.sh --new-keys   once, to make the keys
#   tools/dev-host-upload.sh              after ./build.sh
#   tools/dev-host-upload.sh --prune      delete stored files the current upload no longer uses
set -eu
cd "$(dirname "$0")/.."
. tools/env.sh
exec "$RHF_PYTHON" tools/dev-host-upload.py "$@"
