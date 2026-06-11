import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import {
  migrateConfigSecretsToSecureStore,
  SecureSecretStore,
  type SecureSecretCipher
} from "../src/desktop/secureSecrets.js";

const tempDirs: string[] = [];

describe("SecureSecretStore", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not delete stored secrets when a previously scrubbed config starts up", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-secure-secrets-"));
    tempDirs.push(dir);
    const configPath = path.join(dir, "config.yaml");
    const store = new SecureSecretStore(path.join(dir, "secure-secrets.json"), testCipher);

    const migrated = migrateConfigSecretsToSecureStore(
      {
        ...testConfig(),
        kindroid: { ...testConfig().kindroid, apiKey: "kindroid-test-key" },
        hermes: { ...testConfig().hermes, apiKey: "hermes-test-key" }
      },
      configPath,
      store
    );
    expect(migrated.kindroid.apiKey).toBe("kindroid-test-key");
    expect(migrated.hermes.apiKey).toBe("hermes-test-key");
    expect(fs.readFileSync(configPath, "utf8")).not.toContain("kindroid-test-key");

    const restarted = migrateConfigSecretsToSecureStore(testConfig(), configPath, store);
    expect(restarted.kindroid.apiKey).toBe("kindroid-test-key");
    expect(restarted.hermes.apiKey).toBe("hermes-test-key");
  });
});

const testCipher: SecureSecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`wrapped:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^wrapped:/, "")
};

function testConfig(): AppConfig {
  return {
    kindroid: {
      apiKey: "",
      firebaseProjectId: "kindroid-ai",
      uid: "",
      kins: []
    },
    bridge: {
      dedupeWindowSeconds: 180,
      logPath: "./data/kinagent.log",
      logLevel: "info",
      sessionDir: "./data/browser-session",
      sqlitePath: "./data/bridge.sqlite"
    },
    hermes: {
      enabled: false,
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "",
      agentId: "kindroid-bridge",
      currentSceneUpdates: {
        enabled: true,
        maxLength: 160
      },
      journalSuggestions: {
        enabled: true,
        throttleMessages: 20,
        strongEventBypass: true
      },
      groupBackgrounds: {
        suggestions: {
          enabled: false,
          autonomous: false,
          minMessagesBetweenProposals: 12,
          minSignificance: 0.7
        },
        images: {
          enabled: true,
          provider: "openai",
          openai: {
            apiKey: "",
            model: "gpt-image-1",
            size: "1536x1024",
            quality: "medium"
          }
        }
      },
      chatDynamism: {
        suggestions: {
          enabled: true
        },
        autoAdjust: {
          enabled: false,
          minTurnsBetweenAdjustments: 12,
          min: 0.8,
          max: 1.4,
          maxDelta: 0.2
        }
      }
    },
    voice: {
      enabled: false,
      provider: "none",
      openai: {
        apiKey: "",
        model: "gpt-4o-mini-tts",
        voice: "marin",
        instructions: ""
      },
      elevenlabs: {
        apiKey: "",
        model: "eleven_flash_v2_5",
        outputFormat: "mp3_44100_128"
      }
    }
  };
}
