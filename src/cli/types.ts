import type { AppConfig } from "../config/types.js";
import type { Logger } from "../util/logger.js";

export type LoadRuntime = () => {
  config: AppConfig;
  logger: Logger;
};
