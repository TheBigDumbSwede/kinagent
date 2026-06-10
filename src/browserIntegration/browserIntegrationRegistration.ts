import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  NATIVE_MESSAGING_HOST_NAME,
  nativeMessagingManifestPath,
  nativeMessagingRegistryKey,
  registerNativeMessagingHostCommand,
  unregisterNativeMessagingHostCommand,
  writeNativeMessagingManifestFile,
  type NativeMessagingTarget
} from "./nativeMessaging.js";

const execFileAsync = promisify(execFile);

export interface BrowserIntegrationSettings {
  targets: NativeMessagingTarget[];
  chromiumExtensionIds: string[];
  firefoxExtensionIds: string[];
}

export interface BrowserIntegrationTargetStatus {
  target: NativeMessagingTarget;
  selected: boolean;
  configured: boolean;
  manifestPath: string;
  manifestExists: boolean;
  registryKey: string;
  registryValue: string | null;
  registered: boolean;
  error?: string;
}

export interface BrowserIntegrationStatus {
  ok: boolean;
  platform: NodeJS.Platform;
  hostName: string;
  hostPath: string;
  hostExists: boolean;
  manifestDir: string;
  settings: BrowserIntegrationSettings;
  validationErrors: string[];
  targets: BrowserIntegrationTargetStatus[];
}

export interface BrowserIntegrationRegistrationPaths {
  settingsPath: string;
  manifestDir: string;
  hostPath: string;
}

export const KINAGENT_CHROMIUM_EXTENSION_ID = "cggbaonfbomoejmmmomapjmejacmbpon";

const allTargets: NativeMessagingTarget[] = ["chrome", "edge", "firefox"];
const defaultSettings: BrowserIntegrationSettings = {
  targets: ["chrome", "edge"],
  chromiumExtensionIds: [KINAGENT_CHROMIUM_EXTENSION_ID],
  firefoxExtensionIds: []
};
const chromiumExtensionIdPattern = /^[a-p]{32}$/;

export async function loadBrowserIntegrationSettings(settingsPath: string): Promise<BrowserIntegrationSettings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    return normalizeBrowserIntegrationSettings(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return cloneDefaultSettings();
    }

    throw error;
  }
}

export async function saveBrowserIntegrationSettings(
  settingsPath: string,
  input: unknown
): Promise<BrowserIntegrationSettings> {
  const settings = normalizeBrowserIntegrationSettings(input);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(`${settingsPath}.tmp`, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await fs.rename(`${settingsPath}.tmp`, settingsPath);
  return settings;
}

export async function readBrowserIntegrationStatus(
  paths: BrowserIntegrationRegistrationPaths
): Promise<BrowserIntegrationStatus> {
  const settings = await loadBrowserIntegrationSettings(paths.settingsPath);
  return browserIntegrationStatus(paths, settings);
}

export async function registerBrowserIntegration(
  paths: BrowserIntegrationRegistrationPaths,
  input: unknown
): Promise<BrowserIntegrationStatus> {
  if (process.platform !== "win32") {
    throw new Error("Browser native messaging registration is only supported on Windows.");
  }

  const settings = await saveBrowserIntegrationSettings(paths.settingsPath, input);
  if (!(await fileExists(paths.hostPath))) {
    throw new Error(`Native messaging host executable was not found at ${paths.hostPath}.`);
  }
  if (settings.targets.length === 0) {
    throw new Error("Select at least one browser before registering native messaging.");
  }
  const validationErrors = browserIntegrationValidationErrors(settings);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join(" "));
  }

  for (const target of settings.targets) {
    const extensionIds = extensionIdsForTarget(settings, target);
    if (extensionIds.length === 0) {
      throw new Error(`${targetLabel(target)} registration requires at least one extension ID.`);
    }

    const manifest = await writeNativeMessagingManifestFile({
      manifestDir: paths.manifestDir,
      hostPath: paths.hostPath,
      extensionIds,
      target
    });
    await runRegistryCommand(registerNativeMessagingHostCommand(target, manifest.path));
  }

  return browserIntegrationStatus(paths, settings);
}

