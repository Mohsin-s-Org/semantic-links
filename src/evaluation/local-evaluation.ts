import { semanticDiagnostics } from "../diagnostics/performance.ts";
import type { LocalEmbeddingClient } from "../embeddings/local-embedding-client.ts";
import { EmbeddingBatcher } from "../indexing/embedding-batcher.ts";
import { LexicalIndex } from "../lexical/index.ts";
import type { LexicalDocumentInput, LexicalSuggestion } from "../lexical/types.ts";
import { topDotProducts } from "../retrieval/exact-search.ts";
import { mergeHybridSuggestions } from "../retrieval/hybrid.ts";
import type { SemanticMatch } from "../retrieval/semantic-types.ts";
import { createEvaluationCorpus, type EvaluationFixture } from "./fixtures.ts";
import {
  evaluateRelevance,
  type RelevanceCaseResult,
  type RelevanceReport
} from "./relevance-metrics.ts";

export interface LocalRelevanceEvaluationReport {
  schemaVersion: 1;
  model: LocalEmbeddingClient["descriptor"];
  fixtureCount: number;
  documentCount: number;
  lexical: RelevanceReport;
  semantic: RelevanceReport;
  hybrid: RelevanceReport;
}

export async function runLocalRelevanceEvaluation(
  client: LocalEmbeddingClient,
  signal: AbortSignal,
  onProgress?: (completed: number, total: number) => void
): Promise<LocalRelevanceEvaluationReport> {
  const finish = semanticDiagnostics.startSpan("evaluation.total_ms");
  try {
    const corpus = createEvaluationCorpus();
    const lexicalIndex = new LexicalIndex();
    for (const document of corpus.documents) {
      lexicalIndex.upsert(document);
    }

    const passageVectors = await new EmbeddingBatcher(client, 4).embed(
      corpus.documents.map((document) => ({
        id: document.path,
        text: passageText(document)
      })),
      signal
    );
    const queryVectors = await new EmbeddingBatcher(client, 4).embed(
      corpus.fixtures.map((fixture) => ({
        id: fixture.id,
        text: queryText(fixture)
      })),
      signal,
      onProgress
    );

    const documents = new Map(corpus.documents.map((document) => [document.path, document]));
    const passageEntries = [...passageVectors.vectorsById].map(([path, vector]) => ({ path, vector }));
    const lexicalCases: RelevanceCaseResult[] = [];
    const semanticCases: RelevanceCaseResult[] = [];
    const hybridCases: RelevanceCaseResult[] = [];

    for (const fixture of corpus.fixtures) {
      throwIfAborted(signal);
      const lexical = lexicalIndex.search({
        anchorText: fixture.anchorText,
        contextText: fixture.contextText,
        sourcePath: "evaluation/source.md",
        limit: 10,
        minimumScore: 0.45
      });
      const queryVector = queryVectors.vectorsById.get(fixture.id);
      if (queryVector === undefined) {
        throw new Error(`Evaluation query vector was omitted: ${fixture.id}`);
      }
      const semantic = topDotProducts(queryVector, passageEntries, 10)
        .flatMap(({ value, score }) => {
          const document = documents.get(value.path);
          return document === undefined ? [] : [toSemanticMatch(document, score)];
        });
      const hybrid = mergeHybridSuggestions(lexical, semantic, 10);
      lexicalCases.push(toCase(fixture, lexical));
      semanticCases.push(toCase(fixture, semantic));
      hybridCases.push(toCase(fixture, hybrid));
    }

    return {
      schemaVersion: 1,
      model: client.descriptor,
      fixtureCount: corpus.fixtures.length,
      documentCount: corpus.documents.length,
      lexical: evaluateRelevance(lexicalCases),
      semantic: evaluateRelevance(semanticCases),
      hybrid: evaluateRelevance(hybridCases)
    };
  } finally {
    finish();
  }
}

function passageText(document: LexicalDocumentInput): string {
  const headings = document.headings.map((heading) => heading.text).join(" > ");
  return [
    `passage: ${document.title}`,
    headings,
    document.body
  ].filter((part) => part.length > 0).join("\n");
}

function queryText(fixture: EvaluationFixture): string {
  const context = fixture.contextText.trim();
  return `query: ${context.length > 0 ? context : fixture.anchorText}`;
}

function toSemanticMatch(document: LexicalDocumentInput, similarity: number): SemanticMatch {
  return {
    targetPath: document.path,
    targetTitle: document.title,
    targetHeading: null,
    similarity,
    preview: document.body.slice(0, 240)
  };
}

function toCase(
  fixture: EvaluationFixture,
  ranking: readonly Pick<LexicalSuggestion, "targetPath">[]
): RelevanceCaseResult {
  return {
    id: fixture.id,
    category: fixture.category,
    language: fixture.language,
    ranking: ranking.map((entry) => entry.targetPath),
    relevantTargets: fixture.relevantTargets,
    exactTarget: fixture.exactTarget
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The local relevance evaluation was cancelled.", "AbortError");
  }
}
