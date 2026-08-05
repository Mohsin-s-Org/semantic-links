# Phase 3 persistent semantic index checklist

## Markdown processing

- [x] Split notes by heading sections and prose blocks
- [x] Merge small non-overlapping blocks under the same heading
- [x] Split oversized prose at sentence boundaries with one-sentence overlap
- [x] Enforce the configured maximum even when an overlap sentence is large
- [x] Preserve source offsets and line numbers
- [x] Include the note title and heading breadcrumb in embedding text
- [x] Exclude frontmatter, code, Dataview fences, math, comments, raw HTML blocks, embeds, URLs and existing links
- [x] Reject configured folders, files, tags and frontmatter property or `property=value` rules before persistent parsing
- [x] Share title, alias, heading and tag extraction between lexical and persistent indexes

## Incremental indexing

- [x] Start index services only after `workspace.onLayoutReady()`
- [x] Register create, modify, rename, delete and metadata listeners before reconciliation
- [x] Compare stored mtimes before reading unchanged notes
- [x] Compare content hashes before replacing an unchanged document
- [x] Preserve unchanged chunk vectors inside a modified note or full rebuild
- [x] Preserve document and passage identities across ordinary note renames
- [x] Batch only passages whose stable chunk identity changed
- [x] Preserve the last indexed record after a transient note read failure
- [x] Serialize generations and debounce one combined path-change queue
- [x] Debounce scope changes so repeated settings edits trigger one rebuild
- [x] Abort indexing immediately when the plugin unloads

## Persistent storage

- [x] Store the index outside `data.json` under the plugin directory
- [x] Validate manifest, document, chunk and vector records from `unknown`
- [x] Reject duplicate paths, invalid ownership, bad ranges, duplicate vector rows and non-finite vectors
- [x] Store vectors as a contiguous row-major `Float32Array`
- [x] Bind each generation to its vault, exclusion scope and model identity
- [x] Reset incompatible generations before reconciliation
- [x] Purge stored content when exclusions change while indexing is disabled
- [x] Mark a generation dirty before writing `.next` files
- [x] Validate the next generation before promotion
- [x] Promote the clean manifest last
- [x] Restore `.previous` files after an interrupted write
- [x] Keep only files used by recovery; no unused journal is persisted
- [x] Keep generated indexes out of source history and release assets

## User controls

- [x] Add a searchable semantic-indexing toggle
- [x] Add excluded file and property-rule settings
- [x] Add an index status view with notes, passages, vectors and queue progress
- [x] Add `show-index-status`, `rebuild-index` and `delete-index` commands
- [x] Confirm destructive deletion and state clearly that notes are not changed
- [x] Keep lexical suggestions available when semantic indexing is disabled or storage fails

## Verification

- [x] Unit tests cover protected-content chunking, raw HTML exclusion and sentence overlap
- [x] Unit tests cover uneven sentence lengths and hard maximum passage size
- [x] Unit tests cover bounded embedding batches and malformed vectors
- [x] Unit tests cover unchanged mtime, document hash and passage-level reuse
- [x] Unit tests cover stable passage and exclusion-scope fingerprints
- [x] Unit tests cover property-value rule normalization
- [x] Unit tests cover persistent vector round trips and relationship validation
- [x] Unit tests simulate startup recovery from a dirty interrupted generation
- [x] CI run #126 passes the complete repository pipeline on the audited head
- [ ] Complete a manual Obsidian desktop walkthrough before release

## Model boundary

Phase 3 provides the batch-oriented `EmbeddingClient` boundary and persists real vectors whenever a verified local client is supplied. It does not fake semantic vectors or silently download a model. The consent-based Transformers.js/ONNX runtime remains a separate feasibility and delivery step, as required by the master plan and implementation guardrails.
