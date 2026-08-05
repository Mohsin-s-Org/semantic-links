import {
  compactPreview,
  createLexicalNgrams,
  lexicalSimilarity,
  meaningfulLexicalTokens,
  normalizeLexicalText,
  tokenizeLexicalText
} from "./text.ts";
import type {
  LexicalDocumentInput,
  LexicalMatchKind,
  LexicalSearchQuery,
  LexicalSuggestion
} from "./types.ts";

interface IndexedHeading {
  text: string;
  normalized: string;
  tokens: ReadonlySet<string>;
}

interface IndexedDocument {
  path: string;
  title: string;
  normalizedTitle: string;
  titleTokens: ReadonlySet<string>;
  normalizedAliases: readonly string[];
  aliasTokens: ReadonlySet<string>;
  headings: readonly IndexedHeading[];
  normalizedTags: ReadonlySet<string>;
  bodyTokens: ReadonlyMap<string, number>;
  allTerms: ReadonlySet<string>;
  labelGrams: ReadonlySet<string>;
  exactLabels: ReadonlySet<string>;
  preview: string | null;
}

interface ScoredCandidate {
  suggestion: LexicalSuggestion;
  exactRank: number;
}

const KIND_ORDER: readonly LexicalMatchKind[] = [
  "title",
  "alias",
  "heading",
  "tag",
  "body"
];

export class LexicalIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly postings = new Map<string, Set<string>>();
  private readonly labelPostings = new Map<string, Set<string>>();
  private readonly exactLabelPostings = new Map<string, Set<string>>();

  get size(): number {
    return this.documents.size;
  }

  clear(): void {
    this.documents.clear();
    this.postings.clear();
    this.labelPostings.clear();
    this.exactLabelPostings.clear();
  }

  hasExactLabel(value: string): boolean {
    const normalized = normalizeLexicalText(value);
    return normalized.length > 0 && this.exactLabelPostings.has(normalized);
  }

  upsert(input: LexicalDocumentInput): void {
    this.remove(input.path);
    const document = createIndexedDocument(input);
    this.documents.set(document.path, document);
    for (const term of document.allTerms) {
      const paths = this.postings.get(term) ?? new Set<string>();
      paths.add(document.path);
      this.postings.set(term, paths);
    }
    addToPostings(this.labelPostings, document.labelGrams, document.path);
    addToPostings(this.exactLabelPostings, document.exactLabels, document.path);
  }

  remove(path: string): void {
    const previous = this.documents.get(path);
    if (previous === undefined) {
      return;
    }
    this.documents.delete(path);
    for (const term of previous.allTerms) {
      const paths = this.postings.get(term);
      paths?.delete(path);
      if (paths?.size === 0) {
        this.postings.delete(term);
      }
    }
    removeFromPostings(this.labelPostings, previous.labelGrams, previous.path);
    removeFromPostings(this.exactLabelPostings, previous.exactLabels, previous.path);
  }

  search(query: LexicalSearchQuery): LexicalSuggestion[] {
    const anchor = normalizeLexicalText(query.anchorText);
    if (anchor.length === 0 || query.limit <= 0) {
      return [];
    }

    const anchorTokens = new Set(tokenizeLexicalText(query.anchorText));
    const contextTokens = meaningfulLexicalTokens(query.contextText, 16)
      .filter((token) => !anchorTokens.has(token));
    const candidatePaths = this.collectCandidates(anchor, anchorTokens, contextTokens);
    const scored: ScoredCandidate[] = [];

    for (const path of candidatePaths) {
      if (path === query.sourcePath) {
        continue;
      }
      const document = this.documents.get(path);
      if (document === undefined) {
        continue;
      }
      const candidate = scoreDocument(document, anchor, anchorTokens, contextTokens, this.postings);
      if (candidate !== null && candidate.suggestion.score >= query.minimumScore) {
        scored.push(candidate);
      }
    }

    return scored
      .sort((left, right) => {
        return right.suggestion.score - left.suggestion.score
          || right.exactRank - left.exactRank
          || left.suggestion.targetTitle.localeCompare(right.suggestion.targetTitle)
          || left.suggestion.targetPath.localeCompare(right.suggestion.targetPath);
      })
      .slice(0, Math.max(0, Math.floor(query.limit)))
      .map((candidate) => candidate.suggestion);
  }

  private collectCandidates(
    anchor: string,
    anchorTokens: ReadonlySet<string>,
    contextTokens: readonly string[]
  ): Set<string> {
    const candidates = new Set<string>(this.exactLabelPostings.get(anchor) ?? []);
    for (const token of [...anchorTokens, ...contextTokens]) {
      for (const path of this.postings.get(token) ?? []) {
        candidates.add(path);
      }
    }

    const grams = createLexicalNgrams(anchor);
    const overlapCounts = new Map<string, number>();
    for (const gram of grams) {
      for (const path of this.labelPostings.get(gram) ?? []) {
        overlapCounts.set(path, (overlapCounts.get(path) ?? 0) + 1);
      }
    }
    const minimumOverlap = Math.max(1, Math.floor(grams.length * 0.25));
    for (const [path, count] of overlapCounts) {
      if (count >= minimumOverlap) {
        candidates.add(path);
      }
    }
    return candidates;
  }

}

