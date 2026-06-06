# Hermes Actions

This document describes the current Hermes action surface in Kinagent. The code source of truth is
[src/hermes/actionRegistry.ts](../src/hermes/actionRegistry.ts).

Hermes receives readable Kindroid chat events and may return compact JSON:

```json
{ "actions": [] }
```

Each action must be accepted by a registered handler. Unknown action types, malformed payloads, mismatched ids, and
disabled features are ignored.

## Registry

The active registry is built by `createHermesActionRegistry(...)`.

| Action types                                                     | Handler                          | Execution | Scope                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `update_previously_on_brief`, `update_group_previously_on_brief` | `PreviouslyOnActionHandler`      | Immediate | Stores local-only continuity recap metadata for the same direct Kin or group chat.                     |
| `update_local_scene_state`, `update_group_local_scene_state`     | `LocalSceneActionHandler`        | Immediate | Stores local-only backstage scene metadata for the same direct Kin or group chat.                      |
| `update_current_scene`, `update_group_current_scene`             | `CurrentSceneActionHandler`      | Immediate | Updates Kindroid `current_scene` for the same direct Kin or group chat.                                |
| `update_soundscape`, `update_group_soundscape`                   | `SoundscapeActionHandler`        | Immediate | Emits local procedural soundscape metadata for the same direct Kin or group chat.                      |
| `send_ambient_context_turn`                                      | `AmbientContextActionHandler`    | Immediate | Sends a direct Kin ambient visible message with hidden `internet_response` context.                    |
| `propose_journal_entry`, `delete_journal_entry`                  | `JournalSuggestionActionHandler` | Reviewed  | Creates pending desktop review items. Kindroid journals are changed only after user acceptance.        |
| `propose_chat_dynamism_adjustment`                               | `ChatDynamismActionHandler`      | Reviewed  | Creates pending direct-Kin Chat Dynamism suggestions. No Kindroid mutation is performed automatically. |

## Previously On Briefs

Previously On briefs are local Kinagent continuity notes. They are stored per direct Kin or group and surfaced above the
Scene tab's structured local scene metadata. They help the user re-enter the chat with narrative and emotional
continuity, but they do not mutate Kindroid or automatically inject prompt text.

Direct Kin request:

```json
{
  "type": "update_previously_on_brief",
  "ai_id": "<same direct chat ai_id>",
  "facts": ["<known recent fact>"],
  "inferredTone": "<brief inferred tone>",
  "unresolvedThreads": ["<open thread>"],
  "suggestedOpeningFrame": "<small practical next frame>",
  "recap": "<short user-readable recap>",
  "confidence": "low|medium|high"
}
```

Group request:

```json
{
  "type": "update_group_previously_on_brief",
  "group_id": "<same group_id>",
  "facts": ["<known recent fact>"],
  "inferredTone": "<brief inferred tone>",
  "unresolvedThreads": ["<open thread>"],
  "suggestedOpeningFrame": "<small practical next frame>",
  "recap": "<short user-readable recap>",
  "confidence": "low|medium|high"
}
```

Guardrails:

- The handler rejects mismatched `ai_id` or `group_id`.
- Keep facts grounded in recent readable chat. Put mood or subtext in `inferredTone`, not in facts.
- Keep the brief short and practical; this is a continuity aid, not a transcript summary.
- This action does not call Kindroid and must not write Kindroid memory, `current_scene`, journals, chat text, or user
  replies.
- `suggestedOpeningFrame` is optional user-facing guidance and must not be auto-sent or hidden-injected into Kindroid.

Prewarm:

- Previously On prewarm is handled by `PreviouslyOnPrewarmCoordinator`, separately from local scene and soundscape
  prewarm.
- It loads bounded recent-message context through Kindroid's documented `/v1/get-chat-messages` API.
- It is gated by the shared per-Kin or per-group prewarm watermark, so cached-ready sources are not re-fetched on
  restart unless newer live chat activity arrives or the user explicitly refreshes the recap from the desktop Scene tab.
