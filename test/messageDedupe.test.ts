import { describe, expect, it, vi } from "vitest";
import type { DedupeStore, OutboundMessageRecord } from "../src/state/dedupeStore.js";
import { isRecentOutboundEcho } from "../src/firestore/messageDedupe.js";
import type { Logger } from "../src/util/logger.js";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

describe("isRecentOutboundEcho", () => {
  it("confirms and skips recent outbound user messages", async () => {
    const record = outboundRecord();
    const store = testStore({ matched: true, record });

    await expect(
      isRecentOutboundEcho({
        dedupeStore: store,
        logger,
        scope: "direct",
        message: {
          id: "message-1",
          kinId: "kin-1",
          text: "Hello there",
          sender: "user",
          role: null
        }
      })
    ).resolves.toBe(true);

    expect(store.matchRecentOutbound).toHaveBeenCalledWith({
      kinId: "kin-1",
      text: "Hello there"
    });
    expect(store.confirm).toHaveBeenCalledWith(record);
  });

  it("does not skip assistant-authored messages even when the text matches", async () => {
    const store = testStore({ matched: true, record: outboundRecord() });

    await expect(
      isRecentOutboundEcho({
        dedupeStore: store,
        logger,
        scope: "direct",
        message: {
          id: "message-1",
          kinId: "kin-1",
          text: "Hello there",
          sender: "ai",
          role: "assistant"
        }
      })
    ).resolves.toBe(false);

    expect(store.matchRecentOutbound).not.toHaveBeenCalled();
    expect(store.confirm).not.toHaveBeenCalled();
  });

  it("does not skip messages without a recent outbound match", async () => {
    const store = testStore({ matched: false });

    await expect(
      isRecentOutboundEcho({
        dedupeStore: store,
        logger,
        scope: "group",
        message: {
          id: "message-1",
          kinId: "kin-1",
          text: "Hello there",
          sender: "user",
          role: null
        }
      })
    ).resolves.toBe(false);

    expect(store.confirm).not.toHaveBeenCalled();
  });
});

function testStore(match: Awaited<ReturnType<DedupeStore["matchRecentOutbound"]>>): DedupeStore {
  return {
    recordOutbound: vi.fn(),
    matchRecentOutbound: vi.fn(async () => match),
    confirm: vi.fn()
  };
}

function outboundRecord(): OutboundMessageRecord {
  return {
    kinId: "kin-1",
    textHash: "hash",
    timestamp: Date.now(),
    requestId: "request-1",
    idempotencyKey: "idempotency-1"
  };
}
