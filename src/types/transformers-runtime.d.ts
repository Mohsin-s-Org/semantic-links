declare module "@semantic-links/transformers" {
  export interface ProgressEvent {
    status?: string;
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
  }

  export interface TensorOutput {
    data: Float32Array | number[];
    dims: number[];
  }

  export interface FeatureExtractionPipeline {
    (
      input: string | string[],
      options: { pooling: "mean"; normalize: true }
    ): Promise<TensorOutput>;
    dispose(): Promise<void> | void;
  }

  export interface TransformersEnvironment {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    useFS: boolean;
    useFSCache: boolean;
    useBrowserCache: boolean;
    useWasmCache: boolean;
    cacheKey: string;
    logLevel: number;
    backends: {
      onnx: {
        wasm?: {
          proxy?: boolean;
          simd?: boolean;
          numThreads?: number;
        };
      };
    };
  }

  export const env: TransformersEnvironment;
  export const LogLevel: Readonly<{ ERROR: number }>;

  export function pipeline(
    task: "feature-extraction",
    model: string,
    options: {
      revision: string;
      dtype: "q8";
      local_files_only: boolean;
      progress_callback?: (event: ProgressEvent) => void;
    }
  ): Promise<FeatureExtractionPipeline>;
}
