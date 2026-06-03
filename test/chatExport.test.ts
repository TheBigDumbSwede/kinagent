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
