import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { z } from "zod";
import type { AppConfig, LogLevel } from "./types.js";

dotenv.config({ quiet: true });

const currentSceneMaxLengthLimit = 160;

const defaultConfig: AppConfig = {
  kindroid: {
    firebaseProjectId: "kindroid-ai",
    uid: "",
    kins: []
  },
  bridge: {
    dedupeWindowSeconds: 180,
    logPath: "./data/kinagent.log",
    logLevel: "info",
    sessionDir: "./data/browser-session",
    sqlitePath: "./data/bridge.sqlite"
  },
  hermes: {
    enabled: false,
    baseUrl: "http://127.0.0.1:8642/v1",
    apiKey: "",
    agentId: "kindroid-bridge",
    currentSceneUpdates: {
      enabled: true,
      maxLength: currentSceneMaxLengthLimit
    }
  }
};

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const appConfigSchema = z.object({
  kindroid: z.object({
    firebaseProjectId: z.string().min(1, "kindroid.firebaseProjectId is required."),
    uid: z.string(),
    kins: z.array(
      z.object({
        name: z.string(),
        aiId: z.string(),
        enabled: z.boolean()
      })
    )
  }),
  bridge: z.object({
    dedupeWindowSeconds: z.number().finite().positive("bridge.dedupeWindowSeconds must be a positive number."),
    logPath: z.string().min(1, "bridge.logPath is required."),
    logLevel: logLevelSchema,
    sessionDir: z.string().min(1, "bridge.sessionDir is required."),
    sqlitePath: z.string().min(1, "bridge.sqlitePath is required.")
  }),
  hermes: z.object({
    enabled: z.boolean(),
    baseUrl: z.string().min(1, "hermes.baseUrl is required."),
    apiKey: z.string(),
    agentId: z.string().min(1, "hermes.agentId is required."),
    currentSceneUpdates: z.object({
      enabled: z.boolean(),
      maxLength: z
        .number()
        .finite()
        .positive("hermes.currentSceneUpdates.maxLength must be a positive number.")
        .max(
          currentSceneMaxLengthLimit,
          `hermes.currentSceneUpdates.maxLength cannot exceed ${currentSceneMaxLengthLimit}.`
        )
    })
  })
});

export interface LoadConfigOptions {
  configPath?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const configPath = options.configPath ?? process.env.KINAGENT_CONFIG ?? path.resolve(process.cwd(), "config.yaml");

  const fileConfig = readYamlConfig(configPath);
  const merged = mergeConfig(defaultConfig, fileConfig);

  applyEnvOverrides(merged);
  normalizePaths(merged);

  return parseConfig(merged);
}

function readYamlConfig(configPath: string): Partial<AppConfig> {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = YAML.parse(raw);
  return parsed && typeof parsed === "object" ? (parsed as Partial<AppConfig>) : {};
}

function mergeConfig(base: AppConfig, override: Partial<AppConfig>): AppConfig {
  return {
    kindroid: {
      ...base.kindroid,
      ...override.kindroid,
      kins: override.kindroid?.kins ?? base.kindroid.kins
    },
    bridge: {
      ...base.bridge,
      ...override.bridge
    },
    hermes: {
      ...base.hermes,
      ...override.hermes,
      currentSceneUpdates: {
        ...base.hermes.currentSceneUpdates,
        ...override.hermes?.currentSceneUpdates
      }
    }
  };
}

function applyEnvOverrides(config: AppConfig): void {
  config.kindroid.firebaseProjectId = process.env.KINDROID_FIREBASE_PROJECT_ID ?? config.kindroid.firebaseProjectId;
  config.kindroid.uid = process.env.KINDROID_UID ?? config.kindroid.uid;

  config.bridge.dedupeWindowSeconds = numberFromEnv("BRIDGE_DEDUPE_WINDOW_SECONDS", config.bridge.dedupeWindowSeconds);
  config.bridge.logPath = process.env.BRIDGE_LOG_PATH ?? config.bridge.logPath;
  config.bridge.logLevel = logLevelFromEnv("BRIDGE_LOG_LEVEL", config.bridge.logLevel);
  config.bridge.sessionDir = process.env.BRIDGE_SESSION_DIR ?? config.bridge.sessionDir;
  config.bridge.sqlitePath = process.env.BRIDGE_SQLITE_PATH ?? config.bridge.sqlitePath;

  config.hermes.enabled = booleanFromEnv("HERMES_ENABLED", config.hermes.enabled);
  config.hermes.baseUrl = process.env.HERMES_BASE_URL ?? config.hermes.baseUrl;
  config.hermes.apiKey = process.env.HERMES_API_KEY ?? config.hermes.apiKey;
  config.hermes.agentId = process.env.HERMES_AGENT_ID ?? config.hermes.agentId;
  config.hermes.currentSceneUpdates.enabled = booleanFromEnv(
    "HERMES_CURRENT_SCENE_UPDATES_ENABLED",
    config.hermes.currentSceneUpdates.enabled
  );
  config.hermes.currentSceneUpdates.maxLength = numberFromEnv(
    "HERMES_CURRENT_SCENE_MAX_LENGTH",
    config.hermes.currentSceneUpdates.maxLength
  );
}

function normalizePaths(config: AppConfig): void {
  config.bridge.logPath = path.resolve(process.cwd(), config.bridge.logPath);
  config.bridge.sessionDir = path.resolve(process.cwd(), config.bridge.sessionDir);
  config.bridge.sqlitePath = path.resolve(process.cwd(), config.bridge.sqlitePath);
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }

  return parsed;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function logLevelFromEnv(name: string, fallback: LogLevel): LogLevel {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = logLevelSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`${name} must be one of debug, info, warn, or error.`);
}

function parseConfig(config: AppConfig): AppConfig {
  const parsed = appConfigSchema.safeParse(config);
  if (parsed.success) {
    return parsed.data;
  }

  const issues = parsed.error.issues.map((issue) => {
    return issue.message;
  });
  throw new Error(`Invalid configuration: ${issues.join(" ")}`);
}
