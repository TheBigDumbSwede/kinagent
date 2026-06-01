import { loadBrowserSession } from "../auth/firebaseSession.js";

export interface SessionKin {
  index: number;
  aiId: string;
  name: string;
  current: boolean;
}

export function listKinsFromSession(sessionDir: string): SessionKin[] {
  const session = loadBrowserSession(sessionDir);
  const kindroidOrigin = session.storageState.origins?.find((origin) => {
    return origin.origin === "https://kindroid.ai";
  });

  const docsItem = kindroidOrigin?.localStorage?.find((item) => item.name === "kindroidDocs");
  if (!docsItem) {
    throw new Error(
      "No cached Kindroid Kin list found in the saved browser session. Run npm run login again after the Kindroid app has fully loaded."
    );
  }

  const currentAI = kindroidOrigin?.localStorage?.find((item) => item.name === "currentAI")?.value;
  const docs = JSON.parse(docsItem.value) as unknown;
  if (!Array.isArray(docs)) {
    throw new Error("Cached Kindroid Kin list had an unexpected shape.");
  }

  return docs.flatMap((doc, index) => {
    if (!isRecord(doc)) {
      return [];
    }

    const aiId = stringValue(doc.ai_id);
    if (!aiId) {
      return [];
    }

    return [
      {
        index: index + 1,
        aiId,
        name: stringValue(doc.ai_name) ?? "(unnamed)",
        current: currentAI === aiId
      }
    ];
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
