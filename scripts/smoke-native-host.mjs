import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const nativeHostExe = path.join(process.cwd(), "dist", "native-host", "win-x64", "kinagent-native-host.exe");

if (process.platform !== "win32") {
  process.stdout.write("Skipping native host smoke; Windows helper only runs on Windows.\n");
  process.exit(0);
}

if (!fs.existsSync(nativeHostExe)) {
  fail(`native host executable does not exist at ${nativeHostExe}`);
}

const child = spawn(nativeHostExe, [], {
  cwd: path.dirname(nativeHostExe),
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});

const stderrChunks = [];
const stdoutChunks = [];
let settled = false;

child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
child.stdout.on("data", (chunk) => {
  stdoutChunks.push(chunk);
  const response = tryReadNativeMessage(Buffer.concat(stdoutChunks));
  if (!response) {
    return;
  }

  if (settled) {
    return;
  }

  settled = true;
  child.kill();

  if (response.id !== "native-host-smoke" || response.type !== "status" || response.connected !== false) {
    fail(`unexpected native host response: ${JSON.stringify(response)}`);
  }

  process.stdout.write("Native host smoke passed: status response received over native messaging stdio.\n");
});

child.on("error", (error) => {
  if (settled) {
    return;
  }

  settled = true;
  fail(`native host failed to launch: ${error.message}`);
});

child.on("exit", (code) => {
  if (settled) {
    return;
  }

  settled = true;
  fail(`native host exited before responding with code ${code ?? "unknown"}.${formatStderr()}`);
});

setTimeout(() => {
  if (settled) {
    return;
  }

  settled = true;
  child.kill();
  fail(`native host did not respond within timeout.${formatStderr()}`);
}, 5000);

child.stdin.write(encodeNativeMessage({ id: "native-host-smoke", type: "status" }));

function encodeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function tryReadNativeMessage(buffer) {
  if (buffer.length < 4) {
    return null;
  }

  const length = buffer.readUInt32LE(0);
  if (buffer.length < 4 + length) {
    return null;
  }

  return JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
}

function formatStderr() {
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  return stderr ? ` Stderr:\n${stderr}` : "";
}

function fail(message) {
  process.stderr.write(`Native host smoke failed: ${message}\n`);
  process.exit(1);
}
