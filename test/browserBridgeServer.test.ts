import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  BROWSER_BRIDGE_COMMAND_TYPES,
  BROWSER_BRIDGE_INBOUND_MESSAGE_TYPES,
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  BrowserBridgeServer,
  handleBrowserBridgeMessage,
  nativeMessagingPipePath,
  signBrowserBridgeHandshake
} from "../src/browserIntegration/browserBridgeServer.js";
import type { Logger } from "../src/util/logger.js";

const authSecret = "test-browser-bridge-secret-with-enough-entropy";
const extensionId = "cggbaonfbomoejmmmomapjmejacmbpon";
const nativeHostOrigin = `chrome-extension://${extensionId}/`;

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

describe("browser bridge server", () => {
  it("pins the bridge to non-sensitive outbound commands", () => {
    expect([...BROWSER_BRIDGE_COMMAND_TYPES].sort()).toEqual(["reload-kindroid", "show-notice"].sort());
  });

  it("pins inbound messages to the versioned browser bridge protocol", () => {
    expect([...BROWSER_BRIDGE_INBOUND_MESSAGE_TYPES].sort()).toEqual(
      ["browser-ready", "command-ack", "hello", "ping", "poll"].sort()
    );
  });

  it("handles native messaging bridge pings without a session", () => {
    expect(handleBrowserBridgeMessage({ id: "ping-1", type: "ping" })).toEqual({
      id: "ping-1",
      type: "pong",
      ok: true,
      protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION
    });
  });

  it("rejects readiness, polling, and command acknowledgements before authentication", () => {
    expect(handleBrowserBridgeMessage({ id: "ready-1", type: "browser-ready" })).toMatchObject({
      id: "ready-1",
      type: "error",
      ok: false,
      code: "auth_required"
    });
    expect(handleBrowserBridgeMessage({ id: "poll-1", type: "poll" })).toMatchObject({
      id: "poll-1",
      type: "error",
      ok: false,
      code: "auth_required"
    });
    expect(handleBrowserBridgeMessage({ id: "ack-1", type: "command-ack", commandIds: ["command-1"] })).toMatchObject({
      id: "ack-1",
      type: "error",
      ok: false,
      code: "auth_required"
    });
  });

  it("returns queued browser commands only to authenticated sessions", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const pipeName = `kinagent-browser-bridge-test-${process.pid}-${Date.now()}`;
    const server = new BrowserBridgeServer({
      logger: silentLogger,
      authSecret,
      allowedExtensionIds: [extensionId],
      pipeName
    });
    await server.start();

    try {
      const command = server.queueCommand("reload-kindroid");
      await expect(sendPipeRequest(pipeName, { id: "poll-unauth", type: "poll" })).resolves.toMatchObject({
        id: "poll-unauth",
        type: "error",
        ok: false,
        code: "auth_required"
      });
      expect(server.status(new Date()).queuedCommandCount).toBe(1);

      const hello = await sendPipeRequest(pipeName, signedHello("hello-1"));
      expect(hello).toMatchObject({
        id: "hello-1",
        type: "bridge-ready",
        ok: true,
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION
      });
      const sessionId = sessionIdFrom(hello);

      await expect(
        sendPipeRequest(pipeName, {
          id: "ready-1",
          type: "browser-ready",
          protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
          extensionId,
          sessionId
        })
      ).resolves.toMatchObject({
        id: "ready-1",
        type: "ack",
        ok: true
      });
      expect(server.status(new Date()).connected).toBe(true);

      await expect(
        sendPipeRequest(pipeName, {
          id: "poll-1",
          type: "poll",
          protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
          extensionId,
          sessionId
        })
      ).resolves.toEqual({
        id: "poll-1",
        type: "commands",
        ok: true,
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        commands: [command]
      });
      expect(server.status(new Date()).queuedCommandCount).toBe(0);

      await expect(
        sendPipeRequest(pipeName, {
          id: "ack-1",
          type: "command-ack",
          protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
          extensionId,
          sessionId,
          commandIds: [command.id]
        })
      ).resolves.toEqual({
        id: "ack-1",
        type: "ack",
        ok: true,
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        ackedCommandIds: [command.id]
      });
      expect(server.status(new Date()).lastAckAt).not.toBeNull();
    } finally {
      await server.stop();
    }
  });

  it("binds authenticated sessions to the extension ID that completed the handshake", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const pipeName = `kinagent-browser-bridge-test-${process.pid}-${Date.now()}`;
    const server = new BrowserBridgeServer({
      logger: silentLogger,
      authSecret,
      allowedExtensionIds: [extensionId],
      pipeName
    });
    await server.start();

    try {
      server.queueCommand("show-notice", { text: "Kinagent is connected." });
      const hello = await sendPipeRequest(pipeName, signedHello("hello-bound"));
      const sessionId = sessionIdFrom(hello);

      await expect(
        sendPipeRequest(pipeName, {
          id: "poll-missing-extension",
          type: "poll",
          protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
          sessionId
        })
      ).resolves.toMatchObject({
        id: "poll-missing-extension",
        type: "error",
        ok: false,
        code: "auth_required"
      });

      await expect(
        sendPipeRequest(pipeName, {
          id: "poll-wrong-extension",
          type: "poll",
          protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
          extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sessionId
        })
      ).resolves.toMatchObject({
        id: "poll-wrong-extension",
        type: "error",
        ok: false,
        code: "auth_required"
      });

      await expect(
        sendPipeRequest(pipeName, {
          id: "poll-bound-extension",
          type: "poll",
          protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
          extensionId,
          sessionId
        })
      ).resolves.toMatchObject({
        id: "poll-bound-extension",
        type: "commands",
        ok: true
      });
    } finally {
      await server.stop();
    }
  });

  it("drops authenticated sessions when the extension allowlist changes", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const pipeName = `kinagent-browser-bridge-test-${process.pid}-${Date.now()}`;
    const server = new BrowserBridgeServer({
      logger: silentLogger,
      authSecret,
      allowedExtensionIds: [extensionId],
      pipeName
    });
    await server.start();

    try {
      const hello = await sendPipeRequest(pipeName, signedHello("hello-allowlist"));
      const sessionId = sessionIdFrom(hello);
      server.setAllowedExtensionIds([]);

      await expect(
        sendPipeRequest(pipeName, {
          id: "poll-removed-extension",
          type: "poll",
          protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
          extensionId,
          sessionId
        })
      ).resolves.toMatchObject({
        id: "poll-removed-extension",
        type: "error",
        ok: false,
        code: "auth_required"
      });
    } finally {
      await server.stop();
    }
  });

  it("rejects unknown extension IDs and bad native host signatures", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const pipeName = `kinagent-browser-bridge-test-${process.pid}-${Date.now()}`;
    const server = new BrowserBridgeServer({
      logger: silentLogger,
      authSecret,
      allowedExtensionIds: [extensionId],
      pipeName
    });
    await server.start();

    try {
      await expect(
        sendPipeRequest(
          pipeName,
          signedHello("hello-unknown", {
            extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            nativeHostOrigin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
          })
        )
      ).resolves.toMatchObject({
        id: "hello-unknown",
        type: "error",
        ok: false,
        code: "extension_not_allowed"
      });

      await expect(
        sendPipeRequest(pipeName, {
          ...signedHello("hello-bad-signature"),
          nativeHostSignature: "0".repeat(64)
        })
      ).resolves.toMatchObject({
        id: "hello-bad-signature",
        type: "error",
        ok: false,
        code: "auth_failed"
      });
    } finally {
      await server.stop();
    }
  });

  it("expires queued commands before they can be delivered", () => {
    const server = new BrowserBridgeServer({
      logger: silentLogger,
      authSecret,
      allowedExtensionIds: [extensionId],
      commandTtlMs: 1
    });
    const command = server.queueCommand("show-notice", { text: "Kinagent is connected." });
    expect(server.status(new Date(Date.parse(command.createdAt))).queuedCommandCount).toBe(1);
    expect(server.status(new Date(Date.parse(command.createdAt) + 10)).queuedCommandCount).toBe(0);
  });

  it("rejects unsupported or malformed bridge messages", () => {
    expect(handleBrowserBridgeMessage({ id: "unknown-1", type: "refresh-dom" })).toMatchObject({
      id: "unknown-1",
      type: "error",
      ok: false,
      code: "unsupported_message",
      message: "Unsupported browser bridge message type: refresh-dom"
    });
    expect(handleBrowserBridgeMessage("bad")).toMatchObject({
      id: null,
      type: "error",
      ok: false,
      code: "invalid_message",
      message: "Browser bridge messages must be JSON objects."
    });
  });

  it("responds to JSON line pings over the Windows named pipe", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const pipeName = `kinagent-browser-bridge-test-${process.pid}-${Date.now()}`;
    const server = new BrowserBridgeServer({
      logger: silentLogger,
      authSecret,
      allowedExtensionIds: [extensionId],
      pipeName
    });
    await server.start();

    try {
      await expect(sendPipeRequest(pipeName, { id: "pipe-1", type: "ping" })).resolves.toEqual({
        id: "pipe-1",
        type: "pong",
        ok: true,
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION
      });
    } finally {
      await server.stop();
    }
  });
});

function signedHello(
  id: string,
  input: {
    extensionId?: string;
    nativeHostOrigin?: string;
    nativeHostNonce?: string;
  } = {}
): object {
  const helloExtensionId = input.extensionId ?? extensionId;
  const helloNativeHostOrigin = input.nativeHostOrigin ?? nativeHostOrigin;
  const nativeHostNonce = input.nativeHostNonce ?? `nonce-${id}`;
  return {
    id,
    type: "hello",
    protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
    extensionId: helloExtensionId,
    nativeHostOrigin: helloNativeHostOrigin,
    nativeHostNonce,
    nativeHostSignature: signBrowserBridgeHandshake(authSecret, {
      protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
      extensionId: helloExtensionId,
      nativeHostOrigin: helloNativeHostOrigin,
      nativeHostNonce
    })
  };
}

function sessionIdFrom(response: unknown): string {
  if (
    !response ||
    typeof response !== "object" ||
    typeof (response as { sessionId?: unknown }).sessionId !== "string"
  ) {
    throw new Error("Expected browser bridge response to include a session ID.");
  }

  return (response as { sessionId: string }).sessionId;
}

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
