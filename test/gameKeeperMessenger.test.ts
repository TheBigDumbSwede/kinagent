import { describe, expect, it } from "vitest";
import { keeperMessageCurrentScene } from "../src/game/keeperMessenger.js";

describe("keeperMessageCurrentScene", () => {
  it("converts Keeper narration into compact current-scene text", () => {
    expect(
      keeperMessageCurrentScene('*The radio crackles: "Do not touch the water."*\n\n*The puddle climbs the wall.*', 200)
    ).toBe('The radio crackles: "Do not touch the water." The puddle climbs the wall.');
  });

  it("trims the scene to the configured maximum length", () => {
    expect(keeperMessageCurrentScene("*The phone rings under the sink.*", 16)).toBe("The phone rings");
  });
});
