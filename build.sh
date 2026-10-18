#!/bin/sh
# Build the playable games from your own Rhythm Heaven Fever (USA) disc image.
#
#   ./build.sh "/path/to/Rhythm Heaven Fever (USA).iso" [--skip-tests]
#
# Nothing from the game ships in this repository. Every executable, image,
# chart and sound is read from the ISO you supply into build/ and dist/,
# both of which are git-ignored.
set -eu
cd "$(dirname "$0")"

if [ $# -lt 1 ] || [ ! -f "$1" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
iso="$1"
skip_tests=${2:-}

[ -d .toolchain ] && export PATH="$PWD/.toolchain/emsdk/upstream/emscripten:$PWD/.toolchain/binutils:$PATH"
for tool in python3 node emcc "${RHF_OBJDUMP:-powerpc-eabi-objdump}"; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool. Run tools/setup-toolchain.sh first (see README)." >&2; exit 1; }
done

git submodule update --init third_party/rhf-decomp

echo "== Reading files from your ISO"
python3 tools/extract-disc.py "$iso"

# Every game with a manifest in games/<id>/game.json.
games=$(python3 -c 'import sys; sys.path.insert(0, "tools"); from paths import GAMES; print(*GAMES)')
for game in $games; do
  echo "== $game: translating original code"
  RHF_GAME=$game python3 tools/recompile.py
  tools/build-core.sh "$game"
  echo "== $game: finding the chart"
  RHF_GAME=$game python3 tools/chart-index.py
  echo "== $game: converting assets"
  RHF_GAME=$game python3 tools/extract-assets.py >/dev/null
  RHF_GAME=$game python3 tools/extract-sfx.py >/dev/null
  RHF_GAME=$game python3 tools/extract-layout.py >/dev/null
  RHF_GAME=$game python3 tools/decode-music.py
  tools/stage-web.sh "$game"
  node tools/chart-timeline.mjs "$game"
done
tools/stage-index.sh

if [ "$skip_tests" != "--skip-tests" ]; then
  echo "== Running tests"
  for game in $games; do
    if [ -f "tests/test-$game-timing.mjs" ]; then node "tests/test-$game-timing.mjs" >/dev/null; fi
    node tests/test-runtime.mjs "$game" >/dev/null
    node tests/test-runtime.mjs "$game" --auto >/dev/null
  done
  echo "All tests passed."
fi
echo "Done. Start the games with ./serve.sh --open"
