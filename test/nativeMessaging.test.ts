import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChromiumNativeMessagingManifest,
  buildFirefoxNativeMessagingManifest,
  nativeHostExecutablePath,
  nativeMessagingManifestPath,
  nativeMessagingRegistryKey,
  registerNativeMessagingHostCommand,
  unregisterNativeMessagingHostCommand,
  writeNativeMessagingManifestFiles
} from "../src/browserIntegration/nativeMessaging.js";

describe("native messaging integration helpers", () => {
  it("builds Chromium native messaging manifests with explicit extension origins", () => {
    const manifest = buildChromiumNativeMessagingManifest({
      hostPath: "C:\\Program Files\\Kinagent\\resources\\native-host\\kinagent-native-host.exe",
      extensionIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
    });

    expect(manifest).toEqual({
      name: "com.kinagent.bridge",
      description: "Kinagent browser bridge",
      path: "C:\\Program Files\\Kinagent\\resources\\native-host\\kinagent-native-host.exe",
      type: "stdio",
      allowed_origins: [
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
        "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/"
      ]
    });
  });

  it("builds Firefox native messaging manifests with explicit extension ids", () => {
    const manifest = buildFirefoxNativeMessagingManifest({
      hostPath: "C:\\Program Files\\Kinagent\\resources\\native-host\\kinagent-native-host.exe",
      extensionIds: ["kinagent@example.com"]
    });

    expect(manifest).toEqual({
      name: "com.kinagent.bridge",
      description: "Kinagent browser bridge",
      path: "C:\\Program Files\\Kinagent\\resources\\native-host\\kinagent-native-host.exe",
      type: "stdio",
      allowed_extensions: ["kinagent@example.com"]
    });
  });

  it("writes one manifest per browser target", async () => {
    const manifestDir = await fs.mkdtemp(path.join(os.tmpdir(), "kinagent-native-messaging-"));
    try {
      const files = await writeNativeMessagingManifestFiles({
        manifestDir,
        hostPath: "C:\\Kinagent\\resources\\native-host\\kinagent-native-host.exe",
        extensionIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        targets: ["chrome", "edge", "firefox"]
      });

      expect(files).toEqual([
        { target: "chrome", path: nativeMessagingManifestPath(manifestDir, "chrome") },
        { target: "edge", path: nativeMessagingManifestPath(manifestDir, "edge") },
        { target: "firefox", path: nativeMessagingManifestPath(manifestDir, "firefox") }
      ]);

      await expect(fs.readFile(files[0].path, "utf8")).resolves.toContain("chrome-extension://aaaaaaaa");
      await expect(fs.readFile(files[2].path, "utf8")).resolves.toContain('"allowed_extensions"');
    } finally {
      await fs.rm(manifestDir, { recursive: true, force: true });
    }
  });

  it("creates user-level registry commands for supported browsers", () => {
    expect(nativeMessagingRegistryKey("chrome")).toBe(
      "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.kinagent.bridge"
    );
    expect(nativeMessagingRegistryKey("edge")).toBe(
      "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.kinagent.bridge"
    );
    expect(nativeMessagingRegistryKey("firefox")).toBe(
      "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.kinagent.bridge"
    );

    expect(registerNativeMessagingHostCommand("chrome", "C:\\Kinagent\\manifest.json")).toEqual({
      command: "reg.exe",
      args: [
        "add",
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.kinagent.bridge",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        "C:\\Kinagent\\manifest.json",
        "/f"
      ]
    });
    expect(unregisterNativeMessagingHostCommand("edge")).toEqual({
      command: "reg.exe",
      args: ["delete", "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.kinagent.bridge", "/f"]
    });
  });

  it("resolves the installed helper from Electron resources", () => {
    expect(nativeHostExecutablePath("C:\\Program Files\\Kinagent\\resources")).toBe(
      "C:\\Program Files\\Kinagent\\resources\\native-host\\kinagent-native-host.exe"
    );
  });

  it("refuses manifests without extension ids", () => {
    expect(() => buildChromiumNativeMessagingManifest({ hostPath: "host.exe", extensionIds: [] })).toThrow(
      "At least one Chromium extension id is required."
    );
    expect(() => buildFirefoxNativeMessagingManifest({ hostPath: "host.exe", extensionIds: [] })).toThrow(
      "At least one Firefox extension id is required."
    );
  });
});
