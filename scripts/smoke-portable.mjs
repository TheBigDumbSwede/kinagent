import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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

process.stdout.write(`Portable smoke passed: ${portableExe.file} (${portableExe.size} bytes).\n`);

function fail(message) {
  process.stderr.write(`Portable smoke failed: ${message}\n`);
  process.exit(1);
}
