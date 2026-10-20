#!/bin/sh
# Build one game from the files build.sh already read out of the ISO.
# Usage: tools/build-game.sh <game>   (after tools/env.sh and tools/extract-disc.py)
# Each game writes only build/<game> and dist/<game>, so build.sh runs several at once.
set -eu
cd "$(dirname "$0")/.."
game="$1"
export RHF_GAME="$game"
echo "== $game: translating original code"
"$RHF_PYTHON" tools/recompile.py
tools/build-core.sh "$game"
echo "== $game: finding the chart"
"$RHF_PYTHON" tools/chart-index.py
echo "== $game: converting assets"
"$RHF_PYTHON" tools/extract-assets.py >/dev/null
"$RHF_PYTHON" tools/extract-sfx.py >/dev/null
"$RHF_PYTHON" tools/extract-layout.py >/dev/null
"$RHF_PYTHON" tools/extract-menu.py
"$RHF_PYTHON" tools/extract-results.py
"$RHF_PYTHON" tools/decode-music.py
RHF_ENGINE_STAGED=1 tools/stage-web.sh "$game"
node tools/chart-timeline.mjs "$game"
