# Private dev host

The public site holds no game files and no Wii common key. Visitors import their own ISO and
enter their own key. The dev host is the owner's private shortcut: a browser opened once with
his dev link downloads the game files he prepared from his own disc, plus the Wii common key,
instead of importing the ISO.

Anyone with the dev key gets Nintendo's files. Keep the dev link private and never commit it.

## Parts

- `devhost/worker.mjs`: a Cloudflare Worker (`rhf-devhost.hcussatt.workers.dev`) in front of the
  private R2 bucket `rhf-dev-files`. Reading needs `DEV_KEY` and an allowed origin
  (`ALLOWED_ORIGINS` in `devhost/wrangler.toml`, plus localhost). Writing needs `UPLOAD_KEY` and
  is refused from browsers. Without both secrets every request gets 503.
  Files are stored as `files/<sha256>`; `manifest.json` lists each game's file names and hashes,
  the import version, the commit and the Wii common key. The Worker never deletes anything.
- `.github/workflows/devhost.yml`: deploys the Worker on pushes to main that touch `devhost/`,
  or when run by hand. It creates the bucket on its first run and sets the Worker secrets from
  the repository secrets `RHF_DEV_KEY` and `RHF_UPLOAD_KEY`. It skips until those and the
  Cloudflare secrets exist. No game file passes through Actions.
- `tools/dev-host-upload.sh` (runs `tools/dev-host-upload.py` with the project's Python):
  uploads `dist/<game>/assets` after `./build.sh`, keeping the same files the in-browser
  importer keeps. It only sends files the host does not have yet, then the manifest last.
  It reads the keys from `local/dev-host.env` (git-ignored) and the Wii common key the usual
  way (`local/wii-common-key.txt`, `RHF_WII_COMMON_KEY` or `RHF_DOLPHIN_IOSC`).
- `web/import/devhost.mjs`: the site side. `#dev=<key>` on the site address stores the key in
  that browser's localStorage and removes it from the address bar (the part after `#` never
  reaches a server). The import dialog then shows **Download from dev host**, which stores each
  game in Cache Storage exactly as an ISO import would, checking every file's SHA-256. With a
  dev key, the ISO import can also leave the key field empty and use the dev host's key.

## Free-plan cap

The Worker never lets R2 cost money. A Durable Object (`Usage` in `devhost/worker.mjs`) counts
each calendar month's (UTC) reads and writes and the total stored size, and the Worker refuses an
operation that would pass 80% of R2's free allowance (8 GB stored, 800,000 writes, 8 million
reads; `LIMITS`). Reads then answer 503 and uploads 507 with a message, until the month resets
or, for storage, until the owner deletes objects in the Cloudflare dashboard (the counter
assumes stored bytes only grow; reset it by deleting the `rhf-devhost` Durable Object's data
or redeploying with a new migration). On its first run it lists the bucket to count what is
already stored. Counts are saved every 25 reads and on every write, so a Worker restart can lose
at most a few reads. The Worker and Durable Objects themselves are on the Workers free plan, which
refuses requests past its daily limits rather than charging.

## Versions

`deployment.json` carries `importVersion` (`tools/import_version.py`): a hash of the converters,
every `games/*/game.json` and the chart tracer. The upload stamps the same hash from the Mac's
checkout. The site refuses a dev host whose files came from a different import version, because
they could differ from what this site's importer would make. Rebuild from the deployed commit and
upload again; only changed files are sent. A runtime-only change (new WASM) needs no upload:
press Download from dev host again and unchanged games are kept.

## Setup (owner, once)

1. Cloudflare dashboard → R2 → enable R2 (the free plan asks for a payment method; usage
   stays inside the free 10 GB). The existing `CLOUDFLARE_API_TOKEN` needs
   **Workers R2 Storage: Edit** (the "Edit Cloudflare Workers" template includes it).
2. On the Mac: `tools/dev-host-upload.sh --new-keys`, then add the two printed values as
   repository secrets `RHF_DEV_KEY` and `RHF_UPLOAD_KEY`.
3. After the PR is merged (or by running "Deploy dev host" from the Actions tab), run
   `tools/dev-host-upload.sh` after a build, and open the printed dev link in each browser.

To retire a leaked key, make new keys (move `local/dev-host.env` aside first), update both
secrets and rerun the workflow; the old link stops working at once.
