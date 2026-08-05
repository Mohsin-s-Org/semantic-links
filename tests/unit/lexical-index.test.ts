import assert from "node:assert/strict";
import test from "node:test";
import { LexicalIndex } from "../../src/lexical/index.ts";
import type { LexicalDocumentInput } from "../../src/lexical/types.ts";

function createDocument(
  path: string,
  title: string,
  body: string,
  overrides: Partial<LexicalDocumentInput> = {}
): LexicalDocumentInput {
  return {
    path,
    title,
    basename: title,
    aliases: [],
    headings: [],
    tags: [],
    body,
    ...overrides
  };
}

test("ranks titles, aliases, headings, tags, fuzzy labels and body text", () => {
  const index = new LexicalIndex();
  index.upsert(createDocument(
    "Hydration.md",
    "Hydration",
    "Drinking enough water supports the body.",
    { aliases: ["Water intake"], tags: ["health"] }
  ));
  index.upsert(createDocument(
    "Cycle.md",
    "Water cycle",
    "Water returns to the atmosphere.",
    { headings: [{ text: "Evaporation", level: 2 }] }
  ));
  index.upsert(createDocument(
    "Plants.md",
    "Plant transpiration",
    "Plants lose water through their leaves."
  ));

  assert.equal(search(index, "water intake")[0]?.targetPath, "Hydration.md");
  assert.ok(search(index, "water intake")[0]?.matchKinds.includes("alias"));
  assert.equal(search(index, "evaporation")[0]?.targetHeading, "Evaporation");
  assert.equal(search(index, "transpiraton", "plant transpiraton")[0]?.targetPath, "Plants.md");
  assert.equal(search(index, "health")[0]?.targetPath, "Hydration.md");
  assert.equal(search(index, "atmosphere", "water returns atmosphere")[0]?.targetPath, "Cycle.md");
});

test("excludes the source note and removes stale postings", () => {
  const index = new LexicalIndex();
  index.upsert(createDocument("A.md", "Water", "water water"));
  index.upsert(createDocument("B.md", "Other", "water"));

  assert.equal(search(index, "water", "water", "A.md")[0]?.targetPath, "B.md");
  index.remove("B.md");
  assert.deepEqual(search(index, "water", "water", "A.md"), []);
});

test("tracks exact labels through replacements", () => {
  const index = new LexicalIndex();
  index.upsert(createDocument("A.md", "Old title", "body", { aliases: ["Old alias"] }));
  assert.equal(index.hasExactLabel("Old alias"), true);

  index.upsert(createDocument("A.md", "New title", "body"));
  assert.equal(index.hasExactLabel("Old alias"), false);
  assert.equal(index.hasExactLabel("New title"), true);
});

function search(
  index: LexicalIndex,
  anchorText: string,
  contextText = anchorText,
  sourcePath = "Source.md"
) {
  return index.search({
    anchorText,
    contextText,
    sourcePath,
    limit: 6,
    minimumScore: 0.5
  });
}
