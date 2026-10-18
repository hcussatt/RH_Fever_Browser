#!/bin/sh
# Copy the shared engine and one game's page and manifest next to its generated assets.
set -eu
cd "$(dirname "$0")/.."
game="$1"
mkdir -p "dist/$game" dist/engine
cp -R web/engine/. dist/engine/
rm dist/engine/index.html
cp web/engine/index.html "dist/$game/index.html"
cp "games/$game/game.json" "dist/$game/game.json"
