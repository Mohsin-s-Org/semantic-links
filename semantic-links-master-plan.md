# Semantic Links for Obsidian — Master Plan

## 1. Product definition

Semantic Links is an Obsidian plugin that watches the text around the cursor and suggests internal links to notes or headings that are likely to be conceptually relevant.

It must support both obvious and non-obvious matches:

- `water` → `[[Water]]` through a title match
- `drinking enough throughout the day` → `[[Hydration]]` through semantic similarity
- `water returns to the atmosphere` → `[[Water cycle#Evaporation]]` through paragraph context
- `washing before prayer` → `[[Wudu]]` through semantic meaning, even if the target note does not contain the same wording

The plugin suggests links. It never writes a link automatically without explicit user confirmation.

## 2. MVP decisions

These are the default implementation decisions for the first release:

1. **Desktop-first:** `isDesktopOnly: true` for the MVP. A local multilingual embedding model and its runtime are too large and performance-sensitive to promise mobile support before profiling.
2. **Local-first:** note content is embedded locally. No vault text is sent to a hosted API by default.
3. **Hybrid retrieval:** semantic similarity is combined with titles, aliases, headings, keywords, tags, and existing graph structure.
4. **Paragraph-aware:** an isolated word is not enough for semantic matching. The plugin uses the current sentence and nearby paragraph to disambiguate meaning.
5. **Incremental indexing:** only new or changed notes are reprocessed after the initial index.
6. **Human confirmation:** the user chooses a suggestion before a wikilink is inserted.
7. **Explainable results:** every suggestion shows why it appeared and previews the matching passage.
8. **Model:** start with `Xenova/multilingual-e5-small`, using its quantized ONNX weights through Transformers.js. It produces 384-dimensional embeddings and supports multilingual retrieval.
9. **Search implementation:** exact cosine search in a worker for the MVP. Add an approximate nearest-neighbour index only after profiling proves it is necessary.
10. **Suggestion threshold:** use ranking plus a configurable minimum confidence. Do not interpret raw E5 cosine values as probabilities.

## 3. User experience

### 3.1 Typing flow

Given a note containing:

```markdown
Plants lose water through their leaves during transpiration.
```

After the user pauses briefly, the plugin evaluates the current context and may show:

```text
Suggested links

1. Plant transpiration
   Biology/Plant transpiration.md · Water movement
   “Transpiration is the loss of water vapour from leaves…”
   Semantic match · heading match

2. Water cycle
   Geography/Water cycle.md · Evaporation
   “Water enters the atmosphere through evaporation and transpiration…”
   Semantic match
```

The suggestion popup is anchored near the cursor but does not cover the text being typed.

### 3.2 Acceptance behaviour

The default anchor is the completed word at the cursor:

```markdown
Plants lose [[Plant transpiration|water]] through their leaves during transpiration.
```

If text is selected before accepting, the selected text becomes the alias:

```markdown
Plants lose [[Plant transpiration|water through their leaves]] during transpiration.
```

For a heading target, insert:

```markdown
[[Water cycle#Evaporation|water]]
```

Use the shortest unambiguous Obsidian link path generated through Obsidian’s metadata/file APIs rather than manually guessing paths.

### 3.3 Keyboard and mouse controls

- `Alt+L`: open or focus semantic-link suggestions at the cursor
- `ArrowUp` / `ArrowDown`: move through visible suggestions
- `Enter`: accept the highlighted suggestion while the popup is focused
- `Esc`: dismiss the popup
- Mouse click: accept a suggestion
- Secondary action: open the target note without inserting a link
- Secondary action: dismiss this suggestion for the current context
- Secondary action: never suggest this target from this source note

The normal editor `Enter`, `Tab`, and arrow behaviour must remain untouched while the suggestion popup is not focused.

### 3.4 When suggestions appear

Two retrieval modes run at different times:

#### Fast lexical mode

Runs after a completed token when:

- the token is at least 3 characters, or is an exact title/alias
- the cursor is not inside excluded Markdown syntax
- the user has not dismissed suggestions for the current edit location

This mode uses titles, aliases, headings, tags, and token matching. It does not load the embedding model.

#### Semantic mode

Runs after a configurable debounce, default 650 ms, when:

