# Pages deployment and local asset import

## Public and private files

`site/` is a generated, ignored deployment artifact. It includes the game picker,
shared browser engine, compiled game cores, manifests, importer source archive,
and an offline service worker. It never includes `dist/<game>/assets/`.

The first import runs existing Python converters through Pyodide 0.27.7 in a
module worker. NumPy, Pillow, and cryptography are loaded from its pinned CDN.
The user supplies a raw SOME01 ISO and a key (typed or selected as a text file).
The converter validates the game ID and known main.dol SHA1. JavaScript File
slices handle large offsets that exceed WASM CPython's 32-bit seek limit.
All decryption, conversion, chart dry runs, and caching happen locally. The key
is cleared from the form and worker environment and is not persisted.

The converter extracts data sections and scripts as well as audiovisual assets.
It runs each chart silently through its precompiled core before making the game
available. Expected cue counts are 64 golf, 102 tap, and 31 rap.

Cache Storage holds only prepared runtime files. Each game has a unique cache;
the library pointer is updated after all files are written. Cancellation leaves
previously committed games available. Remove local game data clears only this
project's asset-cache namespace. Other Pages projects on the origin are isolated
by URL path. The ISO and key are not cached.

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
disc or key. For end-to-end qualification, import a real ISO locally and check
all games, reload/offline behavior, pause, restart, and input. Keep test audio
out of the user's gameplay.

## CI/CD

`.github/workflows/pages.yml` runs for PRs, pushes to `main`, and manual dispatch.
It checks source policy and syntax, installs pinned Emscripten 5.0.7, compiles
the approved snapshots, stages and audits the site, and runs Chromium tests.
Only a successful non-PR workflow reaches deployment. No ISO/key is put into
Actions, repository secrets, caches, or artifacts. The normal tracked-source
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

The public release currently includes the three games with approved `runtime-src/` snapshots. Additional upstream game manifests remain available to local builds; publish them after preparing and validating their runtime snapshots.
