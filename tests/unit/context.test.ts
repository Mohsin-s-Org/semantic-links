import assert from "node:assert/strict";
import test from "node:test";
import { extractSuggestionContext } from "../../src/editor/context.ts";

test("extracts the active sentence with one neighbour on each side", () => {
  const documentText = "First paragraph.\n\nPlants need sunlight. Plants lose water through their leaves. This is transpiration.\n\nLast.";
  const cursor = documentText.indexOf("water") + 2;
  const context = extractSuggestionContext(documentText, cursor, cursor, cursor);

  assert.equal(context?.anchor.text, "water");
  assert.equal(context?.selection, null);
  assert.equal(context?.previousSentence, "Plants need sunlight.");
  assert.equal(context?.sentence, "Plants lose water through their leaves.");
  assert.equal(context?.nextSentence, "This is transpiration.");
  assert.equal(
    context?.paragraph,
    "Plants need sunlight. Plants lose water through their leaves. This is transpiration."
  );
});

test("uses a trimmed single-line selection as the explicit focus", () => {
  const documentText = "Earlier context. Read about  water movement  today. Later context.";
  const from = documentText.indexOf("  water");
  const to = documentText.indexOf("  today");
  const context = extractSuggestionContext(documentText, from, to, to);

  assert.equal(context?.anchor.text, "water movement");
  assert.equal(context?.selection, "water movement");
  assert.equal(context?.anchor.start, documentText.indexOf("water"));
  assert.equal(context?.previousSentence, "Earlier context.");
  assert.equal(context?.nextSentence, "Later context.");
});

test("handles the first and last sentence without synthetic neighbours", () => {
  const documentText = "First sentence. Middle sentence. Last sentence.";
  const first = documentText.indexOf("First") + 2;
  const last = documentText.indexOf("Last") + 2;
  const firstContext = extractSuggestionContext(documentText, first, first, first);
  const lastContext = extractSuggestionContext(documentText, last, last, last);

  assert.equal(firstContext?.previousSentence, null);
  assert.equal(firstContext?.sentence, "First sentence.");
  assert.equal(firstContext?.nextSentence, "Middle sentence.");
  assert.equal(lastContext?.previousSentence, "Middle sentence.");
  assert.equal(lastContext?.sentence, "Last sentence.");
  assert.equal(lastContext?.nextSentence, null);
});

test("handles Arabic punctuation without requiring following whitespace", () => {
  const documentText = "هذا تمهيد.هل الماء مهم؟نعم الماء أساس الحياة!";
  const cursor = documentText.indexOf("مهم") + 1;
  const context = extractSuggestionContext(documentText, cursor, cursor, cursor);

  assert.equal(context?.previousSentence, "هذا تمهيد.");
  assert.equal(context?.sentence, "هل الماء مهم؟");
  assert.equal(context?.nextSentence, "نعم الماء أساس الحياة!");
});

test("preserves repeated neighbouring text as separate sentence roles", () => {
  const documentText = "Water matters. Water matters. Water matters.";
  const cursor = documentText.indexOf("Water", 15) + 2;
  const context = extractSuggestionContext(documentText, cursor, cursor, cursor);

  assert.equal(context?.previousSentence, "Water matters.");
  assert.equal(context?.sentence, "Water matters.");
  assert.equal(context?.nextSentence, "Water matters.");
});

test("rejects multiline selections and protected links", () => {
  const multiline = "water\nmovement";
  assert.equal(extractSuggestionContext(multiline, 0, multiline.length, multiline.length), null);

  const linked = "Read [[water movement]] today.";
  const from = linked.indexOf("water");
  const to = from + "water movement".length;
  assert.equal(extractSuggestionContext(linked, from, to, to), null);
});
