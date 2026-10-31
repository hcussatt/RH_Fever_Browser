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

Build and run from the repository root, after `tools/extract-3ds.py` has written `build/ctr/`:

```sh
python3 -c "import json;d=json.load(open('build/ctr/romfs.json'));print('\n'.join('%x %x %s'%(o-d['level3'],n,p) for p,(o,n) in d['files'].items()))" > build/ctr/romfs-index.txt
python3 tools/ctr-harness/gen.py                      # build/ctr/blanco.inc
python3 tools/ctr-harness/split.py 24                 # build/ctr/split/: 24 parts + tables.c
(cd build/ctr/split && ls part*.c tables.c | xargs -P 4 -I{} sh -c 'gcc -O1 -w -c $0 -o ${0%.c}.o' {})   # ~2.5 min on 4 cores
gcc -O3 -w tools/ctr-harness/run.c build/ctr/split/part[0-9][0-9].o build/ctr/split/tables.o -o build/ctr/run -lm
INTERLEAVE=1 GSP=1 GAME=67 START=200 HWAKE=1 WORKERS=all,tramp,gsp SECS=100 FRAMES=/tmp/frames EVERY=20 build/ctr/run 0x100000
```

`GAME=67` starts Animal Acrobat through the game's own start sequence. `FRAMES`/`EVERY` write top-screen
frames as PPM, `DSPWAV=file` writes the audio (32728 Hz stereo s16). Logging: `DSPLOG`, `GSPLOG`, `PICALOG`,
`TF` (chart commands), `ROMLOG`, `WAKELOG`, `COUNT=addr,...`. Notes: /mnt/project-files/notes/megamix-re.md.

Browser build (needs `emcc` on PATH, and the native steps above done first):

```sh
tools/ctr-harness/build-web.sh        # build/ctr/web/: blanco.wasm (~27 MB), the page, and the game data it reads
node tools/serve.mjs                  # then open http://localhost:8080/build/ctr/web/ in Chrome
```

The game runs in a worker; each vblank it hands the page its top screen and audio and waits on the
audio clock (JSPI stack switching, Chrome 137 or later). Space, Left Shift or a left click press A.
Debug switches pass through the address, e.g. `/build/ctr/web/?TF=1`.
