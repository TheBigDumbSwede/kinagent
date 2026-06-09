import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiGroupBackgroundImageProvider } from "../src/groupBackground/openAiImageProvider.js";
import type { GroupBackgroundSuggestion } from "../src/groupBackground/groupBackgroundSuggestionStore.js";

describe("OpenAiGroupBackgroundImageProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates a PNG buffer from OpenAI base64 image data", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiGroupBackgroundImageProvider({
      apiKey: "test-key",
      model: "gpt-image-1",
      size: "1536x1024",
      quality: "medium"
    });

    const result = await provider.generate(suggestion());

    expect(result.image.toString("utf8")).toBe("png-bytes");
    expect(result).toMatchObject({
      mimeType: "image/png",
      model: "gpt-image-1",
      size: "1536x1024"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json"
        })
      })
    );
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-image-1",
      n: 1,
      size: "1536x1024",
      quality: "medium"
    });
    expect(String(body.prompt)).toContain("Wide prairie antenna scene");
    expect(String(body.prompt)).toContain("Do not include text");
  });

  it("fails clearly when image generation is not configured", async () => {
    const provider = new OpenAiGroupBackgroundImageProvider({
      apiKey: "",
      model: "gpt-image-1",
      size: "1536x1024",
      quality: "medium"
    });

    await expect(provider.generate(suggestion())).rejects.toThrow("OpenAI image generation is not configured");
  });
});

function suggestion(): GroupBackgroundSuggestion {
  return {
    id: "suggestion-1",
    groupId: "group-1",
    aiId: "ai-1",
    title: "Antenna",
    prompt: "Wide prairie antenna scene",
    negativePrompt: "text, logos",
    targetCurrentScene: "By the antenna",
    sceneSummary: "The group approaches an antenna at dusk.",
    visualStyle: "cinematic prairie-gothic",
    reason: "The scene moved outdoors.",
    evidence: ["The group left the building."],
    significance: 0.86,
    sourceDocumentId: "message-1",
    sourceTimestamp: "2026-06-09T17:40:00.000Z",
    createdAt: "2026-06-09T17:40:00.000Z",
    updatedAt: "2026-06-09T17:40:00.000Z",
    status: "pending"
  };
}
