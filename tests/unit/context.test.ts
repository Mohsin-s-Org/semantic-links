import assert from "node:assert/strict";
import test from "node:test";
import { extractSuggestionContext } from "../../src/editor/context.ts";

test("extracts the active sentence and paragraph around a word", () => {
  const documentText = "First paragraph.\n\nPlants lose water through their leaves. This is transpiration.\n\nLast.";
  const cursor = documentText.indexOf("water") + 2;
  const context = extractSuggestionContext(documentText, cursor, cursor, cursor);

  assert.equal(context?.anchor.text, "water");
  assert.equal(context?.sentence, "Plants lose water through their leaves.");
  assert.equal(
    context?.paragraph,
    "Plants lose water through their leaves. This is transpiration."
  );
});

test("uses a trimmed single-line selection as the insertion anchor", () => {
  const documentText = "Read about  water movement  today.";
  const from = documentText.indexOf("  water");
  const to = documentText.indexOf("  today");
  const context = extractSuggestionContext(documentText, from, to, to);

  assert.equal(context?.anchor.text, "water movement");
  assert.equal(context?.anchor.start, documentText.indexOf("water"));
});

test("rejects multiline selections and protected links", () => {
  const multiline = "water\nmovement";
  assert.equal(extractSuggestionContext(multiline, 0, multiline.length, multiline.length), null);

  const linked = "Read [[water movement]] today.";
  const from = linked.indexOf("water");
  const to = from + "water movement".length;
  assert.equal(extractSuggestionContext(linked, from, to, to), null);
});
