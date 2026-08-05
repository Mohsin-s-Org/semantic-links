import assert from "node:assert/strict";
import test from "node:test";
import {
  createChunkId,
  createDocumentId
} from "../../src/indexing/hash.ts";

test("document ids are path-stable and case-insensitive", () => {
  assert.equal(createDocumentId("Notes/Water.md"), createDocumentId("notes/water.md"));
  assert.notEqual(createDocumentId("Notes/Water.md"), createDocumentId("Notes/Fire.md"));
});

test("passage ids depend on semantic identity rather than source offsets", () => {
  const documentId = createDocumentId("Notes/Water.md");
  const first = createChunkId(
    documentId,
    ["Water cycle", "Evaporation"],
    "passage: Water\nWater cycle > Evaporation\nLiquid water becomes vapour.",
    0
  );
  const same = createChunkId(
    documentId,
    ["Water cycle", "Evaporation"],
    "passage: Water\nWater cycle > Evaporation\nLiquid water becomes vapour.",
    0
  );
  const duplicate = createChunkId(
    documentId,
    ["Water cycle", "Evaporation"],
    "passage: Water\nWater cycle > Evaporation\nLiquid water becomes vapour.",
    1
  );

  assert.equal(first, same);
  assert.notEqual(first, duplicate);
});
