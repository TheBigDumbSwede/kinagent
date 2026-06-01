function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripKindroidNarrationForSpeech(
  text: string,
  options?: {
    enabled?: boolean;
    delimiter?: string;
  }
): string {
  const delimiter = options?.delimiter?.trim() || "*";
  const escapedDelimiter = escapeRegExp(delimiter);

  if (!options?.enabled) {
    return normalizeSpeechText(text.replace(new RegExp(escapedDelimiter, "g"), ""));
  }

  const narrationPattern = new RegExp(`${escapedDelimiter}[\\s\\S]*?${escapedDelimiter}`, "g");
  return normalizeSpeechText(text.replace(narrationPattern, " "));
}

export function splitSpeechIntoParagraphChunks(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function normalizeSpeechText(text: string): string {
  return text
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph
        .replace(/[^\S\r\n]+/g, " ")
        .replace(/\s+([,.;!?])/g, "$1")
        .trim()
    )
    .filter(Boolean)
    .join("\n\n");
}
