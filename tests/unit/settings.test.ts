import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_VERSION } from "../../src/constants.ts";
import { loadAndMigrateSettings } from "../../src/settings/schema.ts";

test("missing settings load safe lexical-only defaults", () => {
  const result = loadAndMigrateSettings(null);

  assert.equal(result.migrated, false);
  assert.equal(result.settings.settingsVersion, SETTINGS_VERSION);
  assert.equal(result.settings.lexicalMatchingEnabled, true);
  assert.equal(result.settings.semanticIndexingEnabled, false);
  assert.deepEqual(result.settings.excludedFolders, []);
});

test("malformed settings are discarded instead of trusted", () => {
  const result = loadAndMigrateSettings("not-an-object");

  assert.equal(result.migrated, true);
  assert.equal(result.settings.automaticSuggestions, true);
  assert.equal(result.warnings.length, 1);
});

test("legacy semantic toggle migrates and numeric values are clamped", () => {
  const result = loadAndMigrateSettings({
    semanticMatchingEnabled: true,
    debounceMs: 50,
    maxSuggestions: 999,
    minimumConfidence: -4,
    excludedFolders: ["Archive", "Archive", 42, ""],
    excludedTags: ["private", "private"]
  });

  assert.equal(result.migrated, true);
  assert.equal(result.settings.semanticIndexingEnabled, true);
  assert.equal(result.settings.debounceMs, 100);
  assert.equal(result.settings.maxSuggestions, 20);
  assert.equal(result.settings.minimumConfidence, 0);
  assert.deepEqual(result.settings.excludedFolders, ["Archive"]);
  assert.deepEqual(result.settings.excludedTags, ["private"]);
});

test("future schemas keep recognized safe values and ignore unknown keys", () => {
  const result = loadAndMigrateSettings({
    settingsVersion: 99,
    automaticSuggestions: false,
    linkPathMode: "full",
    untrustedExecutable: "ignored"
  });

  assert.equal(result.settings.settingsVersion, SETTINGS_VERSION);
  assert.equal(result.settings.automaticSuggestions, false);
  assert.equal(result.settings.linkPathMode, "full");
  assert.match(result.warnings[0] ?? "", /newer plugin version/u);
});
