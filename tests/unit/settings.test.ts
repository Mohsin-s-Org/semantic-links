import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BACKGROUND_BATCH_SIZE,
  MAX_BACKGROUND_BATCH_SIZE,
  SETTINGS_VERSION
} from "../../src/constants.ts";
import { loadAndMigrateSettings } from "../../src/settings/schema.ts";

test("missing settings load safe lexical-only automatic-thread defaults", () => {
  const result = loadAndMigrateSettings(null);

  assert.equal(result.needsSave, false);
  assert.equal(result.settings.settingsVersion, SETTINGS_VERSION);
  assert.equal(result.settings.lexicalMatchingEnabled, true);
  assert.equal(result.settings.semanticIndexingEnabled, false);
  assert.equal(result.settings.semanticThreadMode, "automatic");
  assert.equal(result.settings.semanticThreadCount, 0);
  assert.equal(
    result.settings.backgroundEmbeddingBatchLimit,
    DEFAULT_BACKGROUND_BATCH_SIZE
  );
  assert.deepEqual(result.settings.excludedFolders, []);
  assert.deepEqual(result.settings.excludedFiles, []);
  assert.deepEqual(result.settings.excludedProperties, []);
});

test("malformed settings are discarded and replaced", () => {
  const result = loadAndMigrateSettings("not-an-object");

  assert.equal(result.needsSave, true);
  assert.equal(result.settings.automaticSuggestions, true);
});

test("legacy settings migrate and invalid values are repaired", () => {
  const result = loadAndMigrateSettings({
    semanticMatchingEnabled: true,
    semanticThreadMode: "tuned",
    semanticThreadCount: 3,
    backgroundEmbeddingBatchLimit: 999,
    debounceMs: 50,
    maxSuggestions: 999,
    minimumConfidence: -4,
    excludedFolders: ["Archive", "Archive", 42, ""],
    excludedFiles: ["Private/Journal.md", "Private/Journal.md"],
    excludedTags: ["#private", "private"],
    excludedProperties: ["No-Index", "no-index", "Publish=FALSE"]
  });

  assert.equal(result.needsSave, true);
  assert.equal(result.settings.semanticIndexingEnabled, true);
  assert.equal(result.settings.semanticThreadMode, "automatic");
  assert.equal(result.settings.semanticThreadCount, 0);
  assert.equal(
    result.settings.backgroundEmbeddingBatchLimit,
    MAX_BACKGROUND_BATCH_SIZE
  );
  assert.equal(result.settings.debounceMs, 100);
  assert.equal(result.settings.maxSuggestions, 20);
  assert.equal(result.settings.minimumConfidence, 0);
  assert.deepEqual(result.settings.excludedFolders, ["Archive"]);
  assert.deepEqual(result.settings.excludedFiles, ["Private/Journal.md"]);
  assert.deepEqual(result.settings.excludedTags, ["private"]);
  assert.deepEqual(
    result.settings.excludedProperties,
    ["no-index", "publish=false"]
  );
});

test("invalid values in the current schema are persisted after repair", () => {
  const result = loadAndMigrateSettings(currentSettings({
    semanticThreadMode: "tuned",
    semanticThreadCount: 2,
    semanticThreadModelRevision: "",
    semanticThreadRuntimeVersion: "runtime",
    semanticThreadDeviceClass: "5-8",
    backgroundEmbeddingBatchLimit: 1,
    debounceMs: "invalid"
  }));

  assert.equal(result.needsSave, true);
  assert.equal(result.settings.debounceMs, 350);
  assert.equal(result.settings.semanticThreadMode, "automatic");
  assert.equal(result.settings.semanticThreadCount, 0);
  assert.equal(
    result.settings.backgroundEmbeddingBatchLimit,
    DEFAULT_BACKGROUND_BATCH_SIZE
  );
});

test("preserves valid learned batch and thread tuning", () => {
  const result = loadAndMigrateSettings(currentSettings({
    semanticThreadMode: "tuned",
    semanticThreadCount: 2,
    semanticThreadModelRevision: "model-revision",
    semanticThreadRuntimeVersion: "runtime-version",
    semanticThreadDeviceClass: "5-8",
    backgroundEmbeddingBatchLimit: 10
  }));

  assert.equal(result.needsSave, false);
  assert.equal(result.settings.backgroundEmbeddingBatchLimit, 10);
  assert.equal(result.settings.semanticThreadMode, "tuned");
  assert.equal(result.settings.semanticThreadCount, 2);
  assert.equal(result.settings.semanticThreadDeviceClass, "5-8");
});

test("future schemas are read defensively without overwriting them", () => {
  const result = loadAndMigrateSettings({
    settingsVersion: 99,
    automaticSuggestions: false,
    linkPathMode: "full",
    futureValue: "preserve on disk"
  });

  assert.equal(result.needsSave, false);
  assert.equal(result.settings.settingsVersion, SETTINGS_VERSION);
  assert.equal(result.settings.automaticSuggestions, false);
  assert.equal(result.settings.linkPathMode, "full");
});

function currentSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settingsVersion: SETTINGS_VERSION,
    automaticSuggestions: true,
    lexicalMatchingEnabled: true,
    semanticIndexingEnabled: false,
    semanticModelEnabled: false,
    semanticModelInstalled: false,
    semanticThreadMode: "automatic",
    semanticThreadCount: 0,
    semanticThreadModelRevision: "",
    semanticThreadRuntimeVersion: "",
    semanticThreadDeviceClass: "unknown",
    backgroundEmbeddingBatchLimit: DEFAULT_BACKGROUND_BATCH_SIZE,
    debounceMs: 350,
    maxSuggestions: 6,
    minimumConfidence: 0.55,
    excludedFolders: [],
    excludedFiles: [],
    excludedTags: [],
    excludedProperties: [],
    linkPathMode: "shortest",
    ...overrides
  };
}
