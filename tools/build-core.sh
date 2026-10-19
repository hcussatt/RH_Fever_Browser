#!/bin/sh
# Compile the Wii platform backend, one game's profile and its generated translation into WASM.
# Usage: tools/build-core.sh <game>   (needs emcc from Emscripten 5.0.7 on PATH)
set -eu
cd "$(dirname "$0")/.."
game="$1"
mkdir -p "dist/$game"
# Keep -ffp-contract=off and -fno-fast-math: scoring and rounding depend on them.
emcc adapters/wii/platform.c -I "adapters/$game" -I "${RHF_RUNTIME_SOURCE:-build}/$game" -O2 -flto -ffp-contract=off -fno-fast-math \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node -sINITIAL_MEMORY=67108864 \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=2097152 -sFILESYSTEM=0 \
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAPU32"]' -o "dist/$game/$game-core.mjs"
