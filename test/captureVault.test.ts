import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureHistoryVault, type CaptureVaultCipher } from "../src/desktop/captureVault.js";

const tempDirs: string[] = [];

describe("CaptureHistoryVault", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("locks and unlocks the capture Git repo without changing its contents", () => {
    const paths = testPaths();
    fs.mkdirSync(path.join(paths.captureDir, ".git", "objects"), { recursive: true });
    fs.mkdirSync(path.join(paths.captureDir, "workspace", "kins", "Alex--kin-1"), { recursive: true });
    fs.writeFileSync(path.join(paths.captureDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    fs.writeFileSync(path.join(paths.captureDir, "workspace", "kins", "Alex--kin-1", "profile.json"), "{}\n", "utf8");

    const vault = new CaptureHistoryVault({ ...paths, cipher: testCipher });
    const locked = vault.lock();

    expect(locked.changed).toBe(true);
    expect(fs.existsSync(paths.captureDir)).toBe(false);
    expect(fs.existsSync(path.join(paths.vaultDir, "repo.enc"))).toBe(true);
    expect(fs.readFileSync(path.join(paths.vaultDir, "repo.enc"), "utf8")).not.toContain("Alex--kin-1");

    const unlocked = vault.unlock();

    expect(unlocked.changed).toBe(true);
    expect(fs.readFileSync(path.join(paths.captureDir, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect(
      fs.readFileSync(path.join(paths.captureDir, "workspace", "kins", "Alex--kin-1", "profile.json"), "utf8")
    ).toBe("{}\n");
  });

  it("persists the lock-on-quit setting", () => {
    const paths = testPaths();
    const vault = new CaptureHistoryVault({ ...paths, cipher: testCipher });

    expect(vault.status().enabled).toBe(false);
    vault.setEnabled(true);

    expect(new CaptureHistoryVault({ ...paths, cipher: testCipher }).status().enabled).toBe(true);
  });

  it("refuses to lock while a capture staging workspace exists", () => {
    const paths = testPaths();
    fs.mkdirSync(path.join(paths.captureDir, ".workspace-next-123"), { recursive: true });
    const vault = new CaptureHistoryVault({ ...paths, cipher: testCipher });

    expect(() => vault.lock()).toThrow(/mid-capture/);
  });
});

const testCipher: CaptureVaultCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(Buffer.from(value, "utf8").toString("base64"), "utf8"),
  decryptString: (value) => Buffer.from(value.toString("utf8"), "base64").toString("utf8")
};

function testPaths(): { captureDir: string; vaultDir: string; settingsPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-capture-vault-"));
  tempDirs.push(dir);
  return {
    captureDir: path.join(dir, "data", "kin-source-control"),
    vaultDir: path.join(dir, "data", "kin-source-control.vault"),
    settingsPath: path.join(dir, "capture-vault-settings.json")
  };
}
