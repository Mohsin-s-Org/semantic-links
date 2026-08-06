export interface RelevanceCaseResult {
  id: string;
  category: string;
  language: string;
  ranking: readonly string[];
  relevantTargets: readonly string[];
  gains?: Readonly<Record<string, number>>;
  exactTarget?: string | null;
}

export interface RelevanceMetrics {
  caseCount: number;
  recallAt5: number;
  recallAt10: number;
  mrrAt5: number;
  ndcgAt5: number;
  exactPreservationRate: number;
  semanticOnlyDiscoveryRate: number;
  irrelevantSuggestionRateAt5: number;
}

export interface RelevanceReport {
  schemaVersion: 1;
  aggregate: RelevanceMetrics;
  byCategory: Record<string, RelevanceMetrics>;
  byLanguage: Record<string, RelevanceMetrics>;
}

export function evaluateRelevance(cases: readonly RelevanceCaseResult[]): RelevanceReport {
  return {
    schemaVersion: 1,
    aggregate: summarize(cases),
    byCategory: summarizeGroups(cases, (entry) => entry.category),
    byLanguage: summarizeGroups(cases, (entry) => entry.language)
  };
}

export function recallAt(
  ranking: readonly string[],
  relevantTargets: readonly string[],
  limit: number
): number {
  const relevant = new Set(relevantTargets);
  if (relevant.size === 0 || limit < 1) {
    return 0;
  }
  const found = new Set(ranking.slice(0, limit).filter((target) => relevant.has(target)));
  return found.size / relevant.size;
}

export function reciprocalRankAt(
  ranking: readonly string[],
  relevantTargets: readonly string[],
  limit: number
): number {
  const relevant = new Set(relevantTargets);
  const index = ranking.slice(0, Math.max(0, limit)).findIndex((target) => relevant.has(target));
  return index < 0 ? 0 : 1 / (index + 1);
}

export function ndcgAt(
  ranking: readonly string[],
  relevantTargets: readonly string[],
  limit: number,
  gains: Readonly<Record<string, number>> = {}
): number {
  if (limit < 1 || relevantTargets.length === 0) {
    return 0;
  }
  const relevant = new Set(relevantTargets);
  const gainFor = (target: string): number => {
    if (!relevant.has(target)) {
      return 0;
    }
    const gain = gains[target];
    return typeof gain === "number" && Number.isFinite(gain) && gain > 0 ? gain : 1;
  };
  const dcg = ranking.slice(0, limit).reduce((score, target, index) => {
    return score + gainFor(target) / Math.log2(index + 2);
  }, 0);
  const ideal = [...relevantTargets]
    .map((target) => gainFor(target))
    .sort((left, right) => right - left)
    .slice(0, limit)
    .reduce((score, gain, index) => score + gain / Math.log2(index + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}

function summarize(cases: readonly RelevanceCaseResult[]): RelevanceMetrics {
  if (cases.length === 0) {
    return emptyMetrics();
  }
  let recall5 = 0;
  let recall10 = 0;
  let mrr5 = 0;
  let ndcg5 = 0;
  let exactCases = 0;
  let exactPreserved = 0;
  let semanticOnlyCases = 0;
  let semanticOnlyFound = 0;
  let suggestions = 0;
  let irrelevant = 0;

  for (const entry of cases) {
    recall5 += recallAt(entry.ranking, entry.relevantTargets, 5);
    recall10 += recallAt(entry.ranking, entry.relevantTargets, 10);
    mrr5 += reciprocalRankAt(entry.ranking, entry.relevantTargets, 5);
    ndcg5 += ndcgAt(entry.ranking, entry.relevantTargets, 5, entry.gains);

    if (entry.exactTarget !== undefined && entry.exactTarget !== null) {
      exactCases += 1;
      if (entry.ranking[0] === entry.exactTarget) {
        exactPreserved += 1;
      }
    }
    if (entry.category === "semantic-only") {
      semanticOnlyCases += 1;
      if (recallAt(entry.ranking, entry.relevantTargets, 5) > 0) {
        semanticOnlyFound += 1;
      }
    }
    const relevant = new Set(entry.relevantTargets);
    for (const target of entry.ranking.slice(0, 5)) {
      suggestions += 1;
      if (!relevant.has(target)) {
        irrelevant += 1;
      }
    }
  }

  return {
    caseCount: cases.length,
    recallAt5: round(recall5 / cases.length),
    recallAt10: round(recall10 / cases.length),
    mrrAt5: round(mrr5 / cases.length),
    ndcgAt5: round(ndcg5 / cases.length),
    exactPreservationRate: round(exactCases === 0 ? 1 : exactPreserved / exactCases),
    semanticOnlyDiscoveryRate: round(semanticOnlyCases === 0 ? 1 : semanticOnlyFound / semanticOnlyCases),
    irrelevantSuggestionRateAt5: round(suggestions === 0 ? 0 : irrelevant / suggestions)
  };
}

function summarizeGroups(
  cases: readonly RelevanceCaseResult[],
  keyOf: (entry: RelevanceCaseResult) => string
): Record<string, RelevanceMetrics> {
  const groups = new Map<string, RelevanceCaseResult[]>();
  for (const entry of cases) {
    const key = keyOf(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return Object.fromEntries(
    [...groups].sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entries]) => [key, summarize(entries)])
  );
}

function emptyMetrics(): RelevanceMetrics {
  return {
    caseCount: 0,
    recallAt5: 0,
    recallAt10: 0,
    mrrAt5: 0,
    ndcgAt5: 0,
    exactPreservationRate: 1,
    semanticOnlyDiscoveryRate: 1,
    irrelevantSuggestionRateAt5: 0
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
