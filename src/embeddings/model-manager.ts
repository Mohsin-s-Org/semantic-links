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
      return null;
    }
    const cached = this.queryCache.get(text);
    if (cached !== undefined) {
      this.queryCache.delete(text);
      this.queryCache.set(text, cached);
      return new Float32Array(cached);
    }
    const vector = await client.embedQuery(text, signal);
    this.queryCache.set(text, vector);
    while (this.queryCache.size > 48) {
      const oldest = this.queryCache.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.queryCache.delete(oldest);
    }
    return new Float32Array(vector);
  }

  unload(): void {
    this.clientValue?.dispose();
    this.clientValue = null;
    this.queryCache.clear();
    this.update({
      state: "disabled",
      message: "The local semantic model is installed but unloaded.",
      percent: null
    });
  }

  async remove(): Promise<void> {
    this.clientValue?.dispose();
    this.clientValue = null;
    this.queryCache.clear();
    await deleteModelCache();
    this.update({
      state: "not-installed",
      message: "The local semantic model was removed.",
      percent: null
    });
  }

  dispose(): void {
    this.clientValue?.dispose();
    this.clientValue = null;
    this.queryCache.clear();
    this.listeners.clear();
  }

  private load(allowDownload: boolean): Promise<LocalEmbeddingClient> {
    if (this.clientValue !== null) {
      return Promise.resolve(this.clientValue);
    }
    if (this.loading !== null) {
      return this.loading;
    }
    const loading = this.loadOnce(allowDownload).finally(() => {
      if (this.loading === loading) {
        this.loading = null;
      }
    });
    this.loading = loading;
    return loading;
  }

  private async loadOnce(allowDownload: boolean): Promise<LocalEmbeddingClient> {
    this.update({
      state: "loading",
      message: allowDownload ? "Downloading and verifying the local semantic model." : "Loading the cached semantic model.",
      percent: null
    });
    const onProgress: ModelProgressListener = (message, percent) => {
      this.update({ state: "loading", message, percent });
    };
    try {
      const client = await LocalEmbeddingClient.create(allowDownload, onProgress);
      this.clientValue = client;
      this.update({ state: "ready", message: "Local semantic matching is ready.", percent: 100 });
      return client;
    } catch (error) {
      if (allowDownload) {
        await deleteModelCache();
      }
      this.update({
        state: "error",
        message: error instanceof Error ? error.message : "The local semantic model could not be loaded.",
        percent: null
      });
      throw error;
    }
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