- It emits `kindroid.previously_on.prewarm` to Hermes and executes only `update_previously_on_brief` or
  `update_group_previously_on_brief` actions from the response.
- It does not execute local scene, soundscape, `current_scene`, journal, ambient-context, or Chat Dynamism actions.

## Local Scene State

Local scene state is backstage Kinagent metadata. It is stored per direct Kin or group and surfaced in the desktop UI so
future local features can inspect the current place, activity, mood, tension, privacy, palette, or ambience without
writing to Kindroid-visible state.

Direct Kin request:

```json
{
  "type": "update_local_scene_state",
  "ai_id": "<same direct chat ai_id>",
  "location": "rainy apartment kitchen",
  "timeOfDay": "late evening",
  "mood": "quiet, intimate, slightly melancholy",
  "activity": "talking over coffee",
  "tension": 0.25,
  "privacy": "private",
  "soundscape": {},
  "visualPalette": {},
  "suggestedUiAccent": "cool low-light",
  "evidence": ["<specific recent-message evidence>"],
  "reason": "<why this local scene state changed>"
}
```

Group request:

```json
{
  "type": "update_group_local_scene_state",
  "group_id": "<same group_id>",
  "location": "ship engine bay",
  "activity": "checking a damaged relay",
  "tension": 0.55,
  "privacy": "restricted",
  "reason": "<why this local scene state changed>"
}
```

Guardrails:

- The handler rejects mismatched `ai_id` or `group_id`.
- Use this only when the venue, time, activity, privacy, tension, mood, or scene direction materially changes.
- Keep values compact, factual, inspectable, and grounded in recent readable chat.
- This action does not call Kindroid and must not write Kindroid memory, `current_scene`, journals, chat text, or user replies.
- Group state is keyed by `group_id`; the latest speaker Kin is recorded only as metadata and is not treated as the group
  scene owner.

Prewarm:

- Local scene prewarm is handled by `LocalScenePrewarmCoordinator`, separately from soundscape prewarm.
- It loads bounded recent-message context through Kindroid's documented `/v1/get-chat-messages` API.
- It is gated by the shared per-Kin or per-group prewarm watermark, so cached-ready sources are not re-fetched on
  restart unless newer live chat activity arrives or the user explicitly uses Force Prewarm from the desktop Scene tab.
- It emits `kindroid.local_scene.prewarm` to Hermes and executes only `update_local_scene_state` or
  `update_group_local_scene_state` actions from the response.
- It does not execute soundscape, `current_scene`, journal, ambient-context, or Chat Dynamism actions.

## Current Scene Updates

Direct Kin chats may request:

```json
{
  "type": "update_current_scene",
  "ai_id": "<same direct chat ai_id>",
  "current_scene": "<brief current situation>",
  "reason": "<short reason>"
}
```

Group chats may request:

```json
{
  "type": "update_group_current_scene",
  "group_id": "<same group_id>",
  "current_scene": "<brief current situation>",
  "reason": "<short reason>"
}
```

Guardrails:

- Only use this when the current location, activity, scene, or situation materially changes.
- Do not use it for routine conversation, greetings, emotional tone, preferences, memories, or speculation.
- The handler rejects mismatched `ai_id` or `group_id`.
- The handler trims and applies the configured `currentSceneUpdates.maxLength`.

## Soundscape Updates

Soundscape updates are local desktop metadata only. Hermes may describe the ambience Kinagent should synthesize, but the
renderer owns the Web Audio graph and no Kindroid state or chat text is changed.

Direct Kin request:

```json
{
  "type": "update_soundscape",
  "ai_id": "<same direct chat ai_id>",
  "reason": "<short reason>",
  "soundscape": {
    "enabled": true,
    "environment": "rainy motel room",
    "mood": "uneasy",
    "intensity": 0.4,
    "transition": "fade",
    "layers": [
      { "type": "rain", "volume": 0.52, "density": 0.7 },
      { "type": "roomTone", "volume": 0.4 },
      { "type": "lowDrone", "volume": 0.14, "pitch": 72 }
    ]
  }
}
```

