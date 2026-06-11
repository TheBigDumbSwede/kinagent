import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

export interface CaptureVaultCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface CaptureVaultSettings {
  enabled: boolean;
}

interface CaptureVaultMetadata {
  version: 1;
  algorithm: "aes-256-gcm";
  encryptedKey: string;
  iv: string;
  authTag: string;
  lockedAt: string;
}

export interface CaptureVaultStatus {
  enabled: boolean;
  available: boolean;
  locked: boolean;
  unlocked: boolean;
  captureDir: string;
  vaultDir: string;
  archivePath: string;
  metadataPath: string;
  lastError?: string;
}

export interface CaptureVaultActionResult {
  ok: true;
  action: "enabled" | "disabled" | "locked" | "unlocked";
  changed: boolean;
  status: CaptureVaultStatus;
}

export class CaptureHistoryVault {
  private lastError: string | undefined;

  constructor(
    private readonly options: {
      captureDir: string;
      vaultDir: string;
      settingsPath: string;
      cipher: CaptureVaultCipher;
    }
  ) {}

  status(): CaptureVaultStatus {
    return {
      enabled: this.settings().enabled,
      available: this.cipher().isEncryptionAvailable(),
      locked: fs.existsSync(this.archivePath()) && !fs.existsSync(this.captureDir()),
      unlocked: fs.existsSync(this.captureDir()),
      captureDir: this.captureDir(),
      vaultDir: this.vaultDir(),
      archivePath: this.archivePath(),
      metadataPath: this.metadataPath(),
      lastError: this.lastError
    };
  }

