import { describe, expect, it } from "vitest";
import { canonLayerIds, normalizeCanonLayerId, normalizeCanonProvenance } from "../src/state/canonLayers.js";

describe("canon layers", () => {
  it("normalizes canonical layer ids and common aliases", () => {
    expect(normalizeCanonLayerId("hard_canon")).toBe("hard_canon");
    expect(normalizeCanonLayerId("Hard Canon")).toBe("hard_canon");
    expect(normalizeCanonLayerId("scene-canon")).toBe("scene_state");
    expect(normalizeCanonLayerId("diagnostics")).toBe("system_observation");
    expect(normalizeCanonLayerId("campaign state")).toBe("game_state");
  });

  it("rejects unknown or non-string layer ids", () => {
    expect(normalizeCanonLayerId("lore_bucket")).toBeNull();
    expect(normalizeCanonLayerId("")).toBeNull();
    expect(normalizeCanonLayerId(null)).toBeNull();
  });

  it("keeps the exported canonical layer set stable", () => {
    expect(canonLayerIds).toEqual([
      "hard_canon",
      "soft_canon",
      "scene_state",
      "user_preference",
      "system_observation",
      "game_state"
    ]);
  });

  it("normalizes provenance metadata while dropping invalid values", () => {
    expect(
      normalizeCanonProvenance({
        sourceType: "Hermes",
        sourceId: "  update_local_scene_state  ",
        sourceDocumentId: "  message-1  ",
        sourceTimestamp: "2026-06-01T12:00:00-05:00",
        observedAt: "not-a-date",
        actor: "  kinagent runtime  ",
        confidence: "high",
        evidence: [" clue one ", "", "clue one", "clue two"],
        reason: "  Material scene change.  ",
        lifecycleStatus: "source_invalidated"
      })
    ).toEqual({
      sourceType: "hermes_action",
      sourceId: "update_local_scene_state",
      sourceDocumentId: "message-1",
      sourceTimestamp: "2026-06-01T17:00:00.000Z",
      actor: "kinagent runtime",
      confidence: "high",
      evidence: ["clue one", "clue two"],
      reason: "Material scene change.",
      lifecycleStatus: "source_invalidated"
    });
  });

  it("preserves explicit null source timestamps for sources without timestamps", () => {
    expect(normalizeCanonProvenance({ sourceType: "manual", sourceTimestamp: null })).toEqual({
      sourceType: "manual",
      sourceTimestamp: null
    });
  });
});
