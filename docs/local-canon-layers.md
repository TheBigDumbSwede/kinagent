# KinAgent Local Canon and State Layers

Kinagent keeps several local records beside Kindroid-visible state. These records are not all the same kind of truth. A
diagnostic observation, a current-scene snapshot, a mystery clue, and a reviewed journal suggestion should not share the
same durability rules just because they are all stored locally.

This document defines the initial layer vocabulary used by Kinagent. The matching TypeScript vocabulary lives in
`src/state/canonLayers.ts`.

## Layer IDs

| Layer ID             | Meaning                                                                                                | Durable by default |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| `hard_canon`         | User-approved stable facts suitable for durable memory or durable Kindroid-facing changes.             | Yes                |
| `soft_canon`         | Repeated or likely facts that remain provisional until reviewed or reinforced.                         | No                 |
| `scene_state`        | Temporary current-scene facts such as location, objects, tone, participants, and immediate open beats. | No                 |
| `user_preference`    | User taste and experience-shaping preferences that should guide Kinagent behavior.                     | Usually            |
| `system_observation` | Diagnostics, health signals, drift observations, and other non-canonical analysis.                     | No                 |
| `game_state`         | Validated campaign, mystery, character, roll, and clue state owned by Kinagent rather than Hermes.     | Per campaign       |

The layer answers one question: what kind of truth is this record claiming to be?

It should not encode lifecycle. `pending`, `accepted`, `dismissed`, `stale`, `source_invalidated`, `expired`, and
`remediated` are lifecycle or review states, not layers.

## Current System Mapping

| System                        | Current layer mapping                     | Notes                                                                                                   |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Journal suggestions           | `hard_canon` candidate                    | A suggestion targets durable memory, but it is not hard canon until the user accepts it.                |
| Accepted journal writes       | `hard_canon`                              | Accepted writes have user review and Kindroid-side mutation results.                                    |
| Previously On briefs          | `scene_state`                             | Continuity recap for re-entry. It is not Kindroid memory and is not automatically injected into chat.   |
| Local scene state             | `scene_state`                             | App-owned backstage current-scene metadata for a Kin or group.                                          |
| Scene ledger                  | `scene_state`                             | Per-source scene facts with provenance for later continuity reasoning.                                  |
| Soundscape state              | `scene_state` derived cue                 | Presentation state inferred from scene context. It is not evidence and should not be promoted directly. |
| Group Gaming campaign state   | `game_state`                              | Validated against campaign pack IDs and owned by Kinagent. Hermes may propose, but Kinagent validates.  |
| Chat Dynamism suggestions     | `system_observation` targeting preference | Drift observation that may lead to reviewed Kindroid configuration changes.                             |
| Future diagnostics            | `system_observation`                      | Diagnostics can influence recommendations but should not become Kin memory without review.              |
| Future Director Mode settings | `user_preference` or `scene_state`        | Stable user taste belongs in preferences; immediate staging instructions belong in scene state.         |

## Provenance

Layered records should carry provenance when practical:

- source type, such as `chat_message`, `chat_history`, `hermes_action`, `user_review`, `kindroid_api`, `campaign_pack`,
  `diagnostic`, `local_runtime`, or `manual`
- source id or source document id
- source timestamp or observed timestamp
- actor, such as user, Hermes, Kinagent runtime, or Kindroid
- confidence
- short evidence strings
- reason
- lifecycle status

Provenance should explain why a record exists. It should not make an unreviewed record more durable than its layer allows.

## Promotion and Demotion

Promotion is a reviewed change from a less durable layer into a more durable layer.

Common examples:

- `soft_canon` to `hard_canon`: repeated fact becomes user-approved memory.
- `scene_state` to `hard_canon`: a current scene event becomes a lasting milestone or journal-worthy event.
- `system_observation` to `user_preference`: repeated drift evidence leads to an approved Chat Dynamism or pacing change.
- `game_state` to `hard_canon`: an episode result becomes a user-approved durable memory or in-joke.

Demotion is a correction away from durability.

Common examples:

- `hard_canon` to `soft_canon`: a previously accepted fact becomes uncertain.
- `soft_canon` to `scene_state`: an inference turns out to be only a temporary scene beat.
- `scene_state` to expired: the scene has moved on.
- `system_observation` to remediated or dismissed: a diagnostic no longer applies.

Do not promote records automatically just because Hermes is confident. Confidence is evidence quality, not user approval.

## Design Rules

- Keep Kindroid-visible durable memory separate from local-only continuity and diagnostics.
- Treat journal proposals as intent to create hard canon, not hard canon itself.
- Treat soundscape and background prompts as presentation derivations, not evidence.
- Let Group Gaming own game-state validation; Hermes can propose changes, but campaign IDs and rule state are Kinagent's
  responsibility.
- Prefer small provenance records over copying long chat text into local state.
- When a record mixes concerns, split it into separate records rather than assigning several meanings to one layer.
