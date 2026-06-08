import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

runNpmScript("check");

const electronBuilderCli = path.join(process.cwd(), "node_modules", "electron-builder", "cli.js");
run(process.execPath, [electronBuilderCli, "--win", "portable", "nsis", "--publish", "never"], {
  NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, "--disable-warning=DEP0190")
});

runNpmScript("smoke:portable");

function runNpmScript(script) {
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm run ${script}`]);
    return;
  }

  run("npm", ["run", script]);
}

function run(command, args, env = {}) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
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

function appendNodeOption(current, option) {
  if (!current) {
    return option;
  }

  if (current.includes(option)) {
    return current;
  }

  return `${current} ${option}`;
}
