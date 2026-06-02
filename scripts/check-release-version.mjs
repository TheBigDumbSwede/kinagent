import fs from "node:fs";
import process from "node:process";

const suppliedTag = process.argv.length > 2 ? process.argv[2] : process.env.GITHUB_REF_NAME;
const tag = (suppliedTag || "").trim();

if (!tag) {
  process.stdout.write("No release tag supplied; skipping package version check.\n");
  process.exit(0);
}

if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
  fail(`Release tag must look like vX.Y.Z; received ${tag}.`);
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const expectedTag = `v${packageJson.version}`;

if (tag !== expectedTag) {
  fail(`Release tag ${tag} does not match package.json version ${packageJson.version}. Expected ${expectedTag}.`);
}

process.stdout.write(`Release tag ${tag} matches package.json version ${packageJson.version}.\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
