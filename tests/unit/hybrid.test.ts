import assert from "node:assert/strict";
import test from "node:test";
import { mergeHybridSuggestions } from "../../src/retrieval/hybrid.ts";

test("returns semantic-only suggestions", () => {
  const result = mergeHybridSuggestions([], [{
    targetPath: "Hydration.md",
    targetTitle: "Hydration",
    targetHeading: null,
    similarity: 0.82,
    preview: "Drinking enough water supports normal function."
  }], 3);

  assert.equal(result[0]?.targetPath, "Hydration.md");
  assert.deepEqual(result[0]?.matchKinds, ["semantic"]);
});

test("boosts a destination found by lexical and semantic retrieval", () => {
  const result = mergeHybridSuggestions([{
    targetPath: "Water.md",
    targetTitle: "Water",
    targetHeading: null,
    score: 0.7,
    matchKinds: ["title"],
    preview: null
  }], [{
    targetPath: "Water.md",
    targetTitle: "Water",
    targetHeading: null,
    similarity: 0.9,
    preview: "Water is essential for hydration."
  }], 3);

  assert.equal(result.length, 1);
  assert.ok((result[0]?.score ?? 0) > 0.7);
  assert.deepEqual(result[0]?.matchKinds, ["title", "semantic"]);
});
