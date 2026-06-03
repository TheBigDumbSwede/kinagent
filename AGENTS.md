# AGENTS.md

Guidance for agents working in this repository.

## Project Model

`kinagent` is a Node.js/TypeScript bridge between Kindroid and a local Hermes Agent runtime.

The core path is:

1. A visible Playwright login captures a Kindroid browser session under `data/`.
2. The runtime extracts Firebase auth state from that session.
3. Firestore Listen watches Kin and group chat message paths in real time.
4. Incoming readable chat events are deduped and forwarded through `HermesAdapter`.
5. Hermes may request narrow Kindroid mutations, currently `current_scene` updates and review-only journal suggestions.
6. The Electron desktop app controls and observes the same background runtime. It should not create a second subscription or mutation path.

Use [README.md](README.md) as the public architecture and setup source. If README and code disagree, inspect the code path before changing documentation.

## Reference Material

The project has three classes of reference material. Keep them distinct.

### Public Project Docs

- [README.md](README.md): runtime architecture, setup, configuration, security notes, workflows, and current milestone status.
- [docs/kindroid-kin-design-reference.md](docs/kindroid-kin-design-reference.md): public Kin design model used by the project when reasoning about Backstory, Key Memories, Journals, Response Directive, Greeting, Example Message, and related fields.
- [docs/hermes-actions.md](docs/hermes-actions.md): current Hermes action registry, action JSON shapes, execution model, and action-addition checklist.

The Kin design reference is operational guidance, not an official Kindroid document. It distills official, community, and local lessons into a practical model for Kinagent features.

### Local-Only Reference Notes

`.local/` is intentionally ignored by Git. Treat anything under it as private working material unless the user explicitly says otherwise.

Local-only notes may include observed Kindroid behavior, private findings, sensitive implementation details, or source material that should not become public documentation. Do not move text from `.local/` into tracked files unless the user explicitly approves the specific material and scope.

### External Reference Documents

The Kin design reference names local reference documents such as:

- `Hitchhikers Guide to Kindroid Creation.pdf`
- `Field Optimization The Logic Burger.txt`

When those documents are available, use them as source material for Kin design reasoning. Do not assume they are committed to the repo. If a task asks for extraction or claims from those documents, inspect the actual document first and separate document-backed claims from implementation inference.

## How the Pieces Tie Together

The repository code is about automation around Kindroid sessions and Hermes actions. The reference documents are about deciding what a good Kin field update or journal entry should mean.

The main bridge is the Hermes journal suggestion workflow:

- [src/hermes/actionRegistry.ts](src/hermes/actionRegistry.ts) is the current source of truth for registered Hermes action handlers.
- [src/hermes/journalSuggestionActionHandler.ts](src/hermes/journalSuggestionActionHandler.ts) prompts Hermes using the design-reference model.
- [src/journal/journalSuggestionStore.ts](src/journal/journalSuggestionStore.ts) stores pending suggestions and applies pacing rules.
- [src/runtime/bridgeRuntime.ts](src/runtime/bridgeRuntime.ts) wires suggestions into the desktop/runtime event stream and accepts reviewed suggestions.
- [src/kindroid/kindroidClient.ts](src/kindroid/kindroidClient.ts) performs the observed Kindroid journal-create request only after the suggestion is accepted.
- [src/desktop/renderer/renderer.js](src/desktop/renderer/renderer.js) presents suggestions for review in the desktop app.

Journal suggestions are review-only. The runtime may propose a triggerable journal capsule, but it must not silently write durable Kin memory without user acceptance.

Use [docs/hermes-actions.md](docs/hermes-actions.md) before adding or changing Hermes functions. Ambient context turns are registered as the direct-Kin hidden context injection path via `send_ambient_context_turn`; keep them narrow, contextual, and non-durable. Group `internet_response` is diagnostic-only unless future live tests prove group AI responses consume it.

## Design Rules for Kin-Related Work

When changing journal, memory, or Kin design behavior, preserve these boundaries:

- Backstory: stable identity, durable traits, world premise.
- Key Memories: important facts, current relationship state, user preferences, boundary anchors.
- Journal Entries: triggerable capsules for durable events, decisions, milestones, relationship changes, important personal facts, recurring patterns, behavior callbacks, place/world capsules, or backstory hook movement.
- Response Directive: output shape, pacing, format, point of view, narration/dialogue balance.
- Greeting Message: scene launch and response invitation.
- Example Message: voice, cadence, formatting, paragraph rhythm, emotional register.

Do not treat journals as generic lore storage, duplicated backstory, transient mood capture, or always-on rules. If a fact should always constrain behavior, it probably belongs in Backstory, Key Memories, Additional Context, or Response Directive instead.

## Runtime Boundaries

Keep these implementation boundaries intact unless the user explicitly asks for a redesign:

- `src/runtime/bridgeRuntime.ts` is the source of truth for background subscriptions and side effects.
- `src/firestore/*ListenClient.ts` and listener modules own realtime Firestore subscription behavior. Do not reintroduce timer polling for live listener behavior.
- `src/hermes/*` owns Hermes prompt/action handling.
- `src/kindroid/*` owns observed Kindroid API payloads and mutations.
- `src/desktop/*` owns UI, tray, IPC, and desktop presentation around the runtime.
- `src/state/*` and preference stores own persistence near `data/`.

If the desktop app needs a new control, wire it through the runtime instead of duplicating listener, Hermes, or Kindroid mutation logic in the renderer.

## Security and Privacy

Kindroid cookies, Firebase tokens, browser storage, `.env`, `config.yaml`, `data/`, release artifacts, logs, and `.local/` are not public project material.

Before committing, verify that the change does not expose:

- browser session state
- Firebase ID or refresh tokens
- Kindroid auth headers or cookies
- private observed API notes
- local-only Kin design findings
- generated release artifacts

The public repository should describe only safe, operationally useful behavior.

## Verification

Use the repository's existing scripts:

- `npm run check`: canonical local gate.
- `npm run smoke:desktop`: quick Electron desktop smoke.
- `npm run dist:win`: full Windows portable build plus portable smoke.
- `npm run test:live`: live Firestore integration tests only when configured and intentionally requested.

For release workflow changes, also test `scripts/check-release-version.mjs` behavior for blank manual-dispatch tags and real `vX.Y.Z` tags.

## Working Style

Prefer narrow, source-backed changes. Read the relevant code and documentation before editing.

When documentation, reference material, and code disagree, do not smooth over the conflict. Identify which source is authoritative for the question at hand:

- runtime behavior comes from code and tests
- public project explanation comes from README and tracked docs
- Kin design semantics come from the design reference and available source documents
- private findings stay local unless explicitly approved

Keep commits scoped. Do not stage ignored local material or generated artifacts.
