# Pages deployment and local asset import

## Public and private files

`site/` is a generated, ignored deployment artifact. It includes the game picker,
shared browser engine, compiled game cores, manifests, importer source archive,
and an offline service worker. It never includes `dist/<game>/assets/`.

The icon import and first play of each game run existing Python converters through Pyodide 0.27.7 in a
module worker. NumPy, Pillow, and cryptography are loaded from its pinned CDN.
The user supplies a raw SOME01 ISO. The public Wii common key is bundled in
`web/import/common-key.mjs` and its generated Pages copy; no key entry is needed.
The converter validates the game ID and known main.dol SHA1. JavaScript File
slices handle large offsets that exceed WASM CPython's 32-bit seek limit.
All decryption, conversion, chart dry runs, and caching happen locally. The worker clears its temporary key environment variable after disc extraction.

The converter extracts data sections and scripts as well as audiovisual assets.
The first Play runs only the selected game’s converters and chart silently through its precompiled core before making the game available. Tile selection never extracts a game; multiplayer waits for Ready. Expected cue counts are 64 golf, 102 tap, and 31 rap.

The initial import reads the original artwork for every registered game, row by row from left to right. Each completed icon appears immediately; cancellation preserves the icons already read. Main-game
icons come from the original select-menu textures; extra-game artwork is rendered
from the original bonus-menu cell banks. It does not convert gameplay charts,
images or sounds. The browser stores a small read-only file handle in IndexedDB
when the user chooses **Choose and remember disc**. The ISO itself is never copied
into browser storage. A normal file input works for the current tab; after leaving
that tab, or if file permission expires, an unprepared game asks for the ISO again.

First Play extracts only that game plus its required shared layouts and results.
Preparation runs asynchronously in a worker and reports progress. A per-game Web
Lock avoids duplicate extraction in concurrent tabs. Gameplay still starts only
through Play/Ready after preparation, with original timing and scoring unchanged.

Cached bodies use **lossless gzip only**, and identical original bytes share one
SHA-256-addressed body within this project. PNGs are retained unchanged; no audio
resampling, lossy codecs, palette reduction or image quality reduction is used.
Asset reads transparently restore the original bytes. Per-game URL references
are published only after all of that game’s files have been stored. Existing raw
caches remain readable. **Compress saved games** migrates them one entry at a time,
without needing an ISO; interruption leaves both migrated and unmigrated entries
readable. Unreferenced shared bodies are reclaimed only after a complete migration
under the storage lock. The storage summary includes both compression and sharing.

Remove local game data clears only this project’s game, icon and shared-body caches
and saved disc reference. Other projects on the origin remain isolated by URL path.
The service worker downloads each game core on demand, keeps played games offline,
and carries unchanged downloaded cores into new shell versions without fetching
cores for unplayed games. The public common-key module remains part of the shell.

The shell version covers all deployed files. The asset-compatibility version
covers converter code, game manifests, and WASM; changing only the UI does not
require another ISO import. Storage persistence is requested, not guaranteed.
Missing or incompatible caches prompt reimport. The service worker caches the
static shell; updates wait for old tabs to close to avoid replacing a running
game's runtime. Asset import needs Internet access for the Python packages.

See [game-modules.md](game-modules.md) for the versioned game-manifest schema,
module registration, Actions build matrix, and import optimizations.

## Local preparation

First build and test from the disc using `build.sh`. Refresh the approved code
snapshots and stage the public site:

```sh
python3 -m pip install -r requirements-ci.txt
python3 tools/prepare-pages.py --snapshot
python3 scripts/check-pages.py
python3 tests/test-public-policy.py
npm ci
npx playwright install chromium
npm test
```

Serve `site/` through a static HTTP server, ideally mounted at
`/RH_Fever_Browser/` to exercise project-path URLs. Do not upload `dist/`.
The browser integration test starts a server under that prefix and exercises
invalid ISO handling, direct game links without data, local-cache readiness,
project-scoped removal, and offline shell loading. These CI tests contain no
disc data. For end-to-end qualification, import a real ISO locally and check
all games, reload/offline behavior, pause, restart, and input. Keep test audio
out of the user's gameplay.

## CI/CD

`.github/workflows/pages.yml` runs for PRs, pushes to `main`, and manual dispatch.
It checks source policy and syntax, installs pinned Emscripten 5.0.7, compiles
the approved snapshots, stages and audits the site, and runs Chromium tests.
Only a successful non-PR workflow reaches deployment. The public common-key module is included in the repository and shell artifact.
No ISO, original data segments, charts, or extracted media are put into Actions,
repository secrets, caches, or public artifacts. The normal tracked-source
policy check remains in its own workflow as well.

A repository administrator must enable **Settings → Pages → Build and deployment
→ Source: GitHub Actions**. The expected URL is
`https://hcussatt.github.io/RH_Fever_Browser/`. A 404 before a successful deployment
does not validate the player. If Pages settings also return 404, the signed-in
account may lack repository administration access. Private-repository Pages
availability also depends on the owner's GitHub plan.

Before merging, inspect the public artifact and CI run. Branch protection can
require the build check; configure that through the repository administrator.
No automatic merge is configured.

## Updating importers and runtimes

Keep `tools/prepare-pages.py`'s importer-source list current when converters gain
dependencies. Keep original data local even when extending runtime publication.
Do not weaken the general file policy to allow arbitrary WASM or `.inc` files:
the source allowance is exact and the deployment file set is independently audited.

Internet Archive fetching is not implemented. A future URL importer would need
CORS support on the actual download/redirect endpoint, streaming, integrity
checks, and cancellation/resume handling. A normal browser download followed by
local ISO selection already uses the same import path.

Every registered game and remix is enabled for Pages with an approved runtime snapshot. CI discovers the catalog from the manifests.

## Game-select artwork

The launcher follows the original game-select layout and uses its game icons
after local import. `web.icon` in each source manifest names a texture in
`EN/content2/layout/layout_gameSelect.szs`. Extraction converts that texture to
`menu-icon.png` in the game’s private asset cache. The public site contains only
CSS and numbered placeholders; Nintendo menu artwork is never published.
Existing imports without icons remain usable; reimport adds the artwork.

The Pages catalog includes all 37 registered games and remixes. Standard controllers
use the bottom face button (A / Cross) for A, the right face button (B / Circle)
for B, and Start / Options to pause or resume. A also starts or resumes a game.
Press a controller button after connecting it so Chrome exposes the device.
If Chrome blocks audio before a page interaction, click Play once.
