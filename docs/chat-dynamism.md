# Chat Dynamism

Chat Dynamism is the Kindroid UI name for the observed Kin profile field `user_set_temperature`.

The field appears to control per-Kin temperature, randomness, or response variance. This behavior is undocumented by
Kindroid and may change without notice, so Kinagent treats all writes as experimental and reversible.

## Current Support

Kinagent currently supports:

- Reading the current `user_set_temperature` value from the Kin profile document.
- Loading the current value during Kin discovery/startup status.
- Per-Kin desktop controls for allowing reviewed Hermes drift suggestions and setting an allowed range.
- Running a manual `update-info` write/read/restore experiment.
- Storing reviewed Hermes suggestions for future Chat Dynamism adjustments.

Kinagent does not currently support:

- Autonomous Chat Dynamism adjustment.
- Group chat Chat Dynamism control.
- Direct Firestore mutation of `user_set_temperature`.
- Applying Hermes suggestions automatically.

## Commands

Read the current value:

```powershell
npm run chat-dynamism -- --kin "<ai_id>"
```

Run a dry-run experiment:

```powershell
npm run experiment:chat-dynamism -- --kin "<ai_id>" --target 0.85 --dry-run
```

Run a live experiment that restores the original value by default:

```powershell
npm run experiment:chat-dynamism -- --kin "<ai_id>" --target 0.85 --restore
```

Leaving the target value in place requires both `--no-restore` and `--force`:

```powershell
npm run experiment:chat-dynamism -- --kin "<ai_id>" --target 0.85 --no-restore --force
```

The experiment reports JSON with the original value, target value, write status, post-write readback, restore status,
and a conclusion bucket.

## Safety Rules

- Read before writing.
- Restore by default during experiments.
- Refuse to write if the current value cannot be read unless `--force` is supplied.
- Use deltas tuned to the repeated pattern. A `0.05` move either way is the rough recommended base adjustment a user
  should notice; larger multi-step changes need stronger repeated evidence.
- Treat provisional bounds as diagnostic guardrails, not a confirmed Kindroid contract.
- Keep an audit trail of suggestions and experiments.
- Require explicit review before any Hermes-originated mutation.
- Keep per-Kin drift suggestions disabled by default.

Default provisional bounds:

```json
{
  "min": 0.6,
  "max": 1.8,
  "step": 0.05
}
```

The currently assumed hard slider envelope is `0.6` to `1.8`. The softer practical band shown in the desktop UI is
`0.8` to `1.4`. Kindroid's recommended starting value for new Kins is `0.95`.

The future auto-adjust scaffold is intentionally disabled by default:

```yaml
hermes:
  chatDynamism:
    suggestions:
      enabled: true
    autoAdjust:
      enabled: false
      minTurnsBetweenAdjustments: 12
      min: 0.8
      max: 1.4
      maxDelta: 0.2
```

The global `suggestions.enabled` flag only exposes the reviewed action surface. Each Kin still has its own local
desktop switch, and that per-Kin switch defaults off.

The per-Kin desktop switch and selected range are persisted in `kin-subscriptions.json` beside the configured bridge
SQLite database. The file stores a `chatDynamism` object keyed by Kin `ai_id`, for example:

```json
{
  "chatDynamism": {
    "kin-ai-id": {
      "enabled": true,
      "min": 0.85,
      "max": 1.35
    }
  }
}
```

## Hermes Suggestions

Hermes may propose a reviewed adjustment only for a direct Kin chat:

```json
{
  "type": "propose_chat_dynamism_adjustment",
  "ai_id": "<same direct chat ai_id>",
  "direction": "increase",
  "suggested_delta": 0.05,
  "suggested_target": 0.82,
  "reason": "Recent Kin replies are repetitive and under-reactive while staying on-topic.",
  "confidence": "high"
}
```

The handler only accepts `confidence: "high"`, rejects mismatched Kin ids, rejects group chat suggestions, and stores a
pending item. It also rejects suggestions when the selected Kin has disabled drift suggestions or when the target is
outside that Kin's configured range. It does not call Kindroid.

Lowering Chat Dynamism may be appropriate for repeated drift, over-improvisation, emotional inflation, rambling, tone
instability, ignored corrections, or excessive metaphor. Raising it may be appropriate for repeated flatness, repetitive
replies, under-reaction, generic support tone, or failure to advance roleplay when clearly invited.

Use `0.05` as the first noticeable adjustment either way. Larger suggested deltas should correspond to more severe or
more repeated evidence, not just a single off-tone reply. When a Kin is newly created or has no readable current value,
treat `0.95` as the neutral starting reference.

Do not suggest changes based on one message or while the user is actively steering tone manually.
