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
    const normalized = normalizePath(folder);
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
  return isRecord(frontmatter)
    && settings.excludedProperties.some((rule) => {
      return matchesPropertyRule(frontmatter, rule);
    });
}

function matchesPropertyRule(
  frontmatter: Record<string, unknown>,
  rule: string
): boolean {
  const separator = rule.indexOf("=");
  const name = (separator < 0 ? rule : rule.slice(0, separator))
    .trim()
    .toLocaleLowerCase();
  const key = Object.keys(frontmatter).find((entry) => {
    return entry.toLocaleLowerCase() === name;
  });
  if (key === undefined) {
    return false;
  }
  if (separator < 0) {
    return true;
  }

  const expected = rule.slice(separator + 1).trim().toLocaleLowerCase();
  return propertyValues(frontmatter[key]).some((value) => value === expected);
}

function propertyValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => propertyValues(entry));
  }
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return [String(value).trim().toLocaleLowerCase()];
  }
  return [];
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/^\/+|\/+$/gu, "")
    .toLocaleLowerCase();
}
