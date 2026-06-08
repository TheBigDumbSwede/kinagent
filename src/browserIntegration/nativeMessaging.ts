import fs from "node:fs/promises";
import path from "node:path";

export const NATIVE_MESSAGING_HOST_NAME = "com.kinagent.bridge";
export const NATIVE_MESSAGING_PIPE_NAME = "kinagent-browser-bridge";

export type NativeMessagingTarget = "chrome" | "edge" | "firefox";

export interface NativeMessagingManifestInput {
  hostPath: string;
  extensionIds: string[];
}

export interface NativeMessagingManifestFilesInput extends NativeMessagingManifestInput {
  manifestDir: string;
  targets: NativeMessagingTarget[];
}

export interface NativeMessagingRegistryCommand {
  command: "reg.exe";
  args: string[];
}

export interface NativeMessagingManifestFile {
  target: NativeMessagingTarget;
  path: string;
}

export function nativeHostExecutablePath(resourcesPath: string): string {
  return path.join(resourcesPath, "native-host", "kinagent-native-host.exe");
}

export function buildChromiumNativeMessagingManifest(input: NativeMessagingManifestInput): object {
  const allowedOrigins = input.extensionIds.map((extensionId) => `chrome-extension://${extensionId}/`);
  if (allowedOrigins.length === 0) {
    throw new Error("At least one Chromium extension id is required.");
  }

  return {
    name: NATIVE_MESSAGING_HOST_NAME,
    description: "Kinagent browser bridge",
    path: input.hostPath,
    type: "stdio",
    allowed_origins: allowedOrigins
  };
}

export function buildFirefoxNativeMessagingManifest(input: NativeMessagingManifestInput): object {
  if (input.extensionIds.length === 0) {
    throw new Error("At least one Firefox extension id is required.");
  }

  return {
    name: NATIVE_MESSAGING_HOST_NAME,
    description: "Kinagent browser bridge",
    path: input.hostPath,
    type: "stdio",
    allowed_extensions: input.extensionIds
  };
}

export async function writeNativeMessagingManifestFiles(
  input: NativeMessagingManifestFilesInput
): Promise<NativeMessagingManifestFile[]> {
  await fs.mkdir(input.manifestDir, { recursive: true });

  const files: NativeMessagingManifestFile[] = [];
  for (const target of input.targets) {
    const manifest =
      target === "firefox" ? buildFirefoxNativeMessagingManifest(input) : buildChromiumNativeMessagingManifest(input);
    const manifestPath = nativeMessagingManifestPath(input.manifestDir, target);
    await fs.writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await fs.rename(`${manifestPath}.tmp`, manifestPath);
    files.push({ target, path: manifestPath });
  }

  return files;
}

export function nativeMessagingManifestPath(manifestDir: string, target: NativeMessagingTarget): string {
  return path.join(manifestDir, `${NATIVE_MESSAGING_HOST_NAME}.${target}.json`);
}

export function nativeMessagingRegistryKey(target: NativeMessagingTarget): string {
  switch (target) {
    case "chrome":
      return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_MESSAGING_HOST_NAME}`;
    case "edge":
      return `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_MESSAGING_HOST_NAME}`;
    case "firefox":
      return `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_MESSAGING_HOST_NAME}`;
  }
}

export function registerNativeMessagingHostCommand(
  target: NativeMessagingTarget,
  manifestPath: string
): NativeMessagingRegistryCommand {
  return {
    command: "reg.exe",
    args: ["add", nativeMessagingRegistryKey(target), "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"]
  };
}

export function unregisterNativeMessagingHostCommand(target: NativeMessagingTarget): NativeMessagingRegistryCommand {
  return {
    command: "reg.exe",
    args: ["delete", nativeMessagingRegistryKey(target), "/f"]
  };
}
