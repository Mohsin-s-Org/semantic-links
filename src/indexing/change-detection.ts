import type { IndexedDocument } from "./types.ts";

export function needsDocumentRead(
  existing: IndexedDocument | undefined,
  modifiedAt: number
): boolean {
  return existing === undefined || existing.modifiedAt !== modifiedAt;
}

export function canReuseDocument(
  existing: IndexedDocument | undefined,
  contentHash: string
): existing is IndexedDocument {
  return existing?.contentHash === contentHash;
}

export function findRemovedChunkIds(
  existing: IndexedDocument | undefined,
  nextChunkIds: readonly string[]
): string[] {
  if (existing === undefined) {
    return [];
  }
  const retained = new Set(nextChunkIds);
  return existing.chunkIds.filter((id) => !retained.has(id));
}
