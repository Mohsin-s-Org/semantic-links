import {
  env,
  LogLevel,
  pipeline,
  type FeatureExtractionPipeline,
  type ProgressEvent
} from "@semantic-links/transformers";
import type {
  EmbeddingClient,
  EmbeddingInput,
  EmbeddingOutput
} from "../indexing/types.ts";
import { InferenceScheduler } from "./inference-scheduler.ts";
import {
  LOCAL_MODEL_CACHE_KEY,
  LOCAL_MODEL_DESCRIPTOR,
  LOCAL_MODEL_DIMENSIONS,
  LOCAL_MODEL_ID,
  LOCAL_MODEL_REVISION
} from "./model-config.ts";

export type ModelProgressListener = (message: string, percent: number | null) => void;

const QUERY_PRIORITY = 0;
const INDEX_PRIORITY = 1;

export class LocalEmbeddingClient implements EmbeddingClient {
  readonly descriptor = LOCAL_MODEL_DESCRIPTOR;

  private readonly scheduler = new InferenceScheduler();
  private disposed = false;

  private constructor(private readonly extractor: FeatureExtractionPipeline) {}

  static async create(
    allowDownload: boolean,
    onProgress?: ModelProgressListener
  ): Promise<LocalEmbeddingClient> {
    configureEnvironment(allowDownload);
    onProgress?.(
      allowDownload ? "Preparing the local semantic model." : "Loading the cached semantic model.",
      null
    );
    const extractor = await pipeline("feature-extraction", LOCAL_MODEL_ID, {
      revision: LOCAL_MODEL_REVISION,
      dtype: "q8",
      local_files_only: !allowDownload,
      progress_callback: (event) => reportProgress(event, onProgress)
    });
    const client = new LocalEmbeddingClient(extractor);
    await client.embedQuery("warm up local semantic matching", new AbortController().signal);
    onProgress?.("The local semantic model is ready.", 100);
    return client;
  }

  embed(
    inputs: readonly EmbeddingInput[],
    signal: AbortSignal
  ): Promise<EmbeddingOutput[]> {
    return this.scheduler.run(INDEX_PRIORITY, async () => {
      throwIfUnavailable(this.disposed, signal);
      const vectors = await this.run(inputs.map((input) => input.text), signal);
      return inputs.map((input, index) => ({
        id: input.id,
        vector: vectors[index] ?? missingVector(input.id)
      }));
    });
  }

  embedQuery(text: string, signal: AbortSignal): Promise<Float32Array> {
    return this.scheduler.run(QUERY_PRIORITY, async () => {
      throwIfUnavailable(this.disposed, signal);
      const [vector] = await this.run([`query: ${text}`], signal);
      if (vector === undefined) {
        throw new Error("The local model did not return a query vector.");
      }
      return vector;
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    void Promise.resolve(this.extractor.dispose()).catch(() => undefined);
  }

  private async run(texts: string[], signal: AbortSignal): Promise<Float32Array[]> {
    throwIfUnavailable(this.disposed, signal);
    const output = await this.extractor(texts, {
      pooling: "mean",
      normalize: true
    });
    throwIfUnavailable(this.disposed, signal);
    return splitOutput(output.data, output.dims, texts.length);
  }
}

function configureEnvironment(allowDownload: boolean): void {
  if (!("caches" in globalThis)) {
    throw new Error("Obsidian's local cache API is unavailable, so the semantic model cannot be stored safely.");
  }
  env.allowRemoteModels = allowDownload;
  env.allowLocalModels = false;
  env.useFS = false;
  env.useFSCache = false;
  env.useBrowserCache = true;
  env.useWasmCache = true;
  env.cacheKey = LOCAL_MODEL_CACHE_KEY;
  env.logLevel = LogLevel.ERROR;
  const wasm = env.backends.onnx.wasm ?? {};
  wasm.proxy = true;
  wasm.simd = true;
  wasm.numThreads = 0;
  env.backends.onnx.wasm = wasm;
}

function splitOutput(
  data: Float32Array | number[],
  dims: readonly number[],
  count: number
): Float32Array[] {
  const values = data instanceof Float32Array ? data : new Float32Array(data);
  const dimensions = dims.at(-1) ?? 0;
  if (dimensions !== LOCAL_MODEL_DIMENSIONS || values.length !== count * dimensions) {
    throw new Error(
      `The local model returned ${values.length} values for ${count} inputs; expected ${count * LOCAL_MODEL_DIMENSIONS}.`
    );
  }
  const vectors: Float32Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const vector = values.slice(index * dimensions, (index + 1) * dimensions);
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new Error("The local model returned a non-finite embedding value.");
    }
    vectors.push(vector);
  }
  return vectors;
}

function reportProgress(
  event: ProgressEvent,
  listener?: ModelProgressListener
): void {
  if (listener === undefined) {
    return;
  }
  const percent = typeof event.progress === "number"
    ? Math.max(0, Math.min(100, event.progress))
    : typeof event.loaded === "number" && typeof event.total === "number" && event.total > 0
      ? Math.max(0, Math.min(100, (event.loaded / event.total) * 100))
      : null;
  const file = typeof event.file === "string" ? ` ${shortName(event.file)}` : "";
  listener(`${formatStatus(event.status)}${file}`.trim(), percent);
}

function formatStatus(status: string | undefined): string {
  switch (status) {
    case "initiate": return "Preparing";
    case "download": return "Downloading";
    case "progress": return "Downloading";
    case "done": return "Cached";
    case "ready": return "Ready";
    default: return "Preparing model";
  }
}

function shortName(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function throwIfUnavailable(disposed: boolean, signal: AbortSignal): void {
  if (disposed) {
    throw new Error("The local semantic model has been unloaded.");
  }
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The embedding request was cancelled.", "AbortError");
  }
}

function missingVector(id: string): never {
  throw new Error(`The local model omitted the embedding for ${id}.`);
}
