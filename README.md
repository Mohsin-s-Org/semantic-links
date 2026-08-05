# Semantic Links for Obsidian

A privacy-first Obsidian plugin that suggests meaningful internal links while you write. Links are inserted only after explicit confirmation.

Phase 1 implements the production foundation only. Semantic models, vault indexing, and ranking are deliberately excluded.

## Phase 1 capabilities

- Strict TypeScript with the official Obsidian 1.13 API types
- Versioned settings validated from `unknown`
- Searchable declarative settings with one source of truth
- One cancellable request controller per CodeMirror editor
- Request deduplication and immediate stale-work cancellation
- Document, cursor, focus, IME, plugin-transaction, and Undo/redo handling
- Explicit mock note chooser for exercising the acceptance path
- Revalidated wikilink insertion in one CodeMirror transaction
- Protection against stale-file acceptance and nested wikilinks
- Unit, integration, policy, build, reproducibility, and packaging checks
- Exact three-file releases with separate provenance attestations

The mock chooser is not the final lexical or semantic suggestion engine.

## Example

Explicitly accepting `Plant transpiration` can change:

```markdown
Plants lose water through their leaves during transpiration.
```

to one undoable edit:

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
npm run verify:reproducible-build
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

No ZIP, model, WASM, checksum, or documentation assets are attached. Release tags exactly match the manifest version without a `v` prefix. Every workflow action is pinned to an immutable commit, and each release asset receives a separate GitHub provenance attestation.

## Planning documents

- [Master plan](semantic-links-master-plan.md)
- [Master plan addendum](docs/master-plan-addendum.md)
- [Obsidian implementation guardrails](docs/obsidian-implementation-guardrails.md)
- [Phase 1 foundation checklist](docs/phase-1-foundation-checklist.md)
- [Community Plugins release checklist](docs/community-plugin-release-checklist.md)

The addendum and guardrails are authoritative where they conflict with older implementation details in the original master plan.

## Privacy target

Vault content, filenames, links, tags, embeddings, and index records remain on the device in the default implementation. Future model or runtime downloads require explicit approval.

## Status

Phase 1 foundation implemented. A manual Obsidian desktop walkthrough remains required before release. The next milestone is the local runtime feasibility spike, followed by the lexical vault index and real suggestions.
