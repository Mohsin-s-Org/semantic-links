import {
  Transaction,
  type Extension
} from "@codemirror/state";
import {
  ViewPlugin,
  type EditorView,
  type ViewUpdate
} from "@codemirror/view";
import { EditorSuggestionController } from "./controller.ts";
import { PLUGIN_LINK_INSERTION } from "./insertion.ts";
import type { EditorControllerRegistry } from "./registry.ts";

export type EditorContextChangeHandler = (
  view: EditorView,
  controller: EditorSuggestionController,
  documentVersion: number
) => void;

export function isContextChange(
  update: Pick<ViewUpdate, "docChanged" | "selectionSet">
): boolean {
  return update.docChanged || update.selectionSet;
}

export function createControllerExtension(
  registry: EditorControllerRegistry,
  onContextChanged: EditorContextChangeHandler
): Extension {
  return ViewPlugin.fromClass(class {
    private readonly controller = new EditorSuggestionController();
    private readonly view: EditorView;
    private documentVersion = 0;

    constructor(view: EditorView) {
      this.view = view;
      registry.register(view, this.controller);
      if (view.hasFocus) {
        registry.setActive(view);
      }
    }

    update(update: ViewUpdate): void {
      this.controller.setComposing(update.view.composing);
      if (update.view.hasFocus) {
        registry.setActive(update.view);
      } else if (update.focusChanged) {
        registry.clearActive(update.view);
        this.controller.invalidate();
      }

      if (!isContextChange(update)) {
        return;
      }

      if (update.docChanged) {
        this.documentVersion += 1;
      }

      for (const transaction of update.transactions) {
        if (transaction.annotation(PLUGIN_LINK_INSERTION) === true) {
          this.controller.notePluginTransaction();
          return;
        }

        const event = transaction.annotation(Transaction.userEvent);
        if (event?.startsWith("undo") === true || event?.startsWith("redo") === true) {
          this.controller.noteUndoRedo();
          return;
        }
      }

      if (update.view.hasFocus && !update.view.composing) {
        onContextChanged(update.view, this.controller, this.documentVersion);
      }
    }

    destroy(): void {
      registry.unregister(this.view);
    }
  });
}
