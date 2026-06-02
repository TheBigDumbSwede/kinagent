import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts/check-release-version.mjs");

describe("check-release-version", () => {
  it("skips validation for an explicitly blank workflow-dispatch tag", () => {
    const result = runCheckReleaseVersion([""], { GITHUB_REF_NAME: "main" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No release tag supplied");
  });

  it("accepts a tag that matches package.json", () => {
    const result = runCheckReleaseVersion(["v0.1.1"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("matches package.json version 0.1.1");
  });

  it("rejects a branch name when it is validated as the release tag", () => {
    const result = runCheckReleaseVersion(["main"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Release tag must look like vX.Y.Z");
  });
});

function runCheckReleaseVersion(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8"
  });
}
