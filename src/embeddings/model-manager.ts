import { semanticDiagnostics } from "../diagnostics/performance.ts";
import { LocalEmbeddingClient, type ModelProgressListener } from "./local-embedding-client.ts";
import { LOCAL_MODEL_CACHE_KEY } from "./model-config.ts";

export type ModelState = "not-installed" | "disabled" | "loading" | "ready" | "error";

export interface ModelStatus {
  state: ModelState;
  message: string;
  percent: number | null;
}

type StatusListener = (status: ModelStatus) => void;

export class LocalModelManager {
  private readonly listeners = new Set<StatusListener>();
  private readonly queryCache = new Map<string, Float32Array>();
  private clientValue: LocalEmbeddingClient | null = null;
  private loading: Promise<LocalEmbeddingClient> | null = null;
  private loadingController: AbortController | null = null;
  private statusValue: ModelStatus = {
    state: "not-installed",
    message: "The local semantic model is not installed.",
    percent: null
  };

  get client(): LocalEmbeddingClient | null {
    return this.clientValue;
  }

  get status(): ModelStatus {
    return { ...this.statusValue };
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  loadCached(): Promise<LocalEmbeddingClient> {
    return this.load(false);
  }

  download(): Promise<LocalEmbeddingClient> {
    return this.load(true);
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
    this.clientValue?.dispose();
    this.clientValue = null;
    this.queryCache.clear();
    this.updateCacheGauges();
    semanticDiagnostics.captureMemory("unload");
    this.update({
      state: "disabled",
      message: "The local semantic model is installed but unloaded.",
      percent: null
    });
  }

  async remove(): Promise<void> {
    this.cancelLoading();
    this.clientValue?.dispose();
    this.clientValue = null;
    this.queryCache.clear();
    this.updateCacheGauges();
    await semanticDiagnostics.measure("model.cache_delete_ms", deleteModelCache);
    this.update({
      state: "not-installed",
      message: "The local semantic model was removed.",
      percent: null
    });
  }

  dispose(): void {
    this.cancelLoading();
    this.clientValue?.dispose();
    this.clientValue = null;
    this.queryCache.clear();
    this.updateCacheGauges();
    this.listeners.clear();
  }

  private load(allowDownload: boolean): Promise<LocalEmbeddingClient> {
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
        onProgress
      );
      if (signal.aborted) {
        client.dispose();
        throw abortError(signal);
      }
      this.clientValue = client;
      semanticDiagnostics.captureMemory("reload");
      this.update({ state: "ready", message: "Local semantic matching is ready.", percent: 100 });
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
