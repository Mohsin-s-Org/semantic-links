import type { Extension } from "@codemirror/state";
import {
  ViewPlugin,
  type EditorView,
  type ViewUpdate
} from "@codemirror/view";
import type { LexicalSuggestion } from "../lexical/types.ts";
import { meaningfulLexicalTokens } from "../lexical/text.ts";
import { mergeHybridSuggestions } from "../retrieval/hybrid.ts";
import type { SemanticMatch } from "../retrieval/semantic-types.ts";
import { extractSuggestionContext, type SuggestionContext } from "./context.ts";
import {
  getSuggestionPopup,
  showSuggestions
} from "./suggestion-popup.ts";

export interface SemanticQueryHost {
  readonly debounceMs: number;
  readonly maxSuggestions: number;
  canSearch(view: EditorView): boolean;
  sourcePath(): string | null;
  search(
    context: SuggestionContext,
    sourcePath: string,
    signal: AbortSignal
  ): Promise<SemanticMatch[]>;
}

export function createSemanticQueryExtension(host: SemanticQueryHost): Extension {
  return ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private request: AbortController | null = null;
    private documentVersion = 0;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.documentVersion += 1;
      }
      if (!update.docChanged && !update.selectionSet) {
        return;
      }
      this.cancel();
      if (!host.canSearch(update.view)) {
        return;
      }
      this.timer = globalThis.setTimeout(() => {
        this.timer = null;
        void this.run(host).catch(() => undefined);
      }, host.debounceMs + 40);
    }

    destroy(): void {
      this.cancel();
    }

    private async run(queryHost: SemanticQueryHost): Promise<void> {
      const sourcePath = queryHost.sourcePath();
      const context = readContext(this.view);
      if (
        sourcePath === null
        || context === null
        || !isSemanticContext(context.searchText)
        || !queryHost.canSearch(this.view)
      ) {
        return;
      }
      const request = new AbortController();
      this.request = request;
      const matches = await queryHost.search(context, sourcePath, request.signal);
      if (request.signal.aborted || this.request !== request || !this.view.hasFocus) {
        return;
      }
      const current = readContext(this.view);
      if (current === null || current.anchor.contextHash !== context.anchor.contextHash) {
        return;
      }
      const popup = getSuggestionPopup(this.view.state);
      const lexical: readonly LexicalSuggestion[] = popup?.suggestions ?? [];
      const suggestions = mergeHybridSuggestions(
        lexical,
        matches,
        queryHost.maxSuggestions
      );
      if (suggestions.length === 0) {
        return;
      }
      showSuggestions(this.view, {
        requestKey: {
          filePath: sourcePath,
          documentVersion: this.documentVersion,
          anchorStart: context.anchor.start,
          anchorEnd: context.anchor.end,
          anchorText: context.anchor.text,
          contextHash: context.anchor.contextHash,
          mode: popup?.requestKey.mode ?? "automatic"
        },
        suggestions,
        selectedIndex: 0,
        keyboardActive: popup?.keyboardActive ?? false
      });
    }

    private cancel(): void {
      if (this.timer !== null) {
        globalThis.clearTimeout(this.timer);
        this.timer = null;
      }
      this.request?.abort();
      this.request = null;
    }
  });
}

function readContext(view: EditorView): SuggestionContext | null {
  const selection = view.state.selection.main;
  return extractSuggestionContext(
    view.state.doc.toString(),
    selection.from,
    selection.to,
    selection.head
  );
}

function isSemanticContext(value: string): boolean {
  return value.trim().length >= 24
    || meaningfulLexicalTokens(value, 5).length >= 5;
}
