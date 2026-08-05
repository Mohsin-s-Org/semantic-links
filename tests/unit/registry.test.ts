import assert from "node:assert/strict";
import test from "node:test";
import type { EditorView } from "@codemirror/view";
import { EditorSuggestionController } from "../../src/editor/controller.ts";
import { EditorControllerRegistry } from "../../src/editor/registry.ts";

test("the registry never returns an editor that has lost focus", () => {
  const viewState = { hasFocus: true };
  const view = viewState as unknown as EditorView;
  const registry = new EditorControllerRegistry();

  registry.register(view, new EditorSuggestionController());
  registry.setActive(view);
  assert.notEqual(registry.getActive(), null);

  viewState.hasFocus = false;
  assert.equal(registry.getActive(), null);

  registry.dispose();
});
