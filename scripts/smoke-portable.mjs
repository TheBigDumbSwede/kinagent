import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

const releaseDir = path.resolve(process.cwd(), "release");

if (!fs.existsSync(releaseDir)) {
  fail("release directory does not exist.");
}

const portableExe = fs
  .readdirSync(releaseDir)
  .filter((file) => /^Kinagent-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-portable\.exe$/i.test(file))
  .map((file) => {
    const fullPath = path.join(releaseDir, file);
    return {
      file,
      fullPath,
      size: fs.statSync(fullPath).size
    };
  })
  .sort((left, right) => right.size - left.size)[0];

if (!portableExe) {
  fail("portable Kinagent exe was not found in release/.");
}

if (portableExe.size < 50_000_000) {
  fail(`${portableExe.file} is unexpectedly small (${portableExe.size} bytes).`);
}

if (process.platform !== "win32") {
  process.stdout.write(
    `Portable smoke found ${portableExe.file} (${portableExe.size} bytes); launch skipped on ${process.platform}.\n`
  );
  process.exit(0);
}

const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-portable-smoke-"));
const logPath = path.join(smokeDir, "kinagent-portable-smoke.log");
const child = spawn(portableExe.fullPath, [], {
  cwd: smokeDir,
  env: {
    ...process.env,
    KINAGENT_DESKTOP_SMOKE: "1",
    BRIDGE_LOG_PATH: logPath
  },
  stdio: "ignore",
  windowsHide: true
});

const timeoutMs = 45_000;
let settled = false;
const timeout = setTimeout(() => {
  if (settled) {
    return;
  }

  settled = true;
  terminateProcessTree(child.pid);
  fail(`portable app did not complete launch smoke within ${timeoutMs}ms.${formatLogHint(logPath)}`);
}, timeoutMs);

child.on("error", (error) => {
  if (settled) {
    return;
  }

  settled = true;
  clearTimeout(timeout);
  fail(`portable app failed to launch: ${error.message}${formatLogHint(logPath)}`);
});

child.on("exit", (code) => {
  if (settled) {
    return;
  }

  settled = true;
  clearTimeout(timeout);
  if (code !== 0) {
    fail(`portable app exited with code ${code ?? "unknown"}.${formatLogHint(logPath)}`);
  }

  process.stdout.write(`Portable smoke passed: ${portableExe.file} (${portableExe.size} bytes).\n`);
});

function fail(message) {
  process.stderr.write(`Portable smoke failed: ${message}\n`);
  process.exit(1);
}

function terminateProcessTree(pid) {
  if (!pid) {
    return;
  }

  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true
  });
}

function formatLogHint(logPath) {
  if (!fs.existsSync(logPath)) {
    return " No smoke log was written.";
  }

  return ` Smoke log:\n${fs.readFileSync(logPath, "utf8")}`;
}
