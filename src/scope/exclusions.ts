import {
  getAllTags,
  type MetadataCache,
  type TFile
} from "obsidian";
import type { SemanticLinksSettings } from "../settings/types.ts";
import { isRecord } from "../utils/validation.ts";

type ExclusionSettings = Pick<
  SemanticLinksSettings,
  "excludedFolders" | "excludedFiles" | "excludedTags" | "excludedProperties"
>;

export function isFileExcluded(
  metadataCache: MetadataCache,
  file: TFile,
  settings: ExclusionSettings
): boolean {
  const path = normalizePath(file.path);
  if (settings.excludedFiles.some((entry) => normalizePath(entry) === path)) {
    return true;
  }
  if (settings.excludedFolders.some((folder) => {
    const normalized = normalizePath(folder).replace(/^\/+|\/+$/gu, "");
    return normalized.length > 0
      && (path === normalized || path.startsWith(`${normalized}/`));
  })) {
    return true;
  }

  const cache = metadataCache.getFileCache(file);
  if (cache === null) {
    return false;
  }
  if ((getAllTags(cache) ?? []).some((tag) => {
    return settings.excludedTags.includes(
      tag.replace(/^#/u, "").toLocaleLowerCase()
    );
  })) {
    return true;
  }

  const frontmatter: unknown = cache.frontmatter;
  if (!isRecord(frontmatter)) {
    return false;
  }
  const properties = new Set(Object.keys(frontmatter).map((key) => key.toLocaleLowerCase()));
  return settings.excludedProperties.some((property) => {
    return properties.has(property.trim().toLocaleLowerCase());
  });
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "").toLocaleLowerCase();
}
