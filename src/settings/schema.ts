import {
  DEFAULT_BACKGROUND_BATCH_SIZE,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_SUGGESTIONS,
  MAX_BACKGROUND_BATCH_SIZE,
  MAX_DEBOUNCE_MS,
  MAX_SUGGESTIONS,
  MIN_DEBOUNCE_MS,
  MIN_SUGGESTIONS,
  SETTINGS_VERSION
} from "../constants.ts";
import type { WasmThreadCount } from "../embeddings/thread-tuning.ts";
import {
  isRecord,
  readBoolean,
  readClampedNumber,
  readEnum,
  readStringList
} from "../utils/validation.ts";
import { DEFAULT_SETTINGS, createDefaultSettings } from "./defaults.ts";
import type {
  SemanticLinksSettings,
  SemanticThreadMode,
  SettingsLoadResult
} from "./types.ts";

const LINK_PATH_MODES = ["shortest", "full"] as const;
const SEMANTIC_THREAD_MODES = ["automatic", "tuned"] as const;
const THREAD_DEVICE_CLASSES = ["unknown", "1-2", "3-4", "5-8", "9+"] as const;
const SETTING_KEYS = new Set<keyof SemanticLinksSettings>([
  "settingsVersion",
  "automaticSuggestions",
  "lexicalMatchingEnabled",
  "semanticIndexingEnabled",
  "semanticModelEnabled",
  "semanticModelInstalled",
  "semanticThreadMode",
  "semanticThreadCount",
  "semanticThreadModelRevision",
  "semanticThreadRuntimeVersion",
  "semanticThreadDeviceClass",
  "backgroundEmbeddingBatchLimit",
  "debounceMs",
  "maxSuggestions",
  "minimumConfidence",
  "excludedFolders",
  "excludedFiles",
  "excludedTags",
  "excludedProperties",
  "linkPathMode"
]);

export function loadAndMigrateSettings(input: unknown): SettingsLoadResult {
  if (!isRecord(input)) {
    return {
      settings: createDefaultSettings(),
      needsSave: input !== null && input !== undefined
    };
  }

  const rawVersion = input["settingsVersion"];
  const version = typeof rawVersion === "number" && Number.isInteger(rawVersion)
    ? rawVersion
    : 0;
  const modelInstalled = readBoolean(
    input,
    "semanticModelInstalled",
    DEFAULT_SETTINGS.semanticModelInstalled
  );
  const threadProfile = readThreadProfile(input);
  const settings: SemanticLinksSettings = {
    settingsVersion: SETTINGS_VERSION,
    automaticSuggestions: readBoolean(
      input,
      "automaticSuggestions",
      DEFAULT_SETTINGS.automaticSuggestions
    ),
    lexicalMatchingEnabled: readBoolean(
      input,
      "lexicalMatchingEnabled",
      DEFAULT_SETTINGS.lexicalMatchingEnabled
    ),
    semanticIndexingEnabled: readSemanticToggle(input),
    semanticModelEnabled: modelInstalled && readBoolean(
      input,
      "semanticModelEnabled",
      modelInstalled
    ),
    semanticModelInstalled: modelInstalled,
    ...threadProfile,
    backgroundEmbeddingBatchLimit: Math.round(readClampedNumber(
      input,
      "backgroundEmbeddingBatchLimit",
      DEFAULT_BACKGROUND_BATCH_SIZE,
      DEFAULT_BACKGROUND_BATCH_SIZE,
      MAX_BACKGROUND_BATCH_SIZE
    )),
    debounceMs: Math.round(readClampedNumber(
      input,
      "debounceMs",
      DEFAULT_DEBOUNCE_MS,
      MIN_DEBOUNCE_MS,
      MAX_DEBOUNCE_MS
    )),
    maxSuggestions: Math.round(readClampedNumber(
      input,
      "maxSuggestions",
      DEFAULT_MAX_SUGGESTIONS,
      MIN_SUGGESTIONS,
      MAX_SUGGESTIONS
    )),
    minimumConfidence: readClampedNumber(
      input,
      "minimumConfidence",
      DEFAULT_SETTINGS.minimumConfidence,
      0,
      1
    ),
    excludedFolders: readStringList(
      input,
      "excludedFolders",
      DEFAULT_SETTINGS.excludedFolders
    ),
    excludedFiles: readStringList(
      input,
      "excludedFiles",
      DEFAULT_SETTINGS.excludedFiles
    ),
    excludedTags: normalizeTags(readStringList(
      input,
      "excludedTags",
      DEFAULT_SETTINGS.excludedTags
    )),
    excludedProperties: normalizeProperties(readStringList(
      input,
      "excludedProperties",
      DEFAULT_SETTINGS.excludedProperties
    )),
    linkPathMode: readEnum(
      input,
      "linkPathMode",
      LINK_PATH_MODES,
      DEFAULT_SETTINGS.linkPathMode
    )
  };

  return {
    settings,
    needsSave: version <= SETTINGS_VERSION && !matchesCurrentSettings(input, settings)
  };
}