- the context contains at least 5 meaningful tokens or 24 characters
- the current sentence or paragraph changed
- the embedding model and index are ready

Only the newest request may update the popup. Every query receives a monotonically increasing request ID; stale results are discarded.

## 4. Repository structure

```text
semantic-links-obsidian/
├─ .github/
│  └─ workflows/
│     ├─ ci.yml
│     └─ release.yml
├─ docs/
│  ├─ architecture.md
│  ├─ ranking.md
│  ├─ privacy.md
│  ├─ testing.md
│  └─ model-evaluation.md
├─ scripts/
│  ├─ build-worker.mjs
│  ├─ package-release.mjs
│  └─ benchmark-index.mts
├─ src/
│  ├─ main.ts
│  ├─ constants.ts
│  ├─ types.ts
│  ├─ commands/
│  │  ├─ rebuild-index.ts
│  │  ├─ show-suggestions.ts
│  │  └─ inspect-index.ts
│  ├─ editor/
│  │  ├─ extension.ts
│  │  ├─ context-extractor.ts
│  │  ├─ markdown-guards.ts
│  │  ├─ suggestion-state.ts
│  │  ├─ suggestion-tooltip.ts
│  │  ├─ insertion.ts
│  │  └─ keymap.ts
│  ├─ indexing/
│  │  ├─ index-manager.ts
│  │  ├─ vault-scanner.ts
│  │  ├─ note-parser.ts
│  │  ├─ chunker.ts
│  │  ├─ metadata-extractor.ts
│  │  ├─ change-queue.ts
│  │  └─ index-version.ts
│  ├─ retrieval/
│  │  ├─ search-service.ts
│  │  ├─ lexical-index.ts
│  │  ├─ semantic-search.ts
│  │  ├─ candidate-merger.ts
│  │  ├─ ranker.ts
│  │  └─ explanation.ts
│  ├─ embeddings/
│  │  ├─ embedding-client.ts
│  │  ├─ model-manager.ts
│  │  ├─ model-download.ts
│  │  └─ embedding-worker.ts
│  ├─ storage/
│  │  ├─ index-store.ts
│  │  ├─ binary-vectors.ts
│  │  ├─ manifest-store.ts
│  │  └─ migrations.ts
│  ├─ feedback/
│  │  ├─ feedback-store.ts
│  │  └─ feedback-features.ts
│  ├─ settings/
│  │  ├─ defaults.ts
│  │  ├─ settings-tab.ts
│  │  └─ validation.ts
│  ├─ views/
│  │  ├─ index-status-view.ts
│  │  └─ diagnostics-modal.ts
│  └─ utils/
│     ├─ debounce.ts
│     ├─ hashing.ts
│     ├─ text.ts
│     └─ cancellation.ts
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ fixtures/
│  │  └─ test-vault/
│  └─ performance/
├─ manifest.json
├─ versions.json
├─ styles.css
├─ package.json
├─ package-lock.json
├─ esbuild.config.mjs
├─ eslint.config.mts
├─ tsconfig.json
├─ LICENSE
└─ README.md
```

## 5. Core runtime architecture

```text
Obsidian editor
    │
    ▼
CodeMirror editor extension
    │ extracts current token, sentence, paragraph and cursor range
    ▼
Suggestion controller
    ├─ immediate lexical lookup
    └─ debounced semantic query
             │
             ▼
       Search service
       ├─ lexical index
       ├─ semantic vector search
       ├─ vault graph features
       └─ feedback features
             │
             ▼
       Candidate merger and ranker
             │
             ▼
CodeMirror tooltip with explanations and previews
             │
             ▼
Single editor transaction inserts the selected wikilink
```

Indexing is separate from typing:

```text
Vault create/modify/rename/delete events
    │
    ▼
Debounced change queue
    │
    ▼
Markdown parser and chunker
    │
    ├─ lexical metadata update
    └─ embedding worker batch
             │
             ▼
Persistent local index
```

## 6. Plugin lifecycle

### `onload()`

Keep `onload()` cheap. It should only:

1. Load settings through `Plugin.loadData()`.
2. Register commands.
3. Register the settings tab.
4. Register the CodeMirror editor extension.
5. Register the optional index-status view.
6. Register cleanup handlers.

