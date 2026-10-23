#!/bin/sh
# Write the game picker and the list of built games it reads.
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist
cp web/library.html dist/index.html
cp -R web/import dist/
mkdir -p dist/engine
cp web/engine/*.mjs dist/engine/
node -e '
const fs=require("fs");
const games=fs.readdirSync("dist").filter(d=>fs.existsSync(`dist/${d}/game.json`)).sort()
 .map(d=>{const m=JSON.parse(fs.readFileSync(`dist/${d}/game.json`));return {id:m.id,title:m.title};});
fs.writeFileSync("dist/games.json",JSON.stringify(games)+"\n");'
