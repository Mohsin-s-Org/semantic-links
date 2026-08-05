import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { App } from "obsidian";
import {
  insertVerifiedWikilink,
  type TransactionEditor
} from "../../src/editor/insertion.ts";

class RecordingEditor implements TransactionEditor {
  state = EditorState.create({ doc: "Use `water` here." });
  dispatchCount = 0;

  dispatch(_spec: TransactionSpec): void {
    this.dispatchCount += 1;
  }
}

test("protected contexts are rejected again at acceptance time", () => {
  const editor = new RecordingEditor();
  const app = { metadataCache: {} } as unknown as App;
  const result = insertVerifiedWikilink(app, editor, {
    sourcePath: "Source.md",
    anchorStart: 5,
    anchorEnd: 10,
    expectedText: "water",
    targetPath: "Target.md",
    targetHeading: null,
    displayText: "water",
    pathMode: "shortest"
  });

  assert.deepEqual(result, { ok: false, code: "protected-context" });
  assert.equal(editor.dispatchCount, 0);
});