It must not scan the vault, download a model, or calculate embeddings during `onload()`.

### `workspace.onLayoutReady()`

After the workspace is ready:

1. Open the persistent index.
2. Validate its schema and model version.
3. Register vault create, modify, rename, and delete listeners.
4. Compare the current vault manifest against the stored index manifest.
5. Queue only missing or changed notes.
6. Start background indexing according to the user’s performance settings.

### `onunload()`

1. Abort active suggestion and indexing requests.
2. Flush pending index metadata.
3. Terminate workers.
4. Revoke worker Blob URLs.
5. Remove tooltip state and view registrations.

## 7. Markdown parsing and chunking

### 7.1 Excluded content

Do not embed or suggest from:

- YAML frontmatter values marked private by configuration
- fenced code blocks
- inline code
- generated Dataview blocks
- mathematical blocks where text semantics are unreliable
- embeds and attachment URLs
- existing wikilink syntax
- Markdown link destinations
- configured folders, files, tags, and properties

Normal prose inside blockquotes and callouts remains indexable unless excluded.

### 7.2 Note metadata

For every Markdown file collect:

- path
- basename
- display title, when supplied by frontmatter
- aliases
- headings and their levels
- tags
- outgoing links
- resolved incoming links, when available
- file modification time
- content hash
- exclusion state

### 7.3 Chunk boundaries

Chunk by semantic Markdown structure, not fixed character windows:

1. Split into heading sections.
2. Split each section into paragraphs and list groups.
3. Merge tiny adjacent blocks under the same heading.
4. Split oversized blocks at sentence boundaries.
5. Preserve source offsets and line numbers.

Default target size:

- minimum: 40 words
- target: 120 words
- maximum: 220 words
- overlap: one sentence when a large block is split

Each passage embedded for retrieval is:

```text
passage: {note title}
{heading breadcrumb}
{clean chunk text}
```

The title and heading are included because they often contain the concept name even when the paragraph uses pronouns or shorthand.

## 8. Embedding model and model management

### 8.1 Initial model

Use:

```text
Xenova/multilingual-e5-small
```

Configuration:

- task: `feature-extraction`
- quantized weights
- pooling: `mean`
- normalization: `true`
- indexed text prefix: `passage: `
- live query prefix: `query: `
- maximum input length: model limit, with plugin-side truncation below that limit

### 8.2 First-use experience

The plugin must not silently download a large model.

On first semantic use, show a setup modal explaining:

- semantic suggestions require a local model download
- approximate download size
- note text remains on the device during inference
- title and alias suggestions can work without the model
- the user may postpone or disable semantic matching

Buttons:

- `Download and enable semantic matching`
- `Use title and keyword matching only`
- `Cancel`

Show download and initialization progress. A failed download must leave lexical matching functional.

### 8.3 Model cache and versioning

Store a model descriptor in index metadata:

```ts
interface ModelDescriptor {
  id: string;
  revision: string;
  quantization: string;
  dimensions: number;
  tokenizerVersion: string;
  runtimeVersion: string;
}
```

Any change that can alter embeddings invalidates the vector index and requires a controlled rebuild.

### 8.4 Worker strategy

Run model inference and vector search away from editor event handling.

The implementation starts with a feasibility spike because Obsidian community releases normally centre on `main.js`, `manifest.json`, and `styles.css`, while ONNX requires runtime assets. The spike must prove:

1. Transformers.js initializes inside Obsidian Electron.
2. Quantized model files download and cache successfully.
3. Required ONNX WebAssembly assets resolve reliably.
4. Inference does not block editor input.
5. The model and worker unload cleanly.
6. A packaged release works in a clean test vault, not only in development.

If a dedicated custom worker cannot be packaged reliably, use ONNX Runtime’s worker/proxy support first, while keeping all indexing and search calls behind `EmbeddingClient` so the implementation can later move to a dedicated worker without touching editor code.

## 9. Persistent index design

Settings belong in `data.json` through `loadData()` and `saveData()`.

The semantic index is too large for `data.json`. Store it separately beneath the plugin’s own configuration directory.

Proposed layout:

