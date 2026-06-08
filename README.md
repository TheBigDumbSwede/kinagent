# kinagent

`kinagent` is a headless Node.js/TypeScript bridge prototype for watching Kindroid chat activity and forwarding it into Hermes Agent. It also wraps the parts of Kindroid's public `/v1` API that the bridge needs for outbound sends, chat export, and narrow reviewed mutations.

This is intentionally a small service foundation. It does not depend on Cadence; the optional desktop control panel is an Electron wrapper around the same Node internals.

Detailed observed Kindroid integration notes are intentionally kept out of the public repository.

## Status

Working in this first milestone:

- TypeScript project scaffold and CLI.
- Electron desktop control panel with Windows tray behavior.
- Manual Kindroid login through a visible Playwright Chromium window.
- Local browser session persistence under `./data/`, including IndexedDB because Firebase Auth often stores browser tokens there.
- Desktop background session warming while the app is running; a lightweight HTTP touch refreshes Kindroid cookies, with a hidden browser fallback when needed.
- Server-side Kin discovery from Firestore REST using the saved authenticated session.
- Best-effort extraction of Firebase browser auth state from saved Playwright storage.
- Firestore realtime listen stream for `ChatMessages` using the saved Firebase browser auth state, with gRPC keepalive and reconnect backoff.
- Recent-message probing and chat transcript export through Kindroid's documented `/v1/get-chat-messages` API.
- Live plaintext monitor for new incoming Firestore chat messages.
- Kindroid outbound client using the documented `kn_` API-key flow when configured, including direct sends, group sends,
  public chat-history export, current-scene updates, and low-level chat break/rewind helpers.
- SQLite-backed outbound dedupe for recent bridge-originated messages.
- Hermes chat adapter for the local Cadence Hermes gateway, including narrow Kindroid `current_scene` updates and
  local-only scene metadata.
- Experimental desktop-only procedural soundscape controls using local Web Audio synthesis.
- Opt-in group Gaming foundations for local original mystery campaign packs, initialized campaign state, contained Hermes
  game decisions, and mode-gated Keeper message sends.

Not complete yet:

- Installer/signing/start-with-Windows packaging.
- Broader Hermes tool/action coverage beyond the current-scene proof of concept.

The listener command uses Firestore's gRPC Listen API, not timer polling. It emits lightweight `kindroid.chat.changed`
notifications; historical recent-message probes use Kindroid's documented `/v1/get-chat-messages` API, and
`monitor-live` can print new decrypted Firestore messages as they arrive.

## Architecture

The background runtime is the source of truth for subscriptions and side effects. The desktop app may manage, display, and manually toggle that runtime, but it should not introduce a separate listener path that bypasses Hermes, session warming, dedupe, or Kindroid mutation adapters.

```text
Kindroid browser login
  -> Playwright visible Chromium
  -> ./data/browser-session/storage-state.json
  -> Firebase auth extraction
  -> Firestore listener: Users/{uid}/AIs/{ai_id}/ChatMessages
  -> decrypted chat event
  -> HermesAdapter
  -> optional current-scene action or local scene metadata action
  -> KindroidClient POST /v1/update-info or /v1/groupchats-update, or local scene-state JSON

Outbound:
Hermes or CLI
  -> KindroidClient
  -> POST /v1/send-message
  -> dedupe record

Chat export:
Desktop
  -> KindroidClient
  -> GET /v1/get-chat-messages
  -> local Markdown transcript

Soundscape prewarm and probes:
Runtime or CLI
  -> KindroidClient
  -> GET /v1/get-chat-messages
  -> bounded recent-message context
  -> ./data/prewarm-state.json freshness watermark
  -> ./data/soundscape-state.json

Local scene state:
Runtime
  -> KindroidClient
  -> GET /v1/get-chat-messages
  -> bounded recent-message context
  -> Hermes
  -> update_local_scene_state or update_group_local_scene_state
  -> ./data/local-scene-state.json
  -> ./data/prewarm-state.json freshness watermark
  -> desktop Kin or Group Scene tab

Group Gaming:
Desktop
  -> Group Gaming tab
  -> local campaign pack loader
  -> ./data/game-groups.json
  -> ./data/game-campaign-state.json
Runtime
  -> group chat event when Gaming is enabled
  -> Hermes game decision
  -> validated local campaign state changes
  -> optional group send only in autonomous mode

Previously On briefs:
Runtime
  -> KindroidClient
  -> GET /v1/get-chat-messages
  -> bounded recent-message context
  -> Hermes
  -> update_previously_on_brief or update_group_previously_on_brief
  -> ./data/previously-on-state.json
  -> ./data/prewarm-state.json freshness watermark
  -> desktop Kin or Group Scene tab
```

