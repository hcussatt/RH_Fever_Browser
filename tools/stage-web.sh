#!/bin/sh
# Copy the hand-written page files for one game next to its generated assets.
set -eu
cd "$(dirname "$0")/.."
game="$1"
mkdir -p "dist/$game"
cp -R "web/$game/." "dist/$game/"
