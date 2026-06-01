import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/loadConfig.js";

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads defaults when the config file is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-config-"));
    const missingConfig = path.join(tempDir, "missing.yaml");

    const config = loadConfig({ configPath: missingConfig });

    expect(config.kindroid.firebaseProjectId).toBe("kindroid-ai");
    expect(config.bridge.sessionDir).toBe(path.resolve(process.cwd(), "./data/browser-session"));
    expect(config.hermes.enabled).toBe(false);
  });

  it("merges file config and environment overrides", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-config-"));
    const configPath = path.join(tempDir, "config.yaml");
    fs.writeFileSync(
      configPath,
      [
        "kindroid:",
        '  firebaseProjectId: "file-project"',
        '  uid: "file-uid"',
        "  kins:",
        '    - name: "Brielle"',
        '      aiId: "kin-1"',
        "      enabled: true",
        "bridge:",
        "  dedupeWindowSeconds: 30",
        '  logLevel: "warn"',
        '  sessionDir: "./session"',
        "hermes:",
        "  enabled: true",
        '  baseUrl: "http://example.test"',
        '  agentId: "agent-from-file"'
      ].join("\n")
    );

    vi.stubEnv("KINDROID_UID", "env-uid");
    vi.stubEnv("BRIDGE_LOG_LEVEL", "debug");
    vi.stubEnv("HERMES_ENABLED", "false");

    const config = loadConfig({ configPath });

    expect(config.kindroid.firebaseProjectId).toBe("file-project");
    expect(config.kindroid.uid).toBe("env-uid");
    expect(config.kindroid.kins).toEqual([{ name: "Brielle", aiId: "kin-1", enabled: true }]);
    expect(config.bridge.dedupeWindowSeconds).toBe(30);
    expect(config.bridge.logLevel).toBe("debug");
    expect(config.bridge.sessionDir).toBe(path.resolve(process.cwd(), "./session"));
    expect(config.hermes.enabled).toBe(false);
    expect(config.hermes.baseUrl).toBe("http://example.test");
  });

  it("rejects invalid numeric environment overrides", () => {
    vi.stubEnv("BRIDGE_DEDUPE_WINDOW_SECONDS", "not-a-number");

    expect(() => loadConfig({ configPath: path.join(os.tmpdir(), "missing-kinagent-config.yaml") })).toThrow(
      "BRIDGE_DEDUPE_WINDOW_SECONDS must be a number."
    );
  });
});
