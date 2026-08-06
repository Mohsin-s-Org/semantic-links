import type { SETTINGS_VERSION } from "../constants.ts";
import type {
  ThreadDeviceClass,
  WasmThreadCount
} from "../embeddings/thread-tuning.ts";

export type LinkPathMode = "shortest" | "full";
export type SemanticThreadMode = "automatic" | "tuned";

export interface SemanticLinksSettings {
  settingsVersion: typeof SETTINGS_VERSION;
  automaticSuggestions: boolean;
  lexicalMatchingEnabled: boolean;
  semanticIndexingEnabled: boolean;
  semanticModelEnabled: boolean;
  semanticModelInstalled: boolean;
  semanticThreadMode: SemanticThreadMode;
  semanticThreadCount: WasmThreadCount;
  semanticThreadModelRevision: string;
  semanticThreadRuntimeVersion: string;
  semanticThreadDeviceClass: ThreadDeviceClass;
  backgroundEmbeddingBatchLimit: number;
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
