import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PrewarmCoordinatorBase } from "../src/runtime/prewarmCoordinatorBase.js";
import { PrewarmCoordinatorRegistry } from "../src/runtime/prewarmCoordinatorRegistry.js";
import { PrewarmStateStore } from "../src/runtime/prewarmStateStore.js";
import type { Logger } from "../src/util/logger.js";

describe("PrewarmCoordinatorRegistry", () => {
  it("resumes only the coordinator with a persisted cursor and dedupes repeat resume attempts", () => {
    const prewarmState = testPrewarmStateStore();
    prewarmState.markChatHistoryCursor("localScene", { scope: "kin", id: "kin-1" }, 1_780_000_001_000);
    const localScene = fakeCoordinator();
    const previouslyOn = fakeCoordinator();
    const registry = new PrewarmCoordinatorRegistry({
      logger: testLogger,
      prewarmState,
      resolveKin: (kinId) => ({
        documentId: kinId,
        aiId: kinId,
        name: "Alexis",
        current: false,
        chatDynamism: { raw: undefined, numeric: null, display: "(not set)" }
      }),
      resolveGroup: () => null
    });
    registry.register("localScene", localScene);
    registry.register("previouslyOn", previouslyOn);

    registry.resumePersisted();
    registry.resumePersisted();

    expect(localScene.resumeKinCatchup).toHaveBeenCalledTimes(1);
    expect(previouslyOn.resumeKinCatchup).not.toHaveBeenCalled();
  });

  it("dispatches live Kin activity through all registered coordinators", () => {
    const prewarmState = testPrewarmStateStore();
    const localScene = fakeCoordinator();
    const previouslyOn = fakeCoordinator();
    const registry = new PrewarmCoordinatorRegistry({
      logger: testLogger,
      prewarmState,
      resolveKin: () => null,
      resolveGroup: () => null
    });
    registry.register("localScene", localScene);
    registry.register("previouslyOn", previouslyOn);
    const kin = {
      documentId: "kin-1",
      aiId: "kin-1",
      name: "Alexis",
      current: false,
      chatDynamism: { raw: undefined, numeric: null, display: "(not set)" }
    };
    const trigger = { documentId: "message-1", timestamp: "2026-06-06T12:00:00.000Z" };

    registry.prewarmKinActivity(kin, trigger);

    expect(localScene.prewarmKin).toHaveBeenCalledWith(kin, "activity", { trigger });
    expect(previouslyOn.prewarmKin).toHaveBeenCalledWith(kin, "activity", { trigger });
  });

  it("forces only the requested coordinator kind", async () => {
    const prewarmState = testPrewarmStateStore();
    const localScene = fakeCoordinator();
    const soundscape = fakeCoordinator();
    const registry = new PrewarmCoordinatorRegistry({
      logger: testLogger,
      prewarmState,
      resolveKin: () => null,
      resolveGroup: () => null
    });
    registry.register("localScene", localScene);
    registry.register("soundscape", soundscape);
    const kin = {
      documentId: "kin-1",
      aiId: "kin-1",
      name: "Alexis",
      current: false,
      chatDynamism: { raw: undefined, numeric: null, display: "(not set)" }
    };

    await registry.forceKin("soundscape", kin);

    expect(soundscape.prewarmKin).toHaveBeenCalledWith(kin, "manual-force", { force: true });
    expect(localScene.prewarmKin).not.toHaveBeenCalled();
  });
});

function fakeCoordinator(): PrewarmCoordinatorBase {
  return {
    prewarmKin: vi.fn(),
    prewarmGroup: vi.fn(),
    resumeKinCatchup: vi.fn(),
    resumeGroupCatchup: vi.fn()
  } as unknown as PrewarmCoordinatorBase;
}

function testPrewarmStateStore(): PrewarmStateStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-prewarm-catchup-registry-test-"));
  return new PrewarmStateStore(path.join(dir, "prewarm-state.json"));
}

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
