import {
  ItemView,
  type WorkspaceLeaf
} from "obsidian";
import { INDEX_STATUS_VIEW_TYPE } from "../constants.ts";
import type { PersistentIndexManager } from "../indexing/index-manager.ts";
import type { IndexStatus } from "../indexing/types.ts";

export interface IndexStatusViewHost {
  readonly indexManager: PersistentIndexManager | null;
  rebuildSemanticIndex(): Promise<void>;
  requestSemanticIndexDeletion(): void;
}

export class IndexStatusView extends ItemView {
  private unsubscribe: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: IndexStatusViewHost
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return INDEX_STATUS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Semantic Links index";
  }

  override getIcon(): string {
    return "database";
  }

  override onOpen(): Promise<void> {
    this.bindManager();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    return Promise.resolve();
  }

  bindManager(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const manager = this.host.indexManager;
    if (manager === null) {
      this.renderEmpty();
      return;
    }
    this.unsubscribe = manager.subscribe((status) => {
      this.renderStatus(status);
    });
  }

  private renderEmpty(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Semantic Links index" });
    this.contentEl.createEl("p", {
      text: "The index service will open after the Obsidian workspace is ready."
    });
  }

  private renderStatus(status: IndexStatus): void {
    this.contentEl.empty();
    this.contentEl.addClass("semantic-links-index-view");
    this.contentEl.createEl("h2", { text: "Semantic Links index" });
    const state = this.contentEl.createDiv({ cls: "semantic-links-index-view__state" });
    state.createEl("strong", { text: formatPhase(status.phase) });
    state.createEl("p", { text: status.message });

    const metrics = this.contentEl.createDiv({ cls: "semantic-links-index-view__metrics" });
    metric(metrics, "Notes", status.documentCount);
    metric(metrics, "Passages", status.chunkCount);
    metric(metrics, "Vectors", status.vectorCount);
    metric(metrics, "Queued", status.queuedCount);

    if (status.totalCount > 0 && status.phase === "indexing") {
      const progress = this.contentEl.createEl("progress", {
        cls: "semantic-links-index-view__progress"
      });
      progress.max = status.totalCount;
      progress.value = status.processedCount;
      this.contentEl.createEl("p", {
        cls: "semantic-links-index-view__progress-label",
        text: `${status.processedCount} of ${status.totalCount} notes processed`
      });
    }

    if (status.lastCompletedAt !== null) {
      this.contentEl.createEl("p", {
        cls: "semantic-links-index-view__completed",
        text: `Last completed ${new Date(status.lastCompletedAt).toLocaleString()}`
      });
    }

    const actions = this.contentEl.createDiv({ cls: "semantic-links-index-view__actions" });
    const rebuild = actions.createEl("button", { text: "Rebuild index" });
    rebuild.disabled = status.phase === "indexing" || status.phase === "deleting";
    rebuild.addEventListener("click", () => {
      void this.host.rebuildSemanticIndex();
    });
    const remove = actions.createEl("button", {
      cls: "mod-warning",
      text: "Delete local index"
    });
    remove.disabled = status.phase === "indexing" || status.phase === "deleting";
    remove.addEventListener("click", () => {
      this.host.requestSemanticIndexDeletion();
    });
  }
}

function metric(container: HTMLElement, label: string, value: number): void {
  const item = container.createDiv({ cls: "semantic-links-index-view__metric" });
  item.createEl("span", { text: label });
  item.createEl("strong", { text: String(value) });
}

function formatPhase(phase: IndexStatus["phase"]): string {
  switch (phase) {
    case "closed": return "Closed";
    case "opening": return "Opening";
    case "ready": return "Ready";
    case "indexing": return "Indexing";
    case "paused": return "Disabled";
    case "deleting": return "Deleting";
    case "error": return "Error";
  }
}
