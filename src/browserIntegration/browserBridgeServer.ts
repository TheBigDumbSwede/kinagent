import net from "node:net";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NATIVE_MESSAGING_PIPE_NAME } from "./nativeMessaging.js";
import type { Logger } from "../util/logger.js";

export const BROWSER_BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_BROWSER_BRIDGE_COMMAND_TTL_MS = 30_000;
export const DEFAULT_BROWSER_BRIDGE_SESSION_TTL_MS = 5 * 60_000;

export interface BrowserBridgeServerOptions {
  logger: Logger;
  authSecret: string;
  allowedExtensionIds?: string[];
  pipeName?: string;
  commandTtlMs?: number;
  sessionTtlMs?: number;
}

export interface BrowserBridgeResponse {
  id: unknown;
  type: "ack" | "bridge-ready" | "commands" | "error" | "pong";
  ok?: boolean;
  code?: string;
  commands?: BrowserBridgeCommand[];
  message?: string;
  protocolVersion?: number;
  sessionId?: string;
  ackedCommandIds?: string[];
}

export const BROWSER_BRIDGE_COMMAND_TYPES = ["reload-kindroid", "show-notice"] as const;
export type BrowserBridgeCommandType = (typeof BROWSER_BRIDGE_COMMAND_TYPES)[number];

export const BROWSER_BRIDGE_INBOUND_MESSAGE_TYPES = ["ping", "hello", "browser-ready", "poll", "command-ack"] as const;

export interface BrowserBridgeCommand {
  id: string;
  type: BrowserBridgeCommandType;
  createdAt: string;
  expiresAt: string;
  text?: string;
}

export interface BrowserBridgeRuntimeStatus {
  connected: boolean;
  queuedCommandCount: number;
  protocolVersion: number;
  authenticatedSessionCount: number;
  lastReadyAt: string | null;
  lastPollAt: string | null;
  lastAckAt: string | null;
}

export interface BrowserBridgeMessageOptions {
  authenticated?: boolean;
  commands?: BrowserBridgeCommand[];
  sessionId?: string;
  ackedCommandIds?: string[];
}

interface BrowserBridgeSession {
  id: string;
  extensionId: string;
  createdAt: Date;
  lastSeenAt: Date;
}

interface BrowserBridgeCommandRecord {
  command: BrowserBridgeCommand;
  deliveredAt: Date | null;
  ackedAt: Date | null;
  expiredAt: Date | null;
}

export function nativeMessagingPipePath(pipeName = NATIVE_MESSAGING_PIPE_NAME): string {
  return `\\\\.\\pipe\\${pipeName}`;
}

export function browserBridgeHandshakePayload(input: {
  protocolVersion: number;
  extensionId: string;
  nativeHostOrigin: string;
  nativeHostNonce: string;
}): string {
  return [
    `protocolVersion=${input.protocolVersion}`,
    `extensionId=${input.extensionId}`,
    `nativeHostOrigin=${input.nativeHostOrigin}`,
    `nativeHostNonce=${input.nativeHostNonce}`
  ].join("\n");
}

export function signBrowserBridgeHandshake(
  secret: string,
  input: {
    protocolVersion: number;
    extensionId: string;
    nativeHostOrigin: string;
    nativeHostNonce: string;
  }
): string {
  return createHmac("sha256", secret).update(browserBridgeHandshakePayload(input)).digest("hex");
}

