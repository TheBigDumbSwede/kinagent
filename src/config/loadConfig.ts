import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { z } from "zod";
import type { AppConfig, LogLevel, VoiceProvider } from "./types.js";

dotenv.config({ quiet: true });

const currentSceneMaxLengthLimit = 160;
const defaultOpenAiVoice = "marin";

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
    },
    journalSuggestions: {
      enabled: true,
      throttleMessages: 20,
      strongEventBypass: true
    },
    chatDynamism: {
      suggestions: {
        enabled: true
      },
      autoAdjust: {
        enabled: false,
        minTurnsBetweenAdjustments: 12,
        min: 0.8,
        max: 1.4,
        maxDelta: 0.2
      }
    }
  },
  voice: {
    enabled: false,
    provider: "none",
    openai: {
      apiKey: "",
      model: "gpt-4o-mini-tts",
      voice: defaultOpenAiVoice,
      instructions: ""
    },
    elevenlabs: {
      apiKey: "",
      model: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128"
    }
  }
};

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const voiceProviderSchema = z.enum(["none", "openai", "elevenlabs"]);
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
    }),
    journalSuggestions: z.object({
      enabled: z.boolean(),
      throttleMessages: z
        .number()
        .finite()
        .int("hermes.journalSuggestions.throttleMessages must be an integer.")
        .positive("hermes.journalSuggestions.throttleMessages must be a positive number."),
      strongEventBypass: z.boolean()
    }),
    chatDynamism: z.object({
      suggestions: z.object({
        enabled: z.boolean()
      }),
      autoAdjust: z.object({
        enabled: z.boolean(),
        minTurnsBetweenAdjustments: z
          .number()
          .finite()
          .int("hermes.chatDynamism.autoAdjust.minTurnsBetweenAdjustments must be an integer.")
          .positive("hermes.chatDynamism.autoAdjust.minTurnsBetweenAdjustments must be a positive number."),
        min: z.number().finite(),
        max: z.number().finite(),
        maxDelta: z.number().finite().positive("hermes.chatDynamism.autoAdjust.maxDelta must be a positive number.")
      })
    })
  }),
  voice: z.object({
    enabled: z.boolean(),
    provider: voiceProviderSchema,
    openai: z.object({
      apiKey: z.string(),
      model: z.string().min(1, "voice.openai.model is required."),
      voice: z.string().min(1, "voice.openai.voice is required."),
      instructions: z.string()
    }),
    elevenlabs: z.object({
      apiKey: z.string(),
      model: z.string().min(1, "voice.elevenlabs.model is required."),
      outputFormat: z.string().min(1, "voice.elevenlabs.outputFormat is required.")
    })
  })
});

export interface LoadConfigOptions {
  configPath?: string;
  createDefaultConfig?: boolean;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const configPath = options.configPath ?? process.env.KINAGENT_CONFIG ?? path.resolve(process.cwd(), "config.yaml");
  if (options.createDefaultConfig) {
    ensureDefaultConfig(configPath);
  }

  const fileConfig = readYamlConfig(configPath);
  const merged = mergeConfig(defaultConfig, fileConfig);

  applyEnvOverrides(merged);
  normalizePaths(merged);

  return parseConfig(merged);
}

export function saveConfig(config: AppConfig, configPath: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, YAML.stringify(config), "utf8");
}

