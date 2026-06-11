import fs from "node:fs";
import path from "node:path";
import type { LogLevel } from "../config/types.js";

const levels: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const secretPatterns = [
  /(idToken|refreshToken|accessToken|authorization|cookie|cookies)["':=\s]+([^"',\s}]+)/gi,
  /(Bearer\s+)[A-Za-z0-9._-]+/gi
];

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface CreateLoggerOptions {
  logPath?: string;
  maxBytes?: number;
  maxFiles?: number;
}

const defaultMaxLogBytes = 5 * 1024 * 1024;
const defaultMaxLogFiles = 3;

export function createLogger(level: LogLevel, options: CreateLoggerOptions = {}): Logger {
  const threshold = levels[level];

  function write(messageLevel: LogLevel, message: string, meta?: unknown): void {
    if (levels[messageLevel] < threshold) {
      return;
    }

    const line = format(messageLevel, message, meta);
    const stream = messageLevel === "error" || messageLevel === "warn" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
    if (options.logPath) {
      appendLogLine(options.logPath, line, {
        maxBytes: options.maxBytes ?? defaultMaxLogBytes,
        maxFiles: options.maxFiles ?? defaultMaxLogFiles
      });
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

function appendLogLine(logPath: string, line: string, rotation: { maxBytes: number; maxFiles: number }): void {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    rotateLogIfNeeded(logPath, rotation);
    fs.appendFileSync(logPath, `${line}\n`, "utf8");
  } catch {
    // Logging must never break the bridge runtime.
  }
}

function rotateLogIfNeeded(logPath: string, rotation: { maxBytes: number; maxFiles: number }): void {
  if (rotation.maxBytes <= 0 || rotation.maxFiles <= 0 || !fs.existsSync(logPath)) {
    return;
  }

  const current = fs.statSync(logPath);
  if (current.size < rotation.maxBytes) {
    return;
  }

  for (let index = rotation.maxFiles - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    const target = `${logPath}.${index + 1}`;
    if (fs.existsSync(source)) {
      fs.rmSync(target, { force: true });
      fs.renameSync(source, target);
    }
  }

  const firstRotated = `${logPath}.1`;
  fs.rmSync(firstRotated, { force: true });
  fs.renameSync(logPath, firstRotated);
}

function format(level: LogLevel, message: string, meta?: unknown): string {
  const base = {
    level,
    time: new Date().toISOString(),
    message
  };

  if (meta === undefined) {
    return redactSecrets(JSON.stringify(base));
  }

  return redactSecrets(JSON.stringify({ ...base, meta }));
}

export function redactSecrets(value: string): string {
  return secretPatterns.reduce((current, pattern) => {
    return current.replace(pattern, (_match, prefix) => `${prefix}[REDACTED]`);
  }, value);
}