export function handleBrowserBridgeMessage(
  input: unknown,
  options: BrowserBridgeMessageOptions = {}
): BrowserBridgeResponse {
  if (!isRecord(input)) {
    return errorResponse(null, "invalid_message", "Browser bridge messages must be JSON objects.");
  }

  const id = input.id ?? null;
  if (typeof input.type !== "string") {
    return errorResponse(id, "invalid_message", "Browser bridge messages require a string type.");
  }

  switch (input.type) {
    case "ping":
      return { id, type: "pong", ok: true, protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION };
    case "hello":
      return options.sessionId
        ? {
            id,
            type: "bridge-ready",
            ok: true,
            protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
            sessionId: options.sessionId
          }
        : errorResponse(id, "auth_required", "Browser bridge hello did not complete authentication.");
    case "browser-ready":
      return options.authenticated
        ? { id, type: "ack", ok: true, protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION }
        : errorResponse(id, "auth_required", "Browser bridge session is required before readiness messages.");
    case "poll":
      return options.authenticated
        ? {
            id,
            type: "commands",
            ok: true,
            protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
            commands: options.commands ?? []
          }
        : errorResponse(id, "auth_required", "Browser bridge session is required before polling commands.");
    case "command-ack":
      return options.authenticated
        ? {
            id,
            type: "ack",
            ok: true,
            protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
            ackedCommandIds: options.ackedCommandIds ?? []
          }
        : errorResponse(id, "auth_required", "Browser bridge session is required before acknowledging commands.");
    default:
      return errorResponse(id, "unsupported_message", `Unsupported browser bridge message type: ${input.type}`);
  }
}

export class BrowserBridgeServer {
  private readonly logger: Logger;
  private readonly authSecret: string;
  private readonly pipeName: string;
  private readonly commandTtlMs: number;
  private readonly sessionTtlMs: number;
  private allowedExtensionIds = new Set<string>();
  private readonly sockets = new Set<net.Socket>();
  private readonly queuedCommands: BrowserBridgeCommandRecord[] = [];
  private readonly recentCommands = new Map<string, BrowserBridgeCommandRecord>();
  private readonly sessions = new Map<string, BrowserBridgeSession>();
  private server: net.Server | null = null;
  private lastReadyAt: Date | null = null;
  private lastPollAt: Date | null = null;
  private lastAckAt: Date | null = null;

  constructor(options: BrowserBridgeServerOptions) {
    this.logger = options.logger;
    this.authSecret = options.authSecret;
    this.pipeName = options.pipeName ?? NATIVE_MESSAGING_PIPE_NAME;
    this.commandTtlMs = options.commandTtlMs ?? DEFAULT_BROWSER_BRIDGE_COMMAND_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_BROWSER_BRIDGE_SESSION_TTL_MS;
    this.setAllowedExtensionIds(options.allowedExtensionIds ?? []);
  }

  setAllowedExtensionIds(extensionIds: string[]): void {
    this.allowedExtensionIds = new Set(extensionIds.map((id) => id.trim()).filter(Boolean));
    for (const [sessionId, session] of this.sessions) {
      if (!this.allowedExtensionIds.has(session.extensionId)) {
        this.sessions.delete(sessionId);
      }
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    if (process.platform !== "win32") {
      this.logger.info("Browser bridge native messaging pipe skipped on non-Windows platform.");
      return;
    }

    const server = net.createServer((socket) => this.handleSocket(socket));
    const pipePath = nativeMessagingPipePath(this.pipeName);
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          server.on("error", (error) => {
            this.logger.warn("Browser bridge native messaging pipe error.", errorMeta(error));
          });
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen({
          path: pipePath,
          readableAll: false,
          writableAll: false
        });
      });

