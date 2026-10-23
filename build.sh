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

. ./tools/env.sh
for tool in node emcc "${RHF_OBJDUMP:-powerpc-eabi-objdump}"; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool. Run tools/setup-toolchain.sh first (see README)." >&2; exit 1; }
done
"$RHF_PYTHON" -c 'import numpy, PIL, cryptography' || {
  echo 'Missing Python packages. Create .venv with Python 3.10+ and install requirements.txt there.' >&2
  exit 1
}

git submodule update --init third_party/rhf-decomp

echo "== Reading files from your ISO"
"$RHF_PYTHON" tools/extract-disc.py "$iso"

# Every game with a manifest in games/<id>/game.json.
games=$("$RHF_PYTHON" -c 'import sys; sys.path.insert(0, "tools"); from paths import GAMES; print(*GAMES)')
# Games build side by side, one per CPU core unless RHF_JOBS says otherwise. Each game's
# output goes to build/logs/<game>-<step>.log and is shown in full if that game fails.
jobs=${RHF_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)}
# Decoded sound samples are kept by their bytes, so games that share sounds decode them once.
export RHF_DSP_CACHE="$PWD/build/cache/dsp"
mkdir -p build/logs
# The engine is copied once; each game step then finds it in place.
mkdir -p dist/engine
cp -R web/engine/. dist/engine/
rm dist/engine/index.html
run_each() {
  # run_each <label> <command>: run "<command> <game>" for every game, $jobs at a time.
  printf '%s\n' $games | xargs -P "$jobs" -I{} sh -c '
    log=build/logs/$1-$0.log
    if $2 "$1" >"$log" 2>&1; then echo "   $1: $0 ok"; else cat "$log"; echo "== $1: $0 failed (log: $log)" >&2; exit 255; fi' "$1" {} "$2"
}
echo "== Building $(echo $games | wc -w | tr -d ' ') games, $jobs at a time"
run_each build tools/build-game.sh
tools/stage-index.sh

if [ "$skip_tests" != "--skip-tests" ]; then
  echo "== Running tests"
  run_each test tools/test-game.sh
  node tests/test-grading.mjs >/dev/null
  echo "All tests passed."
fi
echo "Done. Start the games with ./serve.sh --open"
