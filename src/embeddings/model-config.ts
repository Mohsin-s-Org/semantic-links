import type { ModelDescriptor } from "../indexing/types.ts";

export const LOCAL_MODEL_ID = "Xenova/multilingual-e5-small";
export const LOCAL_MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export const LOCAL_MODEL_CACHE_KEY = "semantic-links-e5-small-v1";
export const LOCAL_MODEL_APPROXIMATE_BYTES = 150_000_000;
export const LOCAL_MODEL_DIMENSIONS = 384;

export const LOCAL_MODEL_DESCRIPTOR: Readonly<ModelDescriptor> = Object.freeze({
  id: LOCAL_MODEL_ID,
  revision: LOCAL_MODEL_REVISION,
  quantization: "q8",
  dimensions: LOCAL_MODEL_DIMENSIONS,
  tokenizerVersion: LOCAL_MODEL_REVISION,
  runtimeVersion: "transformers.js-4.2.0"
});
