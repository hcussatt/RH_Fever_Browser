# Adding a web game

`games/<id>/game.json` is the registration point. Every source manifest uses
`schemas/game.schema.json` (JSON Schema 2020-12), with `schemaVersion: 1`.
The directory and `id` must match; IDs are safe lowercase URL components.
Unknown fields and unsupported schema versions fail validation.

Keep a new game local while implementing and qualifying its Wii adapter:

```json
"web": {"enabled": false}
```

After building from your own ISO and checking chart completion, cue counts,
input, rendering, audio, and grading, enable it with its expected cue count:

```json
"web": {"enabled": true, "order": 40, "expectedCues": 42}
```

`order` controls the picker and import order; ties sort by ID. `expectedCues`
is checked against the original chart's silent run before imported data is
published to the local library. It does not alter timing or grading.

A game whose cues wait for A and B together sets `"input": 6` under `wii` (the
default, 4, is A alone); the page then shows both buttons' keys.

Supply `adapters/<id>/game.h`, the manifest's original C++ units, scene,
cell-animation archive, banks, projection, and optional layout metadata. New
original behavior may require adapter work; registration alone does not port
a game. Run the local build and fidelity checks, then refresh the code-only
snapshot with `python3 tools/prepare-pages.py --snapshot`. Only enabled games
are snapshotted. Review `runtime-src/<id>/original-functions.inc` before commit.
Never commit extracted assets, original data sections, charts, the DOL, or ISO.

```sh
python3 -m pip install -r requirements-ci.txt
python3 tools/game_registry.py
python3 tools/game_registry.py --matrix
python3 tests/test_game_registry.py
```

Actions validates all manifests, including disabled modules, and rejects
enabled modules missing an adapter or runtime snapshot. It discovers the
enabled IDs and compiles them in separate matrix jobs. The assembly job
downloads those cores, generates the catalog and importer bundle, audits the
exact deployment contents, and tests the picker and offline shell. Deployment
to Pages runs only after all checks pass on `main`.

There are no game lists to edit in the workflow, picker, importer, or public
artifact audit. The source policy allows only the exact translated snapshot
path of each registered enabled game; media and data protections still apply.

# Import performance

The browser reads only the sound archive's metadata and required audio ranges
from the ISO. It avoids decrypting and copying the entire 319 MB archive.
DSP audio and Yaz0 byte loops run in JavaScript in the same background worker;
Python converters still orchestrate extraction and preserve the asset formats.
Native CLI conversion retains its Python decoder.

In a local Chrome comparison with the USA ISO, the original pipeline took
57.7 seconds and optimized imports took 6.2–6.8 seconds. All 591 generated
runtime cache files matched byte for byte. These are machine-specific timings;
first-use CDN downloads and slower disks/devices can add time.
