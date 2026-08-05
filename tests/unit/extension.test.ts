import assert from "node:assert/strict";
import test from "node:test";
import { isContextChange } from "../../src/editor/extension.ts";

test("document and cursor-only changes refresh the active context", () => {
  assert.equal(isContextChange({ docChanged: true, selectionSet: false }), true);
  assert.equal(isContextChange({ docChanged: false, selectionSet: true }), true);
  assert.equal(isContextChange({ docChanged: false, selectionSet: false }), false);
});
