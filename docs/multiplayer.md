# Private multiplayer

Open the main Pages arcade and choose **MULTIPLAYER**. Choose **Create room** and
send your friend the six-character room code or the room link. Your friend enters the
code and chooses **Join room**; the two browsers then connect directly. Keep both lobby
tabs open.

Without the matchmaker (or if it cannot be reached), connect by copying codes: create
an invite and send its link to your friend. Your friend opens the main-site link,
generates an answer and sends it back. Paste the answer and connect. Creating a room
also shows the invite link, so the host can fall back without starting over.

The host chooses the game from the lobby selector; the guest automatically loads
the same game and cannot change the selection. Both choose **Ready** after their
local game loads. The host may choose another game between rounds without a new
invite. Each selection clears both players' readiness. Missing or incompatible
local assets block readiness; **Load your disc** opens the existing main-site
importer, and **Reload local game** retries afterward.

The main document owns the WebRTC connection. Each selected game runs in a local,
same-origin iframe, so changing games does not navigate away or lose the peer.
Ready unlocks local audio, then schedules a shared countdown. The deadline is
translated between the parent and iframe performance-clock origins. Gameplay,
audio, timing windows and scoring remain local. Opponent summaries and final
comparisons are displayed above the game. Fewer original misses + unanswered cues
wins; equal counts draw. Results are self-reported. New round requires both Ready
again. Pause, restart or hiding a ready/playing tab interrupts an incomplete round.

There are no accounts. The only server is the optional room-code matchmaker below. STUN is external infrastructure
(`stun.l.google.com:19302`); no TURN relay is configured, so some networks cannot
connect. HTTPS or localhost is required. Each player supplies their own disc data;
no assets are transferred. Localhost invite links are for same-machine testing.

## Protocol and timing

Protocol version 2 adds host-only game selection and per-selection compatibility checks. Two RTCDataChannels carry JSON:

- `control`: reliable/ordered hello, readiness, ping/pong, proposed deadline,
  acknowledgement, commit, interruption, results/ack and new-round messages.
- `presence`: unordered, zero retransmissions, five cumulative snapshots per
  second. Old sequence/round numbers are ignored; buffered status updates are
  dropped. No remote press, audio, chart or image data is sent.

The initial handshake checks the lobby/build version. Each Ready additionally checks a game compatibility digest covering the manifest, chart/timeline, WASM and relevant
engine modules. Only the digest crosses the connection. The protocol version is
also carried in signaling codes. Codes and inbound messages have size limits;
remote names are rendered with textContent and counters are validated.

After both Ready gestures unlock audio and prepare a fresh runtime, the host
collects eight monotonic-clock ping/pong samples and selects the lowest round-trip
sample. An estimated RTT above 400 ms cancels the attempt. The host proposes a
start four seconds ahead, the guest acknowledges, then the host commits. Late
acknowledgements/commits cancel instead of starting immediately. This is a best
effort target of less than 500 ms alignment, not an atomic distributed start or a
physical audible-alignment guarantee. A connection loss at the final commit can
still let only one player start.

Position snapshots use local heard-audio elapsed time. A discrepancy over 500 ms
(including transit delay) conservatively marks comparison unofficial. Nothing
seeks, adjusts playback rate, changes timing windows, rolls back, or edits scores.

## Validation

Stage source changes with `tools/stage-web.sh golf` (and other built games).
Run `node --test tests/peer-match.test.mjs` for protocol failure and round tests.
Existing timing/runtime tests cover unchanged local judgments; use the commands
in AGENTS.md for all built games. `npm test` includes the protocol suite along
with the existing Pages checks.

For browser validation, use two isolated browser sessions with automation audio
muted. Exercise create/invite/answer/accept, Ready in both orders, countdown,
physical input, live counters, complete song/results, new round, pause, restart,
visibility interruption, disconnect, malformed codes, version mismatch, and solo
Play/pause/resume/restart. Inspect dialog and card at desktop and narrow widths.
Close automated test sessions afterward. Same-machine browser checks do not
establish original-hardware fidelity, acoustic latency, or NAT traversal coverage;
separate-device/network checks remain necessary before making those claims.

