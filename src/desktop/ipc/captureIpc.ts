import { ipcMain } from "electron";
import { readCapturedGroup, readCapturedKin } from "../../capture/captureReader.js";
import type { Logger } from "../../util/logger.js";

export function registerCaptureIpcHandlers(logger: Logger): void {
  ipcMain.handle("capture:get-kin", async (_event, input: { kinId?: string } = {}) => {
    const kinId = input.kinId ?? "";
    const startedAt = Date.now();
    logger.info("Reading captured Kin state for desktop.", { kinId });
    try {
      const result = await readCapturedKin(kinId);
      logger.info("Read captured Kin state for desktop.", {
        kinId,
        ok: result.ok,
        fields: result.fields.length,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      logger.error("Failed to read captured Kin state for desktop.", {
        kinId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  });

  ipcMain.handle("capture:get-group", async (_event, input: { groupId?: string } = {}) => {
    const groupId = input.groupId ?? "";
    const startedAt = Date.now();
    logger.info("Reading captured Group state for desktop.", { groupId });
    try {
      const result = await readCapturedGroup(groupId);
      logger.info("Read captured Group state for desktop.", {
        groupId,
        ok: result.ok,
        fields: result.fields.length,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      logger.error("Failed to read captured Group state for desktop.", {
        groupId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  });
}
