# Semantic efficiency benchmarking

This document supports issues #8 and #9 under epic #7. It defines how to collect performance and relevance evidence without reading, exporting, or transmitting a user's vault.

## Privacy boundary

Diagnostics are disabled by default. When enabled, the plugin records only fixed-name numeric timings, counts, byte estimates and memory values exposed by the runtime. It does not record note text, query text, selections, filenames, paths, tags, links, aliases or hardware identifiers.

The relevance suite uses 16 synthetic bilingual documents and 112 synthetic query contexts committed to the repository. It does not search the active vault.

## Deterministic exact-search benchmark

Run:

```bash
npm run benchmark:semantic
```

This measures exact 384-dimensional top-40 search over 1,000, 5,000 and 10,000 deterministic normalised vectors. To include 50,000 and 100,000 vectors:

```bash
npm run benchmark:semantic -- --large
```

The command emits JSON with p50, p95 and p99 search latency. Results are informational and are not used as fragile CI wall-clock assertions.

## Live Obsidian performance report

1. Enable the local q8 model and allow initial indexing to finish.
2. Run **Semantic Links: Start local semantic diagnostics**.
3. Exercise representative work:
   - repeated warm semantic queries;
   - new and repeated contexts to generate cache misses and hits;
   - typing while background indexing is active;
   - editing, renaming and deleting notes;
   - model unload and re-enable;
   - an explicit index flush or rebuild where appropriate.
4. Run **Semantic Links: Stop diagnostics and copy report**.
5. Save the clipboard JSON outside the vault with the test hardware description, operating system, Obsidian version, plugin commit, document count, passage/vector count and whether the model was cold or warm.

The report separates model loading, warm-up, inference queue wait, inference work, query-cache behaviour, exact search, worker round trips, hybrid fusion, background batches, event-loop delay and memory observations where supported.

## Local relevance baseline

1. Enable the verified local q8 model.
2. Run **Semantic Links: Run local semantic relevance evaluation**.
3. The command embeds only the committed synthetic fixture corpus using the current model, prefixes, pooling and normalisation.
4. It runs the current lexical index, exact semantic search and hybrid merger separately.
5. The clipboard report includes Recall@5, Recall@10, MRR@5, nDCG@5, exact-title/alias preservation, semantic-only discovery and irrelevant-suggestion rate, split by category and language.

Attach the result to issue #9 before accepting retrieval-affecting changes. Do not tune and report final results on the same examples without retaining a holdout subset.

## Initial product budgets

These are proposed product targets for review after baseline data is collected. They are not claims about current performance and are not universal constants.

| Metric | Proposed target |
| --- | ---: |
| Warm semantic query p95, end to end | <= 200 ms |
| Main-thread event-loop delay p95 during indexing | <= 16 ms |
| Individual long task | < 50 ms |
| Background inference slice p95 while active | <= 100 ms |
| Coalesced checkpoint p95 | <= 250 ms |
| Model plus semantic-index memory on ordinary vaults | <= 512 MB |

A target may be revised only with an issue comment that includes representative measurements and explains the user impact. Later optimisation issues must include before/after reports and the #9 relevance comparison.

## Required report context

Every attached live report should state:

- operating system and architecture;
- CPU model or broad device class;
- available memory;
- Obsidian and Electron versions;
- plugin commit;
- model descriptor and execution provider;
- number of notes, chunks and vectors;
- cold, cache-only or warm model state;
- whether indexing was idle or active;
- diagnostics duration and actions performed.

Do not include vault names, note names, paths or content.
