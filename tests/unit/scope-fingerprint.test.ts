import assert from "node:assert/strict";
import test from "node:test";
import { createIndexScopeFingerprint } from "../../src/indexing/scope-fingerprint.ts";

test("normalizes ordering, case and path separators", () => {
  const first = createIndexScopeFingerprint({
    excludedFolders: ["Private", "Archive\\Old"],
    excludedFiles: ["Notes/Secret.md"],
    excludedTags: ["Draft", "PRIVATE"],
    excludedProperties: ["No-Index"]
  });
  const second = createIndexScopeFingerprint({
    excludedFolders: ["archive/old", "private"],
    excludedFiles: ["notes/secret.md"],
    excludedTags: ["private", "draft"],
    excludedProperties: ["no-index"]
  });

  assert.equal(first, second);
});

test("changes whenever persisted inclusion rules change", () => {
  const baseline = createIndexScopeFingerprint({
    excludedFolders: [],
    excludedFiles: [],
    excludedTags: [],
    excludedProperties: []
  });
  const excluded = createIndexScopeFingerprint({
    excludedFolders: [],
    excludedFiles: ["Private.md"],
    excludedTags: [],
    excludedProperties: []
  });

  assert.notEqual(baseline, excluded);
});
