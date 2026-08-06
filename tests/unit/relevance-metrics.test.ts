import assert from "node:assert/strict";
import test from "node:test";
import { createEvaluationCorpus } from "../../src/evaluation/fixtures.ts";
import {
  evaluateRelevance,
  ndcgAt,
  recallAt,
  reciprocalRankAt
} from "../../src/evaluation/relevance-metrics.ts";

test("calculates ranking metrics", () => {
  const ranking = ["irrelevant", "target", "other"];
  assert.equal(recallAt(ranking, ["target"], 5), 1);
  assert.equal(reciprocalRankAt(ranking, ["target"], 5), 0.5);
  assert.equal(ndcgAt(ranking, ["target"], 5), 1 / Math.log2(3));
});

test("reports aggregate, category and language quality", () => {
  const report = evaluateRelevance([
    {
      id: "exact",
      category: "exact-title",
      language: "en",
      ranking: ["target", "noise"],
      relevantTargets: ["target"],
      exactTarget: "target"
    },
    {
      id: "semantic",
      category: "semantic-only",
      language: "ar",
      ranking: ["noise", "target"],
      relevantTargets: ["target"],
      exactTarget: null
    }
  ]);

  assert.equal(report.aggregate.caseCount, 2);
  assert.equal(report.aggregate.recallAt5, 1);
  assert.equal(report.aggregate.mrrAt5, 0.75);
  assert.equal(report.aggregate.exactPreservationRate, 1);
  assert.equal(report.aggregate.semanticOnlyDiscoveryRate, 1);
  assert.equal(report.byLanguage["ar"]?.caseCount, 1);
});

test("provides a repository-safe multilingual evaluation corpus", () => {
  const corpus = createEvaluationCorpus();
  assert.equal(corpus.fixtures.length, 112);
  assert.equal(corpus.documents.length, 16);
  assert.ok(corpus.fixtures.some((fixture) => fixture.category === "semantic-only" && fixture.language === "ar"));
  assert.ok(corpus.fixtures.some((fixture) => fixture.category === "mixed-language"));
  assert.ok(corpus.fixtures.some((fixture) => fixture.category === "ambiguous"));
  assert.equal(JSON.stringify(corpus).includes("/Users/"), false);
});
