import type { EditorView } from "@codemirror/view";
import {
  Notice,
  Plugin,
  normalizePath,
  type TFile,
  type WorkspaceLeaf
} from "obsidian";
import {
  DELETE_INDEX_COMMAND_ID,
  INDEX_STATUS_VIEW_TYPE,
  REBUILD_INDEX_COMMAND_ID,
  SHOW_INDEX_STATUS_COMMAND_ID,
  SHOW_SUGGESTIONS_COMMAND_ID
} from "./constants.ts";
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
import { hashText } from "./indexing/hash.ts";
import { PersistentIndexManager } from "./indexing/index-manager.ts";
import { createIndexScopeFingerprint } from "./indexing/scope-fingerprint.ts";
import { meaningfulLexicalTokens } from "./lexical/text.ts";
import type { LexicalSuggestion } from "./lexical/types.ts";
import {
  LexicalVaultIndex,
  isMarkdownFile
} from "./lexical/vault-index.ts";
import { mergeHybridSuggestions } from "./retrieval/hybrid.ts";
import type { SemanticMatch } from "./retrieval/semantic-types.ts";
import { isFileExcluded } from "./scope/exclusions.ts";
import { createDefaultSettings } from "./settings/defaults.ts";
import { loadAndMigrateSettings } from "./settings/schema.ts";
import { SemanticLinksSettingTab } from "./settings/settings-tab.ts";
import type { SemanticLinksSettings } from "./settings/types.ts";
import {
  createEmptyIndexManifest,
  PersistentIndexStore
} from "./storage/index-store.ts";
import { DeleteIndexModal } from "./ui/delete-index-modal.ts";
import {
  IndexStatusView,
  type IndexStatusViewHost
} from "./views/index-status-view.ts";

const INSERTION_FAILURE_MESSAGES: Record<InsertWikilinkFailureCode, string> = {
  "invalid-range": "The selected text range is no longer valid.",
  "changed-anchor": "The text changed before the link could be inserted.",
  "already-linked": "The selected text is already inside a wikilink.",
  "protected-context": "Links cannot be inserted in this Markdown context.",
  "target-not-found": "The target note or heading no longer exists.",
  "invalid-target": "Obsidian could not create a valid link target.",
  "dispatch-failed": "The editor rejected the link transaction."
};

export default class SemanticLinksPlugin extends Plugin implements IndexStatusViewHost {
  override settings: SemanticLinksSettings = createDefaultSettings();
  indexManager: PersistentIndexManager | null = null;

  private readonly controllers = new EditorControllerRegistry();
  private readonly lifecycle = new AbortController();
  private lexicalIndex: LexicalVaultIndex | null = null;
  private statusBarElement: HTMLElement | null = null;

