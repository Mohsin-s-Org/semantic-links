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
import type { SettingsLoadResult } from "./types.ts";

const LINK_PATH_MODES = ["shortest", "full"] as const;

function readLegacySemanticToggle(record: Record<string, unknown>): boolean {
  const current = record["semanticIndexingEnabled"];
  if (typeof current === "boolean") {
    return current;
  }

  const previous = record["semanticMatchingEnabled"];
  if (typeof previous === "boolean") {
    return previous;
  }

  const earliest = record["enableSemanticSearch"];
  return typeof earliest === "boolean"
    ? earliest
    : DEFAULT_SETTINGS.semanticIndexingEnabled;
}

export function loadAndMigrateSettings(input: unknown): SettingsLoadResult {
  if (!isRecord(input)) {
    return {
      settings: createDefaultSettings(),
      migrated: input !== null && input !== undefined,
      warnings: input === null || input === undefined
        ? []
        : ["Stored settings were not an object and were reset to safe defaults."]
    };
  }

  const warnings: string[] = [];
  const rawVersion = input["settingsVersion"];
  const version = typeof rawVersion === "number" && Number.isInteger(rawVersion)
    ? rawVersion
    : 0;

  if (version > SETTINGS_VERSION) {
    warnings.push(
      "Stored settings were created by a newer plugin version. Unknown values were ignored."
    );
  } else if (version < SETTINGS_VERSION) {
    warnings.push(`Migrated settings schema ${version} to ${SETTINGS_VERSION}.`);
  }

  return {
    settings: {
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
      semanticIndexingEnabled: readLegacySemanticToggle(input),
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
      excludedTags: readStringList(
        input,
        "excludedTags",
        DEFAULT_SETTINGS.excludedTags
      ),
      linkPathMode: readEnum(
        input,
        "linkPathMode",
        LINK_PATH_MODES,
        DEFAULT_SETTINGS.linkPathMode
      )
    },
    migrated: version !== SETTINGS_VERSION,
    warnings
  };
}
