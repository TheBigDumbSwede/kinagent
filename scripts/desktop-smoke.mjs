import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
ensureElectronInstalled();
const electronPath = require("electron");
const appEntry = path.resolve(process.cwd(), "dist", "desktop", "main.js");

const child = spawn(electronPath, [appEntry], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    KINAGENT_DESKTOP_SMOKE: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
let settled = false;
const timeout = setTimeout(() => {
  if (settled) {
    return;
  }

  settled = true;
  child.kill();
  process.stderr.write("Desktop smoke timed out before the app exited.\n");
  process.exit(1);
}, 15_000);

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

child.on("exit", (code) => {
  if (settled) {
    return;
  }

  settled = true;
  clearTimeout(timeout);

  if (code !== 0) {
    process.stderr.write(stderr || `Desktop smoke exited with code ${code}.\n`);
    process.exit(code ?? 1);
  }

  process.stdout.write("Desktop smoke passed.\n");
});

function ensureElectronInstalled() {
  const electronDir = path.resolve(process.cwd(), "node_modules", "electron");
  if (fs.existsSync(path.join(electronDir, "path.txt"))) {
    return;
  }

  const installScript = path.join(electronDir, "install.js");
  const result = spawnSync(process.execPath, [installScript], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
