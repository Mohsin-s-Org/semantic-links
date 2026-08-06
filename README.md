# Semantic Links for Obsidian

Semantic Links is a privacy-first desktop Obsidian plugin that suggests conceptually relevant internal links while you write. It never inserts a link without explicit confirmation.

## Capabilities

- Local lexical matching across titles, aliases, headings, tags and note text
- Optional verified `multilingual-e5-small` q8 model with explicit download consent
- English, Arabic and mixed-language semantic retrieval
- Focused query context using the note title, active selection or sentence, and bounded neighbours
- Structural Markdown passage chunking with source ranges and heading breadcrumbs
- Incremental persistent indexing with crash-safe journalling and checksummed generations
- Canonical packed float32 vector storage and incremental search-worker updates
- Length-bucketed, idle-aware background embedding with live-query priority
- Optional local WASM thread tuning with automatic fallback
- Opt-in local performance diagnostics and a repository-safe relevance evaluation suite
- Atomic, revalidated wikilink insertion in one undoable CodeMirror transaction
- Searchable Obsidian 1.13 settings, index status, rebuild and deletion controls

Vault content, filenames, tags, links, passages, embeddings and index records remain on the device. Lexical suggestions remain available when the model is absent, disabled or unavailable.

## Development

Use Node.js 22 or later.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run ci
```

`npm run ci` performs one strict typecheck, linting, all tests, a production bundle, reproducibility verification, repository and version checks, exact release staging, and a clean-vault smoke test.

For informational exact-search measurements:

```bash
npm run benchmark:semantic
```

Generated `main.js`, `dist/`, model/runtime caches and local indexes must not be committed.

## Local data

Settings use Obsidian's `data.json`. The semantic index is stored separately below the plugin directory:

```text
index/
├─ manifest.json
├─ documents.json
├─ chunks.json
├─ vectors.f32
└─ journal.json
```

The model and required runtime assets download only after explicit consent. Downloads are pinned, allowlisted and integrity-verified.

## Release assets

Community Plugins releases contain exactly:

```text
main.js
manifest.json
styles.css
```

No model, WASM, index, archive, checksum or documentation asset is attached. Release tags exactly match `manifest.json` without a `v` prefix, and every release asset receives a separate provenance attestation.

## Project documents

- [Master plan](semantic-links-master-plan.md)
- [Master plan addendum](docs/master-plan-addendum.md)
- [Obsidian implementation guardrails](docs/obsidian-implementation-guardrails.md)
- [Phase 3 checklist](docs/phase-3-persistent-index-checklist.md)
- [Semantic efficiency benchmarking](docs/semantic-efficiency-benchmarking.md)
- [Community Plugins release checklist](docs/community-plugin-release-checklist.md)
- [GitHub Actions usage policy](GITHUB_ACTIONS_POLICY.md)

The addendum and Obsidian guardrails are authoritative where older planning details conflict.

## Status

The consolidated implementation covers Phase 3, the verified local semantic runtime, Stage A measurement infrastructure, Stage B quality-neutral efficiency work, and the focused-query portion of Stage C through issue #18.

Tokenizer-aware budgets, evaluated rank fusion and scale-gated Stage D experiments remain tracked in issues #19–#25. They are intentionally not presented as complete without their required benchmark and relevance evidence.

Before release, run the documented live Obsidian desktop walkthrough and attach representative local performance and relevance reports to the tracking issues.
