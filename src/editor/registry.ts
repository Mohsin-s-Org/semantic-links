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
    const controller = this.controllers.get(view);
    controller?.dispose();
    this.controllers.delete(view);
    if (this.activeView === view) {
      this.activeView = null;
    }
  }

  setActive(view: EditorView): void {
    if (this.controllers.has(view)) {
      this.activeView = view;
    }
  }

  getActive(): ActiveEditorController | null {
    if (this.activeView === null) {
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
