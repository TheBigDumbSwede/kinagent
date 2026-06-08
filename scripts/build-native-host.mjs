import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const projectPath = path.join(process.cwd(), "native-host", "Kinagent.NativeHost", "Kinagent.NativeHost.csproj");
const outputDir = path.join(process.cwd(), "dist", "native-host", "win-x64");
const outputExe = path.join(outputDir, "kinagent-native-host.exe");

if (process.platform !== "win32") {
  process.stdout.write("Skipping native host build; Windows helper is only built on Windows.\n");
  process.exit(0);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

run("dotnet", [
  "publish",
  projectPath,
  "--configuration",
  "Release",
  "--runtime",
  "win-x64",
  "--self-contained",
  "true",
  "-p:PublishSingleFile=true",
  "-p:PublishTrimmed=true",
  "-p:DebugType=none",
  "-p:DebugSymbols=false",
  "--output",
  outputDir
]);

if (!fs.existsSync(outputExe)) {
  fail(`native host executable was not produced at ${outputExe}`);
}

const size = fs.statSync(outputExe).size;
if (size < 1_000_000) {
  fail(`native host executable is unexpectedly small (${size} bytes).`);
}

process.stdout.write(`Native host built: ${outputExe} (${size} bytes).\n`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DOTNET_CLI_TELEMETRY_OPTOUT: "1"
    },
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  process.stderr.write(`Native host build failed: ${message}\n`);
  process.exit(1);
}
