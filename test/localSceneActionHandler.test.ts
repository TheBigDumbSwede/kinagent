import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalSceneActionHandler } from "../src/hermes/localSceneActionHandler.js";
import { LocalSceneStateStore } from "../src/localScene/localSceneStore.js";
import type { Logger } from "../src/util/logger.js";

describe("LocalSceneActionHandler", () => {
  it("normalizes direct and group local scene actions", () => {
    const handler = testHandler();

    expect(
      handler.normalizeActions({
        actions: [
          {
            type: "update_local_scene_state",
            ai_id: "kin-1",
            location: "rainy kitchen",
            time_of_day: "late evening",
            suggested_ui_accent: "cool low-light",
            tension: 0.25
          },
          {
            type: "update_group_local_scene_state",
            group_id: "group-1",
            visualPalette: { light: "blue", contrast: 0.4 }
          }
        ]
      })
    ).toEqual([
      expect.objectContaining({
        type: "update_local_scene_state",
        ai_id: "kin-1",
        location: "rainy kitchen",
        timeOfDay: "late evening",
        suggestedUiAccent: "cool low-light",
        tension: 0.25
      }),
      expect.objectContaining({
        type: "update_group_local_scene_state",
        group_id: "group-1",
        visualPalette: { light: "blue", contrast: 0.4 }
      })
    ]);
  });

  it("stores direct local scene updates without calling Kindroid", async () => {
    const onLocalSceneUpdated = vi.fn();
    const handler = testHandler(onLocalSceneUpdated);

    await handler.handle(directNotification(), {
      type: "update_local_scene_state",
      ai_id: "kin-1",
      location: "rainy kitchen",
      mood: "quiet"
    });

    expect(onLocalSceneUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "kin",
        kinId: "kin-1",
        location: "rainy kitchen",
        mood: "quiet"
      })
    );
  });

  it("rejects mismatched local scene ids", async () => {
    const onLocalSceneUpdated = vi.fn();
    const handler = testHandler(onLocalSceneUpdated);

    await handler.handle(directNotification(), {
      type: "update_local_scene_state",
      ai_id: "kin-2",
      location: "elsewhere"
    });
    await handler.handle(groupNotification(), {
      type: "update_group_local_scene_state",
      group_id: "group-2",
      location: "elsewhere"
    });

    expect(onLocalSceneUpdated).not.toHaveBeenCalled();
  });
});

function testHandler(onLocalSceneUpdated = vi.fn()): LocalSceneActionHandler {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-local-scene-handler-"));
  return new LocalSceneActionHandler(
    testLogger,
    new LocalSceneStateStore(path.join(tempDir, "scene.json")),
    onLocalSceneUpdated
  );
}

function directNotification() {
  return {
    type: "kindroid.chat.changed" as const,
    kinId: "kin-1",
    documentId: "doc-1",
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "The room changed.",
    sender: "user",
    role: null,
    source: "firestore" as const
  };
}

function groupNotification() {
  return {
    type: "kindroid.group_chat.changed" as const,
    groupId: "group-1",
    aiId: "kin-2",
    documentId: "doc-1",
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "The room changed.",
    sender: "ai",
    role: "ai",
    source: "firestore" as const
  };
}

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
