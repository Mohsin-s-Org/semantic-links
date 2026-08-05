import type { EditorView } from "@codemirror/view";
import {
  Notice,
  Plugin,
  getAllTags,
  type TFile
} from "obsidian";
import { SHOW_SUGGESTIONS_COMMAND_ID } from "./constants.ts";
import { findTextAnchor, type TextAnchor } from "./editor/anchor.ts";
import type {
  EditorSuggestionController,
  SuggestionRequestTicket
} from "./editor/controller.ts";
import { createControllerExtension } from "./editor/extension.ts";
import {
  insertVerifiedWikilink,
  type InsertWikilinkResult
} from "./editor/insertion.ts";
import { EditorControllerRegistry, type ActiveEditorController } from "./editor/registry.ts";
import type { SuggestionRequestKey } from "./editor/request-key.ts";
import { createDefaultSettings } from "./settings/defaults.ts";
import { loadAndMigrateSettings } from "./settings/schema.ts";
import { SemanticLinksSettingTab } from "./settings/settings-tab.ts";
import type { SemanticLinksSettings } from "./settings/types.ts";
import { FoundationSuggestionModal } from "./ui/foundation-suggestion-modal.ts";

export default class SemanticLinksPlugin extends Plugin {
  override settings: SemanticLinksSettings = createDefaultSettings();

  private readonly controllers = new EditorControllerRegistry();
  private readonly lifecycle = new AbortController();
  private statusBarElement: HTMLElement | null = null;

