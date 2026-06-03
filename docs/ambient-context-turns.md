# Ambient Context Turns

Ambient context turns let KinAgent send a short visible atmospheric message while attaching hidden operational context
through Kindroid's observed `internet_response` field. For Hermes-originated turns, Hermes generates both the visible
ambient beat and the hidden context; KinAgent's built-in tone lines are only a manual fallback.

The visible message is diegetic scene texture generated for the current situation. KinAgent normalizes it to leading and
trailing asterisks so Kindroid formats it as narration instead of spoken dialogue:

```text
*The lights flicker once, just long enough to make the shadows move.*
```

The hidden context carries the actual Hermes or tool result:

```text
Hermes context packet:
Source: tool:door-control
Confidence: high
Result:
The north service door is now unlocked. The hallway camera is looping old footage.

Instruction:
Use this context naturally if relevant. Do not mention Hermes, tools, hidden context, internet_response, or this transport mechanism unless the user asks directly.
```

## Why This Exists

The goal is to avoid visible operator-style messages in the Kindroid transcript while still giving the Kin a natural turn
boundary. The Kin sees a small atmospheric beat, and the useful operational context arrives through `internet_response`.
Because Hermes has the live situation, it should choose the ambient beat when it actively injects context.

In the current Hermes registry, `send_ambient_context_turn` is the active API for this specific operation in direct Kin
chats. It sits beside `update_current_scene`, `update_group_current_scene`, and journal suggestion actions; it is not a
replacement for those routes.

It is the only current way for Hermes to inject immediate context without making the operational content overt in the
visible transcript.

This differs from OOC messages because the visible chat remains in-world. It also differs from journal or current-scene
updates because the context is immediate and per-turn, not durable memory or tiny scene-state persistence.

## Run

The manual CLI currently sends direct Kin ambient turns. Hermes may use the registered action for direct Kin chat events.
Group `internet_response` remains diagnostic-only because live tests show the group endpoint accepts the field but group
AI responses do not consume it.

Ambient context is allowed per Kin by default. In the desktop app, use the Kin Hermes tab to disable ambient context for
individual Kins that should not receive hidden Hermes injections.

```powershell
npm run ambient-context -- --kin "abc123" --tone storm --context "Hermes context: The north service door is now unlocked. The backup generator is still offline."
```

Read hidden context from a file:

```powershell
npm run ambient-context -- --kin "abc123" --tone sci-fi --context-file .\tmp\hermes-result.txt
```

Override the visible atmospheric line:

```powershell
npm run ambient-context -- --kin "abc123" --ambient-message "*The old radio coughs static, then falls silent.*" --context "Hermes context: A new route is available through the maintenance corridor."
```

Dry run without sending:

```powershell
npm run ambient-context -- --kin "abc123" --tone gothic --context "Hermes context: The east stairwell is clear." --dry-run
```

Useful options:

- `--kin <ai_id>`: required Kin id.
- `--context <text>`: hidden operational context.
- `--context-file <path>`: hidden operational context from a UTF-8 text file.
- `--tone <neutral|domestic|storm|sci-fi|noir|fantasy|gothic>`: ambient line family. Defaults to `neutral`.
- `--ambient-message <text>`: explicit visible atmospheric line, preferably generated from the same situational context.
- `--visible-message <text>`: compatibility alias for `--ambient-message`.
- `--instruction <text>`: override the hidden instruction.
- `--request-id <id>`: explicit request id.
- `--idempotency-key <key>`: explicit idempotency key.
- `--dry-run`: print a sanitized payload preview.
- `--verbose`: include the redacted hidden context packet in local output.

Default output does not print the full hidden context. It reports status, selected tone, visible message, request ids, and
hidden context length.

The desktop Monitor shows Hermes-originated hidden packets as local `Hermes` entries with a distinct background. These
entries are not user or AI chat messages; they expose the `internet_response` packet KinAgent attached to the ambient
turn so the operator can inspect what was injected.

## Risks

`internet_response` is undocumented Kindroid behavior and may change or stop working. Hidden also does not mean private
from Kindroid: assume attached context may be stored or processed server-side.

The visible atmospheric line still becomes part of the chat transcript. Overuse may distort the scene tone or make the
conversation feel oddly interrupted. Keep the visible line small and low-impact, and make it fit the current conversation
plus the saved current setting when available. The visible line must not mention Hermes, tools, diagnostics, hidden
context, `internet_response`, or the operational facts carried in the hidden packet. The visible line should be one
asterisk-delimited narration beat.

Do not put secrets, tokens, browser session data, raw logs, or sensitive private material into hidden context.

## Recommended Use

Use ambient context turns for immediate Hermes or tool results that should affect the next direct Kin response without
dumping tool output into chat. Summarize hidden context before injecting it, and have Hermes generate a matching
atmospheric beat that fits the current scene without revealing the operational result.

Use the sibling action that matches the intended side effect:

- `current_scene` for tiny state updates.
- journal entries for durable recall after review.
- ambient context turns for immediate per-turn operational context.

Avoid using this as a general autonomous messaging system. It is not scheduling, polling, or background automation.
Hermes may use the registered `send_ambient_context_turn` action when another Hermes function needs to pass immediate
context to a Kin without showing the operational details. If the only useful work is a current setting update or a
journal proposal, use that action alone.