function createIndexedDocument(input: LexicalDocumentInput): IndexedDocument {
  const normalizedTitle = normalizeLexicalText(input.title || input.basename);
  const normalizedAliases = uniqueNormalized(input.aliases);
  const headings = input.headings
    .map((heading) => ({
      text: heading.text.trim(),
      normalized: normalizeLexicalText(heading.text),
      tokens: new Set(tokenizeLexicalText(heading.text))
    }))
    .filter((heading) => heading.normalized.length > 0);
  const normalizedTags = new Set(uniqueNormalized(input.tags.map((tag) => tag.replace(/^#/u, ""))));
  const bodyTokens = countTerms(tokenizeLexicalText(input.body).slice(0, 5_000));
  const exactLabels = new Set<string>([
    normalizedTitle,
    ...normalizedAliases,
    ...headings.map((heading) => heading.normalized)
  ]);
  const labelGrams = new Set<string>(
    [...exactLabels].flatMap((label) => createLexicalNgrams(label))
  );
  const allTerms = new Set<string>([
    ...tokenizeLexicalText(input.title),
    ...input.aliases.flatMap((alias) => tokenizeLexicalText(alias)),
    ...headings.flatMap((heading) => [...heading.tokens]),
    ...normalizedTags,
    ...bodyTokens.keys()
  ]);

  return {
    path: input.path,
    title: input.title.trim() || input.basename,
    normalizedTitle,
    titleTokens: new Set(tokenizeLexicalText(input.title || input.basename)),
    normalizedAliases,
    aliasTokens: new Set(input.aliases.flatMap((alias) => tokenizeLexicalText(alias))),
    headings,
    normalizedTags,
    bodyTokens,
    allTerms,
    labelGrams,
    exactLabels,
    preview: compactPreview(input.body)
  };
}

function scoreDocument(
  document: IndexedDocument,
  anchor: string,
  anchorTokens: ReadonlySet<string>,
  contextTokens: readonly string[],
  postings: ReadonlyMap<string, ReadonlySet<string>>
): ScoredCandidate | null {
  let score = 0;
  let exactRank = 0;
  const kinds = new Set<LexicalMatchKind>();
  let targetHeading: string | null = null;

  if (document.normalizedTitle === anchor) {
    score = 1;
    exactRank = 5;
    kinds.add("title");
  }
  if (document.normalizedAliases.includes(anchor)) {
    score = Math.max(score, 0.99);
    exactRank = Math.max(exactRank, 4);
    kinds.add("alias");
  }

  const exactHeading = document.headings.find((heading) => heading.normalized === anchor);
  if (exactHeading !== undefined) {
    score = Math.max(score, 0.96);
    exactRank = Math.max(exactRank, 3);
    kinds.add("heading");
    targetHeading = exactHeading.text;
  }
  if (document.normalizedTags.has(anchor)) {
    score = Math.max(score, 0.82);
    exactRank = Math.max(exactRank, 2);
    kinds.add("tag");
  }

  if (anchor.length >= 3 && document.normalizedTitle.startsWith(anchor)) {
    score = Math.max(score, 0.91);
    kinds.add("title");
  }
  if (anchor.length >= 3 && document.normalizedAliases.some((alias) => alias.startsWith(anchor))) {
    score = Math.max(score, 0.9);
    kinds.add("alias");
  }

  const titleSimilarity = lexicalSimilarity(anchor, document.normalizedTitle);
  if (titleSimilarity >= 0.55) {
    score = Math.max(score, 0.56 + titleSimilarity * 0.34);
    kinds.add("title");
  }
  const aliasSimilarity = maximumSimilarity(anchor, document.normalizedAliases);
  if (aliasSimilarity >= 0.55) {
    score = Math.max(score, 0.55 + aliasSimilarity * 0.34);
    kinds.add("alias");
  }
  const headingMatch = bestHeadingMatch(anchor, document.headings);
  if (headingMatch !== null && headingMatch.similarity >= 0.58) {
    const headingScore = 0.54 + headingMatch.similarity * 0.34;
    if (headingScore >= score - 0.03) {
      targetHeading = headingMatch.heading.text;
    }
    score = Math.max(score, headingScore);
    kinds.add("heading");
  }

  const titleCoverage = tokenCoverage(anchorTokens, document.titleTokens);
  if (titleCoverage > 0) {
    score = Math.max(score, 0.58 + titleCoverage * 0.25);
    kinds.add("title");
  }
  const aliasCoverage = tokenCoverage(anchorTokens, document.aliasTokens);
  if (aliasCoverage > 0) {
    score = Math.max(score, 0.57 + aliasCoverage * 0.24);
    kinds.add("alias");
  }

  const bodyScore = scoreBody(document, anchorTokens, contextTokens, postings);
  if (bodyScore > 0) {
    score = Math.max(score, bodyScore);
    kinds.add("body");
  }

  if (score === 0) {
    return null;
  }

  return {
    exactRank,
    suggestion: {
      targetPath: document.path,
      targetTitle: document.title,
      targetHeading,
      score: Math.min(1, roundScore(score)),
      matchKinds: KIND_ORDER.filter((kind) => kinds.has(kind)),
      preview: targetHeading === null
        ? document.preview
        : `Heading: ${targetHeading}`
    }
  };
}

function scoreBody(
  document: IndexedDocument,
  anchorTokens: ReadonlySet<string>,
  contextTokens: readonly string[],
  postings: ReadonlyMap<string, ReadonlySet<string>>
): number {
  const weightedTerms = [
    ...[...anchorTokens].map((term) => ({ term, weight: 2 })),
    ...contextTokens.map((term) => ({ term, weight: 1 }))
  ];
  if (weightedTerms.length === 0) {
    return 0;
  }

  let matchedWeight = 0;
  let totalWeight = 0;
  let matchedTerms = 0;
  for (const entry of weightedTerms) {
    const documentFrequency = postings.get(entry.term)?.size ?? 0;
    const rarity = documentFrequency === 0 ? 1 : 1 / Math.sqrt(documentFrequency);
    const weighted = entry.weight * (0.5 + rarity);
    totalWeight += weighted;
    const frequency = document.bodyTokens.get(entry.term) ?? 0;
    if (frequency > 0) {
      const frequencyBoost = Math.min(0.2, Math.log1p(frequency) * 0.06);
      matchedWeight += weighted * (1 + frequencyBoost);
      matchedTerms += 1;
    }
  }
  if (matchedTerms === 0 || totalWeight === 0) {
    return 0;
  }
  const anchorMatched = [...anchorTokens].some((term) => document.bodyTokens.has(term));
  if (!anchorMatched && matchedTerms < 2) {
    return 0;
  }
  const coverage = matchedWeight / totalWeight;
  return 0.48 + Math.min(0.25, coverage * 0.28);
}

function bestHeadingMatch(
  anchor: string,
  headings: readonly IndexedHeading[]
): { heading: IndexedHeading; similarity: number } | null {
  let best: { heading: IndexedHeading; similarity: number } | null = null;
  for (const heading of headings) {
    const similarity = lexicalSimilarity(anchor, heading.normalized);
    if (best === null || similarity > best.similarity) {
      best = { heading, similarity };
    }
  }
  return best;
}

function maximumSimilarity(anchor: string, values: readonly string[]): number {
  let maximum = 0;
  for (const value of values) {
    maximum = Math.max(maximum, lexicalSimilarity(anchor, value));
  }
  return maximum;
}

function tokenCoverage(query: ReadonlySet<string>, target: ReadonlySet<string>): number {
  if (query.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const token of query) {
    if (target.has(token)) {
      matches += 1;
    }
  }
  return matches / query.size;
}

function countTerms(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function uniqueNormalized(values: readonly string[]): string[] {
  return [...new Set(values
    .map((value) => normalizeLexicalText(value))
    .filter((value) => value.length > 0))];
}

function addToPostings(
  postings: Map<string, Set<string>>,
  terms: ReadonlySet<string>,
  path: string
): void {
  for (const term of terms) {
    const paths = postings.get(term) ?? new Set<string>();
    paths.add(path);
    postings.set(term, paths);
  }
}

function removeFromPostings(
  postings: Map<string, Set<string>>,
  terms: ReadonlySet<string>,
  path: string
): void {
  for (const term of terms) {
    const paths = postings.get(term);
    paths?.delete(path);
    if (paths?.size === 0) {
      postings.delete(term);
    }
  }
}

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
