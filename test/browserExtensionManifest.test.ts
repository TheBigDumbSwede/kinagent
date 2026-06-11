import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface BrowserExtensionManifest {
  manifest_version?: number;
  icons?: Record<string, string>;
  permissions?: string[];
  host_permissions?: string[];
  background?: {
    service_worker?: string;
  };
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
  }>;
  action?: {
    default_icon?: Record<string, string>;
    default_title?: string;
  };
}

const manifestPath = path.join(process.cwd(), "browser-extension", "manifest.json");
const backgroundPath = path.join(process.cwd(), "browser-extension", "background.js");
const contentPath = path.join(process.cwd(), "browser-extension", "content.js");

describe("browser extension manifest", () => {
  it("keeps the extension on the narrow native messaging and Kindroid-only surface", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BrowserExtensionManifest;

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions?.sort()).toEqual(["nativeMessaging"].sort());
    expect(manifest.host_permissions).toEqual(["https://kindroid.ai/*"]);
    expect(manifest.icons).toEqual({
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    });
    expect(manifest.action).toEqual({
      default_title: "Kinagent",
      default_icon: manifest.icons
    });
    expect(manifest.background?.service_worker).toBe("background.js");
    expect(manifest.content_scripts).toEqual([
      {
        matches: ["https://kindroid.ai/*"],
        js: ["content.js"],
        run_at: "document_idle"
      }
    ]);
  });

  it("declares packaged icon files that exist inside the extension", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BrowserExtensionManifest;
    const iconPaths = new Set(Object.values(manifest.icons ?? {}));

    expect(iconPaths.size).toBe(4);
    for (const iconPath of iconPaths) {
      const absolutePath = path.join(process.cwd(), "browser-extension", iconPath);
      expect(fs.existsSync(absolutePath), iconPath).toBe(true);
      expect(fs.statSync(absolutePath).size, iconPath).toBeGreaterThan(0);
    }
  });

  it("keeps deliberate reloads in the background script and treats notices as best-effort", () => {
    const background = fs.readFileSync(backgroundPath, "utf8");
    const content = fs.readFileSync(contentPath, "utf8");

    expect(background).toContain('type: "hello"');
    expect(background).toContain("BRIDGE_PROTOCOL_VERSION");
    expect(background).toContain("bridgeSessionId");
    expect(background).toContain('type: "command-ack"');
    expect(background).toContain("chrome.tabs.reload");
    expect(background).toContain(".catch(() => undefined)");
    expect(content).not.toContain("kinagent-reload-kindroid");
  });
});
