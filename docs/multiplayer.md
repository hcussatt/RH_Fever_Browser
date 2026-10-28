# Private multiplayer

Open the main Pages arcade and choose **MULTIPLAYER**. Create an invite and send
its link to your friend. Your friend opens the main-site link, generates an answer
and sends it back. Paste the answer and connect. Keep both lobby tabs open.

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
comparisons are displayed above the game. The higher song score wins (see Matches and scoring);
equal scores and missed counts draw. Results are self-reported. New round requires both Ready
again. Pause, restart or hiding a ready/playing tab interrupts an incomplete round.

There are no accounts or signaling backend. STUN is external infrastructure
(`stun.l.google.com:19302`); no TURN relay is configured, so some networks cannot
connect. HTTPS or localhost is required. Each player supplies their own disc data;
no assets are transferred. Localhost invite links are for same-machine testing.

## Matches and scoring

The host's **Mode** picks one game (as before), a remix set, or Shuffle:

- **Remix N set**: that song-select row's minigames in order, then the remix
  (`SETS` in `web/engine/menu.mjs`; Remix 8 to 10 use the row's "2" games).
- **Shuffle**: three different version 1 minigames from the remix rows, one
  "2" game (never the same game as a pick before it), then a random remix. The
  host draws the list and sends it, so both players get the same one.

Each song is its own round: both players press Ready before every song, and the
host presses **Next song** once both results are in. An interrupted song can be
replayed; a finished one cannot. Picking a single game ends the match. A table
under the status shows each song's scores and the running totals.

Scoring (`web/engine/versus.mjs`, also used for single games): a song scores
0 to 100, the original checkpoint manager's `hits*100/total` for each grading
category, averaged over the categories, so a short category or song weighs the
same as a long one. The match total is the sum. Higher total wins; ties go to
fewer missed cues (misses + unanswered), then more Superbs, then more Perfects;
otherwise it is a draw. Final results therefore also carry the original grade
and per-category counts.

## Practice before each song

A game with a practice (`chart.practice`) shows **Practice** in place of Ready,
plus **Skip practice**. Practice plays the game's original practice in the game
frame, whatever the game select's Skip practice switch says. When it ends, or the
player skips it (the lobby button, Enter, or the game's own Skip), the song waits
paused and that player is marked ready. Games without one (remixes and most "2"
games) keep Ready. A replay of an interrupted song uses Ready. Escape or a
hidden tab during practice pauses only the practice; changing games or an
interruption stops it.

## Look and lead bar

The lobby uses the game select's theme: while a game is loaded, the selected
game's title screen is the backdrop and the panels, buttons and table take its
colours (`showTitle` in `web/import/library.mjs`). During a song a bar under the
status shows who leads: green (left) is you, red (right) your friend, and the
diamond slides toward the leader. The lead is each side's hits minus missed cues
from the live counters, compared through `tanh(gap/10)` (`lead` in `versus.mjs`),
so a gap of about ten cues pushes it most of the way. After the song it shows the
final counts.

## Protocol and timing

Protocol version 3 adds matches: a `select` may carry `match: {title, games, index}`,
and results carry `grade` and `categories`. Version 2 added host-only game selection and per-selection compatibility checks. Two RTCDataChannels carry JSON:

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
