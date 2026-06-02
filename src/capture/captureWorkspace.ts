import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(stableValue(value), null, 2)}\n`, "utf8");
}

export function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

export async function ensureGitRepository(outputDir: string): Promise<void> {
  if (!fs.existsSync(path.join(outputDir, ".git"))) {
    await execFileAsync("git", ["init"], { cwd: outputDir });
    await execFileAsync("git", ["config", "user.name", "Kinagent Capture"], { cwd: outputDir });
    await execFileAsync("git", ["config", "user.email", "kinagent-capture@local"], { cwd: outputDir });
  }

  ensureCaptureGitExcludes(outputDir);
}

export function recoverInterruptedWorkspace(outputDir: string, workspaceDir: string): void {
  if (fs.existsSync(workspaceDir)) {
    return;
  }

  const backups = transientWorkspaceDirs(outputDir, ".workspace-prev-");
  const latestBackup = backups.at(-1);
  if (latestBackup) {
    fs.renameSync(latestBackup, workspaceDir);
  }
}

export function cleanupTransientWorkspaces(outputDir: string): void {
  for (const dir of transientWorkspaceDirs(outputDir, ".workspace-next-")) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const dir of transientWorkspaceDirs(outputDir, ".workspace-prev-")) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function resetStagingDirectory(dir: string, outputDir: string): void {
  const resolved = path.resolve(dir);
  const resolvedOutputDir = path.resolve(outputDir);
  if (
    !path.basename(resolved).startsWith(".workspace-next-") ||
    !resolved.startsWith(`${resolvedOutputDir}${path.sep}`)
  ) {
    throw new Error(`Refusing to reset unexpected capture staging directory: ${resolved}`);
  }

  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

export function promoteWorkspace(stagingDir: string, workspaceDir: string, outputDir: string): void {
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedStagingDir = path.resolve(stagingDir);
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const backupDir = path.join(outputDir, `.workspace-prev-${process.pid}-${Date.now()}`);

  if (
    !path.basename(resolvedStagingDir).startsWith(".workspace-next-") ||
    !resolvedStagingDir.startsWith(`${resolvedOutputDir}${path.sep}`) ||
    path.basename(resolvedWorkspaceDir) !== "workspace" ||
    !resolvedWorkspaceDir.startsWith(`${resolvedOutputDir}${path.sep}`)
  ) {
    throw new Error("Refusing to promote unexpected capture workspace paths.");
  }

  let backupCreated = false;
  try {
    if (fs.existsSync(resolvedWorkspaceDir)) {
      fs.renameSync(resolvedWorkspaceDir, backupDir);
      backupCreated = true;
    }

    fs.renameSync(resolvedStagingDir, resolvedWorkspaceDir);
    if (backupCreated) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (backupCreated && !fs.existsSync(resolvedWorkspaceDir) && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, resolvedWorkspaceDir);
    }

    throw error;
  }
}

export async function stageCapture(outputDir: string): Promise<void> {
  await execFileAsync("git", ["add", "--", "workspace"], { cwd: outputDir });
}

export async function commitCapture(
  outputDir: string,
  message: string
): Promise<{ commitHash?: string; createdCommit: boolean }> {
  const status = await execFileAsync("git", ["status", "--porcelain", "--", "workspace"], { cwd: outputDir });
  if (!status.stdout.trim()) {
    return { commitHash: await currentCommit(outputDir), createdCommit: false };
  }

  await execFileAsync("git", ["commit", "-m", message], { cwd: outputDir });
  return { commitHash: await currentCommit(outputDir), createdCommit: true };
}

async function currentCommit(outputDir: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: outputDir });
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}

function transientWorkspaceDirs(outputDir: string, prefix: string): string[] {
  return fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(outputDir, entry.name))
    .sort();
}

function ensureCaptureGitExcludes(outputDir: string): void {
  const excludePath = path.join(outputDir, ".git", "info", "exclude");
  const excludeLines = [".workspace-next-*", ".workspace-prev-*"];
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  const missing = excludeLines.filter((line) => !existing.split(/\r?\n/).includes(line));
  if (missing.length > 0) {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.appendFileSync(
      excludePath,
      `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${missing.join("\n")}\n`
    );
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  );
}