  settings(): CaptureVaultSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.options.settingsPath, "utf8")) as Partial<CaptureVaultSettings>;
      return { enabled: Boolean(parsed.enabled) };
    } catch {
      return { enabled: false };
    }
  }

  setEnabled(enabled: boolean): CaptureVaultActionResult {
    this.writeSettings({ enabled });
    return {
      ok: true,
      action: enabled ? "enabled" : "disabled",
      changed: true,
      status: this.status()
    };
  }

  unlock(): CaptureVaultActionResult {
    const status = this.status();
    if (status.unlocked || !status.locked) {
      return {
        ok: true,
        action: "unlocked",
        changed: false,
        status
      };
    }

    if (!this.cipher().isEncryptionAvailable()) {
      throw new Error("Cannot unlock captured Kin history because OS secure storage is unavailable.");
    }

    const metadata = this.readMetadata();
    const archiveKey = Buffer.from(this.cipher().decryptString(Buffer.from(metadata.encryptedKey, "base64")), "base64");
    const encrypted = fs.readFileSync(this.archivePath());
    const decipher = crypto.createDecipheriv("aes-256-gcm", archiveKey, Buffer.from(metadata.iv, "base64"));
    decipher.setAuthTag(Buffer.from(metadata.authTag, "base64"));
    const zipBytes = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const targetDir = this.captureDir();
    const tempDir = `${targetDir}.unlock-${process.pid}-${Date.now()}`;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    try {
      extractZipSafely(zipBytes, tempDir);
      fs.renameSync(tempDir, targetDir);
    } catch (error) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }

    this.lastError = undefined;
    return {
      ok: true,
      action: "unlocked",
      changed: true,
      status: this.status()
    };
  }

  lock(): CaptureVaultActionResult {
    const status = this.status();
    if (!status.unlocked) {
      return {
        ok: true,
        action: "locked",
        changed: false,
        status
      };
    }

    if (!this.cipher().isEncryptionAvailable()) {
      throw new Error("Cannot lock captured Kin history because OS secure storage is unavailable.");
    }

    assertCaptureRepoIdle(this.captureDir());
    const archiveKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const zipBytes = zipDirectory(this.captureDir());
    const cipher = crypto.createCipheriv("aes-256-gcm", archiveKey, iv);
    const encrypted = Buffer.concat([cipher.update(zipBytes), cipher.final()]);
    const metadata: CaptureVaultMetadata = {
      version: 1,
      algorithm: "aes-256-gcm",
      encryptedKey: this.cipher().encryptString(archiveKey.toString("base64")).toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      lockedAt: new Date().toISOString()
    };

    fs.mkdirSync(this.vaultDir(), { recursive: true });
    atomicWrite(this.archivePath(), encrypted);
    atomicWrite(this.metadataPath(), `${JSON.stringify(metadata, null, 2)}\n`);
    removeDirectoryRecursive(this.captureDir());
    this.lastError = undefined;
    return {
      ok: true,
      action: "locked",
      changed: true,
      status: this.status()
    };
  }

  lockIfEnabled(): CaptureVaultActionResult | null {
    if (!this.settings().enabled) {
      return null;
    }

    try {
      return this.lock();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  unlockIfEnabled(): CaptureVaultActionResult | null {
    if (!this.settings().enabled) {
      return null;
    }

    try {
      this.recoverInvalidUnlockedResidue();
      return this.unlock();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  private readMetadata(): CaptureVaultMetadata {
    const parsed = JSON.parse(fs.readFileSync(this.metadataPath(), "utf8")) as CaptureVaultMetadata;
    if (parsed.version !== 1 || parsed.algorithm !== "aes-256-gcm") {
      throw new Error("Captured Kin history vault metadata is not supported.");
    }
    return parsed;
  }

  private writeSettings(settings: CaptureVaultSettings): void {
    fs.mkdirSync(path.dirname(this.options.settingsPath), { recursive: true });
    atomicWrite(this.options.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  }

  private captureDir(): string {
    return path.resolve(this.options.captureDir);
  }

  private vaultDir(): string {
    return path.resolve(this.options.vaultDir);
  }

  private archivePath(): string {
    return path.join(this.vaultDir(), "repo.enc");
  }

  private metadataPath(): string {
    return path.join(this.vaultDir(), "metadata.json");
  }

  private cipher(): CaptureVaultCipher {
    return this.options.cipher;
  }

  private recoverInvalidUnlockedResidue(): void {
    if (!fs.existsSync(this.archivePath()) || !fs.existsSync(this.captureDir())) {
      return;
    }

    if (isValidCaptureGitRepo(this.captureDir())) {
      return;
    }

    removeDirectoryRecursive(this.captureDir());
  }
}

export function captureVaultPaths(userDataDir: string): { captureDir: string; vaultDir: string; settingsPath: string } {
  const dataDir = path.join(userDataDir, "data");
  return {
    captureDir: path.join(dataDir, "kin-source-control"),
    vaultDir: path.join(dataDir, "kin-source-control.vault"),
    settingsPath: path.join(userDataDir, "capture-vault-settings.json")
  };
}

function zipDirectory(sourceDir: string): Buffer {
  const zip = new AdmZip();
  addDirectoryToZip(zip, sourceDir, "");
  return zip.toBuffer();
}

function assertCaptureRepoIdle(captureDir: string): void {
  const entries = fs.readdirSync(captureDir, { withFileTypes: true });
  if (fs.existsSync(path.join(captureDir, ".capture-active"))) {
    throw new Error("Captured Kin history capture is still running; it will be locked on a later clean quit.");
  }

  const transient = entries.find(
    (entry) =>
      entry.isDirectory() && (entry.name.startsWith(".workspace-next-") || entry.name.startsWith(".workspace-prev-"))
  );
  if (transient) {
    throw new Error("Captured Kin history is mid-capture; it will be locked on a later clean quit.");
  }

  if (fs.existsSync(path.join(captureDir, ".git", "index.lock"))) {
    throw new Error("Captured Kin history Git index is locked; it will be locked on a later clean quit.");
  }
}

function isValidCaptureGitRepo(captureDir: string): boolean {
  return fs.existsSync(path.join(captureDir, ".git", "HEAD"));
}

function addDirectoryToZip(zip: AdmZip, dir: string, relativeDir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    const zipPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      zip.addFile(`${zipPath}/`, Buffer.alloc(0));
      addDirectoryToZip(zip, entryPath, zipPath);
      continue;
    }

    if (entry.isFile()) {
      zip.addFile(zipPath, fs.readFileSync(entryPath));
    }
  }
}

function extractZipSafely(zipBytes: Buffer, targetDir: string): void {
  const zip = new AdmZip(zipBytes);
  const targetRoot = path.resolve(targetDir);
  for (const entry of zip.getEntries()) {
    const entryPath = path.resolve(targetRoot, entry.entryName);
    if (entryPath !== targetRoot && !entryPath.startsWith(`${targetRoot}${path.sep}`)) {
      throw new Error("Captured Kin history vault contains an unsafe path.");
    }

    if (entry.isDirectory) {
      fs.mkdirSync(entryPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, entry.getData());
  }
}

function removeDirectoryRecursive(dir: string): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  makeWritableRecursive(dir);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

function makeWritableRecursive(targetPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return;
  }

  try {
    fs.chmodSync(targetPath, stat.isDirectory() ? 0o777 : 0o666);
  } catch {
    // Best effort only; the following rm call will surface a real failure.
  }

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return;
  }

  for (const entry of fs.readdirSync(targetPath)) {
    makeWritableRecursive(path.join(targetPath, entry));
  }
}

function atomicWrite(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
}
