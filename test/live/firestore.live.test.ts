import { describe, expect, it } from "vitest";
import { loadBrowserSession } from "../../src/auth/firebaseSession.js";
import { loadConfig } from "../../src/config/loadConfig.js";
import { FirestoreRestClient } from "../../src/firestore/firestoreRestClient.js";
import { mapKindroidMessage } from "../../src/firestore/messageMapper.js";
import { createLogger } from "../../src/util/logger.js";

const runLiveTests = process.env.KINAGENT_LIVE_TESTS === "1";
const liveDescribe = runLiveTests ? describe : describe.skip;

liveDescribe("live Firestore session", () => {
  it("can read and decrypt one recent configured Kin message without printing plaintext", async () => {
    const config = loadConfig();
    const kin = config.kindroid.kins.find((candidate) => candidate.enabled && candidate.aiId);

    expect(kin?.aiId, "config.yaml must contain an enabled Kin with aiId").toBeTruthy();

    const session = loadBrowserSession(config.bridge.sessionDir);
    const decryptionKey = config.kindroid.uid || session.firebaseAuth?.uid;
    expect(decryptionKey, "saved session must expose a Firebase UID").toBeTruthy();

    const client = new FirestoreRestClient(config, createLogger("error"));
    const documents = await client.listChatMessages({ kinId: kin!.aiId, limit: 1 });

    expect(documents.length).toBeGreaterThan(0);

    const message = mapKindroidMessage(documents[0]!, kin!.aiId, { decryptionKey });
    expect(message.id).toBeTruthy();
    expect(message.textEncrypted).toBe(true);
    expect(message.textDecrypted).toBe(true);
    expect(message.text?.startsWith("!enc:")).toBe(false);
  });
});
