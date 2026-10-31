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
- `noops.txt`: functions the harness skips. `tfdump.py`: prints tickflow (chart) commands.

Build and run from the repository root, after `tools/extract-3ds.py` has written `build/ctr/`:

```sh
python3 -c "import json;d=json.load(open('build/ctr/romfs.json'));print('\n'.join('%x %x %s'%(o-d['level3'],n,p) for p,(o,n) in d['files'].items()))" > build/ctr/romfs-index.txt
python3 tools/ctr-harness/gen.py                      # build/ctr/blanco.inc
python3 tools/ctr-harness/split.py 24                 # build/ctr/split/: 24 parts + tables.c
(cd build/ctr/split && ls part*.c tables.c | xargs -P 4 -I{} sh -c 'gcc -O1 -w -c $0 -o ${0%.c}.o' {})   # ~2.5 min on 4 cores
gcc -O3 -ffast-math -w tools/ctr-harness/run.c build/ctr/split/*.o -o build/ctr/run -lm
INTERLEAVE=1 GSP=1 GAME=67 START=200 HWAKE=1 WORKERS=all,tramp,gsp SECS=100 FRAMES=/tmp/frames EVERY=20 build/ctr/run 0x100000
```

`GAME=67` starts Animal Acrobat through the game's own start sequence. `FRAMES`/`EVERY` write top-screen
frames as PPM, `DSPWAV=file` writes the audio (32728 Hz stereo s16). Logging: `DSPLOG`, `GSPLOG`, `PICALOG`,
`TF` (chart commands), `ROMLOG`, `WAKELOG`, `COUNT=addr,...`. Notes: /mnt/project-files/notes/megamix-re.md.
