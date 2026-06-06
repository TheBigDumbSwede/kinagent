import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const rendererSource = path.join(projectRoot, "src", "desktop", "renderer");
const rendererTarget = path.join(projectRoot, "dist", "desktop", "renderer");
const assetsSource = path.join(projectRoot, "assets");
const assetsTarget = path.join(projectRoot, "dist", "desktop", "assets");

fs.rmSync(assetsTarget, { recursive: true, force: true });
fs.mkdirSync(rendererTarget, { recursive: true });
fs.mkdirSync(assetsTarget, { recursive: true });

const expectedRendererFiles = new Set();
for (const entry of fs.readdirSync(rendererSource, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }

  const extension = path.extname(entry.name);
  expectedRendererFiles.add(extension === ".ts" ? `${path.basename(entry.name, extension)}.js` : entry.name);
}

for (const entry of fs.readdirSync(rendererTarget, { withFileTypes: true })) {
  if (entry.isFile() && !expectedRendererFiles.has(entry.name)) {
    fs.rmSync(path.join(rendererTarget, entry.name), { force: true });
  }
}

for (const entry of fs.readdirSync(rendererSource, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }

  if (path.extname(entry.name) === ".ts") {
    continue;
  }

  fs.copyFileSync(path.join(rendererSource, entry.name), path.join(rendererTarget, entry.name));
}

copyDirectory(assetsSource, assetsTarget);

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
