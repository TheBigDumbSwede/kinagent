import { describe, expect, it } from "vitest";
import {
  defaultChatExportFileName,
  isMessageInRange,
  normalizeDateRange,
  renderChatTranscript
} from "../src/chatExport/chatExport.js";
import type { NormalizedKindroidMessage } from "../src/firestore/types.js";

describe("chat export", () => {
  it("renders a transcript with dates", () => {
    expect(
      renderChatTranscript(
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
      )
    ).toBe("## 2026-06-01\n[12:00] User: Hello.\n[12:01] Alexis: Hi there.\n");
  });

  it("renders group transcript speakers from AI IDs", () => {
    expect(
      renderChatTranscript(
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
            role: "assistant",
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
      )
    ).toBe("## 2026-06-01\n[12:00] Alexis: I can start.\n[12:01] Amanda: I'll follow.\n[12:02] User: Good.\n");
  });

  it("filters date ranges inclusively by selected day", () => {
    const range = normalizeDateRange("2026-06-02", "2026-06-03");

    expect(isMessageInRange(message({ timestamp: "2026-06-01T23:59:59.000Z" }), range)).toBe(false);
    expect(isMessageInRange(message({ timestamp: "2026-06-02T00:00:00.000Z" }), range)).toBe(true);
    expect(isMessageInRange(message({ timestamp: "2026-06-03T23:59:59.000Z" }), range)).toBe(true);
    expect(isMessageInRange(message({ timestamp: "2026-06-04T00:00:00.000Z" }), range)).toBe(false);
  });

  it("builds a safe markdown filename", () => {
    expect(defaultChatExportFileName("Alexis Prime", normalizeDateRange("2026-06-01", "2026-06-03"))).toBe(
      "alexis-prime-chat-2026-06-01-to-2026-06-03.md"
    );
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
