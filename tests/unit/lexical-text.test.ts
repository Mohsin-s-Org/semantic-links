import assert from "node:assert/strict";
import test from "node:test";
import {
  lexicalSimilarity,
  normalizeLexicalText,
  stripMarkdownForLexicalIndex
} from "../../src/lexical/text.ts";

test("normalizes Unicode, punctuation and Arabic diacritics", () => {
  assert.equal(normalizeLexicalText("ٱلْمَاءُ"), "الماء");
  assert.equal(normalizeLexicalText("Water—Cycle"), "water cycle");
});

test("gives useful similarity for a transposed spelling", () => {
  assert.ok(lexicalSimilarity("hydration", "hydratoin") > 0.5);
});

test("removes protected Markdown while keeping visible link labels", () => {
  const indexed = stripMarkdownForLexicalIndex([
    "---",
    "title: Hidden metadata",
    "---",
    "Use `hidden code` and visible [water cycle](https://example.com).",
    "```ts",
    "const secret = true;",
    "```"
  ].join("\n"));

  assert.equal(indexed.includes("Hidden metadata"), false);
  assert.equal(indexed.includes("hidden code"), false);
  assert.equal(indexed.includes("secret"), false);
  assert.equal(indexed.includes("https://"), false);
  assert.equal(indexed.includes("water cycle"), true);
});
