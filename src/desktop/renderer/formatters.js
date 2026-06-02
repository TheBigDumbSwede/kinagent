export function formatTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatTimelineChange(entry) {
  if (!entry.changed && entry.previousShortHash) {
    return "No text change from previous snapshot";
  }

  const added = Number(entry.addedLines || 0);
  const removed = Number(entry.removedLines || 0);
  const characterDelta = Number(entry.characterDelta || 0);
  const characterLabel = characterDelta === 0 ? "0 chars" : `${characterDelta > 0 ? "+" : ""}${characterDelta} chars`;

  if (!entry.previousShortHash) {
    return `Initial capture · +${added} lines · ${characterLabel}`;
  }

  return `Compared with ${entry.previousShortHash} · +${added} / -${removed} lines · ${characterLabel}`;
}

export function providerLabel(provider) {
  return provider === "elevenlabs" ? "ElevenLabs" : "OpenAI";
}
