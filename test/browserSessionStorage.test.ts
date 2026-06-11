import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentBrowserSessionStorage } from "../src/auth/browserSessionStorage.js";

const tempDirs: string[] = [];

describe("plaintext browser session storage", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports desktop-encrypted sessions clearly to CLI callers", () => {
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-session-storage-"));
    tempDirs.push(sessionDir);
    fs.writeFileSync(path.join(sessionDir, "storage-state.json.enc"), "encrypted", "utf8");

    expect(() => currentBrowserSessionStorage().load(sessionDir)).toThrow(
      /desktop-encrypted session exists.*headless CLI commands cannot decrypt/s
    );
  });
});