Group Gaming also recognizes explicit user-originated group commands:

- `/start-mystery` starts the selected campaign/mystery.
- `/reset-mystery` clears local progress and restarts the selected mystery.
- `/end-mystery` marks the selected mystery complete and queues or sends a closing Keeper note according to the
  automation mode.

Only user messages execute these commands. Mystery intros are generated from spoiler-free public briefing data and do not
include hidden truth, threat data, countdowns, or hidden clues.

For group play, Kin/AI messages are buffered as non-mutating context. The next user-originated message closes the turn
and sends that buffered context plus the user message to Hermes as one game turn parcel. Autonomous mode can send
Keeper and abstract roll-outcome messages, but Kinagent does not try to force Kindroid automatic turn-taking.
Group-visible roll outcomes stay abstract, while full local dice, modifier, total, and outcome details remain in
`rollHistory` for audit and post-roll Hermes narration context.

Kindroid domain access is organized behind `KindroidApiClient` resource modules:

- `kins` for Kin discovery from `Users/{uid}/AIs`.
- `chats` for Kin chat message reads and listen streams.
- `groups` for group metadata from `Users/{uid}/Groups`.
- `groupChats` for group chat message and pinned-message reads/listen streams.

## Security Notes

Kindroid browser session data, cookies, Firebase ID tokens, refresh tokens, and API auth headers are equivalent to passwords.

- Do not commit `./data/`.
- Do not paste tokens into issues, logs, or chat.
- This project redacts common token/cookie fields from logs, but the safest path is still to avoid logging raw session objects.
- `.env.example` and `config.example.yaml` contain placeholders only.

## Kindroid API Boundary

