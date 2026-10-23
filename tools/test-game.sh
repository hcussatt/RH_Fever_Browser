#!/bin/sh
# The tests build.sh runs for one built game: its timing test if it has one, then a
# no-input run and a centered autoplay run of the whole level.
set -eu
cd "$(dirname "$0")/.."
game="$1"
if [ -f "tests/test-$game-timing.mjs" ]; then node "tests/test-$game-timing.mjs" >/dev/null; fi
node tests/test-runtime.mjs "$game" >/dev/null
node tests/test-runtime.mjs "$game" --auto >/dev/null
