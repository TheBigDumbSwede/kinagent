import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/util/logger.js";

const tempDirs: string[] = [];

describe("createLogger", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates profile logs when they exceed the configured size", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-logger-"));
    tempDirs.push(dir);
    const logPath = path.join(dir, "kinagent.log");
    fs.writeFileSync(logPath, "x".repeat(80), "utf8");

    const logger = createLogger("info", { logPath, maxBytes: 64, maxFiles: 2 });
    logger.info("after rotation");

    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.readFileSync(`${logPath}.1`, "utf8")).toBe("x".repeat(80));
    expect(fs.readFileSync(logPath, "utf8")).toContain("after rotation");
  });
});
