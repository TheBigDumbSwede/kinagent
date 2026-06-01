import type { AppConfig } from "../config/types.js";
import type { KindroidChatChangeNotification } from "../firestore/types.js";
import type { Logger } from "../util/logger.js";
import type { HermesAdapter } from "./types.js";

export class LoggingHermesAdapter implements HermesAdapter {
  constructor(private readonly logger: Logger) {}

  async handleChatChanged(notification: KindroidChatChangeNotification): Promise<void> {
    this.logger.info("Hermes adapter received Kindroid chat change notification.", {
      documentId: notification.documentId,
      kinId: notification.kinId,
      timestamp: notification.timestamp,
      sender: notification.sender,
      role: notification.role,
      source: notification.source
    });
  }
}

export function createHermesAdapter(config: AppConfig, logger: Logger): HermesAdapter {
  if (config.hermes.enabled) {
    logger.warn("Hermes HTTP/WebSocket integration is not implemented yet; using logging adapter.");
  }

  return new LoggingHermesAdapter(logger);
}
