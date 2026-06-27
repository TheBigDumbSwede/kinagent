import { describe, expect, it } from "vitest";
import { buildReviewedAmbientContextTurn } from "../src/runtime/bridgeRuntime.js";

describe("reviewed ambient context turns", () => {
  it("falls back when the visible screen-context beat leaks hidden context", () => {
    const turn = buildReviewedAmbientContextTurn({
      ambientMessage: "The project dashboard shifts on the screen.",
      fallbackAmbientMessage: "A low tone sounds.",
      context: "The user is viewing a project dashboard with a failing task.",
      source: "screen_context"
    });

    expect(turn.visibleMessage).toBe("*A low tone sounds.*");
    expect(turn.internetResponse).toContain("The user is viewing a project dashboard with a failing task.");
  });
});
