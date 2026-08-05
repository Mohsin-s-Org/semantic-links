import type { EditorView } from "@codemirror/view";
import {
  Notice,
  Plugin,
  type TFile
} from "obsidian";
import { SHOW_SUGGESTIONS_COMMAND_ID } from "./constants.ts";
import type {
  EditorSuggestionController,
  SuggestionRequestTicket
} from "./editor/controller.ts";
import {
  extractSuggestionContext,
  type SuggestionContext
} from "./editor/context.ts";
import { createControllerExtension } from "./editor/extension.ts";
import {
  insertVerifiedWikilink,
  type InsertWikilinkFailureCode,
  type InsertWikilinkResult
} from "./editor/insertion.ts";
import {
  EditorControllerRegistry,
  type ActiveEditorController
} from "./editor/registry.ts";
import type { SuggestionRequestKey } from "./editor/request-key.ts";
import {
  createSuggestionPopupExtension,
  enableSuggestionKeyboard,
  hideSuggestions,
  isPopupForRequest,
  showSuggestions,
  type SuggestionPopupState
} from "./editor/suggestion-popup.ts";
import { meaningfulLexicalTokens } from "./lexical/text.ts";
import type { LexicalSuggestion } from "./lexical/types.ts";
import {
  LexicalVaultIndex,
  isMarkdownFile
} from "./lexical/vault-index.ts";
import { isFileExcluded } from "./scope/exclusions.ts";
import { createDefaultSettings } from "./settings/defaults.ts";
import { loadAndMigrateSettings } from "./settings/schema.ts";
import { SemanticLinksSettingTab } from "./settings/settings-tab.ts";
import type { SemanticLinksSettings } from "./settings/types.ts";

const INSERTION_FAILURE_MESSAGES: Record<InsertWikilinkFailureCode, string> = {
  "invalid-range": "The selected text range is no longer valid.",
  "changed-anchor": "The text changed before the link could be inserted.",
  "already-linked": "The selected text is already inside a wikilink.",
  "protected-context": "Links cannot be inserted in this Markdown context.",
  "target-not-found": "The target note no longer exists.",
  "invalid-target": "Obsidian could not create a valid link target.",
  "dispatch-failed": "The editor rejected the link transaction."
};

export default class SemanticLinksPlugin extends Plugin {
  override settings: SemanticLinksSettings = createDefaultSettings();

  private readonly controllers = new EditorControllerRegistry();
  private readonly lifecycle = new AbortController();
  private lexicalIndex: LexicalVaultIndex | null = null;
  private statusBarElement: HTMLElement | null = null;