export async function unregisterBrowserIntegration(
  paths: BrowserIntegrationRegistrationPaths
): Promise<BrowserIntegrationStatus> {
  if (process.platform !== "win32") {
    throw new Error("Browser native messaging registration is only supported on Windows.");
  }

  const settings = await loadBrowserIntegrationSettings(paths.settingsPath);
  for (const target of allTargets) {
    await runRegistryCommand(unregisterNativeMessagingHostCommand(target), { allowMissing: true });
  }

  return browserIntegrationStatus(paths, settings);
}

export function normalizeBrowserIntegrationSettings(input: unknown): BrowserIntegrationSettings {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const targets = normalizeTargets(value.targets);

  return {
    targets: Array.isArray(value.targets) ? targets : [...defaultSettings.targets],
    chromiumExtensionIds: mergeExtensionIds(
      defaultSettings.chromiumExtensionIds,
      normalizeExtensionIds(value.chromiumExtensionIds)
    ),
    firefoxExtensionIds: normalizeExtensionIds(value.firefoxExtensionIds)
  };
}

export function browserIntegrationValidationErrors(settings: BrowserIntegrationSettings): string[] {
  if (!settings.targets.some((target) => target === "chrome" || target === "edge")) {
    return [];
  }

  const invalid = settings.chromiumExtensionIds.filter((id) => !chromiumExtensionIdPattern.test(id));
  return invalid.length > 0
    ? [`Chrome/Edge extension IDs must be 32 lowercase characters using only letters a-p: ${invalid.join(", ")}.`]
    : [];
}

async function browserIntegrationStatus(
  paths: BrowserIntegrationRegistrationPaths,
  settings: BrowserIntegrationSettings
): Promise<BrowserIntegrationStatus> {
  const hostExists = await fileExists(paths.hostPath);
  const targets = await Promise.all(
    allTargets.map(async (target): Promise<BrowserIntegrationTargetStatus> => {
      const manifestPath = nativeMessagingManifestPath(paths.manifestDir, target);
      const registryValue = process.platform === "win32" ? await readRegistryDefaultValue(target) : null;
      return {
        target,
        selected: settings.targets.includes(target),
        configured: extensionIdsForTarget(settings, target).length > 0,
        manifestPath,
        manifestExists: await fileExists(manifestPath),
        registryKey: nativeMessagingRegistryKey(target),
        registryValue,
        registered: registryValue === manifestPath
      };
    })
  );

  return {
    ok: true,
    platform: process.platform,
    hostName: NATIVE_MESSAGING_HOST_NAME,
    hostPath: paths.hostPath,
    hostExists,
    manifestDir: paths.manifestDir,
    settings,
    validationErrors: browserIntegrationValidationErrors(settings),
    targets
  };
}

function extensionIdsForTarget(settings: BrowserIntegrationSettings, target: NativeMessagingTarget): string[] {
  return target === "firefox" ? settings.firefoxExtensionIds : settings.chromiumExtensionIds;
}

function normalizeTargets(input: unknown): NativeMessagingTarget[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return allTargets.filter((target) => input.includes(target));
}

function normalizeExtensionIds(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,]+/) : [];
  return Array.from(
    new Set(
      raw
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function mergeExtensionIds(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat()));
}

function cloneDefaultSettings(): BrowserIntegrationSettings {
  return {
    targets: [...defaultSettings.targets],
    chromiumExtensionIds: [...defaultSettings.chromiumExtensionIds],
    firefoxExtensionIds: [...defaultSettings.firefoxExtensionIds]
  };
}

async function readRegistryDefaultValue(target: NativeMessagingTarget): Promise<string | null> {
  try {
    const result = await execFileAsync("reg.exe", ["query", nativeMessagingRegistryKey(target), "/ve"], {
      windowsHide: true
    });
    return parseRegistryDefaultValue(result.stdout);
  } catch {
    return null;
  }
}

export function parseRegistryDefaultValue(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s+\(Default\)\s+REG_SZ\s+(.+?)\s*$/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function runRegistryCommand(
  command: { command: string; args: string[] },
  options: { allowMissing?: boolean } = {}
): Promise<void> {
  try {
    await execFileAsync(command.command, command.args, { windowsHide: true });
  } catch (error) {
    if (options.allowMissing) {
      return;
    }

    throw new Error(`Registry command failed: ${errorMessage(error)}`, { cause: error });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function targetLabel(target: NativeMessagingTarget): string {
  if (target === "firefox") {
    return "Firefox";
  }

  return target === "edge" ? "Edge" : "Chrome";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
