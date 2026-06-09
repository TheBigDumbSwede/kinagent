import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

runNpmScript("check");
runNpmScript("native-host:build");
runNpmScript("native-host:smoke");

const electronBuilderCli = path.join(process.cwd(), "node_modules", "electron-builder", "cli.js");

// Azure Trusted Signing is opt-in via KINAGENT_SIGN=1 so unsigned local/CI builds
// keep working without Azure credentials. The values below are non-secret identifiers;
// GitHub release signing authenticates with azure/login and OIDC before this runs.
const signingEnabled = process.env.KINAGENT_SIGN === "1";
const trustedSigningConfig = {
  publisherName: envOrDefault("KINAGENT_AZURE_PUBLISHER_NAME", "Bruce Mager"),
  endpoint: envOrDefault("KINAGENT_AZURE_TRUSTED_SIGNING_ENDPOINT", "https://eus.codesigning.azure.net/"),
  codeSigningAccountName: envOrDefault("KINAGENT_AZURE_SIGNING_ACCOUNT_NAME", "BigDumbSwede"),
  certificateProfileName: envOrDefault("KINAGENT_AZURE_CERTIFICATE_PROFILE_NAME", "BigDumbSwede")
};
const signingArgs = signingEnabled ? trustedSigningArgs(trustedSigningConfig) : [];

run(process.execPath, [electronBuilderCli, "--win", "portable", "nsis", ...signingArgs, "--publish", "never"], {
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

function envOrDefault(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function trustedSigningArgs(config) {
  for (const [key, value] of Object.entries(config)) {
    if (!value) {
      process.stderr.write(`Missing Azure Trusted Signing value for ${key}.\n`);
      process.exit(1);
    }
  }

  return Object.entries(config).map(([key, value]) => `-c.win.azureSignOptions.${key}=${value}`);
}