```text
.obsidian/plugins/semantic-links/
├─ data.json
└─ index/
   ├─ manifest.json
   ├─ documents.json
   ├─ chunks.json
   ├─ vectors.f32
   ├─ lexical.json
   ├─ feedback.json
   └─ journal.json
```

### 9.1 Manifest

```ts
interface IndexManifest {
  schemaVersion: number;
  pluginVersion: string;
  vaultFingerprint: string;
  model: ModelDescriptor | null;
  vectorCount: number;
  dimensions: number;
  lastCompletedAt: number | null;
  dirty: boolean;
}
```

### 9.2 Document record

```ts
interface IndexedDocument {
  id: string;
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: IndexedHeading[];
  outgoingPaths: string[];
  contentHash: string;
  modifiedAt: number;
  chunkIds: string[];
}
```

### 9.3 Chunk record

```ts
interface IndexedChunk {
  id: string;
  documentId: string;
  headingPath: string[];
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  textPreview: string;
  lexicalTerms: string[];
  vectorRow: number;
}
```

### 9.4 Vector file

`vectors.f32` is a contiguous row-major `Float32Array`:

```text
row 0: 384 floats
row 1: 384 floats
...
```

Embeddings are already L2-normalized, so cosine similarity is a dot product.

The MVP may rewrite the vector file after a batch of changes. The write uses a temporary file plus replace/rename semantics so an interrupted write cannot destroy the last complete index.

### 9.5 Crash recovery

Before writing a new index generation:

1. Mark `dirty: true`.
2. Write new files with `.next` suffixes.
3. Validate record counts and vector byte length.
4. Promote `.next` files.
5. Mark `dirty: false`.
6. Delete stale temporary files.

If startup finds `dirty: true`, retain the last validated generation and queue affected notes for rebuilding.

## 10. Lexical index

The lexical layer supports useful results before the model loads and improves precision afterward.

Index fields separately:

- note title
- aliases
- headings
- tags
- body terms

Use normalized Unicode text and preserve original display text. Tokenization must support Latin and Arabic scripts without assuming whitespace is the only boundary.

Candidate signals:

- exact title match
- exact alias match
- title prefix match
- fuzzy title/alias match
- heading phrase match
- body term score
- tag overlap

A lightweight BM25-style inverted index is sufficient. Do not add a server search dependency.

## 11. Semantic search

### 11.1 Query construction

The live semantic query contains:

1. the current sentence
2. the previous sentence when needed for pronoun/context resolution
3. the current paragraph, capped to the configured context limit
4. optionally the current note title and heading breadcrumb

Example:

```text
query: Note: Plant biology
Section: Leaves
Plants lose water through their leaves during transpiration.
```

### 11.2 Search

1. Embed the query once.
2. Calculate dot products against normalized chunk vectors.
3. Keep the top 40 chunks with a bounded min-heap.
4. Exclude chunks from the active note.
5. Group chunks by destination note.
6. Keep the best two chunks per destination for explanation.
7. Pass destination candidates to the hybrid ranker.

The first implementation uses exact search because it is deterministic, dependency-light, and easy to test. Performance benchmarks decide whether an approximate index is needed.

## 12. Hybrid ranking

Raw model similarity is not a probability. Ranking is relative to candidates.

### 12.1 Candidate generation

Generate independently:

- top 40 semantic chunks
- top 40 lexical notes/headings
- exact title and alias matches regardless of rank

Merge candidates by destination note and optional heading.

### 12.2 Normalized features

For each merged candidate calculate:

```ts
interface RankingFeatures {
  semanticRankScore: number;
  lexicalRankScore: number;
  titleAliasScore: number;
  headingScore: number;
  graphScore: number;
  feedbackScore: number;
  duplicatePenalty: number;
  genericNotePenalty: number;
}
```

Semantic and lexical values are rank-normalized within the candidate set. This avoids treating the narrow E5 cosine range as calibrated confidence.

### 12.3 Initial scoring formula

```text
score =
    0.50 × semanticRankScore
  + 0.22 × lexicalRankScore
  + 0.13 × titleAliasScore
  + 0.07 × headingScore
  + 0.05 × graphScore
  + 0.03 × feedbackScore
  - duplicatePenalty
  - genericNotePenalty
```

Important boosts and exclusions:

