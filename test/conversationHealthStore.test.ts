import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConversationHealthStore } from "../src/conversationHealth/conversationHealthStore.js";
import {
  analyzeRepetitivePhrasing,
  type ConversationHealthMessage
} from "../src/conversationHealth/repetitionDiagnostic.js";

describe("conversation health repetition diagnostic", () => {
  it("detects obvious repeated phrase loops in recent Kin output", () => {
    const result = analyzeRepetitivePhrasing([
      healthMessage("m1", "She smiles softly before answering."),
      healthMessage("m2", "She smiles softly and reaches for the cup."),
      healthMessage("m3", "She smiles softly, then looks away.")
    ]);

    expect(result).toMatchObject({
      type: "repetitive_phrasing",
      fingerprint: "repetitive_phrasing:action_beat:smiles softly",
      evidence: [{ kind: "action_beat", phrase: "smiles softly", count: 3 }]
    });
  });

  it("does not flag normal repeated character names when phrasing changes", () => {
    const result = analyzeRepetitivePhrasing([
      healthMessage("m1", "Alexis opens the back door and checks the rain."),
      healthMessage("m2", "Alexis finds the umbrella beside the hall tree."),
      healthMessage("m3", "Alexis asks whether the porch light should stay on.")
    ]);

    expect(result).toBeNull();
  });

  it("dedupes repeated signals within the throttle window", () => {
    let now = new Date("2026-06-26T12:00:00.000Z");
    const store = new ConversationHealthStore(testStorePath(), { now: () => now });

    expect(store.recordMessage(healthMessage("m1", "She smiles softly before answering."))).toBeNull();
    expect(store.recordMessage(healthMessage("m2", "She smiles softly and reaches for the cup."))).toBeNull();
    const first = store.recordMessage(healthMessage("m3", "She smiles softly, then looks away."));
    expect(first).toMatchObject({ status: "active", type: "repetitive_phrasing" });

    now = new Date("2026-06-26T12:05:00.000Z");
    const deduped = store.recordMessage(healthMessage("m4", "She smiles softly at the thought."));

    expect(deduped).toBeNull();
    expect(store.list()).toHaveLength(1);
  });

  it("keeps muted signals from reappearing after the throttle window", () => {
    let now = new Date("2026-06-26T12:00:00.000Z");
    const store = new ConversationHealthStore(testStorePath(), { now: () => now });

    store.recordMessage(healthMessage("m1", "She smiles softly before answering."));
    store.recordMessage(healthMessage("m2", "She smiles softly and reaches for the cup."));
    const first = store.recordMessage(healthMessage("m3", "She smiles softly, then looks away."));
    expect(first).not.toBeNull();
    const muted = store.muteSignal(first?.id ?? "");
    expect(muted?.status).toBe("muted");

    now = new Date("2026-06-26T20:00:00.000Z");
    const suppressed = store.recordMessage(healthMessage("m4", "She smiles softly at the thought."));

    expect(suppressed).toBeNull();
    expect(store.list("muted")).toHaveLength(1);
    expect(store.list("active")).toHaveLength(0);
  });
});

function healthMessage(documentId: string, text: string): ConversationHealthMessage {
  return {
    scope: "kin",
    sourceId: "kin-1",
    sourceName: "Alexis",
    subjectKinId: "kin-1",
    subjectName: "Alexis",
    documentId,
    timestamp: `2026-06-26T12:00:${documentId.slice(1).padStart(2, "0")}.000Z`,
    text
  };
}

function testStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-conversation-health-test-"));
  return path.join(dir, "conversation-health-signals.json");
}
