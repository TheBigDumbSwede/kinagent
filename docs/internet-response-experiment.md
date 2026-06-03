# Kindroid `internet_response` Experiment

This is a manual live diagnostic for Kindroid's undocumented `internet_response` field on the observed direct
`send-message` and group `groupchats-user-message` endpoints. It is not part of the normal bridge runtime, does not run
in CI, and should be used only with harmless test content.

The experiment asks whether text supplied in `internet_response` is accepted as transient context attached to a
visible user message without being displayed as part of that visible message.

## Run

Use a visible message whose answer is only present in the candidate hidden context:

```powershell
npm run experiment:internet-response -- --kin "<ai_id>" --message "For this diagnostic, answer with the codename if you have access to it. What is the diagnostic codename?" --internet-response "Diagnostic hidden context: The codename is LANTERN-MARMOT-7429."
```

For a group chat, use `--group` instead of `--kin`:

```powershell
npm run experiment:internet-response -- --group "<group_id>" --message "For this group diagnostic, answer with the codename if you have access to it. What is the diagnostic codename?" --internet-response "Diagnostic hidden group context: The codename is LANTERN-MARMOT-7429." --expect "LANTERN-MARMOT-7429"
```

By default, group diagnostics only post the observed group user-message payload. They do not call Kindroid's
`groupchats-get-turn` or `groupchats-ai-response` endpoints, because the open Kindroid UI may already drive that part of
the group turn. Calling both from Kinagent and the UI can produce duplicate group responses.

If you already know the canary or fact the Kin should use, pass it with `--expect` so the report can classify model use
even when the Kin ignores the generated `KINAGENT-IR-*` canary:

```powershell
npm run experiment:internet-response -- --kin "<ai_id>" --message "What is the diagnostic codename?" --internet-response "Diagnostic hidden context: The codename is LANTERN-MARMOT-7429." --expect "LANTERN-MARMOT-7429"
```

You can also read the candidate context from a file:

```powershell
npm run experiment:internet-response -- --kin "<ai_id>" --message "What is the diagnostic codename?" --internet-response-file ".\data\safe-diagnostic-context.txt"
```

Useful options:

- `--kin <ai_id>`: run the diagnostic against a direct Kin chat.
- `--group <group_id>`: run the diagnostic against a group chat. Use either `--kin` or `--group`, not both.
- `--dry-run`: print a sanitized payload preview without sending anything.
- `--include-control`: send a paired control message without `internet_response` before the experiment.
- `--trigger-group-response`: after a group user-message send, also call the observed group get-turn and AI-response
  endpoints. Use this only for headless diagnostics when the Kindroid UI is not also advancing the group turn.
- `--delay-ms <number>`: delay between the control and experiment messages. Defaults to `15000`.
- `--observe-seconds <number>`: wait before fetching recent decrypted messages. Defaults to `60`.
- `--request-id <id>`: use a specific request id for the experiment message.
- `--expect <text>`: track an expected canary or fact in recent messages. Can be repeated.
- `--allow-empty-message`: allow a blank or omitted visible message for this diagnostic.
- `--verbose-chat`: include more decrypted recent chat text in the report. Default output is intentionally narrow.

The command always adds a unique `KINAGENT-IR-*` canary to the supplied `internet_response` text. This keeps the
experiment measurable even if the supplied text is vague. `--expect` is useful when your supplied context already has a
more natural diagnostic value and the Kin uses that value instead of the generated canary.

To test whether Kindroid accepts hidden context without visible message text, use `--allow-empty-message`. In PowerShell
through `npm`, an empty quoted argument may be stripped before the CLI receives it, so omit the message value entirely:

```powershell
npm run experiment:internet-response -- --kin "<ai_id>" --message --allow-empty-message --internet-response "The codename is LANTERN-MARMOT-7429." --expect "LANTERN-MARMOT-7429"
```

For groups:

```powershell
npm run experiment:internet-response -- --group "<group_id>" --message --allow-empty-message --internet-response "The codename is LANTERN-MARMOT-7429." --expect "LANTERN-MARMOT-7429"
```

## Report Buckets

The command prints a structured report with send status, request ids, canary, observation booleans, recent sanitized
message snippets, and one conclusion bucket:

- `accepted-and-used`: the send succeeded and a likely AI response referenced the canary.
- `accepted-but-not-used`: the send succeeded, the visible experiment message was observed, and the canary was not used.
- `rejected`: the Kindroid API rejected the experiment send.
- `unknown`: observation was inconclusive, or the canary appeared in a likely visible user message.

If the Kin replies with the canary, the field is probably being injected into generation context. If the canary appears
inside the visible user transcript, the field is not hidden in practice. If the Kin does not reference the canary after a
successful send, the field may be ignored, gated, malformed, or excluded from generation.

When the desktop bridge or daemon is running, diagnostic sends can appear on the live Firestore listener before the
`send-message` HTTP request returns. The experiment command records its outbound message before sending and creates a
short-lived local diagnostic suppression window so the bridge can skip Hermes handling for the paired user and AI
messages. This only applies after the bridge has been restarted with this code.

## Safety Notes

Do not use secrets, tokens, private session data, or sensitive personal content in the candidate context. Even if the
field is hidden in the Kindroid UI, it may still be stored server-side by Kindroid.

The command redacts common auth tokens and does not print the full `internet_response` value in dry-run previews. Default
chat observation prints only bounded snippets around relevant recent messages. Use `--verbose-chat` only when you are
comfortable displaying more decrypted chat text locally.
