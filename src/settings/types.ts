import type { SETTINGS_VERSION } from "../constants.ts";

export type LinkPathMode = "shortest" | "full";

export interface SemanticLinksSettings {
  settingsVersion: typeof SETTINGS_VERSION;
  automaticSuggestions: boolean;
  lexicalMatchingEnabled: boolean;
  semanticIndexingEnabled: boolean;
  debounceMs: number;
  maxSuggestions: number;
  minimumConfidence: number;
  excludedFolders: string[];
  excludedFiles: string[];
  excludedTags: string[];
  excludedProperties: string[];
  linkPathMode: LinkPathMode;
}

export interface SettingsLoadResult {
  settings: SemanticLinksSettings;
  needsSave: boolean;
}
