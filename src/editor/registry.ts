import type { EditorView } from "@codemirror/view";
import type { EditorSuggestionController } from "./controller.ts";

export interface ActiveEditorController {
  view: EditorView;
  controller: EditorSuggestionController;
}

export class EditorControllerRegistry {
  private readonly controllers = new Map<EditorView, EditorSuggestionController>();
  private activeView: EditorView | null = null;

  register(view: EditorView, controller: EditorSuggestionController): void {
    const previous = this.controllers.get(view);
    if (previous !== undefined && previous !== controller) {
      previous.dispose();
    }
    this.controllers.set(view, controller);
  }

  unregister(view: EditorView): void {
    this.controllers.get(view)?.dispose();
    this.controllers.delete(view);
    this.clearActive(view);
  }

  setActive(view: EditorView): void {
    if (this.controllers.has(view)) {
      this.activeView = view;
    }
  }

  clearActive(view?: EditorView): void {
    if (view === undefined || this.activeView === view) {
      this.activeView = null;
    }
  }

  getActive(): ActiveEditorController | null {
    if (this.activeView === null || !this.activeView.hasFocus) {
      return null;
    }

    const controller = this.controllers.get(this.activeView);
    return controller === undefined
      ? null
      : { view: this.activeView, controller };
  }

  invalidateAll(): void {
    for (const controller of this.controllers.values()) {
      controller.invalidate();
    }
  }

  dispose(): void {
    for (const controller of this.controllers.values()) {
      controller.dispose();
    }
    this.controllers.clear();
    this.activeView = null;
  }
}