function readThreadProfile(record: Record<string, unknown>): Pick<
  SemanticLinksSettings,
  | "semanticThreadMode"
  | "semanticThreadCount"
  | "semanticThreadModelRevision"
  | "semanticThreadRuntimeVersion"
  | "semanticThreadDeviceClass"
> {
  const requestedMode = readEnum(
    record,
    "semanticThreadMode",
    SEMANTIC_THREAD_MODES,
    DEFAULT_SETTINGS.semanticThreadMode
  );
  const count = readThreadCount(record["semanticThreadCount"]);
  const modelRevision = readOptionalString(record["semanticThreadModelRevision"]);
  const runtimeVersion = readOptionalString(record["semanticThreadRuntimeVersion"]);
  const deviceClass = readEnum(
    record,
    "semanticThreadDeviceClass",
    THREAD_DEVICE_CLASSES,
    DEFAULT_SETTINGS.semanticThreadDeviceClass
  );
  const mode: SemanticThreadMode = requestedMode === "tuned"
    && count !== 0
    && modelRevision.length > 0
    && runtimeVersion.length > 0
    ? "tuned"
    : "automatic";
  return mode === "tuned"
    ? {
        semanticThreadMode: mode,
        semanticThreadCount: count,
        semanticThreadModelRevision: modelRevision,
        semanticThreadRuntimeVersion: runtimeVersion,
        semanticThreadDeviceClass: deviceClass
      }
    : {
        semanticThreadMode: "automatic",
        semanticThreadCount: 0,
        semanticThreadModelRevision: "",
        semanticThreadRuntimeVersion: "",
        semanticThreadDeviceClass: "unknown"
      };
}

function readThreadCount(value: unknown): WasmThreadCount {
  return value === 1 || value === 2 || value === 4 ? value : 0;
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readSemanticToggle(record: Record<string, unknown>): boolean {
  for (const key of [
    "semanticIndexingEnabled",
    "semanticMatchingEnabled",
    "enableSemanticSearch"
  ]) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return DEFAULT_SETTINGS.semanticIndexingEnabled;
}

function normalizeTags(tags: string[]): string[] {
  return uniqueNormalized(tags, (tag) => tag.replace(/^#/u, ""));
}

function normalizeProperties(properties: string[]): string[] {
  return uniqueNormalized(properties, (property) => property);
}

function uniqueNormalized(
  values: string[],
  transform: (value: string) => string
): string[] {
  return [...new Set(values
    .map((value) => transform(value).trim().toLocaleLowerCase())
    .filter((value) => value.length > 0))];
}

function matchesCurrentSettings(
  record: Record<string, unknown>,
  settings: SemanticLinksSettings
): boolean {
  return Object.keys(record).every((key) => SETTING_KEYS.has(key as keyof SemanticLinksSettings))
    && record["settingsVersion"] === settings.settingsVersion
    && record["automaticSuggestions"] === settings.automaticSuggestions
    && record["lexicalMatchingEnabled"] === settings.lexicalMatchingEnabled
    && record["semanticIndexingEnabled"] === settings.semanticIndexingEnabled
    && record["semanticModelEnabled"] === settings.semanticModelEnabled
    && record["semanticModelInstalled"] === settings.semanticModelInstalled
    && record["semanticThreadMode"] === settings.semanticThreadMode
    && record["semanticThreadCount"] === settings.semanticThreadCount
    && record["semanticThreadModelRevision"] === settings.semanticThreadModelRevision
    && record["semanticThreadRuntimeVersion"] === settings.semanticThreadRuntimeVersion
    && record["semanticThreadDeviceClass"] === settings.semanticThreadDeviceClass
    && record["backgroundEmbeddingBatchLimit"] === settings.backgroundEmbeddingBatchLimit
    && record["debounceMs"] === settings.debounceMs
    && record["maxSuggestions"] === settings.maxSuggestions
    && record["minimumConfidence"] === settings.minimumConfidence
    && arraysEqual(record["excludedFolders"], settings.excludedFolders)
    && arraysEqual(record["excludedFiles"], settings.excludedFiles)
    && arraysEqual(record["excludedTags"], settings.excludedTags)
    && arraysEqual(record["excludedProperties"], settings.excludedProperties)
    && record["linkPathMode"] === settings.linkPathMode;
}

function arraysEqual(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}
