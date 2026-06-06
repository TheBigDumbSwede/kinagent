import { describe, expect, it } from "vitest";
import {
  shouldDeactivateActiveSoundscape,
  soundscapeKeyFromPayload
} from "../src/desktop/renderer/SoundscapeActivation.js";

describe("soundscape activation", () => {
  it("derives active soundscape keys from monitor payloads", () => {
    expect(soundscapeKeyFromPayload({ kinId: "kin-1" })).toBe("kin:kin-1");
    expect(soundscapeKeyFromPayload({ groupId: "group-1" })).toBe("group:group-1");
    expect(soundscapeKeyFromPayload({ kinId: "" })).toBeNull();
    expect(soundscapeKeyFromPayload(undefined)).toBeNull();
  });

  it("deactivates only the matching direct Kin soundscape", () => {
    expect(shouldDeactivateActiveSoundscape("kin:kin-1", { kinId: "kin-1" })).toBe(true);
    expect(shouldDeactivateActiveSoundscape("kin:kin-1", { kinId: "kin-2" })).toBe(false);
    expect(shouldDeactivateActiveSoundscape("group:group-1", { kinId: "kin-1" })).toBe(false);
  });

  it("deactivates only the matching group soundscape", () => {
    expect(shouldDeactivateActiveSoundscape("group:group-1", { groupId: "group-1" })).toBe(true);
    expect(shouldDeactivateActiveSoundscape("group:group-1", { groupId: "group-2" })).toBe(false);
    expect(shouldDeactivateActiveSoundscape("kin:kin-1", { groupId: "group-1" })).toBe(false);
  });
});
