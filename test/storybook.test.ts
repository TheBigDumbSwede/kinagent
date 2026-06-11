import { describe, expect, it } from "vitest";
import type { NormalizedKindroidMessage } from "../src/firestore/types.js";
import {
  chunkStorybookTranscript,
  createStorybookFromTranscript,
  createStorybookTranscriptFromMessages,
  type StorybookHermesClient,
  type StorybookHermesRequest
} from "../src/storybook/storybook.js";

describe("storybook pipeline", () => {
  it("normalizes selected direct and group chat history into a storybook transcript", () => {
    const transcript = createStorybookTranscriptFromMessages(
      [
        message({
          id: "doc-2",
          kinId: "kin-1",
          timestamp: "2026-06-01T12:01:00.000Z",
          sender: "ai",
          text: "I brought the umbrella.",
          raw: { display_name: "Alexis" }
        }),
        message({
          id: "doc-1",
          kinId: "group-1",
          timestamp: "2026-06-01T12:00:00.000Z",
          sender: "user",
          text: "It is raining again."
        }),
        message({
          id: "doc-3",
          kinId: "kin-2",
          timestamp: "2026-06-01T12:02:00.000Z",
          role: "assistant",
          text: "I'll check the porch."
        })
      ],
      {
        scope: "group",
        id: "group-1",
        displayName: "Weekend Group",
        speakerNames: {
          "kin-2": "Amanda"
        }
      }
    );

    expect(transcript.conversationId).toBe("group:group-1");
    expect(transcript.messages.map((entry) => `${entry.id}:${entry.speakerName}:${entry.text}`)).toEqual([
      "msg_00001:User:It is raining again.",
      "msg_00002:Alexis:I brought the umbrella.",
      "msg_00003:Amanda:I'll check the porch."
    ]);
    expect(transcript.participants).toEqual([
      { id: "user", name: "User", kind: "user" },
      { id: "kin:kin-1", name: "Alexis", kind: "kin" },
      { id: "kin:kin-2", name: "Amanda", kind: "kin" }
    ]);
  });

  it("chunks transcripts by count, time gaps, and group participant turns", () => {
    const direct = createStorybookTranscriptFromMessages(
      [
        message({ id: "a", timestamp: "2026-06-01T10:00:00.000Z", text: "One." }),
        message({ id: "b", timestamp: "2026-06-01T10:05:00.000Z", text: "Two." }),
        message({ id: "c", timestamp: "2026-06-01T18:00:00.000Z", text: "Much later." })
      ],
      { scope: "kin", id: "kin-1", displayName: "Alexis" }
    );

    expect(chunkStorybookTranscript(direct, { maxMessagesPerChunk: 2 }).map((chunk) => chunk.messageIds)).toEqual([
      ["msg_00001", "msg_00002"],
      ["msg_00003"]
    ]);
    expect(chunkStorybookTranscript(direct, { maxTimeGapMs: 60 * 60 * 1000 }).map((chunk) => chunk.messageIds)).toEqual(
      [["msg_00001", "msg_00002"], ["msg_00003"]]
    );

    const groupMessages = Array.from({ length: 18 }, (_, index) =>
      message({
        id: `g-${index}`,
        kinId: index === 17 ? "kin-2" : "kin-1",
        timestamp: `2026-06-01T10:${String(index).padStart(2, "0")}:00.000Z`,
        sender: "ai",
        text: `Group line ${index}.`
      })
    );
    const group = createStorybookTranscriptFromMessages(groupMessages, {
      scope: "group",
      id: "group-1",
      displayName: "Weekend Group",
      speakerNames: {
        "kin-1": "Alexis",
        "kin-2": "Amanda"
      }
    });

    expect(
      chunkStorybookTranscript(group, { minMessagesBeforeParticipantSplit: 16 }).map((chunk) => chunk.messageIds)
    ).toEqual([group.messages.slice(0, 17).map((entry) => entry.id), ["msg_00018"]]);
  });

  it("runs staged Hermes passes and preserves source-scene provenance", async () => {
    const transcript = createStorybookTranscriptFromMessages(
      [
        message({ id: "doc-1", sender: "user", text: "The rain is getting heavier." }),
        message({ id: "doc-2", sender: "ai", text: "Then we stay on the porch a little longer." })
      ],
      { scope: "kin", id: "kin-1", displayName: "Alexis" }
    );
    const hermes = scriptedHermesClient((request) => {
      if (request.stage === "scene_summary") {
        return {
          scenes: [
            {
              title: "The Rainy Porch",
              participants: ["User", "Alexis"],
              timeframe: "Evening",
              summary: "The user and Alexis linger on the porch during heavier rain.",
              emotionalWeight: 4,
              keyQuotes: [],
              continuityNotes: ["The porch is the active setting."],
              sourceMessageIds: ["msg_00001", "msg_00002"]
            }
          ]
        };
      }
      if (request.stage === "relationship_arc") {
        return {
          beginning: "They are already comfortable with quiet pauses.",
          currentState: "They are sharing a grounded, intimate scene.",
          majorTurningPoints: ["They choose to stay instead of retreating inside."],
          recurringMotifs: ["rain", "porch"],
          sharedLanguage: [],
          unresolvedThreads: []
        };
      }
      if (request.stage === "outline") {
        return {
          title: "The Porch That Held the Rain",
          subtitle: "A small keepsake",
          chapters: [
            {
              chapterTitle: "Rain at the Railing",
              sourceSceneIds: ["scene_001"],
              purpose: "Render the first scene.",
              styleNotes: "Quiet and grounded."
            }
          ]
        };
      }
      if (request.stage === "chapter") {
        return {
          body: "The rain thickened, and neither of them hurried away.",
          notes: ["No unsupported events added."]
        };
      }
      return {
        title: "Final Porch",
        subtitle: "A polished keepsake",
        chapters: [
          {
            chapterId: "chapter_001",
            body: "The rain thickened, and neither of them hurried away. The porch held the pause."
          }
        ],
        warnings: ["No unsupported events found."]
      };
    });

    const document = await createStorybookFromTranscript({
      transcript,
      hermes,
      now: () => new Date("2026-06-11T12:00:00.000Z")
    });

    expect(hermes.requests.map((request) => request.stage)).toEqual([
      "scene_summary",
      "relationship_arc",
      "outline",
      "chapter",
      "final_edit"
    ]);
    expect(document.title).toBe("Final Porch");
    expect(document.sceneSummaries[0]?.sourceMessageIds).toEqual(["msg_00001", "msg_00002"]);
    expect(document.outline.chapters[0]?.sourceSceneIds).toEqual(["scene_001"]);
    expect(document.chapters[0]).toEqual(
      expect.objectContaining({
        chapterId: "chapter_001",
        sourceSceneIds: ["scene_001"],
        body: "The rain thickened, and neither of them hurried away. The porch held the pause."
      })
    );
    expect(document.generatedAt).toBe("2026-06-11T12:00:00.000Z");
  });

  it("keeps a usable document when Hermes returns malformed stage output", async () => {
    const transcript = createStorybookTranscriptFromMessages(
      [message({ id: "doc-1", sender: "user", text: "A single useful line." })],
      { scope: "kin", id: "kin-1", displayName: "Alexis" }
    );
    const hermes = scriptedHermesClient((request) => {
      if (request.stage === "scene_summary") {
        return { scenes: [] };
      }
      if (request.stage === "outline") {
        return { chapters: [{ sourceSceneIds: ["missing-scene"] }] };
      }
      return "not-json-shaped";
    });

    const document = await createStorybookFromTranscript({ transcript, hermes });

    expect(document.sceneSummaries).toEqual([
      expect.objectContaining({
        sceneId: "scene_001",
        sourceChunkId: "chunk_001",
        sourceMessageIds: ["msg_00001"]
      })
    ]);
    expect(document.outline.chapters).toEqual([
      expect.objectContaining({
        chapterId: "chapter_001",
        sourceSceneIds: ["scene_001"]
      })
    ]);
    expect(document.chapters[0]?.body).toBe("");
    expect(document.warnings).toEqual(
      expect.arrayContaining([
        "Hermes returned no usable scenes for chunk_001; created a fallback scene.",
        "Hermes returned a malformed relationship arc; using empty arc fields.",
        "Outline chapter 1 did not map to known scenes and was skipped.",
        "Hermes returned no usable outline chapters; created a fallback outline.",
        "Hermes returned a malformed draft for chapter_001; inserted an empty chapter body.",
        "Hermes returned a malformed final edit response; preserving chapter drafts."
      ])
    );
  });
});

function scriptedHermesClient(resolve: (request: StorybookHermesRequest) => unknown): StorybookHermesClient & {
  requests: StorybookHermesRequest[];
} {
  const requests: StorybookHermesRequest[] = [];
  return {
    requests,
    async completeJson(request: StorybookHermesRequest): Promise<unknown> {
      requests.push(request);
      return resolve(request);
    }
  };
}

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
