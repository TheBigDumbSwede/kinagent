import { describe, expect, it } from "vitest";
import {
  buildScreenContextChatRequest,
  normalizeScreenContextAnalysis
} from "../src/screenContext/screenContextAnalysis.js";

describe("normalizeScreenContextAnalysis", () => {
  it("accepts compact JSON screen analysis", () => {
    const result = normalizeScreenContextAnalysis(
      JSON.stringify({
        ambient_message: "A monitor hums quietly.",
        context: "The user is viewing a project dashboard with one failing task.",
        suggested_use: "Acknowledge the failing task if relevant.",
        tone: "neutral",
        sensitivity_flags: ["private_message"],
        summary: "Project dashboard",
        visible_text: "Build failed"
      })
    );

    expect(result).toEqual({
      ambientMessage: "A monitor hums quietly.",
      context: "The user is viewing a project dashboard with one failing task.",
      suggestedUse: "Acknowledge the failing task if relevant.",
      tone: "neutral",
      sensitivityFlags: ["private_message"],
      summary: "Project dashboard",
      visibleText: "Build failed"
    });
  });

  it("extracts JSON from wrapped model text", () => {
    const result = normalizeScreenContextAnalysis(
      '```json\n{"ambientMessage":"The screen glow shifts.","analysis":"A terminal is open.","sensitivityFlags":[]}\n```'
    );

    expect(result.ambientMessage).toBe("The screen glow shifts.");
    expect(result.context).toBe("A terminal is open.");
    expect(result.sensitivityFlags).toEqual([]);
  });

  it("rejects missing ambient message or context", () => {
    expect(() => normalizeScreenContextAnalysis('{"ambient_message":"Only visible."}')).toThrow(/context/i);
    expect(() => normalizeScreenContextAnalysis('{"context":"Only hidden."}')).toThrow(/ambient message/i);
  });

  it("rejects Hermes no-vision fallback analysis", () => {
    expect(() =>
      normalizeScreenContextAnalysis(
        JSON.stringify({
          ambient_message: "A pause settles around the screen.",
          context:
            "A desktop screenshot was provided for ambient screen context, but no reliable visual content or readable on-screen details are available from the captured data in this turn.",
          sensitivity_flags: []
        })
      )
    ).toThrow(/could not inspect/i);
  });

  it("caps long fields and sensitivity flag count", () => {
    const result = normalizeScreenContextAnalysis(
      JSON.stringify({
        ambient_message: "a".repeat(300),
        context: "b".repeat(7_000),
        sensitivity_flags: Array.from({ length: 20 }, (_, index) => `flag-${index}`)
      })
    );

    expect(result.ambientMessage).toHaveLength(240);
    expect(result.context).toHaveLength(6_000);
    expect(result.sensitivityFlags).toHaveLength(12);
  });

  it("builds an OpenAI-compatible multimodal chat request", () => {
    const request = buildScreenContextChatRequest("hermes-agent", {
      kinId: "kin-1",
      kinName: "Kairi",
      imageMimeType: "image/png",
      imageBase64: "abc123",
      detailLevel: "text-heavy",
      capture: {
        mode: "screen",
        displayId: "display-1",
        displayName: "Screen 1",
        width: 1600,
        height: 900,
        capturedAt: "2026-06-27T00:00:00.000Z"
      }
    });

    expect(request.messages[1]?.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining('"detail_level":"text-heavy"')
      },
      {
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,abc123",
          detail: "high"
        }
      }
    ]);
  });
});