Group request:

```json
{
  "type": "update_group_soundscape",
  "group_id": "<same group_id>",
  "reason": "<short reason>",
  "soundscape": {
    "enabled": true,
    "environment": "ship engine bay",
    "mood": "tense",
    "intensity": 0.5,
    "transition": "swell",
    "layers": [
      { "type": "hum", "volume": 0.3, "pitch": 58 },
      { "type": "lowDrone", "volume": 0.18, "pitch": 58 }
    ]
  }
}
```

Guardrails:

- Requires the direct Kin's Manage > Audio > Soundscape setting to be enabled. Group soundscape updates are gated by
  that Group's Manage > Audio > Soundscape setting.
- The handler rejects mismatched `ai_id` or `group_id`.
- Use this only when venue, weather, machinery, environmental texture, tension, or a major scene event materially changes.
- Do not update on every turn.
- Allowed layer types are `rain`, `wind`, `roomTone`, `lowDrone`, `hum`, `tensionPulse`, and `static`.
- Use cached-sample mixer volumes, not tiny procedural-test values: primary beds usually `0.35-0.55`, weather
  `0.4-0.65`, and hum/drone usually `0.15-0.3`.
- Use `static` only for explicit radio, signal, comms, scanner, television, or interference scenes. Do not use it for
  generic office, lobby, tension, or machinery ambience.
- This action must not include Kin-visible text, soundtrack instructions, Foley requests, or durable memory content.
- It does not call Kindroid and does not write `current_scene`.
- Soundscape prewarm uses the same shared prewarm watermark as local scene prewarm, persists generated soundscape state
  locally, and can be refreshed per source with Force Prewarm from the desktop Audio tab.

## Journal Suggestions

Journal suggestions are review-only. Hermes may propose a journal create or delete, but the runtime only stores a pending
suggestion. The desktop review flow performs the Kindroid mutation after user acceptance.

Create request:

```json
{
  "type": "propose_journal_entry",
  "ai_id": "<same ai_id>",
  "title": "<specific short title>",
  "category": "relationship_milestone",
  "category_detail": "<optional specific durable label>",
  "entry": "<concise third-person journal capsule>",
  "keyphrases": ["<distinctive recall phrase>"],
  "evidence": ["<specific message evidence>"],
  "durability_reason": "<why this changes future interpretation>",
  "confidence": "high",
  "strong_event": false
}
```

Delete request:

```json
{
  "type": "delete_journal_entry",
  "ai_id": "<same ai_id>",
  "journal_entry_id": "<id from journalContext.existingEntries>",
  "title": "<short deletion review title>",
  "target_title": "<existing entry title>",
  "target_entry": "<brief existing entry excerpt>",
  "evidence": ["<specific contradiction or duplicate evidence>"],
  "durability_reason": "<why keeping this entry would harm future recall>",
  "confidence": "high",
  "strong_event": false
}
```

Guardrails:

- Journal create/delete suggestions require `confidence: "high"`.
- Suggestions must include a durable reason.
- Journal creation is only for Kin-authored messages where `sender` is `ai`.
- Delete requests must use an id present in `journalContext.existingEntries`.
- Suggestions are compared against existing journal entries and field excerpts when context is available.
- Journals are triggerable capsules, not generic lore storage, duplicated backstory, transient mood capture, or always-on rules.

## Chat Dynamism Suggestions

Chat Dynamism is the Kindroid UI name for the observed profile field `user_set_temperature`. Hermes may propose a
reviewed adjustment, but Kinagent only stores the pending suggestion in this first pass.

Direct Kin request:

```json
{
  "type": "propose_chat_dynamism_adjustment",
  "ai_id": "<same direct chat ai_id>",
  "direction": "increase",
  "suggested_delta": 0.05,
  "suggested_target": 0.82,
  "reason": "<specific multi-message pattern>",
  "confidence": "high"
}
```

Guardrails:

