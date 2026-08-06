import assert from "node:assert/strict";
import test from "node:test";
import type { SuggestionContext } from "../../src/editor/context.ts";
import {
  buildSemanticQueryContext,
  canonicalizeSemanticWhitespace
} from "../../src/retrieval/semantic-query-context.ts";

test("builds the production title, focus and neighbour window without paragraph duplication", () => {
  const result = buildSemanticQueryContext("Water Notes", context());

  assert.equal(result.variant, "title-focus-neighbours");
  assert.equal(result.focus, "Water moves through leaves.");
  assert.equal(result.componentCount, 4);
  assert.equal(result.text, [
    "Note: Water Notes",
    "Previous: Roots absorb water.",
    "Focus: Water moves through leaves.",
    "Next: This process is transpiration."
  ].join("\n"));
  assert.equal(result.text.includes("The full paragraph"), false);
});

test("prefers an explicit selection without silently replacing it", () => {
  const selected = context({
    selection: "water   movement",
    sentence: "Read about water movement today."
  });
  const result = buildSemanticQueryContext("Notes", selected);

  assert.equal(result.focus, "water movement");
  assert.match(result.text, /Focus: water movement/u);
  assert.equal(result.text.includes("Focus: Read about"), false);
});

test("exposes all required evaluation variants", () => {
  const input = context();

  assert.equal(
    buildSemanticQueryContext("Water", input, "legacy-title-sentence-paragraph").text,
    [
      "Note: Water",
      "Sentence: Water moves through leaves.",
      "Paragraph: The full paragraph contains Water moves through leaves. and more."
    ].join("\n")
  );
  assert.equal(
    buildSemanticQueryContext("Water", input, "focus-only").text,
    "Focus: Water moves through leaves."
  );
  assert.equal(
    buildSemanticQueryContext("Water", input, "title-focus").text,
    "Note: Water\nFocus: Water moves through leaves."
  );
});

test("omits unavailable first or last neighbours structurally", () => {
  const first = buildSemanticQueryContext("Notes", context({ previousSentence: null }));
  const last = buildSemanticQueryContext("Notes", context({ nextSentence: null }));

  assert.equal(first.text.includes("Previous:"), false);
  assert.equal(first.componentCount, 3);
  assert.equal(last.text.includes("Next:"), false);
  assert.equal(last.componentCount, 3);
});

test("preserves meaningful repeated text in separate roles", () => {
  const repeated = buildSemanticQueryContext("Water matters.", context({
    previousSentence: "Water matters.",
    sentence: "Water matters.",
    nextSentence: "Water matters."
  }));

  assert.equal(repeated.text.match(/Water matters\./gu)?.length, 4);
});

test("canonicalises equivalent English, Arabic and mixed whitespace", () => {
  assert.equal(canonicalizeSemanticWhitespace("  water\n\tplanning  "), "water planning");
  assert.equal(canonicalizeSemanticWhitespace("  ترشيد   المياه  "), "ترشيد المياه");
  assert.equal(
    canonicalizeSemanticWhitespace("water   والمياه\nplanning"),
    "water والمياه planning"
  );
});

function context(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    anchor: {
      start: 0,
      end: 5,
      text: "Water",
      context: "Water",
      contextHash: "hash"
    },
    selection: null,
    previousSentence: "Roots absorb water.",
    sentence: "Water moves through leaves.",
    nextSentence: "This process is transpiration.",
    paragraph: "The full paragraph contains Water moves through leaves. and more.",
    searchText: "Water moves through leaves.\nThe full paragraph contains Water moves through leaves. and more.",
    ...overrides
  };
}
