import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tracked = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8"
});

if (tracked.status !== 0) {
  process.stderr.write(tracked.stderr || "Unable to list repository files.\n");
  process.exit(tracked.status ?? 1);
}

const blockedPathPatterns = [
  /^data[\\/]/,
  /^dist[\\/]/,
  /^node_modules[\\/]/,
  /(^|[\\/])config\.yaml$/i,
  /\.har$/i,
  /\.ai$/i,
  /storage-state\.json$/i
];

const secretPatterns = [
  { name: "Firebase auth storage key", pattern: /firebase:authUser:/i },
  { name: "Refresh token field", pattern: /refreshToken["'\s:=]/i },
  { name: "Access token field", pattern: /accessToken["'\s:=]/i },
  { name: "ID token field", pattern: /idToken["'\s:=]/i },
  { name: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: "Kindroid encrypted message", pattern: /!enc:U2FsdGVkX1/i }
];

const allowlistedContentFiles = new Set([
  "README.md",
  "src/auth/firebaseSession.ts",
  "src/firestore/messageMapper.ts",
  "src/index.ts",
  "src/kindroid/kindroidClient.ts",
  "src/kindroid/kindroidCrypto.ts",
  "src/util/logger.ts",
  "test/kindroidCrypto.test.ts",
  "test/messageMapper.test.ts",
  "scripts/secret-scan.mjs"
]);

const findings = [];
const files = tracked.stdout.split(/\r?\n/).filter(Boolean);

for (const file of files) {
  const normalized = file.replaceAll("\\", "/");

  if (blockedPathPatterns.some((pattern) => pattern.test(normalized))) {
    findings.push(`${file}: blocked path should not be tracked`);
    continue;
  }

  const absolutePath = path.join(root, file);
  if (!fs.existsSync(absolutePath)) {
    continue;
  }

  if (allowlistedContentFiles.has(normalized) || isLikelyBinary(absolutePath)) {
    continue;
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  for (const secretPattern of secretPatterns) {
    if (secretPattern.pattern.test(content)) {
      findings.push(`${file}: ${secretPattern.name}`);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`Secret scan failed:\n${findings.map((finding) => `- ${finding}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Secret scan passed (${files.length} files checked).\n`);

function isLikelyBinary(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.includes(0);
}
