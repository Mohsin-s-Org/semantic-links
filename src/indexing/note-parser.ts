import type { App, TFile } from "obsidian";
import { isFileExcluded } from "../scope/exclusions.ts";
import type { SemanticLinksSettings } from "../settings/types.ts";
import { chunkMarkdown } from "./chunker.ts";
import { createChunkId, createDocumentId, hashText } from "./hash.ts";
import {
  extractIndexedNoteMetadata,
  readOutgoingPaths
} from "./note-metadata.ts";
import type {
  IndexedChunk,
  IndexedDocument
} from "./types.ts";

export interface ParsedIndexDocument {
  document: IndexedDocument;
  chunks: IndexedChunk[];
}

export async function parseIndexDocument(
  app: App,
  file: TFile,
  settings: SemanticLinksSettings,
  existingDocumentId?: string
): Promise<ParsedIndexDocument | null | undefined> {
  if (isFileExcluded(app.metadataCache, file, settings)) {
    return null;
  }

  let content: string;
  try {
    content = await app.vault.cachedRead(file);
  } catch {
    return undefined;
  }
  if (isFileExcluded(app.metadataCache, file, settings)) {
    return null;
  }

  const cache = app.metadataCache.getFileCache(file);
  const metadata = extractIndexedNoteMetadata(file, cache);
  const outgoingPaths = readOutgoingPaths(app, file, cache);
  const documentId = existingDocumentId ?? createDocumentId(file.path);
  const occurrences = new Map<string, number>();
  const chunks: IndexedChunk[] = chunkMarkdown(content, metadata.title).map((draft) => {
    const identity = JSON.stringify([draft.headingPath, draft.embeddingText]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return {
      id: createChunkId(
        documentId,
        draft.headingPath,
        draft.embeddingText,
        occurrence
      ),
      documentId,
      headingPath: draft.headingPath,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      startLine: draft.startLine,
      endLine: draft.endLine,
      textPreview: draft.textPreview,
      lexicalTerms: draft.lexicalTerms,
      embeddingText: draft.embeddingText,
      vectorRow: -1
    };
  });
  const contentHash = hashText(JSON.stringify({
    path: file.path,
    ...metadata,
    outgoingPaths,
    content
  }));

  return {
    document: {
      id: documentId,
      path: file.path,
      ...metadata,
      outgoingPaths,
      contentHash,
      modifiedAt: file.stat.mtime,
      chunkIds: chunks.map((chunk) => chunk.id)
    },
    chunks
  };
}
