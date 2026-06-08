import net from "node:net";
import { NATIVE_MESSAGING_PIPE_NAME } from "./nativeMessaging.js";
import type { Logger } from "../util/logger.js";

export interface BrowserBridgeServerOptions {
  logger: Logger;
  pipeName?: string;
}

export interface BrowserBridgeRequest {
  id?: unknown;
  type?: unknown;
}

export interface BrowserBridgeResponse {
  id: unknown;
  type: "ack" | "error" | "pong";
  ok?: boolean;
  code?: string;
  message?: string;
}

export function nativeMessagingPipePath(pipeName = NATIVE_MESSAGING_PIPE_NAME): string {
  return `\\\\.\\pipe\\${pipeName}`;
}

export function handleBrowserBridgeMessage(input: unknown): BrowserBridgeResponse {
  if (!isRecord(input)) {
    return errorResponse(null, "invalid_message", "Browser bridge messages must be JSON objects.");
  }

  const id = input.id ?? null;
  if (typeof input.type !== "string") {
    return errorResponse(id, "invalid_message", "Browser bridge messages require a string type.");
  }

  switch (input.type) {
    case "ping":
      return { id, type: "pong", ok: true };
    case "browser-ready":
      return { id, type: "ack", ok: true };
    default:
      return errorResponse(id, "unsupported_message", `Unsupported browser bridge message type: ${input.type}`);
  }
}

export class BrowserBridgeServer {
  private readonly logger: Logger;
  private readonly pipeName: string;
  private readonly sockets = new Set<net.Socket>();
  private server: net.Server | null = null;

  constructor(options: BrowserBridgeServerOptions) {
    this.logger = options.logger;
    this.pipeName = options.pipeName ?? NATIVE_MESSAGING_PIPE_NAME;
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
        server.listen(pipePath);
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

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
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

    socket.write(`${JSON.stringify(handleBrowserBridgeMessage(parsed))}\n`);
  }
}

function errorResponse(id: unknown, code: string, message: string): BrowserBridgeResponse {
  return { id, type: "error", ok: false, code, message };
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