  override async onload(): Promise<void> {
    const savedData: unknown = await this.loadData();
    const loaded = loadAndMigrateSettings(savedData);
    this.settings = loaded.settings;
    if (loaded.needsSave) {
      await this.saveSettings();
    }

    this.lexicalIndex = new LexicalVaultIndex(this.app, () => this.settings);
    this.addSettingTab(new SemanticLinksSettingTab(this.app, this));
    this.statusBarElement = this.addStatusBarItem();
    this.setStatus("loading");

    this.registerEditorExtension(createControllerExtension(
      this.controllers,
      (view, controller, documentVersion) => {
        this.handleContextChanged(view, controller, documentVersion);
      }
    ));
    this.registerEditorExtension(createSuggestionPopupExtension({
      accept: (view, popup, suggestion) => {
        this.acceptLexicalSuggestion(view, popup, suggestion);
      }
    }));

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.controllers.clearActive();
      this.controllers.invalidateAll();
    }));

    this.addCommand({
      id: SHOW_SUGGESTIONS_COMMAND_ID,
      name: "Show link suggestions",
      hotkeys: [{ modifiers: ["Alt"], key: "l" }],
      callback: () => {
        this.openSuggestionPopup();
      }
    });

    this.app.workspace.onLayoutReady(() => {
      void this.initializeLexicalIndex();
    });
  }

  override onunload(): void {
    this.lifecycle.abort();
    this.controllers.dispose();
    this.lexicalIndex?.dispose();
    this.lexicalIndex = null;
    this.statusBarElement = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.lexicalIndex?.scheduleRebuild();
  }

  private async initializeLexicalIndex(): Promise<void> {
    const lexicalIndex = this.lexicalIndex;
    if (lexicalIndex === null || this.lifecycle.signal.aborted) {
      return;
    }

    this.setStatus("indexing vault");
    await lexicalIndex.rebuild(this.lifecycle.signal);
    if (this.lifecycle.signal.aborted || !lexicalIndex.ready) {
      return;
    }

    this.registerLexicalIndexEvents(lexicalIndex);
    this.setStatus(`ready · ${lexicalIndex.size} notes`);
  }

  private registerLexicalIndexEvents(lexicalIndex: LexicalVaultIndex): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (isMarkdownFile(file)) {
        lexicalIndex.scheduleRefresh(file);
      }
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (isMarkdownFile(file)) {
        lexicalIndex.scheduleRefresh(file);
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      lexicalIndex.remove(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      lexicalIndex.remove(oldPath);
      if (isMarkdownFile(file)) {
        lexicalIndex.scheduleRefresh(file);
      }
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      lexicalIndex.scheduleRefresh(file);
    }));
  }

  private handleContextChanged(
    view: EditorView,
    controller: EditorSuggestionController,
    documentVersion: number
  ): void {
    const lexicalIndex = this.lexicalIndex;
    if (
      lexicalIndex === null
      || !lexicalIndex.ready
      || !this.settings.automaticSuggestions
      || !this.settings.lexicalMatchingEnabled
    ) {
      this.hideCurrentSuggestions(view, controller);
      return;
    }

    const sourceFile = this.app.workspace.getActiveFile();
    if (sourceFile === null || this.isExcluded(sourceFile)) {
      this.hideCurrentSuggestions(view, controller);
      return;
    }

    const context = this.readContext(view);
    if (context === null || !this.isEligibleAutomaticAnchor(context.anchor.text)) {
      this.hideCurrentSuggestions(view, controller);
      return;
    }

    const requestKey = this.createRequestKey(
      sourceFile.path,
      documentVersion,
      context,
      "automatic"
    );
    controller.schedule(requestKey, this.settings.debounceMs, (ticket) => {
      return this.searchAndShow(
        view,
        controller,
        ticket,
        documentVersion,
        false,
        false
      );
    });
  }

  private openSuggestionPopup(): void {
    const active = this.controllers.getActive();
    const sourceFile = this.app.workspace.getActiveFile();
    const lexicalIndex = this.lexicalIndex;
    if (active === null || sourceFile === null) {
      new Notice("Open a Markdown note and place the cursor in eligible text first.");
      return;
    }
    if (enableSuggestionKeyboard(active.view)) {
      return;
    }
    if (lexicalIndex === null || !lexicalIndex.ready) {
      new Notice("The local lexical index is still being prepared.");
      return;
    }
    if (!this.settings.lexicalMatchingEnabled) {
      new Notice("Enable lexical matching in Semantic Links settings first.");
      return;
    }
    if (this.isExcluded(sourceFile)) {
      new Notice("This note is excluded from Semantic Links.");
      return;
    }

    const context = this.readContext(active.view);
    if (context === null) {
      new Notice("Place the cursor in eligible prose or select a phrase first.");
      return;
    }

    const requestKey = this.createRequestKey(
      sourceFile.path,
      0,
      context,
      "manual"
    );
    active.controller.invalidate();
    active.controller.schedule(requestKey, 0, (ticket) => {
      return this.searchAndShow(
        active.view,
        active.controller,
        ticket,
        0,
        true,
        true
      );
    });
  }

  private async searchAndShow(
    view: EditorView,
    controller: EditorSuggestionController,
    ticket: SuggestionRequestTicket,
    documentVersion: number,
    keyboardActive: boolean,
    notifyWhenEmpty: boolean
  ): Promise<void> {
    await yieldBeforeSearch();
    if (ticket.signal.aborted || !view.hasFocus) {
      return;
    }

    const lexicalIndex = this.lexicalIndex;
    const sourceFile = this.app.workspace.getActiveFile();
    if (
      lexicalIndex === null
      || !lexicalIndex.ready
      || sourceFile === null
      || sourceFile.path !== ticket.key.filePath
    ) {
      return;
    }

    const context = this.readContext(view);
    if (context === null) {
      return;
    }
    const currentKey = this.createRequestKey(
      sourceFile.path,
      documentVersion,
      context,
      ticket.key.mode
    );
    if (!controller.acceptResult(ticket, currentKey)) {
      return;
    }

    const suggestions = lexicalIndex.search({
      anchorText: context.anchor.text,
      contextText: context.searchText,
      sourcePath: sourceFile.path,
      limit: this.settings.maxSuggestions,
      minimumScore: this.settings.minimumConfidence
    });
    if (ticket.signal.aborted || !isSameRequest(ticket.key, currentKey)) {
      return;
    }
    if (suggestions.length === 0) {
      hideSuggestions(view);
      if (notifyWhenEmpty) {
        new Notice("No lexical link suggestions were found for this context.");
      }
      this.setStatus(`ready · ${lexicalIndex.size} notes`);
      return;
    }

    showSuggestions(view, {
      requestKey: currentKey,
      anchorStart: context.anchor.start,
      anchorEnd: context.anchor.end,
      suggestions,
      selectedIndex: 0,
      keyboardActive
    });
    this.setStatus(`${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} · ${context.anchor.text}`);
  }

  private acceptLexicalSuggestion(
    view: EditorView,
    popup: SuggestionPopupState,
    suggestion: LexicalSuggestion
  ): void {
    const active = this.controllers.getActive();
    const sourceFile = this.app.workspace.getActiveFile();
    if (
      active === null
      || active.view !== view
      || sourceFile === null
      || sourceFile.path !== popup.requestKey.filePath
      || !isPopupForRequest(view.state, popup.requestKey)
    ) {
      hideSuggestions(view);
      new Notice("The editing context changed before the link could be inserted.");
      return;
    }

    const target = this.app.vault.getAbstractFileByPath(suggestion.targetPath);
    if (!isMarkdownFile(target) || this.isExcluded(target)) {
      hideSuggestions(view);
      new Notice("The suggested target is no longer available.");
      return;
    }

    hideSuggestions(view);
    this.applyLexicalSuggestion(active, sourceFile, popup, suggestion);
  }

  private applyLexicalSuggestion(
    active: ActiveEditorController,
    sourceFile: TFile,
    popup: SuggestionPopupState,
    suggestion: LexicalSuggestion
  ): void {
    active.controller.beginPluginTransaction();
    let result: InsertWikilinkResult;
    try {
      result = insertVerifiedWikilink(
        this.app,
        active.view,
        {
          sourcePath: sourceFile.path,
          anchorStart: popup.anchorStart,
          anchorEnd: popup.anchorEnd,
          expectedText: popup.requestKey.anchorText,
          targetPath: suggestion.targetPath,
          targetHeading: suggestion.targetHeading,
          displayText: popup.requestKey.anchorText,
          pathMode: this.settings.linkPathMode
        },
        (message) => {
          new Notice(message);
        }
      );
    } finally {
      active.controller.endPluginTransaction();
    }

    if (!result.ok) {
      new Notice(INSERTION_FAILURE_MESSAGES[result.code]);
      return;
    }

    this.setStatus(`linked · ${suggestion.targetTitle}`);
  }

  private readContext(view: EditorView): SuggestionContext | null {
    const selection = view.state.selection.main;
    return extractSuggestionContext(
      view.state.doc.toString(),
      selection.from,
      selection.to,
      selection.head
    );
  }

  private createRequestKey(
    filePath: string,
    documentVersion: number,
    context: SuggestionContext,
    mode: SuggestionRequestKey["mode"]
  ): SuggestionRequestKey {
    return {
      filePath,
      documentVersion,
      anchorStart: context.anchor.start,
      anchorEnd: context.anchor.end,
      anchorText: context.anchor.text,
      contextHash: context.anchor.contextHash,
      mode
    };
  }

  private isEligibleAutomaticAnchor(value: string): boolean {
    return this.lexicalIndex?.hasExactLabel(value) === true
      || meaningfulLexicalTokens(value, 1).length > 0;
  }

  private hideCurrentSuggestions(
    view: EditorView,
    controller: EditorSuggestionController
  ): void {
    controller.hideVisibleSuggestions();
    hideSuggestions(view);
  }

  private isExcluded(file: TFile): boolean {
    return isFileExcluded(this.app.metadataCache, file, this.settings);
  }

  private setStatus(message: string): void {
    this.statusBarElement?.setText(`Semantic Links: ${message}`);
  }
}

function yieldBeforeSearch(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function isSameRequest(
  left: SuggestionRequestKey,
  right: SuggestionRequestKey
): boolean {
  return left.filePath === right.filePath
    && left.documentVersion === right.documentVersion
    && left.anchorStart === right.anchorStart
    && left.anchorEnd === right.anchorEnd
    && left.anchorText === right.anchorText
    && left.contextHash === right.contextHash
    && left.mode === right.mode;
}
