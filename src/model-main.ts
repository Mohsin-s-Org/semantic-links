import { Notice } from "obsidian";
import {
  BACKGROUND_BATCH_IDLE_MS,
  COPY_DIAGNOSTICS_REPORT_COMMAND_ID,
  DEFAULT_BACKGROUND_BATCH_SIZE,
  DOWNLOAD_MODEL_COMMAND_ID,
  REMOVE_MODEL_COMMAND_ID,
  RESET_BACKGROUND_TUNING_COMMAND_ID,
  RUN_RELEVANCE_EVALUATION_COMMAND_ID,
  START_DIAGNOSTICS_COMMAND_ID,
  STOP_DIAGNOSTICS_COMMAND_ID,
  TUNE_MODEL_THREADS_COMMAND_ID
} from "./constants.ts";
import { semanticDiagnostics } from "./diagnostics/performance.ts";
import type { SuggestionContext } from "./editor/context.ts";
import { LocalModelManager } from "./embeddings/model-manager.ts";
import {
  LOCAL_MODEL_DESCRIPTOR,
  LOCAL_MODEL_REVISION
} from "./embeddings/model-config.ts";
import type { ThreadBenchmarkResult } from "./embeddings/thread-benchmark.ts";
import {
  approvedThreadCandidates,
  classifyThreadDevice,
  isThreadTuningCompatible,
  type ThreadTuningIdentity
} from "./embeddings/thread-tuning.ts";
import { runLocalRelevanceEvaluation } from "./evaluation/local-evaluation.ts";
import {
  backgroundEmbeddingBatches
} from "./indexing/adaptive-embedding-batches.ts";
import BaseSemanticLinksPlugin from "./main.ts";
import {
  buildSemanticQueryContext
} from "./retrieval/semantic-query-context.ts";
import type { SemanticMatch } from "./retrieval/semantic-types.ts";
import { ModelRemovalModal } from "./ui/model-removal-modal.ts";
import { ModelSetupModal } from "./ui/model-setup-modal.ts";

export default class SemanticLinksPlugin extends BaseSemanticLinksPlugin {
  private readonly semanticLifecycle = new AbortController();
  private readonly modelManager = new LocalModelManager();
  private evaluationController: AbortController | null = null;
  private threadTuningController: AbortController | null = null;