- exact title match: force into candidate set and add a strong title score
- exact alias match: same treatment
- target already linked in the current paragraph: exclude
- target is current file: exclude
- target path excluded by settings: exclude
- unresolved or deleted target: exclude
- shared tags: small graph boost, capped
- source and target already linked elsewhere: small graph boost, not an automatic winner
- repeatedly rejected pair: penalty
- accepted pair: small positive signal
- extremely generic target title such as `Notes` or `Ideas`: configurable penalty

Show at most three automatic suggestions by default.

## 13. Context extraction and Markdown guards

The editor extension must identify both the semantic context and safe replacement range.

### 13.1 Anchor range

Priority:

1. explicit editor selection
2. completed word immediately before or under the cursor
3. nearest meaningful phrase only when a future phrase-selection feature is enabled

The MVP never guesses a multi-word replacement range without a selection.

### 13.2 Context range

Extract:

- active sentence
- adjacent sentence if the active sentence is short
- active paragraph up to a configured character/token cap
- active heading breadcrumb
- active note title

### 13.3 Do not trigger inside

- YAML frontmatter
- fenced code
- inline code
- existing `[[wikilinks]]`
- Markdown links
- URLs
- tags being typed
- HTML tags
- math blocks
- a word shorter than the configured minimum
- IME composition

The implementation should use CodeMirror syntax information where available and conservative text guards as a fallback.

## 14. Editor extension implementation

Use a CodeMirror 6 view plugin plus state effects.

### Components

- `extension.ts`: registers the extension and dependencies
- `context-extractor.ts`: turns editor state into `SuggestionQueryContext`
- `suggestion-state.ts`: stores request state and visible results
- `suggestion-tooltip.ts`: renders the popup through CodeMirror tooltip/decorations
- `keymap.ts`: active only while the plugin popup has focus
- `insertion.ts`: produces and dispatches a single replacement transaction

### Async result safety

Every request includes:

```ts
interface SuggestionRequest {
  id: number;
  filePath: string;
  documentVersion: number;
  anchorFrom: number;
  anchorTo: number;
  anchorText: string;
  contextText: string;
}
```

Before showing or inserting a result, verify:

- request ID is still current
- file path is unchanged
- document version is compatible
- anchor range still contains the expected text

If any check fails, discard the result.

## 15. Link insertion

Build links using Obsidian metadata/file APIs.

Insertion rules:

1. If display text equals the resolved target title and no heading is used:
   ```markdown
   [[Target]]
   ```
2. If display text differs:
   ```markdown
   [[Target|display text]]
   ```
3. If targeting a heading:
   ```markdown
   [[Target#Heading|display text]]
   ```
4. Escape characters that would invalidate wikilink syntax.
5. Perform insertion as one editor transaction so undo removes it in one step.
6. Record accepted feedback only after the transaction succeeds.

## 16. Feedback and personalization

The plugin learns lightweight local preferences without training the embedding model.

Store:

```ts
interface LinkFeedback {
  sourceDocumentId: string;
  targetDocumentId: string;
  contextHash: string;
  action: "accepted" | "dismissed" | "blocked-pair";
  createdAt: number;
}
```

Use feedback only as a small reranking feature. Never let historical feedback override an obviously irrelevant semantic result.

Provide commands to:

- clear suggestion history
- clear blocked pairs
- reset all learning data

## 17. Settings

### Suggestions

- Enable automatic suggestions
- Debounce delay, default 650 ms
- Maximum visible suggestions, default 3
- Minimum anchor length
- Minimum context length
- Confidence threshold
- Show lexical suggestions before semantic model is ready
- Show matching excerpt
- Show explanation labels

### Indexing

- Enable semantic indexing
- Download/remove local model
- Pause indexing while typing
- Batch size
- CPU usage profile: low, balanced, fast
- Rebuild index
- Index status and last completed time

### Content scope

- Excluded folders
- Excluded files
- Excluded tags
- Excluded frontmatter property/value rules
- Include or exclude canvas text in a later release

### Link output

- Prefer shortest path
- Prefer full path
- Link to headings when the matched chunk is under a heading
- Default alias casing behaviour

### Privacy

- Local model status
- Network activity explanation
- Delete downloaded model
- Delete semantic index
- Diagnostics export that excludes note contents by default

