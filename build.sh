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

for game in golf tap; do
  echo "== $game: translating original code"
  RHF_GAME=$game python3 tools/recompile.py
  tools/build-core.sh "$game"
  echo "== $game: converting assets"
  RHF_GAME=$game python3 tools/extract-assets.py >/dev/null
  RHF_GAME=$game python3 tools/extract-sfx.py >/dev/null
  RHF_GAME=$game python3 tools/decode-music.py
  python3 "tools/$game-timeline.py" >/dev/null
  tools/stage-web.sh "$game"
done
cp web/index.html dist/

if [ "$skip_tests" != "--skip-tests" ]; then
  echo "== Running tests"
  for t in golf-timing golf-runtime tap-timing tap-runtime; do
    node "tests/test-$t.mjs" >/dev/null
  done
  node tests/test-golf-runtime.mjs --auto >/dev/null
  node tests/test-tap-runtime.mjs --auto >/dev/null
  echo "All tests passed."
fi
echo "Done. Start the games with ./serve.sh --open"
