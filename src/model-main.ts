import { Notice } from "obsidian";
import {
  COPY_DIAGNOSTICS_REPORT_COMMAND_ID,
  DOWNLOAD_MODEL_COMMAND_ID,
  REMOVE_MODEL_COMMAND_ID,
  RUN_RELEVANCE_EVALUATION_COMMAND_ID,
  START_DIAGNOSTICS_COMMAND_ID,
  STOP_DIAGNOSTICS_COMMAND_ID
} from "./constants.ts";
import { semanticDiagnostics } from "./diagnostics/performance.ts";
import type { SuggestionContext } from "./editor/context.ts";
import { LocalModelManager } from "./embeddings/model-manager.ts";
import { runLocalRelevanceEvaluation } from "./evaluation/local-evaluation.ts";
import BaseSemanticLinksPlugin from "./main.ts";
import type { SemanticMatch } from "./retrieval/semantic-types.ts";
import { ModelRemovalModal } from "./ui/model-removal-modal.ts";
import { ModelSetupModal } from "./ui/model-setup-modal.ts";

export default class SemanticLinksPlugin extends BaseSemanticLinksPlugin {
  private readonly semanticLifecycle = new AbortController();
  private readonly modelManager = new LocalModelManager();
  private evaluationController: AbortController | null = null;

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
      callback: () => this.requestModelRemoval()
    });
    this.addCommand({
      id: START_DIAGNOSTICS_COMMAND_ID,
      name: "Start local semantic diagnostics",
      callback: () => this.startDiagnostics()
    });
    this.addCommand({
      id: COPY_DIAGNOSTICS_REPORT_COMMAND_ID,
      name: "Copy local semantic diagnostics report",
      callback: () => {
        void this.copyDiagnosticsReport(false).catch(() => {
          new Notice("The local diagnostics report could not be copied.");
        });
      }
    });
    this.addCommand({
      id: STOP_DIAGNOSTICS_COMMAND_ID,
      name: "Stop diagnostics and copy report",
      callback: () => {
        void this.copyDiagnosticsReport(true).catch(() => {
          new Notice("The local diagnostics report could not be copied.");
        });
      }
    });
    this.addCommand({
      id: RUN_RELEVANCE_EVALUATION_COMMAND_ID,
      name: "Run local semantic relevance evaluation",
      callback: () => {
        void this.runRelevanceEvaluation().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "The relevance evaluation failed.";
          new Notice(message);
        });
      }
    });

    this.app.workspace.onLayoutReady(() => {
      void this.loadCachedModel().catch(() => {
        new Notice("The cached semantic model could not be loaded. Lexical suggestions remain available.");
      });
    });
  }

  override onunload(): void {
    this.evaluationController?.abort();
    this.evaluationController = null;
    if (semanticDiagnostics.enabled) {
      semanticDiagnostics.stop();
    }
    this.semanticLifecycle.abort();
    this.modelManager.dispose();
    super.onunload();
  }

  protected override async searchSemanticMatches(
    context: SuggestionContext,
    sourcePath: string,
    signal: AbortSignal
  ): Promise<SemanticMatch[]> {
    const finish = semanticDiagnostics.startSpan("query.semantic_total_ms");
    try {
      if (!this.settings.semanticModelEnabled) {
        semanticDiagnostics.increment("query.semantic_disabled");
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
        semanticDiagnostics.increment("query.semantic_unavailable");
        return [];
      }
      const query = [
        `Note: ${file.basename}`,
        context.sentence,
        context.paragraph
      ].filter((part, index, values) => part.length > 0 && values.indexOf(part) === index)
        .join("\n")
        .slice(0, 1_200);
      semanticDiagnostics.setGauge("query.context_characters", query.length);
      const vector = await this.modelManager.embedQuery(query, signal);
      const matches = vector === null
        ? []
        : await manager.searchSemantic(vector, sourcePath, 40, signal);
      semanticDiagnostics.setGauge("query.semantic_result_count", matches.length);
      return matches;
    } finally {
      finish();
    }
  }

  openModelSetup(): void {
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
      () => {
        unsubscribe();
        this.modelManager.cancelLoading();
      }
    );
    unsubscribe = this.modelManager.subscribe((status) => modal.updateStatus(status));
    modal.open();
  }

  requestModelRemoval(): void {
    new ModelRemovalModal(this.app, () => {
      void this.removeModel().catch(() => {
        new Notice("The local semantic model could not be removed completely.");
      });
    }).open();
  }

  async setModelEnabled(enabled: boolean): Promise<void> {
    if (!this.settings.semanticModelInstalled) {
      this.settings.semanticModelEnabled = false;
      return;
    }
    if (enabled) {
      const client = await this.modelManager.loadCached();
      await (await this.waitForIndexManager())?.setEmbeddingClient(client);
    } else {
      await this.indexManager?.setEmbeddingClient(null);
      this.modelManager.unload();
    }
    this.settings.semanticModelEnabled = enabled;
    await this.saveSettings();
  }

  private startDiagnostics(): void {
    semanticDiagnostics.start();
    new Notice("Local semantic diagnostics started. No note content is recorded.");
  }

  private async copyDiagnosticsReport(stop: boolean): Promise<void> {
    const report = stop ? semanticDiagnostics.stop() : semanticDiagnostics.report();
    await copyJson(report);
    new Notice(stop
      ? "Diagnostics stopped and the sanitised report was copied."
      : "The sanitised diagnostics report was copied.");
  }

  private async runRelevanceEvaluation(): Promise<void> {
    if (this.evaluationController !== null) {
      new Notice("A local relevance evaluation is already running.");
      return;
    }
    const client = this.modelManager.client;
    if (client === null) {
      new Notice("Enable the local semantic model before running the relevance evaluation.");
      return;
    }

    const controller = new AbortController();
    this.evaluationController = controller;
    const startedDiagnostics = !semanticDiagnostics.enabled;
    if (startedDiagnostics) {
      semanticDiagnostics.start();
    }
    new Notice("Running the 112-case local semantic relevance evaluation.");
    try {
      const relevance = await runLocalRelevanceEvaluation(client, controller.signal);
      const performance = startedDiagnostics
        ? semanticDiagnostics.stop()
        : semanticDiagnostics.report();
      await copyJson({
        schemaVersion: 1,
        relevance,
        performance
      });
      new Notice("The local relevance and performance report was copied.");
    } finally {
      if (startedDiagnostics && semanticDiagnostics.enabled) {
        semanticDiagnostics.stop();
      }
      if (this.evaluationController === controller) {
        this.evaluationController = null;
      }
    }
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
    while (!this.semanticLifecycle.signal.aborted) {
      if (this.indexManager !== null) {
        return this.indexManager;
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
    }
    return null;
  }
}

async function copyJson(value: unknown): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) {
    throw new Error("Clipboard access is unavailable.");
  }
  await clipboard.writeText(JSON.stringify(value, null, 2));
}