  override async onload(): Promise<void> {
    await super.onload();
    backgroundEmbeddingBatches.configurePersistence(
      this.settings.backgroundEmbeddingBatchLimit,
      (limit) => {
        void this.persistBackgroundBatchLimit(limit).catch(() => undefined);
      }
    );
    await this.configureStoredThreadProfile();

    const markActivity = (): void => backgroundEmbeddingBatches.markActivity();
    this.registerDomEvent(document, "keydown", markActivity, { capture: true });
    this.registerDomEvent(document, "input", markActivity, { capture: true });
    this.registerDomEvent(document, "pointerdown", markActivity, { capture: true });
    this.registerEvent(this.app.workspace.on("active-leaf-change", markActivity));

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
      id: TUNE_MODEL_THREADS_COMMAND_ID,
      name: "Tune local model thread count",
      callback: () => {
        void this.tuneModelThreads().catch(() => {
          new Notice("Local thread tuning could not complete. Automatic threads remain enabled.");
        });
      }
    });
    this.addCommand({
      id: RESET_BACKGROUND_TUNING_COMMAND_ID,
      name: "Reset background embedding tuning",
      callback: () => {
        void this.resetBackgroundBatchTuning().catch(() => {
          new Notice("Background embedding tuning could not be reset.");
        });
      }
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
    this.threadTuningController?.abort();
    this.threadTuningController = null;
    if (semanticDiagnostics.enabled) {
      semanticDiagnostics.stop();
    }
    this.semanticLifecycle.abort();
    this.modelManager.dispose();
    backgroundEmbeddingBatches.configurePersistence(
      DEFAULT_BACKGROUND_BATCH_SIZE
    );
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
      const query = buildSemanticQueryContext(file.basename, context);
      semanticDiagnostics.setGauge("query.context_characters", query.text.length);
      semanticDiagnostics.setGauge("query.context_components", query.componentCount);
      semanticDiagnostics.setGauge(
        "query.explicit_selection",
        context.selection === null ? 0 : 1
      );
      const vector = await this.modelManager.embedQuery(query.text, signal);
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

  async tuneModelThreads(): Promise<void> {
    const running = this.threadTuningController;
    if (running !== null) {
      running.abort(new DOMException("Thread tuning was cancelled.", "AbortError"));
      new Notice("Cancelling thread tuning and restoring automatic inference.");
      return;
    }
    if (
      !this.settings.semanticModelInstalled
      || !this.settings.semanticModelEnabled
      || this.modelManager.client === null
    ) {
      new Notice("Enable the installed local semantic model before tuning threads.");
      return;
    }

    const controller = new AbortController();
    this.threadTuningController = controller;
    const startedDiagnostics = !semanticDiagnostics.enabled;
    if (startedDiagnostics) {
      semanticDiagnostics.start();
    }
    new Notice("Pause typing briefly while local thread settings are tested. Run the command again to cancel.");

    try {
      await waitForQuietEditor(controller.signal);
      const manager = await this.waitForIndexManager();
      await manager?.setEmbeddingClient(null);
      const outcome = await this.modelManager.tuneThreads(controller.signal);
      await manager?.setEmbeddingClient(outcome.client);
      if (outcome.benchmark === null) {
        await this.persistAutomaticThreadProfile();
        new Notice("Thread tuning was cancelled. Automatic inference is restored.");
        return;
      }

      await this.persistThreadDecision(outcome.benchmark);
      const performance = startedDiagnostics
        ? semanticDiagnostics.stop()
        : semanticDiagnostics.report();
      await copyJson({
        schemaVersion: 1,
        identity: currentThreadIdentity(),
        threadTuning: outcome.benchmark,
        performance
      });
      new Notice(formatThreadDecision(outcome.benchmark));
    } catch (error) {
      await this.persistAutomaticThreadProfile();
      const fallback = this.modelManager.client;
      if (fallback !== null) {
        await this.indexManager?.setEmbeddingClient(fallback);
      }
      if (!controller.signal.aborted) {
        const message = error instanceof Error
          ? error.message
          : "Thread tuning failed.";
        new Notice(`${message} Automatic inference is restored.`);
      }
    } finally {
      if (startedDiagnostics && semanticDiagnostics.enabled) {
        semanticDiagnostics.stop();
      }
      if (this.threadTuningController === controller) {
        this.threadTuningController = null;
      }
    }
  }

  async useAutomaticModelThreads(): Promise<void> {
    const running = this.threadTuningController;
    if (running !== null) {
      running.abort(new DOMException("Automatic thread mode was selected.", "AbortError"));
      new Notice("Cancelling thread tuning and restoring automatic inference.");
      return;
    }
    await this.persistAutomaticThreadProfile();
    if (
      this.settings.semanticModelInstalled
      && this.settings.semanticModelEnabled
    ) {
      await this.indexManager?.setEmbeddingClient(null);
      this.modelManager.unload();
      const client = await this.modelManager.loadCached();
      await this.indexManager?.setEmbeddingClient(client);
    }
    new Notice("Automatic local inference threads are enabled.");
  }

  async resetBackgroundBatchTuning(): Promise<void> {
    backgroundEmbeddingBatches.resetTuning();
    this.settings.backgroundEmbeddingBatchLimit = DEFAULT_BACKGROUND_BATCH_SIZE;
    await this.saveData(this.settings);
    new Notice("Background embedding tuning was reset to the conservative batch size.");
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
    await this.persistAutomaticThreadProfile();
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

  private async configureStoredThreadProfile(): Promise<void> {
    const identity = currentThreadIdentity();
    const compatible = this.settings.semanticThreadMode === "tuned"
      && isThreadTuningCompatible({
        modelRevision: this.settings.semanticThreadModelRevision,
        runtimeVersion: this.settings.semanticThreadRuntimeVersion,
        deviceClass: this.settings.semanticThreadDeviceClass
      }, identity)
      && approvedThreadCandidates(globalThis.navigator?.hardwareConcurrency)
        .includes(this.settings.semanticThreadCount)
      && this.settings.semanticThreadCount !== 0;
    if (compatible) {
      this.modelManager.configureThreads(this.settings.semanticThreadCount);
      return;
    }
    this.modelManager.configureThreads(0);
    if (this.settings.semanticThreadMode !== "automatic") {
      await this.persistAutomaticThreadProfile();
    }
  }

  private async persistThreadDecision(
    benchmark: ThreadBenchmarkResult
  ): Promise<void> {
    const threads = benchmark.decision.threads;
    if (threads === 0) {
      await this.persistAutomaticThreadProfile();
      return;
    }
    const identity = currentThreadIdentity();
    this.settings.semanticThreadMode = "tuned";
    this.settings.semanticThreadCount = threads;
    this.settings.semanticThreadModelRevision = identity.modelRevision;
    this.settings.semanticThreadRuntimeVersion = identity.runtimeVersion;
    this.settings.semanticThreadDeviceClass = identity.deviceClass;
    this.modelManager.configureThreads(threads);
    await this.saveData(this.settings);
  }

  private async persistAutomaticThreadProfile(): Promise<void> {
    this.settings.semanticThreadMode = "automatic";
    this.settings.semanticThreadCount = 0;
    this.settings.semanticThreadModelRevision = "";
    this.settings.semanticThreadRuntimeVersion = "";
    this.settings.semanticThreadDeviceClass = "unknown";
    this.modelManager.configureThreads(0);
    await this.saveData(this.settings);
  }

  private async persistBackgroundBatchLimit(limit: number): Promise<void> {
    if (this.settings.backgroundEmbeddingBatchLimit === limit) {
      return;
    }
    this.settings.backgroundEmbeddingBatchLimit = limit;
    await this.saveData(this.settings);
  }

  private async waitForIndexManager(): Promise<typeof this.indexManager> {
    while (!this.semanticLifecycle.signal.aborted) {
      if (this.indexManager !== null) {
        return this.indexManager;
      }
      await delay(50, this.semanticLifecycle.signal);
    }
    return null;
  }
}

function currentThreadIdentity(): ThreadTuningIdentity {
  return {
    modelRevision: LOCAL_MODEL_REVISION,
    runtimeVersion: LOCAL_MODEL_DESCRIPTOR.runtimeVersion,
    deviceClass: classifyThreadDevice(globalThis.navigator?.hardwareConcurrency)
  };
}

async function waitForQuietEditor(signal: AbortSignal): Promise<void> {
  while (backgroundEmbeddingBatches.snapshot().idleForMs < BACKGROUND_BATCH_IDLE_MS) {
    await delay(100, signal);
  }
}

function formatThreadDecision(result: ThreadBenchmarkResult): string {
  const { threads, reason } = result.decision;
  if (threads !== 0) {
    return `Selected ${threads} local WASM thread${threads === 1 ? "" : "s"}. The sanitised report was copied.`;
  }
  return reason === "automatic-within-noise"
    ? "Automatic threads matched the tested options within noise. The sanitised report was copied."
    : "The thread benchmark was inconclusive, so automatic threads remain enabled. The sanitised report was copied.";
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      globalThis.clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was cancelled.", "AbortError");
}

async function copyJson(value: unknown): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) {
    throw new Error("Clipboard access is unavailable.");
  }
  await clipboard.writeText(JSON.stringify(value, null, 2));
}
