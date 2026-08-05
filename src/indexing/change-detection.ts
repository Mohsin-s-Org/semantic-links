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