  override async onload(): Promise<void> {
    const savedData: unknown = await this.loadData();
    const loaded = loadAndMigrateSettings(savedData);
    this.settings = loaded.settings;
    if (loaded.needsSave) {
      await this.saveSettings();
    }

    this.addSettingTab(new SemanticLinksSettingTab(this.app, this));
    this.statusBarElement = this.addStatusBarItem();
    this.setStatus("loading");

    this.registerEditorExtension(createControllerExtension(
      this.controllers,
      (view, controller, documentVersion) => {
        this.handleContextChanged(view, controller, documentVersion);
      }
    ));

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.controllers.clearActive();
      this.controllers.invalidateAll();
    }));

    this.addCommand({
      id: SHOW_SUGGESTIONS_COMMAND_ID,
      name: "Show link suggestions",
      callback: () => {
        this.openSuggestionChooser();
      }
    });

    this.app.workspace.onLayoutReady(() => {
      if (!this.lifecycle.signal.aborted) {
        this.setStatus("ready · lexical foundation");
      }
    });
  }

  override onunload(): void {
    this.lifecycle.abort();
    this.controllers.dispose();
    this.statusBarElement = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private handleContextChanged(
    view: EditorView,
    controller: EditorSuggestionController,
    documentVersion: number
  ): void {
    if (!this.settings.automaticSuggestions || !this.settings.lexicalMatchingEnabled) {
      controller.hideVisibleSuggestions();
      return;
    }

    const sourceFile = this.app.workspace.getActiveFile();
    if (sourceFile === null || this.isExcluded(sourceFile)) {
      controller.hideVisibleSuggestions();
      return;
    }

    const anchor = findTextAnchor(
      view.state.doc.toString(),
      view.state.selection.main.head
    );
    if (anchor === null) {
      controller.hideVisibleSuggestions();
      return;
    }

    const requestKey = this.createRequestKey(
      sourceFile.path,
      documentVersion,
      anchor,
      "automatic"
    );
    controller.schedule(requestKey, this.settings.debounceMs, async (ticket) => {
      await Promise.resolve();
      this.acceptFoundationResult(view, controller, ticket, documentVersion);
    });
  }

  private acceptFoundationResult(
    view: EditorView,
    controller: EditorSuggestionController,
    ticket: SuggestionRequestTicket,
    documentVersion: number
  ): void {
    if (ticket.signal.aborted) {
      return;
    }

    const sourceFile = this.app.workspace.getActiveFile();
    const anchor = findTextAnchor(
      view.state.doc.toString(),
      view.state.selection.main.head
    );
    if (sourceFile === null || anchor === null) {
      return;
    }

    const currentKey = this.createRequestKey(
      sourceFile.path,
      documentVersion,
      anchor,
      "automatic"
    );
    if (controller.acceptResult(ticket, currentKey)) {
      this.setStatus(`candidate context · ${anchor.text}`);
    }
  }

  private openSuggestionChooser(): void {
    const active = this.controllers.getActive();
    const sourceFile = this.app.workspace.getActiveFile();
    if (active === null || sourceFile === null) {
      new Notice("Open a Markdown note and place the cursor in a word first.");
      return;
    }

    const anchor = findTextAnchor(
      active.view.state.doc.toString(),
      active.view.state.selection.main.head
    );
    if (anchor === null) {
      new Notice("Place the cursor in a word to create a link anchor.");
      return;
    }

    const candidates = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path !== sourceFile.path && !this.isExcluded(file))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (candidates.length === 0) {
      new Notice("No eligible Markdown notes are available.");
      return;
    }

    new FoundationSuggestionModal(this.app, candidates, (target) => {
      this.applyFoundationSuggestion(active, sourceFile, anchor, target);
    }).open();
  }

  private applyFoundationSuggestion(
    active: ActiveEditorController,
    sourceFile: TFile,
    anchor: TextAnchor,
    target: TFile
  ): void {
    active.controller.beginPluginTransaction();
    let result: InsertWikilinkResult;
    try {
      result = insertVerifiedWikilink(
        this.app,
        active.view,
        {
          sourcePath: sourceFile.path,
          anchorStart: anchor.start,
          anchorEnd: anchor.end,
          expectedText: anchor.text,
          targetPath: target.path,
          targetHeading: null,
          displayText: anchor.text,
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
      new Notice(this.describeInsertionFailure(result));
      return;
    }

    this.setStatus(`linked · ${target.basename}`);
  }

  private createRequestKey(
    filePath: string,
    documentVersion: number,
    anchor: TextAnchor,
    mode: SuggestionRequestKey["mode"]
  ): SuggestionRequestKey {
    return {
      filePath,
      documentVersion,
      anchorStart: anchor.start,
      anchorEnd: anchor.end,
      contextHash: anchor.contextHash,
      mode
    };
  }

  private isExcluded(file: TFile): boolean {
    const normalizedPath = file.path.toLocaleLowerCase();
    const folderExcluded = this.settings.excludedFolders.some((folder) => {
      const normalizedFolder = folder
        .replace(/^\/+|\/+$/gu, "")
        .toLocaleLowerCase();
      return normalizedFolder.length > 0
        && (normalizedPath === normalizedFolder
          || normalizedPath.startsWith(`${normalizedFolder}/`));
    });
    if (folderExcluded) {
      return true;
    }

    const excludedTags = new Set(this.settings.excludedTags.map((tag) => {
      return `#${tag.toLocaleLowerCase()}`;
    }));
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache === null) {
      return false;
    }

    return (getAllTags(cache) ?? [])
      .some((tag) => excludedTags.has(tag.toLocaleLowerCase()));
  }

  private describeInsertionFailure(
    result: Extract<InsertWikilinkResult, { ok: false }>
  ): string {
    switch (result.code) {
      case "invalid-range":
        return "The selected text range is no longer valid.";
      case "changed-anchor":
        return "The text changed before the link could be inserted.";
      case "target-not-found":
        return "The target note no longer exists.";
      case "invalid-target":
        return "Obsidian could not create a valid link target.";
      case "dispatch-failed":
        return "The editor rejected the link transaction.";
    }
  }

  private setStatus(message: string): void {
    this.statusBarElement?.setText(`Semantic Links: ${message}`);
  }
}
