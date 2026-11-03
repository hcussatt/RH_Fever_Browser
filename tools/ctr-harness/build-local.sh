#!/bin/sh
# Builds the Megamix browser build on this machine from your own decrypted dump, then serves it and
# opens it in the browser. Everything it makes stays in git-ignored folders (build/ctr/, .toolchain/).
#
# Usage: tools/ctr-harness/build-local.sh ["Rhythm Heaven Megamix (USA).cxi"] [game index ...]
#   The dump defaults to the first .cxi/.cia/.3ds/.cci next to the repository folder (or inside it).
#   Games default to every game in tools/ctr-harness/games.txt. NOPLAY=1 skips serving.
# Needs: Python 3.10+, a C compiler (Xcode's clang on a Mac), git, and ffmpeg or (on a Mac) afconvert.
# The first run downloads Emscripten 6.0.13 into .toolchain/emsdk-ctr and takes about half an hour;
# later runs rebuild only what changed.
set -e
cd "$(dirname "$0")/../.."
root=$(pwd)
. ./tools/env.sh

dump=
case "${1:-}" in *.cxi|*.cia|*.3ds|*.cci|*.CXI|*.CIA|*.3DS|*.CCI) dump=$1; shift ;; esac
if [ -z "$dump" ]; then
  for f in ../*.cxi ../*.cia ../*.3ds ../*.cci ./*.cxi ./*.cia ./*.3ds ./*.cci; do
    [ -f "$f" ] && { dump=$f; break; }
  done
fi
[ -n "$dump" ] && [ -f "$dump" ] || {
  echo 'No Megamix dump found. Put your decrypted "Rhythm Heaven Megamix (USA).cxi" next to the repository folder, or pass its path.' >&2
  exit 1; }
cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
[ "$cores" -le 8 ] || cores=8
export JOBS=${JOBS:-$cores}
CC=${CC:-cc}
step() { printf '\n== %s\n' "$*"; }

# 1. Emscripten 6.0.13 (JSPI), kept apart from the Wii build's Emscripten in .toolchain/emsdk.
em=.toolchain/emsdk-ctr
if [ ! -x "$em/upstream/emscripten/emcc" ]; then
  step "Downloading Emscripten 6.0.13 (once)"
  mkdir -p .toolchain
  [ -d "$em" ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$em"
  "$RHF_PYTHON" "$em/emsdk.py" install 6.0.13
fi
[ -f "$em/.emscripten" ] || "$RHF_PYTHON" "$em/emsdk.py" activate 6.0.13 >/dev/null
export PATH="$root/$em/upstream/emscripten:$PATH" EM_CONFIG="$root/$em/.emscripten" EMSDK_PYTHON="$RHF_PYTHON"
if ! command -v node >/dev/null 2>&1; then
  for d in "$root/$em"/node/*/bin; do [ -x "$d/node" ] && export PATH="$d:$PATH"; done
fi

# 2. The program and every RomFS file, read out of the dump (skipped when already done).
mkdir -p build/ctr/romfs
if [ ! -f build/ctr/romfs/.complete ] || [ "$dump" -nt build/ctr/romfs/.complete ]; then
  step "Reading the program and data out of $(basename "$dump") (about 400 MB)"
  "$RHF_PYTHON" tools/extract-3ds.py "$dump" '*'
  touch build/ctr/romfs/.complete
fi
if [ ! -s build/ctr/romfs-index.txt ] || [ build/ctr/romfs.json -nt build/ctr/romfs-index.txt ]; then
  "$RHF_PYTHON" -c "import json;d=json.load(open('build/ctr/romfs.json'));print('\n'.join('%x %x %s'%(o-d['level3'],n,p) for p,(o,n) in d['files'].items()))" > build/ctr/romfs-index.txt
fi

# 3. Translate the program to C (gen.py) and split it into compile units.
if [ ! -s build/ctr/blanco.inc ] || [ -n "$(find build/ctr/code-text.bin build/ctr/code-data.bin tools/arm_recompile.py tools/ctr-harness/gen.py tools/ctr-harness/ents.txt tools/ctr-harness/init.txt tools/ctr-harness/extra.txt tools/ctr-harness/cands.txt tools/ctr-harness/services.txt -newer build/ctr/blanco.inc 2>/dev/null)" ]; then
  step "Translating the program (a few minutes)"
  "$RHF_PYTHON" tools/ctr-harness/gen.py
fi
[ build/ctr/split/tables.c -nt build/ctr/blanco.inc ] || "$RHF_PYTHON" tools/ctr-harness/split.py 24

# 4. The native harness: it lists the files each game reads for the browser build.
step "Compiling the native harness"
ls build/ctr/split/part*.c build/ctr/split/tables.c | xargs -P "$JOBS" -I{} sh -c '
  o="${1%.c}.o"; [ "$o" -nt "$1" ] || '"$CC"' -O1 -w -c "$1" -o "$o"' _ {}
if [ ! -x build/ctr/run ] || [ -n "$(find tools/ctr-harness -maxdepth 1 -name '*.c' -newer build/ctr/run)" ] ||
   [ -n "$(find build/ctr/split -name '*.o' -newer build/ctr/run)" ]; then
  "$CC" -O2 -w tools/ctr-harness/run.c build/ctr/split/part[0-9][0-9].o build/ctr/split/tables.o -o build/ctr/run -lm
fi

# 5. The browser build (program, data and music), then serve it.
step "Building for the browser (the first link takes several minutes)"
RHF_PYTHON="$RHF_PYTHON" tools/ctr-harness/build-web.sh "$@"
[ -n "${NOPLAY:-}" ] || exec tools/ctr-harness/play.sh
