import { describe, expect, it } from "vitest";
import {
  buildAmbientContextTurn,
  buildAmbientHermesContextTurn,
  buildAmbientHermesMessageGuidance,
  defaultAmbientContextInstruction
} from "../src/kindroid/ambientContext.js";

describe("ambient context turns", () => {
  it("builds a neutral ambient turn with hidden context", () => {
    const turn = buildAmbientContextTurn({
      context: "The north service door is now unlocked."
    });

    expect(turn.tone).toBe("neutral");
    expect(turn.visibleMessage).toMatch(/^\*.+\*$/);
    expect(turn.visibleMessage).not.toContain("north service door");
    expect(turn.internetResponse).toContain("Hermes context packet:");
    expect(turn.internetResponse).toContain("Source: unknown");
    expect(turn.internetResponse).toContain("Confidence: unspecified");
    expect(turn.internetResponse).toContain("The north service door is now unlocked.");
    expect(turn.internetResponse).toContain(defaultAmbientContextInstruction);
  });

  it("honors a supplied visible message override", () => {
    const turn = buildAmbientContextTurn({
      tone: "noir",
      visibleMessage: "*The old radio coughs static, then falls silent.*",
      context: "A new route is available through the maintenance corridor."
    });

    expect(turn.tone).toBe("noir");
    expect(turn.visibleMessage).toBe("*The old radio coughs static, then falls silent.*");
    expect(turn.internetResponse).toContain("A new route is available through the maintenance corridor.");
  });

  it("wraps supplied visible messages in narration delimiters", () => {
    const turn = buildAmbientHermesContextTurn({
      ambientMessage: "The console gives a soft two-note chime.",
      hermesResult: "The north service door is now unlocked."
    });

    expect(turn.visibleMessage).toBe("*The console gives a soft two-note chime.*");
  });

  it("selects a tone-specific visible message", () => {
    const turn = buildAmbientContextTurn({
      tone: "storm",
      context: "The backup generator is still offline."
    });

    expect(turn.tone).toBe("storm");
    expect([
      "*Thunder rolls across the roofline, slow and heavy.*",
      "*The lights flicker once, then steady again.*",
      "*Rain taps harder against the glass, turning the room silver.*"
    ]).toContain(turn.visibleMessage);
    expect(turn.visibleMessage).not.toContain("backup generator");
  });

  it("allows an instruction override", () => {
    const turn = buildAmbientContextTurn({
      context: "The hallway camera is looping old footage.",
      instruction: "Use only if directly relevant."
    });

    expect(turn.internetResponse).toContain("Instruction:\nUse only if directly relevant.");
    expect(turn.internetResponse).not.toContain(defaultAmbientContextInstruction);
  });

  it("builds an ambient Hermes context packet with source and confidence", () => {
    const turn = buildAmbientHermesContextTurn({
      tone: "sci-fi",
      ambientMessage: "*The console gives a soft two-note chime.*",
      source: "tool:door-control",
      confidence: "high",
      hermesResult: "The north service door is now unlocked.",
      suggestedUse: "Let the Kin incorporate this as immediate situational awareness."
    });

    expect(turn.tone).toBe("sci-fi");
    expect(turn.visibleMessage).toBe("*The console gives a soft two-note chime.*");
    expect(turn.internetResponse).toContain("Source: tool:door-control");
    expect(turn.internetResponse).toContain("Confidence: high");
    expect(turn.internetResponse).toContain("The north service door is now unlocked.");
    expect(turn.internetResponse).toContain(
      "Suggested use: Let the Kin incorporate this as immediate situational awareness."
    );
  });

  it("rejects empty hidden context", () => {
    expect(() => buildAmbientContextTurn({ context: "   " })).toThrow("Ambient context cannot be empty.");
  });

  it("requires Hermes-originated turns to provide an ambient message", () => {
    expect(() =>
      buildAmbientHermesContextTurn({
        ambientMessage: "   ",
        hermesResult: "The north service door is now unlocked."
      })
    ).toThrow("Ambient message cannot be empty.");
  });

  it("rejects visible ambient messages that expose hidden context terms", () => {
    expect(() =>
      buildAmbientContextTurn({
        ambientMessage: "*The north service door clicks unlocked.*",
        context: "The north service door is now unlocked."
      })
    ).toThrow("Ambient message appears to include hidden context.");
  });

  it("rejects visible ambient messages that mention the transport mechanism", () => {
    expect(() =>
      buildAmbientContextTurn({
        ambientMessage: "*Hermes updates the hidden context.*",
        context: "The hallway camera is looping old footage."
      })
    ).toThrow("Ambient message cannot mention hermes.");
  });

  it("rejects multi-line ambient messages", () => {
    expect(() =>
      buildAmbientContextTurn({
        ambientMessage: "*The light flickers.*\n*The room goes still.*",
        context: "The hallway camera is looping old footage."
      })
    ).toThrow("Ambient message must be one line.");
  });

  it("builds Hermes guidance with current setting and conversation context", () => {
    const guidance = buildAmbientHermesMessageGuidance({
      currentSetting: "A quiet apartment during a storm.",
      conversationContext: "The user and Kin are speaking softly after a tense exchange."
    });

    expect(guidance).toContain("Generate one small diegetic ambient beat");
    expect(guidance).toContain("Keep it concise, usually one short sentence or atmospheric fragment.");
    expect(guidance).toContain("Make it fit the current conversation and the saved current setting when available.");
    expect(guidance).toContain("It should create a natural turn boundary, not take over the scene.");
    expect(guidance).toContain("Current setting:\nA quiet apartment during a storm.");
    expect(guidance).toContain(
      "Current conversation context:\nThe user and Kin are speaking softly after a tense exchange."
    );
  });
});
