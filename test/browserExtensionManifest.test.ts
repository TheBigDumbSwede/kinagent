import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface BrowserExtensionManifest {
  manifest_version?: number;
  permissions?: string[];
  host_permissions?: string[];
  background?: {
    service_worker?: string;
  };
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
  }>;
}

const manifestPath = path.join(process.cwd(), "browser-extension", "manifest.json");
const backgroundPath = path.join(process.cwd(), "browser-extension", "background.js");
const contentPath = path.join(process.cwd(), "browser-extension", "content.js");

describe("browser extension manifest", () => {
  it("keeps the extension on the narrow native messaging and Kindroid-only surface", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BrowserExtensionManifest;

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions?.sort()).toEqual(["nativeMessaging", "tabs"].sort());
    expect(manifest.host_permissions).toEqual(["https://kindroid.ai/*"]);
    expect(manifest.background?.service_worker).toBe("background.js");
    expect(manifest.content_scripts).toEqual([
      {
        matches: ["https://kindroid.ai/*"],
        js: ["content.js"],
        run_at: "document_idle"
      }
    ]);
  });

  it("keeps deliberate reloads in the background script and treats notices as best-effort", () => {
    const background = fs.readFileSync(backgroundPath, "utf8");
    const content = fs.readFileSync(contentPath, "utf8");

    expect(background).toContain("chrome.tabs.reload");
    expect(background).toContain(".catch(() => undefined)");
    expect(content).not.toContain("kinagent-reload-kindroid");
  });
});
