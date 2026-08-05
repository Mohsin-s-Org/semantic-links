import assert from "node:assert/strict";
import test from "node:test";
import {
  createContextHash,
  isSuggestionRequestKey
} from "../../src/editor/request-key.ts";

const validKey = {
  filePath: "Notes/source.md",
  documentVersion: 1,
  anchorStart: 4,
  anchorEnd: 9,
  anchorText: "water",
  contextHash: createContextHash("some water context"),
  mode: "automatic"
};

test("request keys include a valid anchor range and exact text", () => {
  assert.equal(isSuggestionRequestKey(validKey), true);
  assert.equal(isSuggestionRequestKey({ ...validKey, anchorText: "wrong" }), false);
  assert.equal(isSuggestionRequestKey({ ...validKey, anchorEnd: 4 }), false);
  assert.equal(isSuggestionRequestKey({ ...validKey, documentVersion: -1 }), false);
});
