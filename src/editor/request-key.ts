import { isRecord } from "../utils/validation.ts";

export type SuggestionMode = "automatic" | "manual";

export interface SuggestionRequestKey {
  filePath: string;
  documentVersion: number;
  anchorStart: number;
  anchorEnd: number;
  contextHash: string;
  mode: SuggestionMode;
}

export function createContextHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(36);
}

export function serializeRequestKey(key: SuggestionRequestKey): string {
  return JSON.stringify([
    key.filePath,
    key.documentVersion,
    key.anchorStart,
    key.anchorEnd,
    key.contextHash,
    key.mode
  ]);
}

export function requestKeysEqual(
  left: SuggestionRequestKey,
  right: SuggestionRequestKey
): boolean {
  return serializeRequestKey(left) === serializeRequestKey(right);
}

export function isSuggestionRequestKey(value: unknown): value is SuggestionRequestKey {
  if (!isRecord(value)) {
    return false;
  }

  const mode = value["mode"];
  return typeof value["filePath"] === "string"
    && typeof value["documentVersion"] === "number"
    && Number.isInteger(value["documentVersion"])
    && typeof value["anchorStart"] === "number"
    && Number.isInteger(value["anchorStart"])
    && typeof value["anchorEnd"] === "number"
    && Number.isInteger(value["anchorEnd"])
    && typeof value["contextHash"] === "string"
    && (mode === "automatic" || mode === "manual");
}
