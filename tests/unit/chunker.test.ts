import assert from "node:assert/strict";
import test from "node:test";
import { chunkMarkdown } from "../../src/indexing/chunker.ts";
import { tokenizeLexicalText } from "../../src/lexical/text.ts";

test("chunks by headings while excluding protected Markdown", () => {
  const markdown = [
    "---",
    "private: hidden metadata",
    "---",
    "# Water cycle",
    "Water moves through evaporation and condensation. This visible paragraph explains movement through the atmosphere and back to the ground.",
    "",
    "```dataview",
    "TABLE secret FROM #private",
    "```",
    "",
    "<div class=\"private-widget\">",
    "hidden HTML block content",
    "</div>",
    "",
    "## Evaporation",
    "Liquid water becomes vapour when energy increases. `privateCode()` and [[Existing link]] are not passage text.",
    "",
    "$$",
    "hidden = equation",
    "$$"
  ].join("\n");

  const chunks = chunkMarkdown(markdown, "Hydrology", {
    minimumWords: 4,
    targetWords: 18,
    maximumWords: 30
  });

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0]?.headingPath, ["Water cycle"]);
  assert.deepEqual(chunks[1]?.headingPath, ["Water cycle", "Evaporation"]);
  const indexed = chunks.map((chunk) => chunk.embeddingText).join("\n");
  assert.match(indexed, /passage: Hydrology/u);
  assert.equal(indexed.includes("hidden metadata"), false);
  assert.equal(indexed.includes("TABLE secret"), false);
  assert.equal(indexed.includes("hidden HTML"), false);
  assert.equal(indexed.includes("privateCode"), false);
  assert.equal(indexed.includes("Existing link"), false);
  assert.equal(indexed.includes("hidden = equation"), false);
  assert.ok((chunks[0]?.startOffset ?? -1) < (chunks[0]?.endOffset ?? -1));
  assert.ok((chunks[0]?.startLine ?? 0) >= 5);
});

test("recognizes Setext sections and longer closing fences", () => {
  const chunks = chunkMarkdown([
    "Water cycle",
    "===========",
    "Visible water movement appears in this section.",
    "",
    "```js",
    "hiddenCode();",
    "````",
    "",
    "Evaporation",
    "-----------",
    "Visible vapour movement appears in this subsection."
  ].join("\n"), "Hydrology", {
    minimumWords: 1,
    targetWords: 20,
    maximumWords: 40
  });

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0]?.headingPath, ["Water cycle"]);
  assert.deepEqual(chunks[1]?.headingPath, ["Water cycle", "Evaporation"]);
  assert.equal(
    chunks.some((chunk) => chunk.embeddingText.includes("hiddenCode")),
    false
  );
});

test("splits oversized prose at sentence boundaries with one-sentence overlap", () => {
  const sentences = Array.from({ length: 10 }, (_, index) => {
    return `Sentence ${index + 1} contains several meaningful words about plants water sunlight and growth.`;
  });
  const chunks = chunkMarkdown(sentences.join(" "), "Plant biology", {
    minimumWords: 5,
    targetWords: 24,
    maximumWords: 32
  });

  assert.ok(chunks.length > 2);
  for (const chunk of chunks) {
    assert.ok(tokenizeLexicalText(chunk.text).length <= 32);
  }
  const firstLastSentence = chunks[0]?.text.match(/Sentence \d+[^.]*\./gu)?.at(-1);
  assert.ok(firstLastSentence !== undefined);
  assert.equal(chunks[1]?.text.includes(firstLastSentence), true);
});

test("never exceeds the maximum when an overlap would be too large", () => {
  const sentence = (label: string, words: number): string => {
    return `${label} ${Array.from({ length: words - 1 }, () => label).join(" ")}.`;
  };
  const chunks = chunkMarkdown([
    sentence("alpha", 20),
    sentence("beta", 20),
    sentence("gamma", 5)
  ].join(" "), "Uneven prose", {
    minimumWords: 1,
    targetWords: 25,
    maximumWords: 30
  });

  assert.equal(chunks.length, 2);
  assert.deepEqual(
    chunks.map((chunk) => tokenizeLexicalText(chunk.text).length),
    [20, 25]
  );
});
