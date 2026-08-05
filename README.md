# Semantic Links for Obsidian

A privacy-first Obsidian plugin that suggests meaningful internal links while you write, including links where the wording differs but the underlying meaning is related.

Phase 1 implements the production foundation only. Semantic models, vault indexing and ranking are deliberately not included yet.

## Phase 1 capabilities

- Strict TypeScript using the published `obsidian` package
- Versioned settings loaded defensively from `unknown`
- Searchable Obsidian 1.13 settings definitions and heading APIs
- One cancellable request controller per CodeMirror editor view
- Stable request keys, duplicate suppression and stale-result rejection
- IME, plugin-transaction and undo/redo suppression
- Explicit mock suggestion chooser for testing the acceptance path
- Verified wikilink insertion in one CodeMirror transaction
- Lifecycle cleanup for timers, requests, controllers and placeholder services
- Unit, integration, policy, build and clean-vault checks
- Exact three-file release staging with separate provenance attestations

The mock chooser lists eligible Markdown notes so the insertion and Undo path can be exercised. It is not the final lexical or semantic suggestion engine.

## Example

Typing:

```markdown
Plants lose water through their leaves during transpiration.
```

and explicitly accepting `Plant transpiration` creates one undoable editor transaction:

```markdown
Plants lose [[Plant transpiration|water]] through their leaves during transpiration.
```

The plugin never inserts a link automatically.

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

`main.js` and `dist/` are generated and must not be committed.

## Release assets

Community Plugins releases contain exactly:

```text
main.js
manifest.json
styles.css
```

No ZIP, model, WASM or checksum assets are attached. Release tags are the exact manifest version without a `v` prefix, and each supported asset receives its own GitHub build-provenance attestation.

## Planning documents

- [Master plan](semantic-links-master-plan.md) — product architecture, indexing, retrieval, ranking, storage, testing and delivery phases
- [Master plan addendum](docs/master-plan-addendum.md) — authoritative implementation and release updates
- [Obsidian implementation guardrails](docs/obsidian-implementation-guardrails.md) — typing, settings, editor lifecycle, undo, async safety, network and release constraints
- [Phase 1 foundation checklist](docs/phase-1-foundation-checklist.md) — scaffold and exit criteria implemented by this phase
- [Community Plugins release checklist](docs/community-plugin-release-checklist.md) — source review, CI, release assets, provenance and manual verification

The addendum and guardrails are authoritative where they conflict with older implementation details in the original master plan.

## Privacy target

Vault content, filenames, links, tags, embeddings and index records remain on the device in the default implementation. Network access will be limited to explicit model or runtime downloads approved by the user in a later phase.

## Status

Phase 1 foundation implemented. The next milestone is the local embedding-runtime feasibility spike, followed by the lexical vault index and real suggestions.
