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
import { EditorControllerRegistry } from "./registry.ts";

export type EditorDocumentChangeHandler = (
  view: EditorView,
  controller: EditorSuggestionController,
  documentVersion: number
) => void;

export function createControllerExtension(
  registry: EditorControllerRegistry,
  onDocumentChanged: EditorDocumentChangeHandler
): Extension {
  return ViewPlugin.fromClass(class {
    private readonly controller = new EditorSuggestionController();
    private documentVersion = 0;

    constructor(private readonly view: EditorView) {
      registry.register(view, this.controller);
      if (view.hasFocus) {
        registry.setActive(view);
      }
    }

    update(update: ViewUpdate): void {
      this.controller.setComposing(update.view.composing);
      if (update.view.hasFocus) {
        registry.setActive(update.view);
      }

      if (!update.docChanged) {
        return;
      }

      this.documentVersion += 1;
      let pluginTransaction = false;
      let undoRedo = false;

      for (const transaction of update.transactions) {
        if (transaction.annotation(PLUGIN_LINK_INSERTION) === true) {
          pluginTransaction = true;
        }

        const userEvent = transaction.annotation(Transaction.userEvent);
        if (userEvent?.startsWith("undo") === true || userEvent?.startsWith("redo") === true) {
          undoRedo = true;
        }
      }

      if (pluginTransaction) {
        this.controller.notePluginTransaction();
        return;
      }

      if (undoRedo) {
        this.controller.noteUndoRedo();
        return;
      }

      if (update.view.hasFocus && !update.view.composing) {
        onDocumentChanged(update.view, this.controller, this.documentVersion);
      }
    }

    destroy(): void {
      registry.unregister(this.view);
    }
  });
}
