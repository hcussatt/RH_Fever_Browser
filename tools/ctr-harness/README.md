# Megamix native harness

A native test bed for the 3DS (Megamix) backend. It runs the whole translated game program on the host and
stands in for the 3DS system: memory, kernel calls, services (APT, fs, HID, cfg, ...), the DSP (audio voices
and the AAC decoder) and the GPU (a software PICA200). It is research code, used to bring up a game before the
browser build exists. Nothing from the game is in this folder; everything is read from your own dump.

Files:
- `run.c`: memory, kernel calls, services, cooperative threads, the start-a-minigame hook, debug switches.
- `dsp.c`: DSP service, 24 audio voices (PCM8/PCM16/DSP-ADPCM, mixing), AAC decoding through ffmpeg.
- `gsp.c`, `pica.c`: GPU service and a software GPU (command lists, vertex shader interpreter, rasterizer,
  texture formats, texture combiners, blending) plus display transfers.
- `gen.py`: translates the program into `build/ctr/blanco.inc` (entry lists: `ents.txt`, `init.txt`,
  `extra.txt`, candidate entries `cands.txt`).
- `split.py`: splits the translation into compile units (one 58 MB file is too big for clang).
- `hid.c`: the buttons (HID shared memory; `PRESS=vblank,...` presses A in native runs).
- `web.c`, `web/`, `build-web.sh`: the browser build (see below). `web-smoke.mjs` runs it in Node.
- `noops.txt`: functions the harness skips. `tfdump.py`: prints tickflow (chart) commands.

The quickest way, on a Mac or Linux, is one command from the repository root. It reads your decrypted dump
(the first `.cxi`/`.cia`/`.3ds`/`.cci` next to the repository folder, or the path you give), downloads
Emscripten 6.0.13 once into `.toolchain/emsdk-ctr`, runs every step below, then serves the page:

```sh
tools/ctr-harness/build-local.sh                  # all games in games.txt; or e.g. build-local.sh 77
```

The games are listed in `games.txt` (index in the game table, internal name, title); the page links them
and the page lists every game (`?GAME=index` opens one directly). Music is decoded with ffmpeg, or on a Mac without it with `afconvert`.

The steps by hand, from the repository root, after `tools/extract-3ds.py "<dump>" '*'` has written `build/ctr/`:

```sh
python3 -c "import json;d=json.load(open('build/ctr/romfs.json'));print('\n'.join('%x %x %s'%(o-d['level3'],n,p) for p,(o,n) in d['files'].items()))" > build/ctr/romfs-index.txt
python3 tools/ctr-harness/gen.py                      # build/ctr/blanco.inc
python3 tools/ctr-harness/split.py 24                 # build/ctr/split/: 24 parts + tables.c
(cd build/ctr/split && ls part*.c tables.c | xargs -P 4 -I{} sh -c 'gcc -O1 -w -c $0 -o ${0%.c}.o' {})   # ~2.5 min on 4 cores
gcc -O3 -w tools/ctr-harness/run.c build/ctr/split/part[0-9][0-9].o build/ctr/split/tables.o -o build/ctr/run -lm
INTERLEAVE=1 GSP=1 GAME=67 START=200 HWAKE=1 WORKERS=all,tramp,gsp SECS=100 FRAMES=/tmp/frames EVERY=20 build/ctr/run 0x100000
```

`GAME=67` starts Animal Acrobat through the game's own start sequence (77 LumBEARjack 2, 14 LumBEARjack, 69 Super Samurai Slice). `FRAMES`/`EVERY` write top-screen
frames as PPM, `DSPWAV=file` writes the audio (32728 Hz stereo s16). Logging: `DSPLOG`, `GSPLOG`, `PICALOG`,
`TF` (chart commands), `ROMLOG`, `WAKELOG`, `COUNT=addr,...`, `JLOG` (judged inputs), `CKLOG` (input
checkers), `POLLLOG` (input polls), `NANLOG` (NaN shader constants or vertex outputs). `PRESS=vblank[:len[:mask]],...`
presses A (or the buttons in the hex mask, 2 = B); `INPUTAGE=ms` and `LATENCY=ms` act like the browser's audio delay; `GLUNTIL=vblank` skips the
software drawing until then. `PRACTICE=1` plays the game's title card and practice first, as on a first play;
`PRACTICE=0` plays the title card and skips the practice; without it the game starts as on a retry (no title
card, no practice), which the press lists and frame counts above assume. The game's text needs your own 3DS
system font: put `shared_font.bin` (from Citra or Azahar's sysdata folder) or `cbf_std.bcfnt(.lz)` (from
system archive 0004009B00014002) next to the repository folder, or set `RHF_3DS_FONT`; the builds run
`system-font.py`, which writes build/ctr/system-font.bcfnt. Without it the text is blank. Notes: /mnt/project-files/notes/megamix-re.md.

Browser build (needs `emcc` on PATH, and the native steps above done first):

```sh
tools/ctr-harness/build-web.sh        # build/ctr/web/: blanco.wasm (~27 MB), the page, and the game data it reads
tools/ctr-harness/play.sh             # serves on port 8090 and opens /build/ctr/web/ in the browser
```

The game runs in a worker; each vblank it hands the page its top screen and audio and waits on the
audio clock (JSPI stack switching, Chrome 137 or later); the page draws the newest finished screen once per
display refresh. A game picked from the list starts at once. Space, Left Shift or a left click press A; Right
Shift or a right click press B; the arrow keys are the + Control Pad.
Debug switches pass through the address, e.g. `/build/ctr/web/?TF=1`. `?perf=1` shows a line under the game
counting vblanks over 20 ms (`?perf=ms` sets the bar) and audio gaps, with the worst one's game and GPU time.

Checks for every new game (each one is a bug found in Animal Acrobat or LumBEARjack):
- The game runs at 60 frames a second: `POLLLOG=1` shows a poll every two harness vblanks, and
  ticks per frame (tpf) × 59.83 equals the song's BPM × 48 / 60.
- A perfect run (cues followed with `CKLOG=1`, chained cues included) judges every input within the
  just window (`JLOG=1`).
- The music does not drift: a `DSPWAV=` recording lines up with the decoded music file at the same
  offset from start to end, and every cue lands on the music's beat.
- Frames with a hit cost no more than others (`FSTAT=1` timings natively, `?perf=1` in the browser):
  nothing is done all at once when a hit starts sounds or effects.
- In Chrome, real key presses on the heard beat judge within a few ms (`?clock=1` gives each tick and
  when it is heard), and presses shifted early or late judge as shifted.
- Every moving part updates every frame, and no draws are skipped once shaders are compiled.
