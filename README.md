# kinagent

`kinagent` is a headless Node.js/TypeScript bridge prototype for watching Kindroid chat activity and forwarding it into Hermes Agent. It can also send a single message back to a Kin through Kindroid's observed `send-message` endpoint.

This is intentionally a small service foundation. It does not depend on Cadence; the optional desktop control panel is an Electron wrapper around the same Node internals.

Detailed observed Kindroid behavior is captured in [docs/kindroid-findings.md](docs/kindroid-findings.md).

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
- Optional Firestore chat text decryption in `probe-chat` using the saved Firebase UID as the Kindroid AES passphrase.
- Live plaintext monitor for new incoming Firestore chat messages.
- Kindroid outbound `POST https://api.kindroid.ai/v1/send-message` client.
- In-memory outbound dedupe scaffolding.
- Hermes chat adapter for the local Cadence Hermes gateway, including a narrow `current_scene` action executor.

Not complete yet:

- Installer/signing/start-with-Windows packaging.
- Persistent SQLite-backed dedupe storage.
- Broader Hermes tool/action coverage beyond the current-scene proof of concept.

The listener command uses Firestore's gRPC Listen API, not timer polling. It emits lightweight `kindroid.chat.changed` notifications; `probe-chat --decrypt` can verify readable message recovery separately, and `monitor-live` can print new decrypted messages as they arrive.

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
  -> optional current-scene action
  -> KindroidClient POST /v1/update-info or /v1/groupchats-update

Outbound:
Hermes or CLI
  -> KindroidClient
  -> POST /v1/send-message
  -> dedupe record
```

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

## Internal API Warning

This prototype depends on observed Kindroid web behavior:

- `POST https://api.kindroid.ai/v1/send-message`
- `POST https://api.kindroid.ai/v1/update-info` for `current_scene`
- `POST https://api.kindroid.ai/v1/groupchats-update` for group `current_scene`
- Firebase project `kindroid-ai`
- Firestore path `Users/{uid}/AIs/{ai_id}/ChatMessages`
- `!enc:` chat text decrypts with CryptoJS AES using the Firebase UID as the observed passphrase

Those details may be private, undocumented, and subject to change without notice. The code is organized around adapters and defensive checks for that reason.

## Setup

```powershell
npm install
Copy-Item config.example.yaml config.yaml
```

Edit `config.yaml`. If you know your Kindroid UID, set `kindroid.uid`; otherwise the project will try to read it from the saved Firebase auth state. The daemon discovers available Kins from the saved session, so static Kin entries are optional compatibility data rather than the primary subscription source.

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

Probe Firestore chat access and print recent normalized messages:

```powershell
npm run probe-chat -- --kin "<ai_id>" --limit 5
```

Attempt to decrypt `!enc:` chat text with the saved Firebase UID:

```powershell
npm run probe-chat -- --kin "<ai_id>" --limit 5 --decrypt
```

Include the full raw Firestore document payload when inspecting schema changes:

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

Forward decrypted chat events to a local Cadence Hermes gateway and allow Hermes to request `current_scene` updates:

```powershell
$env:HERMES_ENABLED = "true"
$env:HERMES_BASE_URL = "http://127.0.0.1:8642/v1"
$env:HERMES_API_KEY = "<local Hermes API key>"
npm run daemon
```

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

## Configuration

```yaml
kindroid:
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
```

Environment variables can override the main scalar settings; see `.env.example`.

## Next Milestones

1. Expand Hermes action coverage beyond `current_scene`.
2. Expand live integration coverage around saved session refresh and Firestore listen behavior.
3. Add a native Hermes tool callback path if the local gateway exposes one.
4. Add installer signing and start-with-Windows support.
