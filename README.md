# Semantic Links for Obsidian

A privacy-first Obsidian plugin that suggests meaningful internal links while you write. Links are inserted only after explicit confirmation.

Phase 3 adds a crash-safe persistent passage and vector index while preserving the fully local Phase 2 lexical suggestion engine.

## Current capabilities

- In-memory lexical indexing of frontmatter titles, aliases, headings, tags and cleaned note text
- Unicode-aware exact, prefix, token and fuzzy matching, including Arabic normalization
- Paragraph- and sentence-aware context extraction from the active word or selected phrase
- Cursor-anchored suggestions with click or keyboard confirmation
- Structural Markdown chunking by headings, paragraphs and sentence boundaries
- Source offsets, line numbers, heading breadcrumbs, previews and lexical terms for every passage
- Persistent manifests, document records, chunk records and row-major `Float32Array` vector files
- Dirty-generation journaling with `.next` validation and `.previous` recovery
- Incremental create, modify, rename, delete and metadata-cache updates
- Mtime and content-hash reuse so unchanged notes are not reprocessed or re-embedded
- Exclusions for folders, files, tags, frontmatter properties and protected Markdown
- Index status view plus rebuild and delete commands
- Revalidated wikilink insertion in one undoable CodeMirror transaction

The embedding layer is batch-oriented and accepts a verified local `EmbeddingClient`. Phase 3 does not create fake semantic vectors or silently download a model. Lexical suggestions and persistent passage preparation work without a model; the consent-based Transformers.js/ONNX runtime remains a separate feasibility and delivery step.

## Example

Typing in this sentence:

```markdown
Plants lose water through their leaves during transpiration.
```

can suggest `Plant transpiration`. Explicitly accepting it produces one undoable edit:

```markdown
Plants lose [[Plant transpiration|water]] through their leaves during transpiration.
```

The plugin never inserts a link automatically.

## Local index

The persistent index is stored below the installed plugin directory, not in `data.json`:

```text
index/
├─ manifest.json
├─ documents.json
├─ chunks.json
├─ vectors.f32
└─ journal.json
```

Generated index files remain local, are ignored by source control and are never included in GitHub releases. Use **Semantic Links: Show index status** to inspect progress, rebuild the index or delete the local copy without changing any note.

## Development

Use Node.js 22 or later.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:reproducible-build
npm run ci
```

`main.js`, `dist/` and generated indexes must not be committed.

## Release assets

Community Plugins releases contain exactly:

```text
main.js
manifest.json
styles.css
```

No ZIP, model, WASM, checksum, index or documentation assets are attached. Release tags exactly match the manifest version without a `v` prefix. Every workflow action is pinned to an immutable commit, and each release asset receives a separate GitHub provenance attestation.

## Planning documents

- [Master plan](semantic-links-master-plan.md)
- [Master plan addendum](docs/master-plan-addendum.md)
- [Obsidian implementation guardrails](docs/obsidian-implementation-guardrails.md)
- [Phase 1 foundation checklist](docs/phase-1-foundation-checklist.md)
- [Phase 2 lexical checklist](docs/phase-2-lexical-checklist.md)
- [Phase 3 persistent index checklist](docs/phase-3-persistent-index-checklist.md)
- [Community Plugins release checklist](docs/community-plugin-release-checklist.md)
- [GitHub Actions usage policy](GITHUB_ACTIONS_POLICY.md)

The addendum and guardrails are authoritative where they conflict with older implementation details in the original master plan.

## Privacy

Vault content, filenames, links, tags, passages, embeddings and index records remain on the device. The plugin sends no vault data to a hosted API. Future model or runtime downloads require explicit consent, pinned revisions, integrity checks and recoverable failure handling.

## Status

Phase 3 persistent indexing is implemented. A manual Obsidian desktop walkthrough remains required before release. The next engineering step is the local model/runtime feasibility spike, followed by Phase 4 hybrid semantic retrieval and explanations.