## Local verification, 2026-10-19

Two isolated, audio-muted Chrome sessions completed the manual WebRTC handshake,
clock/countdown, live keyboard/counter exchange, full Hole in One songs, original
results and rematch preparation. Both saw the matching final summaries (64
unanswered cues each, with one extra press on one side in the second run).
The second run's output-timestamp start estimates differed by approximately
0.24 ms on the same machine. This is software timestamp evidence only.
Escape and Restart interrupted both sides; a forced peer-connection close left
both local simulations running. Solo Tap Trial Play/input/pause/resume/restart,
invite deep links, malformed-code recovery, clipboard copying, and desktop/narrow
dialog rendering were also exercised. Automated browser sessions were closed.

The earlier runtime, timing, grading and importer checks ran in the original
workspace with its pre-existing local work. They are not claimed as a fresh test
pass of this isolated PR. The existing Pages browser suite could not start its HTTP
server in this environment (`listen EPERM`). Separate-device/WAN/NAT traversal
and acoustic timing remain unverified.

Main-site integration validation: ten focused protocol tests cover host-only game
selection, readiness resets and per-game version mismatch. Earlier full-song
validation above refers to the initial per-game UI; the integrated lobby receives
only a focused browser smoke check, as requested.

The focused integrated-lobby browser smoke check connected from the main arcade,
switched the host from Hole in One to Tap Trial, verified the guest followed with
a locked selector, and reached scheduled play in both embedded games. No second
full-song test pass was run for this integration. Test sessions were closed.

## Integration update, 2026-10-23

Integrated the current main engine while preserving A/B controls, lead-ins, remix
prelude sounds, original end-of-chart grading and crash logging. Removed duplicate
startup declarations left by the previous merge, repaired local arcade loading,
and retained the current arcade styling. Hosts wait for both results before
changing games. The protocol suite is included in the normal test command.

The Pages browser suite now exercises actual WebRTC invite/answer exchange,
host selection, both Ready orders, countdown, result comparison, interruption,
rematch and narrow layout, using disc-free iframe fixtures. These checks validate
lobby integration; they do not establish game fidelity or WAN/NAT connectivity.
Local browser execution is unavailable because this environment blocks HTTP
listeners. GitHub Actions must pass before merge.

## Room codes (matchmaker)

`matchmaker/worker.mjs` is a Cloudflare Worker that passes the invite and the answer
between the two browsers, so players share a six-character code instead of two long
codes. Each room is one Durable Object holding one invite and one answer. The room is
deleted when the host collects the answer, or after ten minutes. The Worker only
accepts the hosted site's origin (`ALLOWED_ORIGINS` in `matchmaker/wrangler.toml`) and
localhost. It never sees gameplay, scores or input: after the exchange the players are
connected directly, exactly as with copied codes. Codes use 31 characters without
look-alikes (no 0/O, 1/I/L), so they are easy to read out.

The lobby shows room codes only when `MATCHMAKER_URL` in `web/engine/matchmaker.mjs`
is set. The copy-paste codes always remain available.

Deployment is automatic: `.github/workflows/matchmaker.yml` publishes the Worker on
every push to main that changes `matchmaker/`, or when run by hand from the Actions
tab. It needs two repository secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token from the **Edit Cloudflare Workers**
  template.
- `CLOUDFLARE_ACCOUNT_ID`: the account ID from the Workers & Pages overview.

Without them the workflow skips. The Worker is served at
`https://rhf-matchmaker.<workers.dev subdomain>.workers.dev/`, and this URL goes into
`MATCHMAKER_URL`. It fits the Workers free plan: a match makes a few requests while the
host waits (one poll every 1.5 s).

Tests: `node --test tests/matchmaker.test.mjs` exercises the Worker and the lobby's
client against an in-memory Durable Object. `tests/lobby-rooms.test.mjs` connects two
browsers through the built lobby by room code, with the Worker code answering in-process.
