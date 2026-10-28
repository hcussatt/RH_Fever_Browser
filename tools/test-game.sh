#!/bin/sh
# The tests build.sh runs for one built game: its timing test if it has one, a no-input run and
# a centered autoplay run of the whole level, then its grading and results checks and its practice.
set -eu
cd "$(dirname "$0")/.."
game="$1"
if [ -f "tests/test-$game-timing.mjs" ]; then node "tests/test-$game-timing.mjs" >/dev/null; fi
node tests/test-runtime.mjs "$game" >/dev/null
node tests/test-runtime.mjs "$game" --auto >/dev/null
node tests/test-grading.mjs "$game" >/dev/null
node tests/test-practice.mjs "$game" >/dev/null
