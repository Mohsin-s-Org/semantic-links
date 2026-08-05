import {
  getAllTags,
  type MetadataCache,
  type TFile
} from "obsidian";
import type { SemanticLinksSettings } from "../settings/types.ts";

type ExclusionSettings = Pick<
  SemanticLinksSettings,
  "excludedFolders" | "excludedTags"
>;

export function isFileExcluded(
  metadataCache: MetadataCache,
  file: TFile,
  settings: ExclusionSettings
): boolean {
  const path = file.path.toLocaleLowerCase();
  if (settings.excludedFolders.some((folder) => {
    const normalized = folder.replace(/^\/+|\/+$/gu, "").toLocaleLowerCase();
    return normalized.length > 0
      && (path === normalized || path.startsWith(`${normalized}/`));
  })) {
    return true;
  }

  const cache = metadataCache.getFileCache(file);
  return cache !== null && (getAllTags(cache) ?? []).some((tag) => {
    return settings.excludedTags.includes(
      tag.replace(/^#/u, "").toLocaleLowerCase()
    );
  });
}
