import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
await ensureElectronInstalled();
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

async function ensureElectronInstalled() {
  const electronDir = path.resolve(process.cwd(), "node_modules", "electron");
  const electronPackage = JSON.parse(fs.readFileSync(path.join(electronDir, "package.json"), "utf8"));
  const platformPath = getPlatformPath();
  const pathFile = path.join(electronDir, "path.txt");
  const distPath = path.join(electronDir, "dist");
  const executablePath = path.join(distPath, platformPath);
  const versionPath = path.join(distPath, "version");

  if (
    fs.existsSync(pathFile) &&
    fs.existsSync(executablePath) &&
    fs.existsSync(versionPath) &&
    fs.readFileSync(versionPath, "utf8").replace(/^v/, "") === electronPackage.version
  ) {
    return;
  }

  process.stdout.write("Installing Electron binary for desktop smoke.\n");
  const { downloadArtifact } = require("@electron/get");
  const extract = require("extract-zip");
  const zipPath = await downloadArtifact({
    version: electronPackage.version,
    artifactName: "electron",
    force: process.env.force_no_cache === "true",
    cacheRoot: process.env.electron_config_cache,
    checksums:
      process.env.electron_use_remote_checksums || process.env.npm_config_electron_use_remote_checksums
        ? undefined
        : require(path.join(electronDir, "checksums.json")),
    platform: process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform,
    arch: process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch
  });

  await extract(zipPath, { dir: distPath });
  const typeDefinitionsPath = path.join(distPath, "electron.d.ts");
  if (fs.existsSync(typeDefinitionsPath)) {
    fs.renameSync(typeDefinitionsPath, path.join(electronDir, "electron.d.ts"));
  }
  fs.writeFileSync(pathFile, platformPath);
}

function getPlatformPath() {
  const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || os.platform();
  switch (platform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}
