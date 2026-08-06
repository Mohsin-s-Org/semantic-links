import assert from "node:assert/strict";
import test from "node:test";
import {
  hasEnabledMatching,
  shouldRunLexicalMatching
} from "../../src/retrieval/matching-policy.ts";

test("allows lexical, semantic, or hybrid matching independently", () => {
  assert.equal(hasEnabledMatching(settings(true, false)), true);
  assert.equal(hasEnabledMatching(settings(false, true)), true);
  assert.equal(hasEnabledMatching(settings(true, true)), true);
  assert.equal(hasEnabledMatching(settings(false, false)), false);
});

test("runs the lexical search only when its toggle is enabled", () => {
  assert.equal(shouldRunLexicalMatching(settings(true, false)), true);
  assert.equal(shouldRunLexicalMatching(settings(false, true)), false);
});

function settings(
  lexicalMatchingEnabled: boolean,
  semanticModelEnabled: boolean
) {
  return { lexicalMatchingEnabled, semanticModelEnabled };
}
