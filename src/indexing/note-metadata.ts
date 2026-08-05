import {
  getAllTags,
  type App,
  type CachedMetadata,
  type TFile
} from "obsidian";
import { isRecord } from "../utils/validation.ts";
import type { IndexedHeading } from "./types.ts";

export interface IndexedNoteMetadata {
  title: string;
  aliases: string[];
  headings: IndexedHeading[];
  tags: string[];
}

export function extractIndexedNoteMetadata(
  file: TFile,
  cache: CachedMetadata | null
): IndexedNoteMetadata {
  const frontmatter: unknown = cache?.frontmatter;
  return {
    title: readTitle(frontmatter) ?? file.basename,
    aliases: readAliases(frontmatter),
    headings: (cache?.headings ?? [])
      .map((heading) => ({
        text: heading.heading.trim(),
        level: heading.level
      }))
      .filter((heading) => heading.text.length > 0),
    tags: [...new Set(getAllTags(cache) ?? [])].sort()
  };
}

export function readOutgoingPaths(
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

function readTitle(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = value["title"];
  return typeof title === "string" && title.trim().length > 0
    ? title.trim()
    : null;
}

function readAliases(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }
  const aliases = value["aliases"] ?? value["alias"];
  const values = typeof aliases === "string"
    ? [aliases]
    : Array.isArray(aliases)
      ? aliases.filter((alias): alias is string => typeof alias === "string")
      : [];
  return [...new Set(values
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0))];
}
