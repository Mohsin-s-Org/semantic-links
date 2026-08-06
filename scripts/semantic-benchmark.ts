import {
  semanticDiagnostics,
  summarizeDistribution
} from "../src/diagnostics/performance.ts";
import { topDotProducts } from "../src/retrieval/exact-search.ts";

const dimensions = 384;
const sizes = process.argv.includes("--large")
  ? [1_000, 10_000, 50_000, 100_000]
  : [1_000, 5_000, 10_000];
const samplesPerSize = 20;
const query = normalizedVector(dimensions, 17);
const results: Record<string, ReturnType<typeof summarizeDistribution>> = {};

semanticDiagnostics.start();
for (const size of sizes) {
  const candidates = Array.from({ length: size }, (_, index) => ({
    value: index,
    vector: normalizedVector(dimensions, index + 1)
  }));
  const samples: number[] = [];
  for (let iteration = 0; iteration < samplesPerSize + 2; iteration += 1) {
    const started = performance.now();
    const result = topDotProducts(query, candidates, 40);
    const duration = performance.now() - started;
    if (iteration >= 2) {
      samples.push(duration);
    }
    if (result.length !== 40) {
      throw new Error(`Expected 40 results for ${size} vectors.`);
    }
  }
  results[String(size)] = summarizeDistribution(samples);
}
const diagnosticsReport = semanticDiagnostics.stop();

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  dimensions,
  samplesPerSize,
  searchByVectorCount: results,
  diagnostics: diagnosticsReport
}, null, 2)}\n`);

function normalizedVector(length: number, seed: number): Float32Array {
  let state = seed >>> 0;
  let squared = 0;
  const vector = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const value = (state / 0xffff_ffff) * 2 - 1;
    vector[index] = value;
    squared += value * value;
  }
  const magnitude = Math.sqrt(squared) || 1;
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / magnitude;
  }
  return vector;
}