function ensureDefaultConfig(configPath: string): void {
  if (fs.existsSync(configPath)) {
    return;
  }

  saveConfig(defaultConfig, configPath);
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
      },
      journalSuggestions: {
        ...base.hermes.journalSuggestions,
        ...override.hermes?.journalSuggestions
      },
      chatDynamism: {
        ...base.hermes.chatDynamism,
        ...override.hermes?.chatDynamism,
        suggestions: {
          ...base.hermes.chatDynamism.suggestions,
          ...override.hermes?.chatDynamism?.suggestions
        },
        autoAdjust: {
          ...base.hermes.chatDynamism.autoAdjust,
          ...override.hermes?.chatDynamism?.autoAdjust
        }
      }
    },
    voice: {
      ...base.voice,
      ...override.voice,
      openai: {
        ...base.voice.openai,
        ...override.voice?.openai
      },
      elevenlabs: {
        ...base.voice.elevenlabs,
        ...override.voice?.elevenlabs
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
  config.hermes.journalSuggestions.enabled = booleanFromEnv(
    "HERMES_JOURNAL_SUGGESTIONS_ENABLED",
    config.hermes.journalSuggestions.enabled
  );
  config.hermes.journalSuggestions.throttleMessages = numberFromEnv(
    "HERMES_JOURNAL_SUGGESTION_THROTTLE_MESSAGES",
    config.hermes.journalSuggestions.throttleMessages
  );
  config.hermes.journalSuggestions.strongEventBypass = booleanFromEnv(
    "HERMES_JOURNAL_STRONG_EVENT_BYPASS",
    config.hermes.journalSuggestions.strongEventBypass
  );
  config.hermes.chatDynamism.suggestions.enabled = booleanFromEnv(
    "HERMES_CHAT_DYNAMISM_SUGGESTIONS_ENABLED",
    config.hermes.chatDynamism.suggestions.enabled
  );
  config.hermes.chatDynamism.autoAdjust.enabled = booleanFromEnv(
    "HERMES_CHAT_DYNAMISM_AUTO_ADJUST_ENABLED",
    config.hermes.chatDynamism.autoAdjust.enabled
  );
  config.hermes.chatDynamism.autoAdjust.minTurnsBetweenAdjustments = numberFromEnv(
    "HERMES_CHAT_DYNAMISM_MIN_TURNS_BETWEEN_ADJUSTMENTS",
    config.hermes.chatDynamism.autoAdjust.minTurnsBetweenAdjustments
  );
  config.hermes.chatDynamism.autoAdjust.min = numberFromEnv(
    "HERMES_CHAT_DYNAMISM_MIN",
    config.hermes.chatDynamism.autoAdjust.min
  );
  config.hermes.chatDynamism.autoAdjust.max = numberFromEnv(
    "HERMES_CHAT_DYNAMISM_MAX",
    config.hermes.chatDynamism.autoAdjust.max
  );
  config.hermes.chatDynamism.autoAdjust.maxDelta = numberFromEnv(
    "HERMES_CHAT_DYNAMISM_MAX_DELTA",
    config.hermes.chatDynamism.autoAdjust.maxDelta
  );

  config.voice.enabled = booleanFromEnv("KINAGENT_VOICE_ENABLED", config.voice.enabled);
  config.voice.provider = voiceProviderFromEnv("KINAGENT_VOICE_PROVIDER", config.voice.provider);
  config.voice.openai.apiKey =
    process.env.KINAGENT_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? config.voice.openai.apiKey;
  config.voice.openai.model =
    process.env.KINAGENT_OPENAI_TTS_MODEL ?? process.env.OPENAI_TTS_MODEL ?? config.voice.openai.model;
  config.voice.openai.voice = normalizeOpenAiVoice(
    process.env.KINAGENT_OPENAI_TTS_VOICE ?? process.env.OPENAI_TTS_VOICE ?? config.voice.openai.voice
  );
  config.voice.openai.instructions =
    process.env.KINAGENT_OPENAI_TTS_INSTRUCTIONS ??
    process.env.OPENAI_TTS_INSTRUCTIONS ??
    config.voice.openai.instructions;
  config.voice.elevenlabs.apiKey =
    process.env.KINAGENT_ELEVENLABS_API_KEY ?? process.env.ELEVENLABS_API_KEY ?? config.voice.elevenlabs.apiKey;
  config.voice.elevenlabs.model =
    process.env.KINAGENT_ELEVENLABS_MODEL ?? process.env.ELEVENLABS_MODEL ?? config.voice.elevenlabs.model;
  config.voice.elevenlabs.outputFormat =
    process.env.KINAGENT_ELEVENLABS_OUTPUT_FORMAT ??
    process.env.ELEVENLABS_OUTPUT_FORMAT ??
    config.voice.elevenlabs.outputFormat;
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

function voiceProviderFromEnv(name: string, fallback: VoiceProvider): VoiceProvider {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = voiceProviderSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`${name} must be one of none, openai, or elevenlabs.`);
}

function normalizeOpenAiVoice(value: string): string {
  return value.trim().toLowerCase() === "alloy" ? defaultOpenAiVoice : value;
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
