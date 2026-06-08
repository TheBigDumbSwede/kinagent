import { describe, expect, it } from "vitest";
import type { KindroidGroupChatChangeNotification } from "../src/firestore/types.js";
import { TurnBuffer } from "../src/game/turnBuffer.js";

describe("TurnBuffer", () => {
  it("buffers Kin context and closes it with a user turn parcel", () => {
    const buffer = new TurnBuffer();

    expect(buffer.bufferContext("group-a", notification("doc-ai-1", "Velma studies the static.", "ai"))).toBe(true);
    expect(buffer.bufferContext("group-a", notification("doc-ai-2", "Daphne checks the puddle.", "ai"))).toBe(true);

    const parcel = buffer.buildParcel("group-a", notification("doc-user-1", "I ask what the radio is saying.", "user"));

    expect(parcel).toMatchObject({
      closedBy: "user",
      contextMessages: [
        {
          documentId: "doc-ai-1",
          sender: "ai",
          text: "Velma studies the static."
        },
        {
          documentId: "doc-ai-2",
          sender: "ai",
          text: "Daphne checks the puddle."
        }
      ],
      userMessage: {
        documentId: "doc-user-1",
        sender: "user",
        text: "I ask what the radio is saying."
      }
    });
  });

  it("ignores duplicate context document ids", () => {
    const buffer = new TurnBuffer();

    expect(buffer.bufferContext("group-a", notification("doc-ai-1", "first", "ai"))).toBe(true);
    expect(buffer.bufferContext("group-a", notification("doc-ai-1", "duplicate", "ai"))).toBe(false);

    expect(buffer.context("group-a", "2026-06-06T00:01:00.000Z")).toEqual([
      expect.objectContaining({
        documentId: "doc-ai-1",
        text: "first"
      })
    ]);
  });

  it("checkpoints a closed parcel and suppresses its document ids later", () => {
    const buffer = new TurnBuffer();

    buffer.bufferContext("group-a", notification("doc-ai-1", "first", "ai"));
    const parcel = buffer.buildParcel("group-a", notification("doc-user-1", "close turn", "user"));
    buffer.checkpoint("group-a", parcel);

    expect(buffer.context("group-a", "2026-06-06T00:02:00.000Z")).toEqual([]);
    expect(buffer.bufferContext("group-a", notification("doc-ai-1", "repeat context", "ai"))).toBe(false);
    expect(buffer.bufferContext("group-a", notification("doc-user-1", "repeat user", "user"))).toBe(false);
    expect(buffer.bufferContext("group-a", notification("doc-ai-2", "new context", "ai"))).toBe(true);
  });

  it("bounds buffered context by message count and age", () => {
    const buffer = new TurnBuffer({ maxMessages: 2, maxAgeMs: 60_000 });

    buffer.bufferContext("group-a", notification("doc-ai-1", "old", "ai", "2026-06-06T00:00:00.000Z"));
    buffer.bufferContext("group-a", notification("doc-ai-2", "recent one", "ai", "2026-06-06T00:02:00.000Z"));
    buffer.bufferContext("group-a", notification("doc-ai-3", "recent two", "ai", "2026-06-06T00:02:30.000Z"));
    buffer.bufferContext("group-a", notification("doc-ai-4", "recent three", "ai", "2026-06-06T00:02:40.000Z"));

    expect(buffer.context("group-a", "2026-06-06T00:03:00.000Z")).toEqual([
      expect.objectContaining({
        documentId: "doc-ai-3",
        text: "recent two"
      }),
      expect.objectContaining({
        documentId: "doc-ai-4",
        text: "recent three"
      })
    ]);
  });

  it("clears a group's context without affecting other groups", () => {
    const buffer = new TurnBuffer();

    buffer.bufferContext("group-a", notification("doc-a", "group a", "ai"));
    buffer.bufferContext("group-b", notification("doc-b", "group b", "ai"));
    buffer.clear("group-a");

    expect(buffer.context("group-a", "2026-06-06T00:01:00.000Z")).toEqual([]);
    expect(buffer.context("group-b", "2026-06-06T00:01:00.000Z")).toEqual([
      expect.objectContaining({
        documentId: "doc-b",
        text: "group b"
      })
    ]);
  });
});

function notification(
  documentId: string,
  text: string,
  sender: KindroidGroupChatChangeNotification["sender"],
  timestamp = "2026-06-06T00:00:00.000Z"
): KindroidGroupChatChangeNotification {
  return {
    type: "kindroid.group_chat.changed",
    groupId: "group-a",
    aiId: sender === "ai" ? "kin-a" : null,
    documentId,
    timestamp,
    text,
    textEncrypted: false,
    textDecrypted: true,
    sender,
    role: sender,
    source: "firestore"
  };
}
