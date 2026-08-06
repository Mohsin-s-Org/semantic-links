import { semanticDiagnostics } from "../diagnostics/performance.ts";

export interface VectorCandidate<T> {
  value: T;
  vector: Float32Array;
}

export interface ScoredCandidate<T> {
  value: T;
  score: number;
}

export function topDotProducts<T>(
  query: Float32Array,
  candidates: Iterable<VectorCandidate<T>>,
  limit: number
): ScoredCandidate<T>[] {
  if (limit < 1) {
    return [];
  }
  const finish = semanticDiagnostics.startSpan("search.exact_ms");
  const top: ScoredCandidate<T>[] = [];
  let candidateCount = 0;
  try {
    for (const candidate of candidates) {
      candidateCount += 1;
      if (candidate.vector.length !== query.length) {
        semanticDiagnostics.increment("search.dimension_mismatch");
        continue;
      }
      const scored = {
        value: candidate.value,
        score: dotProduct(query, candidate.vector)
      };
      if (top.length < limit) {
        top.push(scored);
        continue;
      }
      const lowest = lowestIndex(top);
      if (scored.score > (top[lowest]?.score ?? Number.NEGATIVE_INFINITY)) {
        top[lowest] = scored;
      }
    }
    return top.sort((left, right) => right.score - left.score);
  } finally {
    semanticDiagnostics.setGauge("search.candidate_count", candidateCount);
    semanticDiagnostics.setGauge("search.query_dimensions", query.length);
    semanticDiagnostics.setGauge("search.result_count", top.length);
    finish();
  }
}

export function dotProduct(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return score;
}

function lowestIndex<T>(values: readonly ScoredCandidate<T>[]): number {
  let lowest = 0;
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index]?.score ?? 0) < (values[lowest]?.score ?? 0)) {
      lowest = index;
    }
  }
  return lowest;
}
