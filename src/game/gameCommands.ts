export type GameCommand = { type: "start_mystery" } | { type: "reset_mystery" } | { type: "end_mystery" };

export function parseGameCommand(text: string | null | undefined): GameCommand | null {
  const normalized = text?.trim().toLowerCase();
  if (normalized === "/start-mystery") {
    return { type: "start_mystery" };
  }
  if (normalized === "/reset-mystery") {
    return { type: "reset_mystery" };
  }
  if (normalized === "/end-mystery") {
    return { type: "end_mystery" };
  }
  return null;
}