## 18. Commands

MVP commands:

- `Semantic Links: Show suggestions at cursor`
- `Semantic Links: Rebuild semantic index`
- `Semantic Links: Pause/resume indexing`
- `Semantic Links: Show index status`
- `Semantic Links: Download semantic model`
- `Semantic Links: Remove semantic model and vectors`
- `Semantic Links: Clear suggestion feedback`
- `Semantic Links: Open diagnostics`

## 19. Performance requirements

Targets for the MVP on a typical desktop test machine:

- plugin `onload()`: no vault scan or model initialization
- editor change handler: under 2 ms before scheduling async work
- lexical suggestions: under 30 ms for a 10,000-note synthetic vault
- semantic query embedding: profiled and documented; must not block typing
- exact vector search: under 100 ms for 25,000 chunks on the reference machine
- no more than one live semantic query per editor pane
- indexing yields between batches so the interface remains responsive
- no re-embedding when a file’s content hash and model descriptor are unchanged

These are acceptance budgets, not marketing claims. Record benchmark hardware and vault shape in `docs/model-evaluation.md`.

### Scale trigger for approximate search

Add HNSW or another ANN index only if either condition is consistently exceeded:

- more than 50,000 chunks
- exact vector search exceeds 120 ms at p95 on the reference machine

The ANN implementation must remain behind the `SemanticSearchBackend` interface.

## 20. Privacy and security

1. Vault content remains local during default embedding and search.
2. Network access is limited to downloading explicitly approved model/runtime assets.
3. Never log note text in production.
4. Diagnostics use hashes, counts, durations, and error categories unless the user explicitly includes samples.
5. Exclusion rules apply before text enters the embedding queue.
6. A removed model or index is actually deleted from plugin-managed storage.
7. No telemetry in the MVP.
8. Any future hosted provider must be opt-in, clearly labelled, and architecturally separate from the local provider.

## 21. Testing strategy

### Unit tests

- Markdown guard detection
- sentence and paragraph extraction
- heading breadcrumb extraction
- title and alias normalization
- Arabic and Latin tokenization
- chunk boundary rules
- content hashing
- lexical ranking
- hybrid score calculation
- candidate grouping
- wikilink rendering and escaping
- exclusion rules
- index migrations
- feedback penalties and boosts

### Integration tests

Using `tests/fixtures/test-vault`:

- initial vault scan
- incremental file modification
- rename preserves/rebuilds records correctly
- delete removes vectors and candidates
- current note is excluded
- existing paragraph links are excluded
- accepted suggestion inserts one undoable transaction
- stale async result cannot modify changed text
- index recovers after an interrupted write

### Semantic quality set

Create a committed, non-private evaluation fixture containing labelled examples:

```ts
interface EvaluationCase {
  query: string;
  expectedTargets: string[];
  forbiddenTargets?: string[];
  language: string;
}
```

Include:

- same-word matches
- synonym matches
- contextual ambiguity such as `water`
- English-to-Arabic and Arabic-to-English cases
- misleading shared vocabulary
- generic-note false positives

Track:

- Recall@1
- Recall@3
- mean reciprocal rank
- false-positive rate above the automatic display threshold

### Performance tests

Generate synthetic vaults at:

- 1,000 notes
- 5,000 notes
- 10,000 notes
- 25,000 and 50,000 chunks

Measure indexing throughput, index size, lexical latency, semantic latency, and memory.

## 22. CI and release workflow

### `ci.yml`

Run on pull requests and pushes to `main`:

1. `npm ci`
2. type check
3. ESLint
4. unit tests
5. integration tests
6. production build
7. verify required release files
8. verify `manifest.json`, `package.json`, and `versions.json` versions agree
9. inspect bundle for accidental Node-only/native dependencies

### `release.yml`

On a semantic-version tag without a `v` prefix:

1. run the full CI suite
2. build production `main.js`
3. package `main.js`, `manifest.json`, and `styles.css`
4. create a GitHub release
5. attach required assets
6. attach checksums

The first public submission also requires a complete README, licence, manifest, release assets, and compliance with Obsidian’s plugin policies.

## 23. Delivery phases

### Phase 0 — Runtime feasibility spike

