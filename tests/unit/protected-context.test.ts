import assert from "node:assert/strict";
import test from "node:test";
import { findTextAnchor } from "../../src/editor/anchor.ts";
import { isProtectedAnchor } from "../../src/editor/protected-context.ts";

const protectedExamples = [
  "---\ntag: water\n---\nBody text",
  "```ts\nconst water = 1;\n```",
  "Use `water` here",
  "Visit https://example.com/water today",
  "Read [[Water cycle|water]] today",
  "Read [water](Water.md) today",
  "The value is $water$ today",
  "$$\nwater\n$$",
  "<div>water</div>",
  "<div>\nwater\n</div>",
  "<!-- water -->",
  "<!--\nwater\n-->"
];

test("protected Markdown ranges do not produce anchors", () => {
  for (const documentText of protectedExamples) {
    const start = documentText.indexOf("water");
    assert.notEqual(start, -1);
    assert.equal(isProtectedAnchor(documentText, start, start + 5), true);
    assert.equal(findTextAnchor(documentText, start + 2), null);
  }
});

test("normal prose remains eligible", () => {
  const documentText = "Plants lose water through leaves.";
  const start = documentText.indexOf("water");

  assert.equal(isProtectedAnchor(documentText, start, start + 5), false);
  assert.equal(findTextAnchor(documentText, start + 2)?.text, "water");
});

test("escaped math delimiters do not protect prose", () => {
  const documentText = "The price is \\$5 and water is normal.";
  const start = documentText.indexOf("water");

  assert.equal(isProtectedAnchor(documentText, start, start + 5), false);
});
