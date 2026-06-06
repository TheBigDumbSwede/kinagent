import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SoundscapeStateStore } from "../src/soundscape/soundscapeStateStore.js";
import { silentSoundscapeState } from "../src/soundscape/SoundscapeState.js";

describe("SoundscapeStateStore", () => {
  it("persists kin and group soundscape state separately", () => {
    const filePath = testStorePath();
    const store = new SoundscapeStateStore(filePath);

    store.update({
      scope: "kin",
      kinId: "kin-1",
      documentId: "kin-message",
      sourceTimestamp: "2026-06-01T12:00:00.000Z",
      state: silentSoundscapeState
    });
    store.update({
      scope: "group",
      groupId: "group-1",
      documentId: "group-message",
      sourceTimestamp: "2026-06-01T12:00:01.000Z",
      state: silentSoundscapeState
    });

    const reloaded = new SoundscapeStateStore(filePath);
    expect(reloaded.getForKin("kin-1")?.documentId).toBe("kin-message");
    expect(reloaded.getForGroup("group-1")?.documentId).toBe("group-message");
    expect(reloaded.list()).toHaveLength(2);
  });

  it("deletes a disabled source without touching other scopes", () => {
    const store = new SoundscapeStateStore(testStorePath());
    store.update({
      scope: "kin",
      kinId: "shared-id",
      documentId: "kin-message",
      state: silentSoundscapeState
    });
    store.update({
      scope: "group",
      groupId: "shared-id",
      documentId: "group-message",
      state: silentSoundscapeState
    });

    store.deleteForGroup("shared-id");

    expect(store.getForGroup("shared-id")).toBeNull();
    expect(store.getForKin("shared-id")?.documentId).toBe("kin-message");
  });
});

function testStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-soundscape-store-test-"));
  return path.join(dir, "soundscape-state.json");
}
