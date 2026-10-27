#!/bin/sh
# Compile the Wii platform backend, one game's profile and its generated translation into WASM.
# Usage: tools/build-core.sh <game>   (needs emcc from Emscripten 5.0.7 on PATH)
#
# The compile is skipped when the output exists and nothing it was built from changed:
# every file the last compile read (from its dependency list), the flags and the emcc version.
set -eu
cd "$(dirname "$0")/.."
game="$1"
mkdir -p "dist/$game"
out="dist/$game/$game-core.mjs"
cache="${RHF_BUILD:-build}/core-cache"
mkdir -p "$cache"
# Keep -ffp-contract=off and -fno-fast-math: scoring and rounding depend on them.
# Load PRE (in LLVM's GVN) is off: its time grows far faster than the translated code does, which
# made Remix 10 take over 6 minutes; without it, and without LTO (one source file gains nothing
# from it), Remix 10 builds in about 80 s and plays no slower.
set -- adapters/wii/platform.c -I "adapters/$game" -I "${RHF_RUNTIME_SOURCE:-build}/$game" -O2 -mllvm -enable-load-pre=false -ffp-contract=off -fno-fast-math \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node -sINITIAL_MEMORY=67108864 \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=2097152 -sFILESYSTEM=0 \
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAPU32"]' -o "$out"
inputs_hash() {
  # The dependency list, the command line and the compiler version, then each listed file's bytes.
  { printf '%s\n' "$@"; emcc --version; } | "${RHF_PYTHON:-python3}" -c '
import hashlib,re,sys
deps,extra=sys.argv[1],sys.stdin.buffer.read()
rule=open(deps).read().replace("\\\n"," ").split(": ",1)[1]
names=[re.sub(r"\\([ #])",r"\1",n).replace("$$","$") for n in re.split(r"(?<!\\)\s+",rule.strip())]
h=hashlib.sha1(extra)
for name in sorted(set(names)):
    h.update(name.encode()+b"\0")
    with open(name,"rb") as f:h.update(hashlib.sha1(f.read()).digest())
print(h.hexdigest())' "$cache/$game.d"
}
if [ -f "$out" ] && [ -f "dist/$game/$game-core.wasm" ] && [ -f "$cache/$game.d" ] && [ -f "$cache/$game.stamp" ] &&
   [ "$(inputs_hash "$@" 2>/dev/null)" = "$(cat "$cache/$game.stamp")" ]; then
  echo "$game: core unchanged, not recompiled"
  exit 0
fi
rm -f "$cache/$game.stamp"
emcc "$@" -MD -MF "$cache/$game.d"
inputs_hash "$@" > "$cache/$game.stamp" || rm -f "$cache/$game.stamp"
