import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_VERSION } from "../../src/constants.ts";
import { loadAndMigrateSettings } from "../../src/settings/schema.ts";

test("missing settings load safe lexical-only defaults", () => {
  const result = loadAndMigrateSettings(null);

  assert.equal(result.needsSave, false);
  assert.equal(result.settings.settingsVersion, SETTINGS_VERSION);
  assert.equal(result.settings.lexicalMatchingEnabled, true);
  assert.equal(result.settings.semanticIndexingEnabled, false);
  assert.deepEqual(result.settings.excludedFolders, []);
});

test("malformed settings are discarded and replaced", () => {
  const result = loadAndMigrateSettings("not-an-object");

  assert.equal(result.needsSave, true);
  assert.equal(result.settings.automaticSuggestions, true);
});

test("legacy settings migrate and invalid values are repaired", () => {
  const result = loadAndMigrateSettings({
    semanticMatchingEnabled: true,
    debounceMs: 50,
    maxSuggestions: 999,
    minimumConfidence: -4,
    excludedFolders: ["Archive", "Archive", 42, ""],
    excludedTags: ["#private", "private"]
  });

  assert.equal(result.needsSave, true);
  assert.equal(result.settings.semanticIndexingEnabled, true);
  assert.equal(result.settings.debounceMs, 100);
  assert.equal(result.settings.maxSuggestions, 20);
  assert.equal(result.settings.minimumConfidence, 0);
  assert.deepEqual(result.settings.excludedFolders, ["Archive"]);
  assert.deepEqual(result.settings.excludedTags, ["private"]);
});

test("invalid values in the current schema are persisted after repair", () => {
  const result = loadAndMigrateSettings({
    settingsVersion: SETTINGS_VERSION,
    automaticSuggestions: true,
    lexicalMatchingEnabled: true,
    semanticIndexingEnabled: false,
    debounceMs: "invalid",
    maxSuggestions: 6,
    minimumConfidence: 0.55,
    excludedFolders: [],
    excludedTags: [],
    linkPathMode: "shortest"
  });

  assert.equal(result.needsSave, true);
  assert.equal(result.settings.debounceMs, 350);
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
