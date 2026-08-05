import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_SUGGESTIONS,
  MAX_DEBOUNCE_MS,
  MAX_SUGGESTIONS,
  MIN_DEBOUNCE_MS,
  MIN_SUGGESTIONS,
  SETTINGS_VERSION
} from "../constants.ts";
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
  SettingsLoadResult
} from "./types.ts";

const LINK_PATH_MODES = ["shortest", "full"] as const;
const SETTING_KEYS = new Set<keyof SemanticLinksSettings>([
  "settingsVersion",
  "automaticSuggestions",
  "lexicalMatchingEnabled",
  "semanticIndexingEnabled",
  "debounceMs",
  "maxSuggestions",
  "minimumConfidence",
  "excludedFolders",
  "excludedTags",
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
    excludedTags: normalizeTags(readStringList(
      input,
      "excludedTags",
      DEFAULT_SETTINGS.excludedTags
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
  return [...new Set(tags
    .map((tag) => tag.replace(/^#/u, ""))
    .filter((tag) => tag.length > 0))];
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
    && record["debounceMs"] === settings.debounceMs
    && record["maxSuggestions"] === settings.maxSuggestions
    && record["minimumConfidence"] === settings.minimumConfidence
    && arraysEqual(record["excludedFolders"], settings.excludedFolders)
    && arraysEqual(record["excludedTags"], settings.excludedTags)
    && record["linkPathMode"] === settings.linkPathMode;
}

function arraysEqual(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}
