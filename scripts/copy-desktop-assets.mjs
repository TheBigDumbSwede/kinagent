import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const rendererSource = path.join(projectRoot, "src", "desktop", "renderer");
const rendererTarget = path.join(projectRoot, "dist", "desktop", "renderer");
const preloadSource = path.join(projectRoot, "src", "desktop", "preload.cjs");
const preloadTarget = path.join(projectRoot, "dist", "desktop", "preload.cjs");
const assetsSource = path.join(projectRoot, "assets");
const assetsTarget = path.join(projectRoot, "dist", "desktop", "assets");

fs.rmSync(rendererTarget, { recursive: true, force: true });
fs.rmSync(assetsTarget, { recursive: true, force: true });
fs.mkdirSync(rendererTarget, { recursive: true });
fs.mkdirSync(assetsTarget, { recursive: true });

for (const entry of fs.readdirSync(rendererSource, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }

  fs.copyFileSync(path.join(rendererSource, entry.name), path.join(rendererTarget, entry.name));
}

fs.copyFileSync(preloadSource, preloadTarget);

for (const entry of fs.readdirSync(assetsSource, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }

  fs.copyFileSync(path.join(assetsSource, entry.name), path.join(assetsTarget, entry.name));
}
