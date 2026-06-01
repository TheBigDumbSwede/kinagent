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

export function createLogger(level: LogLevel): Logger {
  const threshold = levels[level];

  function write(messageLevel: LogLevel, message: string, meta?: unknown): void {
    if (levels[messageLevel] < threshold) {
      return;
    }

    const line = format(messageLevel, message, meta);
    const stream = messageLevel === "error" || messageLevel === "warn" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
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
