import { createHash } from "node:crypto";
import { ORT_ASSETS, ORT_VERSION } from "@semantic-links/runtime-integrity";
import {
  LOCAL_MODEL_ID,
  LOCAL_MODEL_REVISION
} from "./model-config.ts";

interface AssetExpectation {
  sha256?: string;
  size?: number;
  json?: boolean;
}

const MODEL_PREFIX = `/${LOCAL_MODEL_ID}/resolve/${LOCAL_MODEL_REVISION}/`;
const ORT_PREFIX = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_ASSETS: Readonly<Record<string, AssetExpectation>> = Object.freeze({
  "config.json": { size: 658, json: true },
  "quant_config.json": { size: 674, json: true },
  "special_tokens_map.json": { size: 167, json: true },
  "tokenizer_config.json": { size: 443, json: true },
  "tokenizer.json": {
    sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"
  },
  "sentencepiece.bpe.model": {
    sha256: "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865"
  },
  "onnx/model_quantized.onnx": {
    sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193"
  }
});

export function createVerifiedFetch(
  fetcher: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): typeof globalThis.fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    const expectation = expectationFor(url);
    const response = await fetcher(input, init);
    if (!response.ok || expectation === null) {
      return response;
    }
    return expectation.json
      ? verifySmallJson(response, expectation, url)
      : verifyStream(response, expectation, url);
  };
}

export function onnxWasmPaths(): { mjs: string; wasm: string } {
  const suffix = isSafari()
    ? "ort-wasm-simd-threaded"
    : "ort-wasm-simd-threaded.asyncify";
  return {
    mjs: `${ORT_PREFIX}${suffix}.mjs`,
    wasm: `${ORT_PREFIX}${suffix}.wasm`
  };
}

function expectationFor(url: URL): AssetExpectation | null {
  if (url.hostname === "huggingface.co" && url.pathname.startsWith(MODEL_PREFIX)) {
    const relative = decodeURIComponent(url.pathname.slice(MODEL_PREFIX.length));
    const expectation = MODEL_ASSETS[relative];
    if (expectation === undefined) {
      throw new Error(`The pinned model requested an unapproved asset: ${relative}`);
    }
    return expectation;
  }
  if (url.href.startsWith(ORT_PREFIX)) {
    const name = url.href.slice(ORT_PREFIX.length).split(/[?#]/u, 1)[0] ?? "";
    const asset = ORT_ASSETS[name];
    if (asset === undefined) {
      throw new Error(`The ONNX runtime requested an unapproved asset: ${name}`);
    }
    return asset;
  }
  return null;
}

async function verifySmallJson(
  response: Response,
  expectation: AssetExpectation,
  url: URL
): Promise<Response> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifySize(bytes.byteLength, expectation.size, url);
  try {
    JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`Downloaded model metadata is not valid JSON: ${url.pathname}`);
  }
  return copyResponse(response, bytes);
}

function verifyStream(
  response: Response,
  expectation: AssetExpectation,
  url: URL
): Response {
  const body = response.body;
  if (body === null) {
    throw new Error(`Downloaded asset has no response body: ${url.pathname}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 0) {
    verifySize(declared, expectation.size, url);
  }
  const hash = createHash("sha256");
  let received = 0;
  const verified = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      hash.update(chunk);
      controller.enqueue(chunk);
    },
    flush(controller) {
      try {
        verifySize(received, expectation.size, url);
        const actual = hash.digest("hex");
        if (expectation.sha256 !== undefined && actual !== expectation.sha256) {
          throw new Error(
            `Downloaded asset failed SHA-256 verification: ${url.pathname}`
          );
        }
      } catch (error) {
        controller.error(error);
      }
    }
  }));
  return copyResponse(response, verified);
}

function verifySize(actual: number, expected: number | undefined, url: URL): void {
  if (expected !== undefined && actual !== expected) {
    throw new Error(
      `Downloaded asset has an unexpected size (${actual}, expected ${expected}): ${url.pathname}`
    );
  }
}

function copyResponse(response: Response, body: BodyInit): Response {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function isSafari(): boolean {
  const agent = globalThis.navigator?.userAgent ?? "";
  return /Safari/iu.test(agent) && !/(?:Chrome|Chromium|Edg)/iu.test(agent);
}
