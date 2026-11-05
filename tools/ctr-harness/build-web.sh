#!/bin/sh
# Builds the Megamix browser build into build/ctr/web/ (git-ignored; it holds the translated game
# and data from the user's dump). Needs emcc (Emscripten) on PATH and the native steps of README.md
# done first (build/ctr/blanco.inc, the code and RomFS files, build/ctr/run). tools/ctr-harness/
# build-local.sh does all of it from the dump.
# Usage: tools/ctr-harness/build-web.sh [game index ...]   (default: every game in games.txt)
#   then tools/ctr-harness/play.sh
set -e
cd "$(dirname "$0")/../.."
PYTHON=${RHF_PYTHON:-python3}
out=build/ctr/web
mkdir -p "$out/obj" "$out/data"
games=${*:-$(awk '!/^#/&&NF{print $1}' tools/ctr-harness/games.txt)}
[ build/ctr/split/tables.c -nt build/ctr/blanco.inc ] || "$PYTHON" tools/ctr-harness/split.py 24
# The translated program: one object per part, rebuilt only when its part changed.
ls build/ctr/split/part*.c build/ctr/split/tables.c | xargs -P "${JOBS:-4}" -I{} sh -c '
  o='"$out"'/obj/$(basename "$1" .c).o; [ "$o" -nt "$1" ] || emcc -O2 -w -c "$1" -o "$o"' _ {}
# Linking takes several minutes (wasm-opt), so it runs only when something changed.
if [ ! -f "$out/blanco.mjs" ] || [ -n "$(find "$out"/obj tools/ctr-harness -maxdepth 1 \( -name '*.o' -o -name '*.c' \) -newer "$out/blanco.mjs" 2>/dev/null)" ]; then
emcc -O2 -w tools/ctr-harness/run.c "$out"/obj/*.o -o "$out/blanco.mjs" \
  -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=worker,node -sJSPI -sSUPPORT_LONGJMP=wasm \
  -sINITIAL_MEMORY=512MB -sALLOW_MEMORY_GROWTH -sSTACK_SIZE=8MB -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sFORCE_FILESYSTEM -sEXPORTED_RUNTIME_METHODS=FS,ENV,callMain,HEAPU8,HEAP16 -lm
fi
"$PYTHON" tools/ctr-harness/system-font.py # your 3DS system font, for the game's text
printf '[' > "$out/games.json"; sep=
for game in $games; do
  line=$(awk -v g="$game" '$1==g' tools/ctr-harness/games.txt)
  [ -n "$line" ] || { echo "Game $game is not in tools/ctr-harness/games.txt" >&2; exit 1; }
  name=$(echo "$line" | awk '{print $2}'); title=$(echo "$line" | cut -d' ' -f3-)
  # The data the game reads: a native run with ROMLOG lists the RomFS files it opens. GL=1 skips
  # the software drawing, so the run plays the whole song in a minute or two. The run plays without
  # input (the "try again" ending); the other endings' sounds and the epilogue pictures are added by name.
  # A second, short run plays the title card and practice (which waits for input) for the files they read.
  list=build/ctr/web-files-$game.txt
  if [ ! -s "$list" ] || [ build/ctr/run -nt "$list" ]; then
    { for practice in 0 1; do
        [ $practice = 1 ] && secs=40 || secs=${SECS:-200}
        GL=1 INTERLEAVE=1 GSP=1 GAME=$game START=200 HWAKE=1 WORKERS=all,tramp,gsp SECS=$secs ROMLOG=1 PRACTICE=$practice build/ctr/run 0x100000 2>&1 |
          awk '/^  file /{print $2}'
      done
      awk '{print $3}' build/ctr/romfs-index.txt | grep -E "^sound/group/GROUP_(EPILOGUE|RESULT)_|^layout/epilogue_$name"
    } | sort -u > "$list" || true
  fi
  { printf '%s\n' build/ctr/code-text.bin build/ctr/code-rodata.bin build/ctr/code-data.bin build/ctr/romfs-meta.bin \
      build/ctr/romfs-index.txt tools/ctr-harness/noops.txt
    [ ! -f build/ctr/system-font.bcfnt ] || echo build/ctr/system-font.bcfnt
    sed 's|^|build/ctr/romfs/|' "$list"; } > "$out/files-$game.txt"
  # Music: decoded once, to 16-bit stereo next to each .aac (as the native harness reads it).
  for f in $(grep '\.aac$' "$out/files-$game.txt"); do
    [ "$f.pcm" -nt "$f" ] || "$PYTHON" tools/ctr-harness/decode-aac.py "$f"
    echo "$f.pcm" >> "$out/files-$game.txt"
  done
  while read -r f; do
    [ "$out/data/$f" -nt "$f" ] && continue
    # the dump's files can be read-only (and so their earlier copies): make the copy writable
    mkdir -p "$out/data/$(dirname "$f")"; [ ! -e "$out/data/$f" ] || chmod u+w "$out/data/$f"
    cp "$f" "$out/data/$f"; chmod u+w "$out/data/$f"
  done < "$out/files-$game.txt"
  printf '%s{"game":%s,"title":"%s"}' "$sep" "$game" "$title" >> "$out/games.json"; sep=,
done
echo ']' >> "$out/games.json"
chmod -R u+w "$out"/*.* 2>/dev/null || true
cp tools/ctr-harness/web/* "$out/"
du -sh "$out/blanco.wasm" "$out/data"
