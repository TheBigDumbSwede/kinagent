import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  browserIntegrationValidationErrors,
  loadBrowserIntegrationSettings,
  normalizeBrowserIntegrationSettings,
  parseRegistryDefaultValue,
  saveBrowserIntegrationSettings
} from "../src/browserIntegration/browserIntegrationRegistration.js";

describe("browser integration registration helpers", () => {
  it("normalizes selected targets and extension ids", () => {
    expect(
      normalizeBrowserIntegrationSettings({
        targets: ["chrome", "edge", "unsupported", "firefox"],
        chromiumExtensionIds: " aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  ",
        firefoxExtensionIds: ["kinagent@example.com", "kinagent@example.com", ""]
      })
    ).toEqual({
      targets: ["chrome", "edge", "firefox"],
      chromiumExtensionIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      firefoxExtensionIds: ["kinagent@example.com"]
    });
  });

  it("preserves an explicit empty browser selection", () => {
    expect(normalizeBrowserIntegrationSettings({ targets: [] }).targets).toEqual([]);
  });

  it("falls back to Chrome and Edge targets when saved settings omit browser targets", () => {
    expect(normalizeBrowserIntegrationSettings({}).targets).toEqual(["chrome", "edge"]);
  });

  it("validates Chromium extension ids when Chrome or Edge is selected", () => {
    expect(
      browserIntegrationValidationErrors({
        targets: ["chrome", "edge"],
        chromiumExtensionIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        firefoxExtensionIds: []
      })
    ).toEqual([]);

    expect(
      browserIntegrationValidationErrors({
        targets: ["chrome"],
        chromiumExtensionIds: ["not-a-real-extension-id", "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"],
        firefoxExtensionIds: []
      })
    ).toEqual([
      "Chrome/Edge extension IDs must be 32 lowercase characters using only letters a-p: not-a-real-extension-id, qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq."
    ]);
  });

  it("leaves Firefox extension ids permissive", () => {
    expect(
      browserIntegrationValidationErrors({
        targets: ["firefox"],
        chromiumExtensionIds: ["not-a-real-extension-id"],
        firefoxExtensionIds: ["kinagent@example.com", "{12345678-1234-1234-1234-123456789abc}"]
      })
    ).toEqual([]);
  });

  it("parses the default native messaging registry value", () => {
    expect(
      parseRegistryDefaultValue(`
HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.kinagent.bridge
    (Default)    REG_SZ    C:\\Users\\Me\\AppData\\Roaming\\Kinagent\\native-messaging\\com.kinagent.bridge.chrome.json
`)
    ).toBe("C:\\Users\\Me\\AppData\\Roaming\\Kinagent\\native-messaging\\com.kinagent.bridge.chrome.json");
  });

  it("returns null when the registry output has no default value", () => {
    expect(parseRegistryDefaultValue("ERROR: The system was unable to find the specified registry key or value.")).toBe(
      null
    );
  });

  it("persists browser integration settings atomically", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kinagent-browser-integration-"));
    const settingsPath = path.join(dir, "browser-integration.json");
    try {
      await expect(loadBrowserIntegrationSettings(settingsPath)).resolves.toEqual({
        targets: ["chrome", "edge"],
        chromiumExtensionIds: [],
        firefoxExtensionIds: []
      });

      await saveBrowserIntegrationSettings(settingsPath, {
        targets: ["firefox"],
        chromiumExtensionIds: [],
        firefoxExtensionIds: "kinagent@example.com"
      });

      await expect(loadBrowserIntegrationSettings(settingsPath)).resolves.toEqual({
        targets: ["firefox"],
        chromiumExtensionIds: [],
        firefoxExtensionIds: ["kinagent@example.com"]
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
