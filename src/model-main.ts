import { Notice } from "obsidian";
import BaseSemanticLinksPlugin from "./main.ts";
import {
  DOWNLOAD_MODEL_COMMAND_ID,
  REMOVE_MODEL_COMMAND_ID
} from "./constants.ts";
import type { SuggestionContext } from "./editor/context.ts";
import { LocalModelManager } from "./embeddings/model-manager.ts";
import type { SemanticMatch } from "./retrieval/semantic-types.ts";
import { ModelRemovalModal } from "./ui/model-removal-modal.ts";
import { ModelSetupModal } from "./ui/model-setup-modal.ts";

export default class SemanticLinksPlugin extends BaseSemanticLinksPlugin {
  private readonly semanticLifecycle = new AbortController();
  private readonly modelManager = new LocalModelManager();

  override async onload(): Promise<void> {
    await super.onload();

    this.addCommand({
      id: DOWNLOAD_MODEL_COMMAND_ID,
      name: "Download local semantic model",
      callback: () => this.openModelSetup()
    });
    this.addCommand({
      id: REMOVE_MODEL_COMMAND_ID,
      name: "Remove local semantic model and vectors",
      callback: () => this.confirmModelRemoval()
    });

    this.app.workspace.onLayoutReady(() => {
      void this.loadCachedModel().catch(() => {
        new Notice("The cached semantic model could not be loaded. Lexical suggestions remain available.");
      });
    });
  }

  override onunload(): void {
    this.semanticLifecycle.abort();
    this.modelManager.dispose();
    super.onunload();
  }

  protected override async searchSemanticMatches(
    context: SuggestionContext,
    sourcePath: string,
    signal: AbortSignal
  ): Promise<SemanticMatch[]> {
    if (!this.settings.semanticModelEnabled) {
      return [];
    }
    const file = this.app.workspace.getActiveFile();
    const manager = this.indexManager;
    if (
      file === null
      || manager === null
      || file.path !== sourcePath
      || this.modelManager.client === null
    ) {
      return [];
    }
    const query = [
      `Note: ${file.basename}`,
      context.sentence,
      context.paragraph
    ].filter((part, index, values) => part.length > 0 && values.indexOf(part) === index)
      .join("\n")
      .slice(0, 1_200);
    const vector = await this.modelManager.embedQuery(query, signal);
    return vector === null ? [] : manager.searchSemantic(vector, sourcePath, 40);
  }

  private openModelSetup(): void {
    let unsubscribe = (): void => undefined;
    const modal = new ModelSetupModal(
      this.app,
      async () => {
        const client = await this.modelManager.download();
        this.settings.semanticModelInstalled = true;
        this.settings.semanticModelEnabled = true;
        this.settings.semanticIndexingEnabled = true;
        await this.saveSettings();
        await (await this.waitForIndexManager())?.setEmbeddingClient(client);
        new Notice("Local semantic matching is enabled.");
      },
      async () => {
        this.settings.semanticModelEnabled = false;
        await this.saveSettings();
      },
      () => unsubscribe()
    );
    unsubscribe = this.modelManager.subscribe((status) => modal.updateStatus(status));
    modal.open();
  }

  private confirmModelRemoval(): void {
    new ModelRemovalModal(this.app, () => {
      void this.removeModel().catch(() => {
        new Notice("The local semantic model could not be removed completely.");
      });
    }).open();
  }

  private async removeModel(): Promise<void> {
    await this.indexManager?.setEmbeddingClient(null, true);
    await this.modelManager.remove();
    this.settings.semanticModelEnabled = false;
    this.settings.semanticModelInstalled = false;
    await this.saveSettings();
    new Notice("The local semantic model and vectors were removed.");
  }

  private async loadCachedModel(): Promise<void> {
    if (
      !this.settings.semanticModelInstalled
      || !this.settings.semanticModelEnabled
      || this.semanticLifecycle.signal.aborted
    ) {
      return;
    }
    const client = await this.modelManager.loadCached();
    await (await this.waitForIndexManager())?.setEmbeddingClient(client);
  }

  private async waitForIndexManager(): Promise<typeof this.indexManager> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.semanticLifecycle.signal.aborted) {
        return null;
      }
      if (this.indexManager !== null) {
        return this.indexManager;
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
    }
    return null;
  }
}