  override async onload(): Promise<void> {
    const loaded = loadAndMigrateSettings(await this.loadData() as unknown);
    this.settings = loaded.settings;
    if (loaded.needsSave) {
      await this.saveSettings();
    }

    this.lexicalIndex = new LexicalVaultIndex(this.app, () => this.settings);
    this.addSettingTab(new SemanticLinksSettingTab(this.app, this));
    this.statusBarElement = this.addStatusBarItem();
    this.setStatus("loading");
    this.registerView(INDEX_STATUS_VIEW_TYPE, (leaf) => new IndexStatusView(leaf, this));

    this.registerEditorExtension(createControllerExtension(
      this.controllers,
      (view, controller, documentVersion) => {
        this.handleContextChanged(view, controller, documentVersion);
      }
    ));
    this.registerEditorExtension(createSuggestionPopupExtension({
      accept: (view, popup, suggestion) => {
        this.acceptSuggestion(view, popup, suggestion);
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
      callback: () => this.openSuggestionPopup()
    });
    this.addCommand({
      id: SHOW_INDEX_STATUS_COMMAND_ID,
      name: "Show index status",
      callback: () => void this.openIndexStatus()
    });
    this.addCommand({
      id: REBUILD_INDEX_COMMAND_ID,
      name: "Rebuild semantic index",
      callback: () => void this.rebuildSemanticIndex()
    });
    this.addCommand({
      id: DELETE_INDEX_COMMAND_ID,
      name: "Delete local semantic index",
      callback: () => this.requestSemanticIndexDeletion()
    });

    this.app.workspace.onLayoutReady(() => {
      void this.initializeIndexes().catch(() => {
        new Notice("Semantic Links could not finish preparing its local indexes.");
      });
    });
  }

  override onunload(): void {
    this.lifecycle.abort();
    this.controllers.dispose();
    this.lexicalIndex?.dispose();
    this.lexicalIndex = null;
    this.indexManager?.dispose();
    this.indexManager = null;
    this.app.workspace.detachLeavesOfType(INDEX_STATUS_VIEW_TYPE);
    this.statusBarElement = null;
  }

  async saveSettings(): Promise<void> {
    this.lexicalIndex?.scheduleScopeRebuild();
    this.indexManager?.scheduleScopeRebuild();
    await this.saveData(this.settings);
  }

  async rebuildSemanticIndex(): Promise<void> {
    const manager = this.indexManager;
    if (manager === null) {
      new Notice("The semantic index is not ready yet.");
      return;
    }
    if (!this.settings.semanticIndexingEnabled) {
      new Notice("Enable semantic indexing in Semantic Links settings first.");
      return;
    }
    try {
      await manager.rebuild();
      new Notice("Semantic Links rebuilt the local index.");
    } catch {
      new Notice("Semantic Links could not rebuild the local index. Open the index status view for details.");
    }
  }

  requestSemanticIndexDeletion(): void {
    const manager = this.indexManager;
    if (manager === null) {
      new Notice("The semantic index is not ready yet.");
      return;
    }
    new DeleteIndexModal(this.app, () => {
      void manager.deleteIndex()
        .then(() => new Notice("Semantic Links deleted the local index."))
        .catch(() => new Notice("Semantic Links could not delete the local index."));
    }).open();
  }

  protected async searchSemanticMatches(
    _context: SuggestionContext,
    _sourcePath: string,
    _signal: AbortSignal
  ): Promise<SemanticMatch[]> {
    return [];
  }

  private async initializeIndexes(): Promise<void> {
    await this.initializeLexicalIndex();
    if (!this.lifecycle.signal.aborted) {
      await this.initializePersistentIndex();
    }
  }

  private async initializeLexicalIndex(): Promise<void> {
    const index = this.lexicalIndex;
    if (index === null || this.lifecycle.signal.aborted) {
      return;
    }
    this.registerLexicalIndexEvents(index);
    this.setStatus("indexing vault");
    await index.rebuild(this.lifecycle.signal);
    if (!this.lifecycle.signal.aborted && index.ready) {
      this.setStatus(`ready · ${index.size} notes`);
    }
  }

  private async initializePersistentIndex(): Promise<void> {
    if (this.lifecycle.signal.aborted || this.indexManager !== null) {
      return;
    }
    const pluginRoot = normalizePath(
      this.manifest.dir
      ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`
    );
    const vaultFingerprint = hashText(this.app.vault.getName());
    const store = new PersistentIndexStore(
      this.app.vault.adapter,
      normalizePath(`${pluginRoot}/index`),
      () => createEmptyIndexManifest(
        this.manifest.version,
        vaultFingerprint,
        createIndexScopeFingerprint(this.settings)
      )
    );
    const manager = new PersistentIndexManager(
      this.app,
      store,
      this.manifest.version,
      vaultFingerprint,
      () => this.settings
    );
    this.indexManager = manager;
    this.bindIndexViews();
    this.registerPersistentIndexEvents(manager);

    try {
      await manager.open();
      if (!this.lifecycle.signal.aborted) {
        await manager.reconcile();
      }
    } catch {
      new Notice("Semantic Links could not open the local semantic index. Lexical suggestions remain available.");
    }
  }

  private registerLexicalIndexEvents(index: LexicalVaultIndex): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (isMarkdownFile(file)) index.scheduleRefresh(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (isMarkdownFile(file)) index.scheduleRefresh(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => index.remove(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      index.remove(oldPath);
      if (isMarkdownFile(file)) index.scheduleRefresh(file);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      index.scheduleRefresh(file);
    }));
  }

  private registerPersistentIndexEvents(manager: PersistentIndexManager): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (isMarkdownFile(file)) manager.scheduleRefresh(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (isMarkdownFile(file)) manager.scheduleRefresh(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => manager.scheduleRemove(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (isMarkdownFile(file)) {
        manager.scheduleRename(file, oldPath);
      } else {
        manager.scheduleRemove(oldPath);
      }
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      manager.scheduleRefresh(file);
    }));
  }

  private async openIndexStatus(): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace
      .getLeavesOfType(INDEX_STATUS_VIEW_TYPE)[0] ?? null;
    if (leaf === null) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (leaf === null) {
        new Notice("Obsidian could not open the Semantic Links index view.");
        return;
      }
      await leaf.setViewState({ type: INDEX_STATUS_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private bindIndexViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(INDEX_STATUS_VIEW_TYPE)) {
      if (leaf.view instanceof IndexStatusView) {
        leaf.view.bindManager();
      }
    }
  }

  private handleContextChanged(
    view: EditorView,
    controller: EditorSuggestionController,
    documentVersion: number
  ): void {
    hideSuggestions(view);
    const index = this.lexicalIndex;
    if (
      index === null
      || !index.ready
      || !this.settings.automaticSuggestions
      || !this.settings.lexicalMatchingEnabled
    ) {
      return;
    }
    const source = this.app.workspace.getActiveFile();
    const context = this.readContext(view);
    if (
      source === null
      || this.isExcluded(source)
      || context === null
      || !this.isEligibleAutomaticAnchor(context.anchor.text)
    ) {
      return;
    }
    const key = this.createRequestKey(source.path, documentVersion, context, "automatic");
    controller.schedule(key, this.settings.debounceMs, (ticket) => {
      return this.searchAndShow(view, controller, ticket, documentVersion, false, false);
    });
  }

  private openSuggestionPopup(): void {
    const active = this.controllers.getActive();
    const source = this.app.workspace.getActiveFile();
    const index = this.lexicalIndex;
    if (active === null || source === null) {
      new Notice("Open a Markdown note and place the cursor in eligible text first.");
      return;
    }
    if (enableSuggestionKeyboard(active.view)) {
      return;
    }
    if (index === null || !index.ready) {
      new Notice("The local lexical index is still being prepared.");
      return;
    }
    if (!this.settings.lexicalMatchingEnabled) {
      new Notice("Enable lexical matching in Semantic Links settings first.");
      return;
    }
    if (this.isExcluded(source)) {
      new Notice("This note is excluded from Semantic Links.");
      return;
    }
    const context = this.readContext(active.view);
    if (context === null) {
      new Notice("Place the cursor in eligible prose or select a phrase first.");
      return;
    }
    const version = active.controller.documentVersion;
    const key = this.createRequestKey(source.path, version, context, "manual");
    active.controller.invalidate();
    active.controller.schedule(key, 0, (ticket) => {
      return this.searchAndShow(
        active.view,
        active.controller,
        ticket,
        version,
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
    const index = this.lexicalIndex;
    const source = this.app.workspace.getActiveFile();
    const context = this.readContext(view);
    if (
      index === null
      || !index.ready
      || source === null
      || source.path !== ticket.key.filePath
      || context === null
    ) {
      return;
    }

    let currentKey = this.createRequestKey(
      source.path,
      documentVersion,
      context,
      ticket.key.mode
    );
    const lexical = index.search({
      anchorText: context.anchor.text,
      contextText: context.searchText,
      sourcePath: source.path,
      limit: this.settings.maxSuggestions,
      minimumScore: this.settings.minimumConfidence
    });
    if (!controller.acceptResult(ticket, currentKey)) {
      return;
    }
    if (lexical.length > 0) {
      this.showResults(view, currentKey, lexical, keyboardActive);
    }

    const semantic = isSemanticContext(context.searchText)
      ? await this.searchSemanticMatches(context, source.path, ticket.signal)
      : [];
    if (ticket.signal.aborted) {
      return;
    }
    const latestContext = this.readContext(view);
    const latestSource = this.app.workspace.getActiveFile();
    if (latestContext === null || latestSource?.path !== source.path) {
      return;
    }
    currentKey = this.createRequestKey(
      source.path,
      documentVersion,
      latestContext,
      ticket.key.mode
    );
    if (!controller.acceptResult(ticket, currentKey)) {
      return;
    }

    const suggestions = mergeHybridSuggestions(
      lexical,
      semantic,
      this.settings.maxSuggestions
    );
    if (suggestions.length === 0) {
      hideSuggestions(view);
      if (notifyWhenEmpty) {
        new Notice("No relevant link suggestions were found for this context.");
      }
      this.setStatus(`ready · ${index.size} notes`);
      return;
    }
    this.showResults(view, currentKey, suggestions, keyboardActive);
  }

  private showResults(
    view: EditorView,
    requestKey: SuggestionRequestKey,
    suggestions: readonly LexicalSuggestion[],
    keyboardActive: boolean
  ): void {
    showSuggestions(view, {
      requestKey,
      suggestions,
      selectedIndex: 0,
      keyboardActive
    });
    this.setStatus(`${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} · ${requestKey.anchorText}`);
  }

  private acceptSuggestion(
    view: EditorView,
    popup: SuggestionPopupState,
    suggestion: LexicalSuggestion
  ): void {
    const active = this.controllers.getActive();
    const source = this.app.workspace.getActiveFile();
    if (
      active === null
      || active.view !== view
      || source === null
      || source.path !== popup.requestKey.filePath
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
    this.applySuggestion(active, source, popup, suggestion);
  }

  private applySuggestion(
    active: ActiveEditorController,
    source: TFile,
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
          sourcePath: source.path,
          anchorStart: popup.requestKey.anchorStart,
          anchorEnd: popup.requestKey.anchorEnd,
          expectedText: popup.requestKey.anchorText,
          targetPath: suggestion.targetPath,
          targetHeading: suggestion.targetHeading,
          displayText: popup.requestKey.anchorText,
          pathMode: this.settings.linkPathMode
        },
        (message) => new Notice(message)
      );
    } finally {
      active.controller.endPluginTransaction();
    }
    if (!result.ok) {
      new Notice(INSERTION_FAILURE_MESSAGES[result.code]);
    } else {
      this.setStatus(`linked · ${suggestion.targetTitle}`);
    }
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

  private isExcluded(file: TFile): boolean {
    return isFileExcluded(this.app.metadataCache, file, this.settings);
  }

  private setStatus(message: string): void {
    this.statusBarElement?.setText(`Semantic Links: ${message}`);
  }
}

function isSemanticContext(value: string): boolean {
  return value.trim().length >= 24
    || meaningfulLexicalTokens(value, 5).length >= 5;
}

function yieldBeforeSearch(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
