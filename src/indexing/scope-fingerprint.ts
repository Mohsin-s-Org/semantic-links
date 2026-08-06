import type { SemanticLinksSettings } from "../settings/types.ts";
import { hashText } from "./hash.ts";

type IndexScopeSettings = Pick<
  SemanticLinksSettings,
  "excludedFolders" | "excludedFiles" | "excludedTags" | "excludedProperties"
>;

export function createIndexScopeFingerprint(settings: IndexScopeSettings): string {
  return hashText(JSON.stringify([
    normalize(settings.excludedFolders),
    normalize(settings.excludedFiles),
    normalize(settings.excludedTags),
    normalize(settings.excludedProperties)
  ]));
}

function normalize(values: readonly string[]): string[] {
  return [...values]
    .map((value) => value.replace(/\\/gu, "/").trim().toLocaleLowerCase())
    .filter((value) => value.length > 0)
    .sort();
}
