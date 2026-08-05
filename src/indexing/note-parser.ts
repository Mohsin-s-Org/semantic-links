import {
  getAllTags,
  type App,
  type CachedMetadata,
  type TFile
} from "obsidian";
import { isFileExcluded } from "../scope/exclusions.ts";
import type { SemanticLinksSettings } from "../settings/types.ts";
import { isRecord } from "../utils/validation.ts";
import { chunkMarkdown } from "./chunker.ts";
import { createChunkId, createDocumentId, hashText } from "./hash.ts";
import type {
  IndexedChunk,
  IndexedDocument,
  IndexedHeading
} from "./types.ts";

export interface ParsedIndexDocument {
  document: IndexedDocument;
  chunks: IndexedChunk[];
}

export async function parseIndexDocument(
  app: App,
  file: TFile,
  settings: SemanticLinksSettings
): Promise<ParsedIndexDocument | null | undefined> {
  if (isFileExcluded(app.metadataCache, file, settings)) {
    return null;
  }

  try {
    const content = await app.vault.cachedRead(file);
    if (isFileExcluded(app.metadataCache, file, settings)) {
      return null;
    }
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter: unknown = cache?.frontmatter;
    const title = readFrontmatterTitle(frontmatter) ?? file.basename;
    const aliases = readFrontmatterAliases(frontmatter);
    const tags = cache === null ? [] : [...new Set(getAllTags(cache) ?? [])].sort();
    const headings = readHeadings(cache);
    const outgoingPaths = readOutgoingPaths(app, file, cache);
    const documentId = createDocumentId(file.path);
    const drafts = chunkMarkdown(content, title);
    const chunks: IndexedChunk[] = drafts.map((draft) => ({
      id: createChunkId(documentId, draft.startOffset, draft.endOffset, draft.text),
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
    }));
    const contentHash = hashText(JSON.stringify({
      path: file.path,
      title,
      aliases,
      tags,
      headings,
      outgoingPaths,
      content
    }));
    return {
      document: {
        id: documentId,
        path: file.path,
        title,
        aliases,
        tags,
        headings,
        outgoingPaths,
        contentHash,
        modifiedAt: file.stat.mtime,
        chunkIds: chunks.map((chunk) => chunk.id)
      },
      chunks
    };
  } catch {
    return undefined;
  }
}

function readFrontmatterTitle(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = value["title"];
  return typeof title === "string" && title.trim().length > 0
    ? title.trim()
    : null;
}

function readFrontmatterAliases(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }
  const aliases = value["aliases"] ?? value["alias"];
  if (typeof aliases === "string") {
    return aliases.trim().length > 0 ? [aliases.trim()] : [];
  }
  if (!Array.isArray(aliases)) {
    return [];
  }
  return [...new Set(aliases
    .filter((alias): alias is string => typeof alias === "string")
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0))];
}

function readHeadings(cache: CachedMetadata | null): IndexedHeading[] {
  return (cache?.headings ?? [])
    .map((heading) => ({
      text: heading.heading.trim(),
      level: heading.level
    }))
    .filter((heading) => heading.text.length > 0);
}

function readOutgoingPaths(
  app: App,
  file: TFile,
  cache: CachedMetadata | null
): string[] {
  const paths = new Set<string>();
  for (const link of cache?.links ?? []) {
    const target = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
    if (target !== null) {
      paths.add(target.path);
    }
  }
  return [...paths].sort();
}