Kindroid now documents a public `kn_` API-key surface at
[https://kindroid.ai/docs/article/api-documentation/](https://kindroid.ai/docs/article/api-documentation/), with base
URL `https://api.kindroid.ai/v1`.

Kinagent uses the documented API shape for:

- `POST https://api.kindroid.ai/v1/send-message`, using blocking text responses with `stream: false`.
- `POST https://api.kindroid.ai/v1/chat-break`, as a low-level client helper only.
- `GET https://api.kindroid.ai/v1/get-chat-messages` for direct Kin and group chat transcript export, recent-message
  probes, and soundscape prewarm context.
- `POST https://api.kindroid.ai/v1/rewind-messages`, as a low-level client helper only.
- `POST https://api.kindroid.ai/v1/groupchats-user-message`, including the documented `message`/`audio_url` one-of payload
  shape. Current Kinagent callers send text messages.
- `POST https://api.kindroid.ai/v1/groupchats-get-turn`
- `POST https://api.kindroid.ai/v1/groupchats-ai-response`, using blocking text responses with `stream: false`.
- `POST https://api.kindroid.ai/v1/groupchats-chat-break`, as a low-level client helper only.
- `POST https://api.kindroid.ai/v1/update-info` for `current_scene` and identity-field writes.
- `POST https://api.kindroid.ai/v1/groupchats-update` for group `current_scene`.

Kinagent does not currently expose public API streaming (`stream: true`) because the bridge runtime and desktop
workflows expect completed response text. It also does not wrap the Discord bot endpoint; that belongs to a different
integration model.

Kinagent still depends on observed Kindroid web behavior for:

- `POST https://api.kindroid.ai/v1/journal-create`
- `POST https://api.kindroid.ai/v1/journal-delete`
- `internet_response` on direct and group message sends
- `user_set_temperature` through `update-info`
- Firebase project `kindroid-ai`
- Firestore path `Users/{uid}/AIs/{ai_id}/ChatMessages`
- `!enc:` chat text decrypts with CryptoJS AES using the Firebase UID as the observed passphrase

Observed details may be private, undocumented, and subject to change without notice. The code is organized around
adapters and defensive checks for that reason.

## Setup

```powershell
npm install
Copy-Item config.example.yaml config.yaml
```

Edit `config.yaml`. Set `kindroid.apiKey` to the `kn_` API key from Kindroid Profile Settings for documented `/v1`
writes. If it is omitted, Kinagent falls back to the saved browser Firebase session for legacy observed write paths.

If you know your Kindroid UID, set `kindroid.uid`; otherwise the project will try to read it from the saved Firebase
auth state. The daemon discovers available Kins from the saved session, so static Kin entries are optional compatibility
data rather than the primary subscription source.

## Commands

Start the desktop app:

```powershell
npm run desktop
```

In the desktop app:

- `Open Login` opens a visible Kindroid browser.
- `Save Session` stores the browser session after login.
- The background supervisor discovers available Kins and subscribes to all enabled Kins automatically.
- The background supervisor also discovers available groups and subscribes to group chat messages automatically.
- `Manage` expands per-Kin subscription toggles for users who want desktop control.
- Minimize or close hides the window to the Windows tray; use the tray menu to show or quit.

Log in and save local browser state:

```powershell
npm run login
```

Run an instrumented login/app-load capture that records token-safe crypto and network metadata:

```powershell
npm run instrument-login -- --duration-seconds 120
```

Send one message:

```powershell
npm run send -- --kin "<ai_id>" --message "hello"
```

List Kins from Firestore REST using the saved session:

```powershell
npm run list-kins
```

List group metadata from Firestore REST using the saved session:

```powershell
npm run list-groups
```

Inspect recent group chat document shapes without printing message text:

```powershell
npm run probe-group-chat -- --group "<group_id>" --limit 5
```

Show a token-safe session summary:

```powershell
npm run session-info
```

Start the listener. This prints notification events, not plaintext chat messages:

```powershell
npm run listen -- --kin "<ai_id>"
```

Start the live plaintext monitor. It skips already-seen recent messages at startup, then prints new decrypted chat messages as JSON lines:

```powershell
npm run monitor-live -- --kin "<ai_id>"
```

Adjust the initial listen window while testing:

```powershell
npm run monitor-live -- --kin "<ai_id>" --page-size 25
```

Example event:

```json
{
  "type": "kindroid.chat.changed",
  "kinId": "example_ai_id",
  "documentId": "example_message_document_id",
  "timestamp": "2025-08-23T05:04:49.273Z",
  "sender": "ai",
  "role": null,
  "source": "firestore"
}
```

Probe Kindroid's documented chat-history API and print recent normalized messages:

```powershell
npm run probe-chat -- --kin "<ai_id>" --limit 5
```

The legacy `--decrypt` flag is accepted for old scripts but no longer changes behavior; `/v1/get-chat-messages`
returns readable message text.

```powershell
npm run probe-chat -- --kin "<ai_id>" --limit 5 --decrypt
```

Include the full raw Kindroid API message payload when inspecting schema changes:

```powershell
npm run probe-chat -- --kin "<ai_id>" --limit 1 --include-raw
```

Run the headless background daemon. It uses the same dynamic Kin and group discovery/subscription supervisors as the desktop app:

```powershell
npm run daemon
```

Capture current Kin identity state into a separate local Git repository:

```powershell
npm run capture-state
```

By default this writes to `./data/kin-source-control`, which is outside the application repo's Git tracking. The capture includes Kin and group profile fields, readable decrypted field files where possible, Kin journal entries, and a Git commit for the snapshot.

The shared backend runtime also runs this capture once at desktop or daemon startup. If the generated files match the previous snapshot, no new capture commit is created.

Forward decrypted chat events to a local Cadence Hermes gateway and allow Hermes to request `current_scene` updates:

```powershell
$env:HERMES_ENABLED = "true"
$env:HERMES_BASE_URL = "http://127.0.0.1:8642/v1"
$env:HERMES_API_KEY = "<local Hermes API key>"
npm run daemon
```

Hermes may also maintain local scene metadata for Kinagent without changing Kindroid-visible content. The local scene
state is stored per direct Kin or group and can capture compact backstage context such as location, time of day, mood,
activity, tension, privacy, soundscape hints, visual palette hints, and supporting evidence. Group local scene state is
keyed by the group rather than by an owner Kin; the latest speaker Kin is recorded only as metadata. The desktop Kin or
Group `Scene` tab shows the current local snapshot. Use Kindroid `current_scene` when the saved Kindroid scene should
change; use local scene state for inspectable app-owned context that should remain inside Kinagent.

Local scene prewarm is separate from soundscape prewarm. It uses the same documented `/v1/get-chat-messages` API for
bounded recent context, but runs through its own coordinator and only executes local scene actions. Kinagent persists a
per-Kin or per-group prewarm watermark, so app restart hydrates existing local scene state without re-fetching every
monitored source. A live chat event advances the source watermark and may trigger a fresh prewarm; the Scene tab also
has a per-source Force Prewarm button for cases where the user chatted while Kinagent was not running.

The same Scene tab may show a local `Previously On` continuity brief above the structured scene JSON. This recap is
stored separately in `previously-on-state.json`; it is short user-facing continuity context, not Kindroid memory, not
`current_scene`, and not automatically injected into chat. Its prewarm path uses the documented `/v1/get-chat-messages`
API, the shared prewarm freshness watermark, and a separate Hermes action contract from local scene state.

The Group `Gaming` tab is an opt-in foundation for original mystery campaign packs. It can select a campaign, a
mystery, and an automation mode, then initializes local campaign state under `./data/game-campaign-state.json`. Group
Gaming preferences are stored separately under `./data/game-groups.json`. Kinagent ships a tiny original sample campaign
pack for development; user-authored local packs can be placed under `./data/campaigns/<pack>/` with a `campaign.json`
manifest plus optional `mysteries/`, `threats/`, `npcs/`, `locations/`, `hooks/`, and `hermes/` folders. Packs provide
static content and prompt hints only; they do not execute code. Mystery packs can model clues, structured countdown
stages, and threat records, but imported packs are validated for internal id references and the game runtime only accepts
state changes that reference known pack ids.

Distributable campaign pack source lives separately under `campaigns/packs/`. `npm run campaigns:check` validates those
packs with the same loader used by the app, and `npm run campaigns:build` writes downloadable zips plus
`campaign-index.json` under `release/campaigns/`. Release builds upload those campaign zips as separate GitHub Release
assets beside the portable app; they are not bundled into the executable.

When Gaming is enabled for a monitored group, Kinagent can send group chat events to Hermes through a contained game
runtime. Hermes returns a game decision with a Keeper message and validated local state changes. `observe` applies only
local state changes, `suggest` stores pending Keeper decisions until reviewed from the Gaming tab, and `autonomous` may
send the Keeper message through the existing group message path. Suggested Keeper messages can be approved with `Send
Keeper`; approved and autonomous messages both use the same group send path and local scene sync. Autonomous Keeper
speech is paced: only user/player turns can mutate campaign state or create Keeper decisions, and visible Keeper
messages are sent only after policy and cooldown checks pass. Source document ids are recorded so the same group chat
event cannot advance countdowns, reveal entities, add clues, or send autonomous Keeper text twice. The game runtime has
its own decision schema and does not extend the generic Hermes action registry.

Enable desktop-only voice sidecar playback for new AI messages:

```yaml
voice:
  enabled: true
  provider: "openai"
  openai:
    model: "gpt-4o-mini-tts"
    voice: "marin"
    instructions: ""
```

Store provider API keys in `.env`, for example `KINAGENT_OPENAI_API_KEY`.
For ElevenLabs, set `voice.provider: "elevenlabs"` in `config.yaml` and
`KINAGENT_ELEVENLABS_API_KEY` in `.env`; the ElevenLabs voice ID is set per
Kin from that Kin's Manage > Audio tab. Voice output is off by default in
`config.example.yaml`, runs only in the desktop app, skips startup catch-up
messages, and only speaks new AI messages from enabled monitors whose per-Kin
voice is enabled.

Allow experimental Hermes-generated procedural soundscapes from a Kin or Group Manage > Audio tab.

The soundscape is local renderer audio only. It uses Web Audio oscillators, noise buffers, filters, and gain ramps for
low-volume ambience; it does not bundle music tracks and does not call external music or generative audio APIs. Hermes
may emit local `update_soundscape` or `update_group_soundscape` metadata for a monitored Kin or group when venue,
weather, machinery, environmental texture, tension, or a major scene event materially changes. Direct chat soundscapes
are gated by that Kin's Audio setting. Group soundscapes are gated by that Group's Audio setting. The
desktop renderer caches that state by Kin or group and plays the most recently active monitored source. Browser autoplay
policy still applies, so audio starts only after a user interaction with the desktop UI. If voice sidecar playback is
active, the soundscape ducks while spoken audio is scheduled.

Soundscape state is persisted per Kin or group and hydrated on startup. Automatic soundscape prewarm uses the shared
prewarm watermark, so restart does not re-fetch every enabled source unless newer live chat activity arrives. The Kin or
Group Audio tab has a per-source Force Prewarm button that bypasses the cached-ready check while still respecting the
source's Soundscape enabled setting and any in-flight prewarm.

Manual test: enable procedural ambience from the Kin or Group Audio tab, monitor that Kin or Group with
Hermes enabled, and send a scene message that materially establishes or changes the environment. The Audio tab should
show generated layers after Hermes returns an update. Switching monitored activity to another Kin or group should switch
to that source's cached soundscape, or silence until Hermes generates one.

TODO for a later sound pass: sample-based or generated event cues could be added for discrete scene moments, but this
prototype deliberately avoids door creaks, voice murmurs, footsteps, and Foley.

Use a non-default config file:

```powershell
npm run listen -- --config .\config.yaml --kin "<ai_id>"
```

## Test Bench

Run the fast deterministic test suite:

```powershell
npm test
```

Run the normal pre-push check:

```powershell
npm run check
```

`npm run check` runs the local secret scan, ESLint, Prettier check, TypeScript typecheck, unit tests, and build. GitHub Actions runs the same check on pushes and pull requests.

The current unit tests cover Kindroid `!enc:` decryption, Firestore message normalization, config loading/env overrides, and outbound SQLite dedupe behavior. They do not call live Kindroid, Firestore, Playwright, or Electron.

Run the desktop launch smoke test:

```powershell
npm run smoke:desktop
```

Run live Firestore integration tests only when a real local session and enabled Kin are available:

```powershell
$env:KINAGENT_LIVE_TESTS = "1"
npm run test:live
```

Build and smoke-check the Windows portable app:

```powershell
npm run dist:win
```

The portable artifact is written under `release/`, which is ignored by Git.

## Versioning and Releases

Kinagent follows the same simple versioning model as Cadence: `package.json`
is the source of truth, and the Windows portable filename is derived from that
version.

Prepare a release version:

```powershell
npm version patch
git push origin main
git push origin v0.1.1
```

Use `minor` or `major` instead of `patch` when appropriate. The GitHub release
workflow runs for `vX.Y.Z` tags, verifies that the tag matches
`package.json`, runs the Windows portable build and smoke check, then attaches
`Kinagent-X.Y.Z-portable.exe` and distributable campaign pack zips to the
GitHub Release for that tag.

The release workflow can also be run manually from GitHub Actions. With no tag
input, it produces downloadable workflow artifacts only. With an existing tag
input, it verifies the version and uploads the portable exe plus campaign
downloads to that release.

## Configuration

```yaml
kindroid:
  apiKey: ""
  firebaseProjectId: "kindroid-ai"
  uid: ""
  kins:
    - name: "Example Kin"
      aiId: ""
      enabled: true

bridge:
  dedupeWindowSeconds: 180
  logPath: "./data/kinagent.log"
  logLevel: "info"
  sessionDir: "./data/browser-session"
  sqlitePath: "./data/bridge.sqlite"

hermes:
  enabled: false
  baseUrl: "http://127.0.0.1:8642/v1"
  apiKey: ""
  agentId: "kindroid-bridge"
  currentSceneUpdates:
    enabled: true
    maxLength: 160
  journalSuggestions:
    enabled: true
    throttleMessages: 20
    strongEventBypass: true
  chatDynamism:
    suggestions:
      enabled: true
    autoAdjust:
      enabled: false
      minTurnsBetweenAdjustments: 12
      min: 0.8
      max: 1.4
      maxDelta: 0.2

voice:
  enabled: false
  provider: "none"
  openai:
    apiKey: ""
    model: "gpt-4o-mini-tts"
    voice: "marin"
    instructions: ""
  elevenlabs:
    apiKey: ""
    model: "eleven_flash_v2_5"
    outputFormat: "mp3_44100_128"
```

Environment variables can override the main scalar settings; see `.env.example`.

Hermes journal suggestions are review-only until accepted in the desktop app. The throttle counts Kin-authored
messages per Kin; strong events can bypass that spacing when `strongEventBypass` is enabled.

Chat Dynamism support is experimental. Kinagent loads the observed `user_set_temperature` field during Kin discovery,
can run a manual write/read/restore diagnostic, and exposes per-Kin desktop controls for reviewed Hermes drift
suggestions and their allowed range. Hermes-originated Chat Dynamism adjustments are stored as reviewed suggestions
only. The current guidance treats `0.05` as a noticeable base adjustment and `0.95` as Kindroid's recommended starting
value for new Kins. Per-Kin drift switches and selected ranges persist in `kin-subscriptions.json` beside the bridge
SQLite database. See [docs/chat-dynamism.md](docs/chat-dynamism.md).

## Next Milestones

1. Expand Hermes action coverage beyond `current_scene`.
2. Expand live integration coverage around saved session refresh and Firestore listen behavior.
3. Add a native Hermes tool callback path if the local gateway exposes one.
4. Add installer signing and start-with-Windows support.
