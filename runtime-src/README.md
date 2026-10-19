# Approved runtime code snapshots

These generated C includes contain statically translated original gameplay
functions. Their publication is explicitly authorized for the browser runtime.
They are not a completed readable decompilation. No original executable data
sections, charts, textures, or sound banks belong here.

CI compiles these snapshots with `adapters/wii/platform.c` and the per-game
profiles, using Emscripten 5.0.7. Remix snapshots also include their generated
`scenes.h` profile table; the registry requires this build dependency. This needs neither an ISO nor a key.

After changing the translation or its selected functions, regenerate all games
with the user's disc through `build.sh`, run the full-level checks, then run:

```sh
python3 tools/prepare-pages.py --snapshot
python3 scripts/check-pages.py
```

Commit the updated snapshots with the adapter/translator change. Never copy
`build/disc/`, `dist/<game>/assets/`, or any key into this directory.
