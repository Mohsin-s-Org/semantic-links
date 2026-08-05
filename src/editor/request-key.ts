import { isRecord } from "../utils/validation.ts";

export type SuggestionMode = "automatic" | "manual";

export interface SuggestionRequestKey {
  filePath: string;
  documentVersion: number;
  anchorStart: number;
  anchorEnd: number;
  anchorText: string;
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
    key.anchorText,
    key.contextHash,
    key.mode
  ]);
}

export function isSuggestionRequestKey(value: unknown): value is SuggestionRequestKey {
  if (!isRecord(value)) {
    return false;
  }

  const filePath = value["filePath"];
  const documentVersion = value["documentVersion"];
  const anchorStart = value["anchorStart"];
  const anchorEnd = value["anchorEnd"];
  const anchorText = value["anchorText"];
  const contextHash = value["contextHash"];
  const mode = value["mode"];
  return typeof filePath === "string"
    && filePath.length > 0
    && typeof documentVersion === "number"
    && Number.isInteger(documentVersion)
    && documentVersion >= 0
    && typeof anchorStart === "number"
    && Number.isInteger(anchorStart)
    && anchorStart >= 0
    && typeof anchorEnd === "number"
    && Number.isInteger(anchorEnd)
    && anchorEnd > anchorStart
    && typeof anchorText === "string"
    && anchorText.length === anchorEnd - anchorStart
    && typeof contextHash === "string"
    && contextHash.length > 0
    && (mode === "automatic" || mode === "manual");
}
