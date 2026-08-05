import {
  Facet,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension
} from "@codemirror/state";
import {
  keymap,
  showTooltip,
  type EditorView,
  type Tooltip
} from "@codemirror/view";
import type { LexicalMatchKind, LexicalSuggestion } from "../lexical/types.ts";
import {
  serializeRequestKey,
  type SuggestionRequestKey
} from "./request-key.ts";

export interface SuggestionPopupState {
  requestKey: SuggestionRequestKey;
  anchorStart: number;
  anchorEnd: number;
  suggestions: readonly LexicalSuggestion[];
  selectedIndex: number;
  keyboardActive: boolean;
}

export interface SuggestionPopupHandler {
  accept(
    view: EditorView,
    popup: SuggestionPopupState,
    suggestion: LexicalSuggestion
  ): void;
}

export const setSuggestionPopup = StateEffect.define<SuggestionPopupState>();
export const clearSuggestionPopup = StateEffect.define<null>();
const moveSuggestionSelection = StateEffect.define<number>();
const activateSuggestionKeyboard = StateEffect.define<boolean>();

const NOOP_HANDLER: SuggestionPopupHandler = {
  accept: () => undefined
};

const popupHandler = Facet.define<SuggestionPopupHandler, SuggestionPopupHandler>({
  combine: (values) => values[0] ?? NOOP_HANDLER
});

const suggestionPopupField = StateField.define<SuggestionPopupState | null>({
  create: () => null,
  update: (value, transaction) => {
    let next = transaction.docChanged || transaction.selection !== undefined
      ? null
      : value;
    for (const effect of transaction.effects) {
      if (effect.is(setSuggestionPopup)) {
        next = normalizePopup(effect.value);
      } else if (effect.is(clearSuggestionPopup)) {
        next = null;
      } else if (effect.is(moveSuggestionSelection) && next !== null) {
        next = {
          ...next,
          selectedIndex: wrapIndex(
            next.selectedIndex + effect.value,
            next.suggestions.length
          )
        };
      } else if (effect.is(activateSuggestionKeyboard) && next !== null) {
        next = { ...next, keyboardActive: effect.value };
      }
    }
    return next;
  },
  provide: (field) => showTooltip.compute([field, popupHandler], (state) => {
    const popup = state.field(field);
    return popup === null
      ? null
      : createPopupTooltip(popup, state.facet(popupHandler));
  })
});

export function createSuggestionPopupExtension(
  handler: SuggestionPopupHandler
): Extension {
  return [
    popupHandler.of(handler),
    suggestionPopupField,
    Prec.high(keymap.of([
      { key: "ArrowDown", run: (view) => moveSelection(view, 1) },
      { key: "ArrowUp", run: (view) => moveSelection(view, -1) },
      { key: "Enter", run: acceptSelected },
      { key: "Escape", run: dismissPopup }
    ]))
  ];
}

export function getSuggestionPopup(state: EditorState): SuggestionPopupState | null {
  return state.field(suggestionPopupField, false) ?? null;
}

export function showSuggestions(
  view: EditorView,
  popup: SuggestionPopupState
): void {
  view.dispatch({ effects: setSuggestionPopup.of(popup) });
}

export function hideSuggestions(view: EditorView): void {
  if (getSuggestionPopup(view.state) !== null) {
    view.dispatch({ effects: clearSuggestionPopup.of(null) });
  }
}

export function enableSuggestionKeyboard(view: EditorView): boolean {
  const popup = getSuggestionPopup(view.state);
  if (popup === null) {
    return false;
  }
  if (!popup.keyboardActive) {
    view.dispatch({ effects: activateSuggestionKeyboard.of(true) });
  }
  return true;
}

export function isPopupForRequest(
  state: EditorState,
  requestKey: SuggestionRequestKey
): boolean {
  const popup = getSuggestionPopup(state);
  return popup !== null
    && serializeRequestKey(popup.requestKey) === serializeRequestKey(requestKey);
}

function createPopupTooltip(
  popup: SuggestionPopupState,
  handler: SuggestionPopupHandler
): Tooltip {
  return {
    pos: popup.anchorEnd,
    end: popup.anchorEnd,
    arrow: true,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "semantic-links-popup";
      dom.setAttribute("role", "listbox");
      dom.setAttribute("aria-label", "Semantic link suggestions");
      dom.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });

      const header = dom.createDiv({ cls: "semantic-links-popup__header" });
      header.createSpan({
        cls: "semantic-links-popup__heading",
        text: "Suggested links"
      });
      const closeButton = header.createEl("button", {
        cls: "semantic-links-popup__close",
        attr: {
          type: "button",
          "aria-label": "Close suggestions"
        },
        text: "×"
      });
      closeButton.addEventListener("click", () => hideSuggestions(view));

      const list = dom.createDiv({ cls: "semantic-links-popup__list" });
      popup.suggestions.forEach((suggestion, index) => {
        const selected = index === popup.selectedIndex;
        const button = list.createEl("button", {
          cls: selected
            ? "semantic-links-popup__item is-selected"
            : "semantic-links-popup__item",
          attr: {
            type: "button",
            role: "option",
            "aria-selected": selected ? "true" : "false"
          }
        });
        const title = suggestion.targetHeading === null
          ? suggestion.targetTitle
          : `${suggestion.targetTitle} › ${suggestion.targetHeading}`;
        button.createDiv({
          cls: "semantic-links-popup__title",
          text: title
        });
        button.createDiv({
          cls: "semantic-links-popup__meta",
          text: `${formatKinds(suggestion.matchKinds)} · ${suggestion.targetPath}`
        });
        if (suggestion.preview !== null) {
          button.createDiv({
            cls: "semantic-links-popup__preview",
            text: suggestion.preview
          });
        }
        button.addEventListener("click", () => {
          handler.accept(view, popup, suggestion);
        });
      });

      dom.createDiv({
        cls: "semantic-links-popup__instructions",
        text: popup.keyboardActive
          ? "↑↓ select · Enter insert · Esc close"
          : "Click a suggestion to insert · Alt+L for keyboard control"
      });
      return { dom };
    }
  };
}

function moveSelection(view: EditorView, delta: number): boolean {
  const popup = getSuggestionPopup(view.state);
  if (popup === null || !popup.keyboardActive) {
    return false;
  }
  view.dispatch({ effects: moveSuggestionSelection.of(delta) });
  return true;
}

function acceptSelected(view: EditorView): boolean {
  const popup = getSuggestionPopup(view.state);
  if (popup === null || !popup.keyboardActive) {
    return false;
  }
  const suggestion = popup.suggestions[popup.selectedIndex];
  if (suggestion === undefined) {
    return false;
  }
  view.state.facet(popupHandler).accept(view, popup, suggestion);
  return true;
}

function dismissPopup(view: EditorView): boolean {
  const popup = getSuggestionPopup(view.state);
  if (popup === null || !popup.keyboardActive) {
    return false;
  }
  hideSuggestions(view);
  return true;
}

function normalizePopup(value: SuggestionPopupState): SuggestionPopupState | null {
  if (value.suggestions.length === 0) {
    return null;
  }
  return {
    ...value,
    suggestions: value.suggestions,
    selectedIndex: wrapIndex(value.selectedIndex, value.suggestions.length)
  };
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return ((index % length) + length) % length;
}

function formatKinds(kinds: readonly LexicalMatchKind[]): string {
  const labels: Record<LexicalMatchKind, string> = {
    title: "title",
    alias: "alias",
    heading: "heading",
    tag: "tag",
    body: "note text"
  };
  return kinds.map((kind) => labels[kind]).join(" + ");
}