Goal: prove local embeddings can be packaged reliably in Obsidian.

Deliverables:

- sample plugin scaffold
- model setup modal
- embed one sentence locally
- cache model assets
- unload/reload test
- packaged clean-vault test
- recorded download size, startup time, embedding latency, and memory

Exit criteria:

- no editor freeze during inference
- packaged build works after installing only release assets
- failure falls back cleanly to lexical-only mode

### Phase 1 — Plugin foundation

Deliverables:

- official-style TypeScript/esbuild scaffold
- manifest, versions, licence, settings
- command registration
- CI
- structured source folders

Exit criteria:

- plugin loads and unloads cleanly
- all checks pass
- `onload()` contains no expensive work

### Phase 2 — Lexical suggestions

Deliverables:

- vault metadata scan
- title, alias, heading, tag, and body index
- editor context extraction
- safe Markdown guards
- inline suggestion popup
- wikilink insertion

Exit criteria:

- exact and fuzzy links work without downloading a model
- suggestions never alter text without confirmation
- stale-result safety is tested

### Phase 3 — Persistent semantic index

Deliverables:

- Markdown chunker
- embedding batching
- persistent vector files
- incremental create/modify/rename/delete handling
- index status view
- rebuild and delete commands

Exit criteria:

- unchanged notes are not re-embedded
- interrupted writes recover safely
- excluded content never enters the index

### Phase 4 — Hybrid retrieval and explanations

Deliverables:

- exact vector search
- candidate merging
- rank-normalized hybrid scoring
- graph features
- excerpt and explanation UI
- configurable threshold

Exit criteria:

- labelled evaluation set meets agreed Recall@3 target
- ambiguous-word examples improve when paragraph context is present
- generic false positives are controlled

### Phase 5 — Feedback and polish

Deliverables:

- dismiss, block pair, and accepted feedback
- diagnostics modal
- accessibility and keyboard review
- theme compatibility
- performance profiling
- documentation

Exit criteria:

- no known data-loss paths
- no production logging of note content
- light and dark themes verified
- index deletion and model deletion verified

### Phase 6 — Beta and release

Deliverables:

- beta release
- clean-vault install instructions
- sample vault
- bug-report template
- privacy documentation
- Obsidian submission preparation

Exit criteria:

- release assets install manually
- version metadata agrees
- tested on Windows, macOS, and Linux desktop
- known limitations documented

## 24. Recommended first implementation issues

1. Scaffold the Obsidian plugin from the official sample structure.
2. Add CI, linting, Vitest, and release validation.
3. Build the local embedding runtime feasibility spike.
4. Define core domain types and index schema.
5. Implement Markdown guards and context extraction.
6. Implement vault metadata scanning and lexical index.
7. Implement CodeMirror suggestion tooltip and safe insertion.
8. Implement structural note chunking.
9. Implement persistent index generation and recovery.
10. Implement embedding batch queue and incremental updates.
11. Implement exact semantic search.
12. Implement hybrid ranking and explanations.
13. Add settings, exclusions, status, and diagnostics.
14. Add semantic evaluation fixtures and benchmarks.
15. Add feedback reranking and blocked pairs.
16. Package beta release and run cross-platform testing.

## 25. Deliberate non-goals for the MVP

- automatically inserting links without confirmation
- generating prose or summaries
- using an LLM to rewrite notes
- cloud embedding by default
- training a custom model on the user’s vault
- editing every note in bulk
- claiming mobile support before profiling
- graph visualisation beyond existing Obsidian capabilities
- identifying a formal relationship label such as “causes” or “contradicts”; the MVP finds relevance, not a knowledge-graph predicate

## 26. Definition of done for version 1.0

Version 1.0 is complete when a user can:

1. Install the plugin from release assets.
2. Use title and alias suggestions immediately.
3. Explicitly download and enable a local semantic model.
4. Index a normal desktop vault without blocking editing.
5. Type a sentence and receive up to three contextually relevant note or heading suggestions.
6. Preview why each suggestion matched.
7. Accept a suggestion and create one valid, undoable wikilink.
8. Dismiss or block irrelevant suggestions.
9. Exclude private folders and rebuild or delete the index.
10. Use the plugin without vault content being sent to a hosted inference service.