      this.logger.info("Browser bridge native messaging pipe started.", { pipeName: this.pipeName });
    } catch (error) {
      this.server = null;
      this.logger.warn("Browser bridge native messaging pipe could not start.", errorMeta(error));
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }

    this.server = null;
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    this.sessions.clear();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  queueCommand(type: BrowserBridgeCommandType, options: { text?: string } = {}): BrowserBridgeCommand {
    const now = new Date();
    const command: BrowserBridgeCommand = {
      id: randomUUID(),
      type,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.commandTtlMs).toISOString(),
      text: options.text
    };
    const record: BrowserBridgeCommandRecord = {
      command,
      deliveredAt: null,
      ackedAt: null,
      expiredAt: null
    };

    this.queuedCommands.push(record);
    this.recentCommands.set(command.id, record);
    if (this.queuedCommands.length > 20) {
      this.queuedCommands.splice(0, this.queuedCommands.length - 20);
    }
    this.pruneRecentCommands();

    return command;
  }

  status(now = new Date()): BrowserBridgeRuntimeStatus {
    this.expireQueuedCommands(now);
    this.pruneSessions(now);
    const recentActivityAt = this.lastPollAt ?? this.lastReadyAt;
    return {
      connected: recentActivityAt ? now.getTime() - recentActivityAt.getTime() < 45_000 : false,
      queuedCommandCount: this.queuedCommands.length,
      protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
      authenticatedSessionCount: this.sessions.size,
      lastReadyAt: this.lastReadyAt?.toISOString() ?? null,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      lastAckAt: this.lastAckAt?.toISOString() ?? null
    };
  }

  private handleSocket(socket: net.Socket): void {
    this.sockets.add(socket);
    let buffer = "";

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        this.handleLine(socket, line);
      }
    });
    socket.on("close", () => {
      this.sockets.delete(socket);
    });
    socket.on("error", (error) => {
      this.sockets.delete(socket);
      this.logger.warn("Browser bridge native messaging client error.", errorMeta(error));
    });
  }

  private handleLine(socket: net.Socket, line: string): void {
    if (line.trim().length === 0) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      socket.write(
        `${JSON.stringify(errorResponse(null, "invalid_json", "Browser bridge message was not valid JSON."))}\n`
      );
      return;
    }

    const response = this.prepareResponseFor(parsed);
    socket.write(`${JSON.stringify(response)}\n`);
  }

  private prepareResponseFor(message: unknown): BrowserBridgeResponse {
    if (!isRecord(message) || typeof message.type !== "string") {
      return handleBrowserBridgeMessage(message);
    }

    if (message.type === "hello") {
      const now = new Date();
      this.pruneSessions(now);
      const handshake = this.authenticateHandshake(message);
      if (!handshake.ok) {
        return errorResponse(message.id ?? null, handshake.code, handshake.message);
      }

      const sessionId = randomUUID();
      this.sessions.set(sessionId, {
        id: sessionId,
        extensionId: handshake.extensionId,
        createdAt: now,
        lastSeenAt: now
      });
      this.lastReadyAt = now;
      return handleBrowserBridgeMessage(message, { sessionId });
    }

    const session = this.sessionFor(message);
    if (!session && message.type !== "ping") {
      return handleBrowserBridgeMessage(message, { authenticated: false });
    }

    if (session) {
      session.lastSeenAt = new Date();
    }

    if (message.type === "browser-ready") {
      this.lastReadyAt = new Date();
      return handleBrowserBridgeMessage(message, { authenticated: true });
    }

    if (message.type === "poll") {
      const now = new Date();
      this.lastPollAt = now;
      const commands = this.drainCommands(now);
      return handleBrowserBridgeMessage(message, { authenticated: true, commands });
    }

    if (message.type === "command-ack") {
      const ackedCommandIds = this.ackCommands(message);
      return handleBrowserBridgeMessage(message, { authenticated: true, ackedCommandIds });
    }

    return handleBrowserBridgeMessage(message, { authenticated: Boolean(session) });
  }

  private authenticateHandshake(
    message: Record<string, unknown>
  ): { ok: true; extensionId: string } | { ok: false; code: string; message: string } {
    const protocolVersion = message.protocolVersion;
    if (protocolVersion !== BROWSER_BRIDGE_PROTOCOL_VERSION) {
      return {
        ok: false,
        code: "unsupported_protocol",
        message: `Browser bridge protocol ${String(protocolVersion)} is not supported.`
      };
    }

    const extensionId = typeof message.extensionId === "string" ? message.extensionId : "";
    if (!this.allowedExtensionIds.has(extensionId)) {
      return {
        ok: false,
        code: "extension_not_allowed",
        message: "Browser bridge extension is not registered for this Kinagent profile."
      };
    }

    const nativeHostOrigin = typeof message.nativeHostOrigin === "string" ? message.nativeHostOrigin : "";
    if (!originMatchesExtensionId(nativeHostOrigin, extensionId)) {
      return {
        ok: false,
        code: "extension_origin_mismatch",
        message: "Browser bridge native host origin does not match the extension ID."
      };
    }

    const nativeHostNonce = typeof message.nativeHostNonce === "string" ? message.nativeHostNonce : "";
    const signature = typeof message.nativeHostSignature === "string" ? message.nativeHostSignature : "";
    if (!nativeHostNonce || !signature) {
      return {
        ok: false,
        code: "auth_required",
        message: "Browser bridge hello requires a native host signature."
      };
    }

    const expected = signBrowserBridgeHandshake(this.authSecret, {
      protocolVersion,
      extensionId,
      nativeHostOrigin,
      nativeHostNonce
    });
    if (!constantTimeHexEqual(signature, expected)) {
      return {
        ok: false,
        code: "auth_failed",
        message: "Browser bridge native host signature was not valid."
      };
    }

    return { ok: true, extensionId };
  }

  private sessionFor(message: Record<string, unknown>): BrowserBridgeSession | null {
    if (message.protocolVersion !== BROWSER_BRIDGE_PROTOCOL_VERSION || typeof message.sessionId !== "string") {
      return null;
    }

    const session = this.sessions.get(message.sessionId);
    if (!session) {
      return null;
    }

    if (message.extensionId !== session.extensionId) {
      return null;
    }

    if (Date.now() - session.lastSeenAt.getTime() > this.sessionTtlMs) {
      this.sessions.delete(message.sessionId);
      return null;
    }

    return session;
  }

  private drainCommands(now: Date): BrowserBridgeCommand[] {
    this.expireQueuedCommands(now);
    const commands = this.queuedCommands.splice(0);
    for (const record of commands) {
      record.deliveredAt = now;
    }
    return commands.map((record) => record.command);
  }

  private ackCommands(message: Record<string, unknown>): string[] {
    const ids = Array.isArray(message.commandIds)
      ? message.commandIds.filter((id): id is string => typeof id === "string")
      : [];
    const now = new Date();
    const acked: string[] = [];
    for (const id of ids) {
      const record = this.recentCommands.get(id);
      if (!record) {
        continue;
      }

      record.ackedAt = now;
      acked.push(id);
    }

    if (acked.length > 0) {
      this.lastAckAt = now;
    }
    return acked;
  }

  private expireQueuedCommands(now: Date): void {
    for (let index = this.queuedCommands.length - 1; index >= 0; index -= 1) {
      const record = this.queuedCommands[index];
      if (Date.parse(record.command.expiresAt) > now.getTime()) {
        continue;
      }

      record.expiredAt = now;
      this.queuedCommands.splice(index, 1);
    }
  }

  private pruneRecentCommands(): void {
    if (this.recentCommands.size <= 60) {
      return;
    }

    const staleCount = this.recentCommands.size - 60;
    for (const id of Array.from(this.recentCommands.keys()).slice(0, staleCount)) {
      this.recentCommands.delete(id);
    }
  }

  private pruneSessions(now: Date): void {
    for (const [id, session] of this.sessions) {
      if (now.getTime() - session.lastSeenAt.getTime() > this.sessionTtlMs) {
        this.sessions.delete(id);
      }
    }
  }
}

function originMatchesExtensionId(origin: string, extensionId: string): boolean {
  if (origin === `chrome-extension://${extensionId}/`) {
    return true;
  }

  if (origin === extensionId) {
    return true;
  }

  return origin.length > 0 && !origin.startsWith("chrome-extension://");
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function errorResponse(id: unknown, code: string, message: string): BrowserBridgeResponse {
  return { id, type: "error", ok: false, code, message, protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMeta(error: unknown): { error: string; code?: string } {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return { error: error.message, code };
  }

  return { error: String(error) };
}
