# kinagent

`kinagent` is a headless Node.js/TypeScript bridge prototype for watching Kindroid chat activity and, later, forwarding it into Hermes Agent. It can also send a single message back to a Kin through Kindroid's observed `send-message` endpoint.

This is intentionally a small service foundation. It does not depend on Cadence; the optional desktop control panel is an Electron wrapper around the same Node internals.

Detailed observed Kindroid behavior is captured in [docs/kindroid-findings.md](docs/kindroid-findings.md).

## Status

Working in this first milestone:

- TypeScript project scaffold and CLI.
- Electron desktop control panel with Windows tray behavior.
- Manual Kindroid login through a visible Playwright Chromium window.
- Local browser session persistence under `./data/`, including IndexedDB because Firebase Auth often stores browser tokens there.
- Cached Kin listing from saved Kindroid browser state.
- Best-effort extraction of Firebase browser auth state from saved Playwright storage.
- Firestore-backed chat change notifications for `ChatMessages`.
- Optional Firestore chat text decryption in `probe-chat` using the saved Firebase UID as the Kindroid AES passphrase.
- Live plaintext monitor for new incoming Firestore chat messages.
- Kindroid outbound `POST https://api.kindroid.ai/v1/send-message` client.
- In-memory outbound dedupe scaffolding.
- Hermes adapter interface with a logging implementation.

Not complete yet:

- Installer/signing/start-with-Windows packaging.
- Firestore realtime subscription from Node using the saved browser Firebase auth state; the current listener uses REST polling.
- Persistent SQLite-backed dedupe storage.
- Actual Hermes HTTP/WebSocket integration.
- Forwarding decrypted Firestore chat content from the listener into Hermes. The listener still emits notification events only until the Hermes content contract is nailed down.

The listener command is wired through Firestore REST polling. It emits lightweight `kindroid.chat.changed` notifications; `probe-chat --decrypt` can verify readable message recovery separately, and `monitor-live` can print new decrypted messages as they arrive.

## Architecture

```text
Kindroid browser login
  -> Playwright visible Chromium
  -> ./data/browser-session/storage-state.json
  -> Firebase auth extraction
  -> Firestore listener: Users/{uid}/AIs/{ai_id}/ChatMessages
  -> chat change notification
  -> TODO: decrypt and forward readable Firestore chat content
  -> HermesAdapter

Outbound:
Hermes or CLI
  -> KindroidClient
  -> POST /v1/send-message
  -> dedupe record
```

## Security Notes

Kindroid browser session data, cookies, Firebase ID tokens, refresh tokens, and API auth headers are equivalent to passwords.

- Do not commit `./data/`.
- Do not paste tokens into issues, logs, or chat.
- This project redacts common token/cookie fields from logs, but the safest path is still to avoid logging raw session objects.
- `.env.example` and `config.example.yaml` contain placeholders only.

## Internal API Warning

This prototype depends on observed Kindroid web behavior:

- `POST https://api.kindroid.ai/v1/send-message`
- Firebase project `kindroid-ai`
- Firestore path `Users/{uid}/AIs/{ai_id}/ChatMessages`
- `!enc:` chat text decrypts with CryptoJS AES using the Firebase UID as the observed passphrase

Those details may be private, undocumented, and subject to change without notice. The code is organized around adapters and defensive checks for that reason.

## Setup

```powershell
npm install
Copy-Item config.example.yaml config.yaml
```

Edit `config.yaml` and fill in at least the Kin `aiId`. If you know your Kindroid UID, set `kindroid.uid`; otherwise the project will try to read it from the saved Firebase auth state.

## Commands

Start the desktop app:

```powershell
npm run desktop
```

In the desktop app:

- `Open Login` opens a visible Kindroid browser.
- `Save Session` stores the browser session after login.
- `Start` begins the live decrypted monitor for the selected Kin.
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

List cached Kins from the saved session:

```powershell
npm run list-kins
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

Use a faster poll interval while testing:

```powershell
npm run monitor-live -- --kin "<ai_id>" --poll-seconds 2
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

Run configured enabled Kins:

```powershell
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
  logLevel: "info"
  sessionDir: "./data/browser-session"
  sqlitePath: "./data/bridge.sqlite"

hermes:
  enabled: false
  baseUrl: "http://localhost:8000"
  agentId: "kindroid-bridge"
```

Environment variables can override the main scalar settings; see `.env.example`.

## Next Milestones

1. Decide the Hermes content contract and forward decrypted Firestore messages from the listener.
2. Replace the REST polling listener with a true Firestore realtime subscription.
3. Expand live integration coverage around saved session refresh and Firestore listen behavior.
4. Implement the real Hermes adapter.
5. Add installer signing and start-with-Windows support.
