import { InMemoryDedupeStore, type DedupeStore } from "./dedupeStore.js";

export function createDedupeStore(dedupeWindowSeconds: number): DedupeStore {
  return new InMemoryDedupeStore(dedupeWindowSeconds * 1000);
}
