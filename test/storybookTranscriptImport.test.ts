import { describe, expect, it } from "vitest";
import { renderChatTranscript } from "../src/chatExport/chatExport.js";
import type { NormalizedKindroidMessage } from "../src/firestore/types.js";
import { parseImportedStorybookTranscript } from "../src/storybook/transcriptImport.js";

describe("Storybook transcript import", () => {
  it("round-trips Kinagent direct-chat Markdown exports with dates and speakers", () => {
    const markdown = renderChatTranscript(
      [
        message({
          id: "doc-1",
          timestamp: "2026-06-01T12:00:00.000Z",
          sender: "user",
          text: "Hello."
        }),
        message({
          id: "doc-2",
          timestamp: "2026-06-01T12:01:00.000Z",
          sender: "ai",
          text: "Hi there."
        })
      ],
      { kinName: "Alexis" }
    );

    const result = parseImportedStorybookTranscript(markdown, { fileName: "alexis-chat-all.md" });

    expect(result.format).toBe("kinagent-markdown");
    expect(result.confidence).toBe("high");
    expect(result.transcript.source).toEqual({
      scope: "import",
      id: "alexis-chat-all.md",
      displayName: "alexis chat all",
      source: "imported-transcript"
    });
    expect(result.transcript.messages.map((entry) => [entry.timestamp, entry.speakerName, entry.text])).toEqual([
      ["2026-06-01T12:00:00.000Z", "User", "Hello."],
      ["2026-06-01T12:01:00.000Z", "Alexis", "Hi there."]
    ]);
    expect(result.transcript.participants).toEqual([
      { id: "user", name: "User", kind: "user" },
      { id: "speaker:alexis", name: "Alexis", kind: "kin" }
    ]);
  });

  it("preserves group speakers from Kinagent Markdown exports", () => {
    const markdown = renderChatTranscript(
      [
        message({
          id: "doc-1",
          kinId: "kin-1",
          timestamp: "2026-06-01T12:00:00.000Z",
          sender: "ai",
          text: "I can start."
        }),
        message({
          id: "doc-2",
          kinId: "kin-2",
          timestamp: "2026-06-01T12:01:00.000Z",
          sender: "ai",
          text: "I'll follow."
        }),
        message({
          id: "doc-3",
          kinId: "group-1",
          timestamp: "2026-06-01T12:02:00.000Z",
          sender: "user",
          text: "Good."
        })
      ],
      {
        kinName: "Weekend Group",
        speakerNames: {
          "kin-1": "Alexis",
          "kin-2": "Amanda"
        }
      }
    );

    const result = parseImportedStorybookTranscript(markdown, { fileName: "weekend-group-chat.md" });

    expect(result.format).toBe("kinagent-markdown");
    expect(result.transcript.messages.map((entry) => `${entry.speakerName}: ${entry.text}`)).toEqual([
      "Alexis: I can start.",
      "Amanda: I'll follow.",
      "User: Good."
    ]);
    expect(result.transcript.participants).toEqual([
      { id: "speaker:alexis", name: "Alexis", kind: "kin" },
      { id: "speaker:amanda", name: "Amanda", kind: "kin" },
      { id: "user", name: "User", kind: "user" }
    ]);
  });

  it("imports plain text speaker lines with missing timestamp warnings", () => {
    const result = parseImportedStorybookTranscript(
      ["Bruce: I don't know where to start.", "Alexis: Start with the easy part.", "", "Bruce: Fine."].join("\n"),
      { fileName: "plain.txt" }
    );

    expect(result.format).toBe("plain-text");
    expect(result.confidence).toBe("medium");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Line 1: message has no usable timestamp.",
        "Line 2: message has no usable timestamp.",
        "Line 4: message has no usable timestamp."
      ])
    );
    expect(result.transcript.messages.map((entry) => [entry.speakerName, entry.timestamp, entry.text])).toEqual([
      ["Bruce", null, "I don't know where to start."],
      ["Alexis", null, "Start with the easy part."],
      ["Bruce", null, "Fine."]
    ]);
  });

  it("keeps malformed freeform text as unknown-speaker paragraph messages", () => {
    const result = parseImportedStorybookTranscript(
      ["No labels here.", "Still the same paragraph.", "", "A second loose paragraph."].join("\n"),
      { fileName: "notes.txt" }
    );

    expect(result.format).toBe("plain-text");
    expect(result.confidence).toBe("low");
    expect(result.warnings).toContain(
      "No speaker labels were detected; paragraph blocks were imported as Unknown speaker messages."
    );
    expect(result.transcript.messages.map((entry) => [entry.speakerName, entry.speakerKind, entry.text])).toEqual([
      ["Unknown", "unknown", "No labels here. Still the same paragraph."],
      ["Unknown", "unknown", "A second loose paragraph."]
    ]);
  });
});

function message(overrides: Partial<NormalizedKindroidMessage>): NormalizedKindroidMessage {
  return {
    id: "doc",
    kinId: "kin-1",
    timestamp: null,
    text: null,
    sender: null,
    role: null,
    raw: {},
    ...overrides
  };
}
