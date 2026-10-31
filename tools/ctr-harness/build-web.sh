#!/bin/sh
# Builds the browser probe of Animal Acrobat into build/ctr/web/ (git-ignored; it holds the
# translated game and data from the user's dump). Needs emcc (Emscripten) on PATH, ffmpeg, and the
# native steps of README.md done first (build/ctr/blanco.inc, the code and RomFS files, build/ctr/run).
# Usage: tools/ctr-harness/build-web.sh    then serve the repo root and open /build/ctr/web/
set -e
cd "$(dirname "$0")/../.."
out=build/ctr/web
mkdir -p "$out/obj" "$out/data"
[ build/ctr/split/tables.c -nt build/ctr/blanco.inc ] || python3 tools/ctr-harness/split.py 24
# The translated program: one object per part, rebuilt only when its part changed.
ls build/ctr/split/part*.c build/ctr/split/tables.c | xargs -P "${JOBS:-4}" -I{} sh -c '
  o='"$out"'/obj/$(basename "$1" .c).o; [ "$o" -nt "$1" ] || emcc -O2 -w -c "$1" -o "$o"' _ {}
# Linking takes about ten minutes (wasm-opt), so it runs only when something changed.
if [ -n "$(find "$out"/obj tools/ctr-harness -maxdepth 1 \( -name '*.o' -o -name '*.c' \) -newer "$out/blanco.mjs" 2>/dev/null)" ] || [ ! -f "$out/blanco.mjs" ]; then
emcc -O2 -w tools/ctr-harness/run.c "$out"/obj/*.o -o "$out/blanco.mjs" \
  -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=worker,node -sJSPI -sSUPPORT_LONGJMP=wasm \
  -sINITIAL_MEMORY=512MB -sALLOW_MEMORY_GROWTH -sSTACK_SIZE=8MB -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sFORCE_FILESYSTEM -sEXPORTED_RUNTIME_METHODS=FS,ENV,callMain,HEAPU8,HEAP16 -lm
fi
# The data the game reads in this probe: a native run with ROMLOG lists the RomFS files it opens.
# GL=1 skips the software drawing, so the run reaches the results in well under a minute. The run
# plays without input (the "try again" ending); the other endings' sounds and the game's epilogue
# pictures are added by name.
if [ ! -s build/ctr/web-files.txt ]; then
  { GL=1 INTERLEAVE=1 GSP=1 GAME=67 START=200 HWAKE=1 WORKERS=all,tramp,gsp SECS=60 ROMLOG=1 build/ctr/run 0x100000 2>&1 |
      awk '/^  file /{print $2}'
    awk '{print $3}' build/ctr/romfs-index.txt | grep -E '^sound/group/GROUP_(EPILOGUE|RESULT)_|^layout/epilogue_ctrBlanco'
  } | sort -u > build/ctr/web-files.txt || true
fi
{ printf '%s\n' build/ctr/code-text.bin build/ctr/code-rodata.bin build/ctr/code-data.bin build/ctr/romfs-meta.bin \
    build/ctr/romfs-index.txt tools/ctr-harness/noops.txt
  sed 's|^|build/ctr/romfs/|' build/ctr/web-files.txt; } > "$out/files.txt"
# Music: decoded here once, as the native probe does (16-bit stereo next to each .aac).
for f in build/ctr/romfs/sound/aac/*.aac; do
  grep -qx "$f" "$out/files.txt" || continue
  [ "$f.pcm" -nt "$f" ] || ffmpeg -v quiet -y -i "$f" -f s16le -ac 2 "$f.pcm"
  echo "$f.pcm" >> "$out/files.txt"
done
while read -r f; do mkdir -p "$out/data/$(dirname "$f")"; cp "$f" "$out/data/$f"; done < "$out/files.txt"
cp tools/ctr-harness/web/* "$out/"
du -sh "$out/blanco.wasm" "$out/data"
