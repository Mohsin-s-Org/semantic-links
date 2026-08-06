import { semanticDiagnostics } from "../diagnostics/performance.ts";
import {
  LocalEmbeddingClient,
  type ModelProgressListener
} from "./local-embedding-client.ts";
import { LOCAL_MODEL_CACHE_KEY } from "./model-config.ts";
import {
  runThreadBenchmark,
  type ThreadBenchmarkProgress,
  type ThreadBenchmarkResult
} from "./thread-benchmark.ts";
import type { WasmThreadCount } from "./thread-tuning.ts";

export type ModelState = "not-installed" | "disabled" | "loading" | "ready" | "error";

export interface ModelStatus {
  state: ModelState;
  message: string;
  percent: number | null;
}

export interface ThreadTuningOutcome {
  client: LocalEmbeddingClient;
  benchmark: ThreadBenchmarkResult | null;
  restoredAutomatic: boolean;
}

type StatusListener = (status: ModelStatus) => void;

export class LocalModelManager {
  private readonly listeners = new Set<StatusListener>();
  private readonly queryCache = new Map<string, Float32Array>();
  private clientValue: LocalEmbeddingClient | null = null;
  private loading: Promise<LocalEmbeddingClient> | null = null;
  private loadingController: AbortController | null = null;
  private configuredThreadsValue: WasmThreadCount = 0;
  private disposed = false;
  private statusValue: ModelStatus = {
    state: "not-installed",
    message: "The local semantic model is not installed.",
    percent: null
  };

  get client(): LocalEmbeddingClient | null {
    return this.clientValue;
  }

  get configuredThreads(): WasmThreadCount {
    return this.configuredThreadsValue;
  }