- Suggestions require `confidence: "high"`.
- The handler rejects group chat suggestions.
- The handler rejects mismatched `ai_id` values.
- The handler rejects suggestions unless the selected Kin has enabled reviewed Chat Dynamism drift suggestions.
- The handler rejects suggestions outside the selected Kin's configured range.
- The handler stores a pending suggestion only. It does not call Kindroid.
- Treat `0.05` in either direction as the rough base adjustment a user should notice.
- Use larger deltas only for stronger repeated evidence.
- Treat `0.95` as Kindroid's recommended starting value for new Kins.
- Do not propose changes based on one message.
- Do not propose changes while the user is actively steering tone manually.
- Lowering may be useful for repeated drift, over-improvisation, emotional inflation, rambling, tone instability,
  ignored corrections, or excessive metaphor.
- Raising may be useful for repeated flatness, repetitive replies, under-reaction, generic support tone, or failure to
  advance roleplay when clearly invited.

## Ambient Context Turns

Ambient context turns are registered as a peer Hermes action beside current-scene updates and journal suggestions. They
are not the default route for all Hermes output. Use them only when a direct Kin needs immediate hidden per-turn
operational context without putting that operational context into visible chat text.

This is currently the only Hermes action that can inject immediate context into the next direct-Kin response without
making the operational content overt in the transcript.

Direct Kin request:

```json
{
  "type": "send_ambient_context_turn",
  "ai_id": "<same direct chat ai_id>",
  "ambient_message": "<small asterisk-delimited diegetic ambient beat fitted to the current conversation and current setting>",
  "context": "<concise hidden operational context>",
  "source": "<source or tool name>",
  "confidence": "high",
  "suggested_use": "<how the Kin should use this context if relevant>"
}
```

Execution:

- Ambient context is allowed per Kin by default. The desktop Kin Hermes tab can disable it for individual Kins.
- The handler builds a hidden `Hermes context packet` and sends it through `internet_response`.
- The visible Kindroid `message` is only the `ambient_message`.
- The visible message is normalized to leading and trailing asterisks so Kindroid formats it as narration.
- The handler records outbound dedupe before sending so the bridge can suppress its own visible ambient echo.
- The desktop Monitor receives a local `Hermes` entry containing the hidden packet that Kinagent sent.
- Direct sends use Kindroid's documented `/v1/send-message` endpoint with an observed `internet_response` extension.
- Group sends are not registered for Hermes ambient context. The documented `/v1/groupchats-user-message` payload does
  not include `internet_response`; the observed extension has been accepted in live diagnostics, but those diagnostics
  currently classify it as accepted-but-not-used by group AI responses.

Guardrails:

- Use this only when a direct Kin needs immediate per-turn context that should not be dumped visibly into chat.
- Do not use this as a substitute for other registered actions. Use `update_current_scene` or
  `update_group_current_scene` for current setting changes, and journal suggestions for reviewed durable memory.
- If the only useful action is a current setting update or journal proposal, do not add an ambient context turn.
- The ambient message is visible and should be small, diegetic, and contextually appropriate to the current conversation
  and saved current scene when available.
- The ambient message should be a single narration line delimited with asterisks.
- The ambient message must not mention Hermes, tools, diagnostics, hidden context, `internet_response`, codenames, or the
  operational facts carried in the hidden context.
- The context should be summarized and non-secret. Hidden does not mean private from Kindroid.
- Do not use this for durable memory. Use reviewed journal suggestions for durable recall and `current_scene` for tiny
  scene-state updates.

Supporting docs:

- [docs/ambient-context-turns.md](ambient-context-turns.md)
- [docs/internet-response-experiment.md](internet-response-experiment.md)

## Adding Actions

When adding a Hermes function:

- Add or update a `HermesActionHandler`.
- Register it in `createHermesActionRegistry(...)`.
- Add a row to `hermesActionRegistryEntries`.
- Update this document.
- Add tests for prompt lines, normalization, id matching, and side-effect boundaries.
- Keep the action narrow. If it mutates Kindroid durable state, prefer review before execution unless there is a strong reason otherwise.
