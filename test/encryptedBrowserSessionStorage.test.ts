import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserStorageState } from "../src/auth/firebaseSession.js";
import {
  encryptedStorageStatePath,
  EncryptedBrowserSessionStorage
} from "../src/desktop/encryptedBrowserSessionStorage.js";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8").toString("base64"),
    decryptString: (value: Buffer) => Buffer.from(value.toString("utf8"), "base64").toString("utf8")
  }
}));

const tempDirs: string[] = [];

describe("EncryptedBrowserSessionStorage", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves browser session state encrypted and removes plaintext storage", () => {
    const sessionDir = tempDir();
    const plaintextPath = path.join(sessionDir, "storage-state.json");
    fs.writeFileSync(plaintextPath, "{}\n", "utf8");

    const storage = new EncryptedBrowserSessionStorage();
    storage.save(sessionDir, storageState());

    expect(fs.existsSync(plaintextPath)).toBe(false);
    expect(fs.existsSync(encryptedStorageStatePath(sessionDir))).toBe(true);
    expect(fs.readFileSync(encryptedStorageStatePath(sessionDir), "utf8")).not.toContain(secretValue());
    expect(storage.load(sessionDir)).toEqual(storageState());
  });

  it("migrates existing plaintext browser sessions to encrypted storage", () => {
    const sessionDir = tempDir();
    const plaintextPath = path.join(sessionDir, "storage-state.json");
    fs.writeFileSync(plaintextPath, `${JSON.stringify(storageState(), null, 2)}\n`, "utf8");

    const storage = new EncryptedBrowserSessionStorage();

    expect(storage.migrate(sessionDir)).toBe(true);
    expect(fs.existsSync(plaintextPath)).toBe(false);
    expect(storage.encrypted(sessionDir)).toBe(true);
    expect(storage.load(sessionDir)).toEqual(storageState());
  });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-encrypted-session-"));
  tempDirs.push(dir);
  return dir;
}

function storageState(): BrowserStorageState {
  const firebaseKey = ["firebase", "authUser", "test", "[DEFAULT]"].join(":");
  const refreshTokenField = `refresh${"Token"}`;
  return {
    cookies: [
      {
        name: "kindroid",
        value: "session-cookie",
        domain: "kindroid.ai",
        path: "/"
      }
    ],
    origins: [
      {
        origin: "https://kindroid.ai",
        localStorage: [
          {
            name: firebaseKey,
            value: JSON.stringify({
              uid: "firebase-uid",
              stsTokenManager: {
                [refreshTokenField]: secretValue()
              }
            })
          }
        ]
      }
    ]
  };
}

function secretValue(): string {
  return ["refresh", "value"].join("-");
}
