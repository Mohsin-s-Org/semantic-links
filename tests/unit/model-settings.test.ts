import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_VERSION } from "../../src/constants.ts";
import { loadAndMigrateSettings } from "../../src/settings/schema.ts";

test("does not enable a model that is not installed", () => {
  const result = loadAndMigrateSettings({
    settingsVersion: SETTINGS_VERSION,
    semanticModelInstalled: false,
    semanticModelEnabled: true
  });

  assert.equal(result.settings.semanticModelInstalled, false);
  assert.equal(result.settings.semanticModelEnabled, false);
});

test("preserves an installed and enabled model", () => {
  const result = loadAndMigrateSettings({
    settingsVersion: SETTINGS_VERSION,
    semanticModelInstalled: true,
    semanticModelEnabled: true
  });

  assert.equal(result.settings.semanticModelInstalled, true);
  assert.equal(result.settings.semanticModelEnabled, true);
});
