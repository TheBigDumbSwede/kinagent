import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  BrowserBridgeServer,
  handleBrowserBridgeMessage,
  nativeMessagingPipePath
} from "../src/browserIntegration/browserBridgeServer.js";
import type { Logger } from "../src/util/logger.js";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

describe("browser bridge server", () => {
  it("handles native messaging bridge pings", () => {
    expect(handleBrowserBridgeMessage({ id: "ping-1", type: "ping" })).toEqual({
      id: "ping-1",
      type: "pong",
      ok: true
    });
  });

  it("acknowledges extension readiness without mutating application state", () => {
    expect(handleBrowserBridgeMessage({ id: "ready-1", type: "browser-ready" })).toEqual({
      id: "ready-1",
      type: "ack",
      ok: true
    });
  });

  it("rejects unsupported or malformed bridge messages", () => {
    expect(handleBrowserBridgeMessage({ id: "unknown-1", type: "refresh-dom" })).toEqual({
      id: "unknown-1",
      type: "error",
      ok: false,
      code: "unsupported_message",
      message: "Unsupported browser bridge message type: refresh-dom"
    });
    expect(handleBrowserBridgeMessage("bad")).toEqual({
      id: null,
      type: "error",
      ok: false,
      code: "invalid_message",
      message: "Browser bridge messages must be JSON objects."
    });
  });

  it("responds to JSON line requests over the Windows named pipe", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const pipeName = `kinagent-browser-bridge-test-${process.pid}-${Date.now()}`;
    const server = new BrowserBridgeServer({ logger: silentLogger, pipeName });
    await server.start();

    try {
      await expect(sendPipeRequest(pipeName, { id: "pipe-1", type: "ping" })).resolves.toEqual({
        id: "pipe-1",
        type: "pong",
        ok: true
      });
    } finally {
      await server.stop();
    }
  });
});

function sendPipeRequest(pipeName: string, message: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(nativeMessagingPipePath(pipeName));
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for browser bridge pipe response."));
    }, 2_000);

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      clearTimeout(timeout);
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newlineIndex)));
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