  get status(): ModelStatus {
    return { ...this.statusValue };
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  configureThreads(threads: WasmThreadCount): void {
    this.configuredThreadsValue = threads;
  }

  loadCached(): Promise<LocalEmbeddingClient> {
    return this.load(false);
  }

  download(): Promise<LocalEmbeddingClient> {
    return this.load(true);
  }

  async tuneThreads(
    signal: AbortSignal,
    onProgress?: (progress: ThreadBenchmarkProgress) => void
  ): Promise<ThreadTuningOutcome> {
    this.throwIfDisposed();
    this.cancelLoading();
    this.releaseClient();
    this.update({
      state: "loading",
      message: "Testing conservative local inference thread settings.",
      percent: 0
    });

    try {
      const benchmark = await runThreadBenchmark(
        (threads, candidateSignal) => LocalEmbeddingClient.create(
          false,
          candidateSignal,
          undefined,
          { threads }
        ),
        globalThis.navigator?.hardwareConcurrency,
        signal,
        {
          onProgress: (progress) => {
            onProgress?.(progress);
            const completed = progress.candidateIndex * progress.sampleCount
              + progress.sample;
            const total = progress.candidateCount * progress.sampleCount;
            this.update({
              state: "loading",
              message: `Testing ${formatThreads(progress.threads)} (${completed}/${total}).`,
              percent: total > 0 ? Math.round(completed / total * 100) : null
            });
          }
        }
      );
      const threads = benchmark.decision.threads;
      this.configuredThreadsValue = threads;
      const client = await this.createCachedClient(threads, signal);
      this.installClient(client, `Local semantic matching is ready with ${formatThreads(threads)}.`);
      semanticDiagnostics.setGauge("thread_tuning.selected_threads", threads);
      semanticDiagnostics.increment(`thread_tuning.selection_${benchmark.decision.reason}`);
      return {
        client,
        benchmark,
        restoredAutomatic: false
      };
    } catch (error) {
      this.configuredThreadsValue = 0;
      const client = await this.restoreAutomaticClient();
      if (signal.aborted) {
        semanticDiagnostics.increment("thread_tuning.cancelled");
        return {
          client,
          benchmark: null,
          restoredAutomatic: true
        };
      }
      semanticDiagnostics.increment("thread_tuning.error_fallback");
      throw error;
    }
  }

  async embedQuery(text: string, signal: AbortSignal): Promise<Float32Array | null> {
    const client = this.clientValue;
    if (client === null) {
      semanticDiagnostics.increment("query.unavailable_count");
      return null;
    }
    const cached = this.queryCache.get(text);
    if (cached !== undefined) {
      semanticDiagnostics.increment("query.cache_hit");
      this.queryCache.delete(text);
      this.queryCache.set(text, cached);
      this.updateCacheGauges();
      return semanticDiagnostics.measureSync("query.cache_copy_ms", () => {
        return new Float32Array(cached);
      });
    }
    semanticDiagnostics.increment("query.cache_miss");
    const vector = await semanticDiagnostics.measure("query.embed_total_ms", () => {
      return client.embedQuery(text, signal);
    });
    this.queryCache.set(text, vector);
    while (this.queryCache.size > 48) {
      const oldest = this.queryCache.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.queryCache.delete(oldest);
      semanticDiagnostics.increment("query.cache_eviction");
    }
    this.updateCacheGauges();
    return semanticDiagnostics.measureSync("query.cache_copy_ms", () => {
      return new Float32Array(vector);
    });
  }

  cancelLoading(): void {
    if (this.loadingController === null) {
      return;
    }
    this.loadingController.abort();
    semanticDiagnostics.increment("model.load_cancelled");
    if (this.statusValue.state === "loading") {
      this.update({
        state: this.clientValue === null ? "not-installed" : "ready",
        message: "Model setup was cancelled.",
        percent: null
      });
    }
  }

  unload(): void {
    this.cancelLoading();
    this.releaseClient();
    semanticDiagnostics.captureMemory("unload");
    this.update({
      state: "disabled",
      message: "The local semantic model is installed but unloaded.",
      percent: null
    });
  }

  async remove(): Promise<void> {
    this.cancelLoading();
    this.releaseClient();
    await semanticDiagnostics.measure("model.cache_delete_ms", deleteModelCache);
    this.update({
      state: "not-installed",
      message: "The local semantic model was removed.",
      percent: null
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelLoading();
    this.releaseClient();
    this.listeners.clear();
  }

  private load(allowDownload: boolean): Promise<LocalEmbeddingClient> {
    this.throwIfDisposed();
    if (this.clientValue !== null) {
      semanticDiagnostics.increment("model.load_reused");
      return Promise.resolve(this.clientValue);
    }
    if (this.loading !== null) {
      semanticDiagnostics.increment("model.load_deduplicated");
      return this.loading;
    }
    const controller = new AbortController();
    this.loadingController = controller;
    const loading = this.loadOnce(allowDownload, controller.signal).finally(() => {
      if (this.loading === loading) {
        this.loading = null;
        this.loadingController = null;
      }
    });
    this.loading = loading;
    return loading;
  }

  private async loadOnce(
    allowDownload: boolean,
    signal: AbortSignal
  ): Promise<LocalEmbeddingClient> {
    this.update({
      state: "loading",
      message: allowDownload ? "Downloading and verifying the local semantic model." : "Loading the cached semantic model.",
      percent: null
    });
    const onProgress: ModelProgressListener = (message, percent) => {
      this.update({ state: "loading", message, percent });
    };
    try {
      const client = await LocalEmbeddingClient.create(
        allowDownload,
        signal,
        onProgress,
        { threads: this.configuredThreadsValue }
      );
      if (signal.aborted) {
        client.dispose();
        throw abortError(signal);
      }
      this.installClient(client, "Local semantic matching is ready.");
      return client;
    } catch (error) {
      semanticDiagnostics.increment("model.load_error");
      if (allowDownload) {
        await deleteModelCache();
      }
      if (!signal.aborted) {
        this.update({
          state: "error",
          message: error instanceof Error ? error.message : "The local semantic model could not be loaded.",
          percent: null
        });
      }
      throw error;
    }
  }

  private createCachedClient(
    threads: WasmThreadCount,
    signal: AbortSignal
  ): Promise<LocalEmbeddingClient> {
    return LocalEmbeddingClient.create(false, signal, undefined, { threads });
  }

  private async restoreAutomaticClient(): Promise<LocalEmbeddingClient> {
    this.throwIfDisposed();
    const recovery = new AbortController();
    const client = await this.createCachedClient(0, recovery.signal);
    this.installClient(client, "Thread tuning stopped; automatic local inference is ready.");
    return client;
  }

  private installClient(client: LocalEmbeddingClient, message: string): void {
    this.releaseClient();
    this.clientValue = client;
    semanticDiagnostics.captureMemory("reload");
    this.update({ state: "ready", message, percent: 100 });
  }

  private releaseClient(): void {
    this.clientValue?.dispose();
    this.clientValue = null;
    this.queryCache.clear();
    this.updateCacheGauges();
  }

  private throwIfDisposed(): void {
    if (this.disposed) {
      throw new Error("The local model manager has been disposed.");
    }
  }

  private updateCacheGauges(): void {
    let bytes = 0;
    for (const vector of this.queryCache.values()) {
      bytes += vector.byteLength;
    }
    semanticDiagnostics.setGauge("query.cache_entries", this.queryCache.size);
    semanticDiagnostics.setGauge("query.cache_bytes", bytes);
  }

  private update(status: ModelStatus): void {
    this.statusValue = status;
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}

async function deleteModelCache(): Promise<void> {
  if ("caches" in globalThis) {
    await globalThis.caches.delete(LOCAL_MODEL_CACHE_KEY);
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The model setup was cancelled.", "AbortError");
}

function formatThreads(threads: WasmThreadCount): string {
  return threads === 0 ? "automatic threads" : `${threads} WASM thread${threads === 1 ? "" : "s"}`;
}
