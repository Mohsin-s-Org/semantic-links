import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_SUGGESTIONS,
  SETTINGS_VERSION
} from "../constants.ts";
import type { SemanticLinksSettings } from "./types.ts";

export const DEFAULT_SETTINGS: Readonly<SemanticLinksSettings> = Object.freeze({
  settingsVersion: SETTINGS_VERSION,
  automaticSuggestions: true,
  lexicalMatchingEnabled: true,
  semanticIndexingEnabled: false,
  debounceMs: DEFAULT_DEBOUNCE_MS,
  maxSuggestions: DEFAULT_MAX_SUGGESTIONS,
  minimumConfidence: 0.55,
  excludedFolders: [],
  excludedTags: [],
  linkPathMode: "shortest"
});

export function createDefaultSettings(): SemanticLinksSettings {
  return {
    ...DEFAULT_SETTINGS,
    excludedFolders: [],
    excludedTags: []
  };
}
