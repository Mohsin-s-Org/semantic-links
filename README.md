# Semantic Links for Obsidian

A privacy-first Obsidian plugin that suggests meaningful internal links while you write. Links are inserted only after explicit confirmation.

Phase 2 adds a fully local lexical suggestion engine. It does not download a model, send vault content over the network, or alter a note without confirmation.

## Phase 2 capabilities

- In-memory scan of Markdown notes after the Obsidian layout is ready
- Indexing of frontmatter titles, aliases, headings, tags and cleaned note text
- Unicode-aware normalization, including Arabic diacritics, plus exact, prefix, token and fuzzy matching
- Paragraph- and sentence-aware context extraction from the active word or selected phrase
- Existing Markdown safety guards for frontmatter, links, code, URLs, HTML, comments and math
- Cursor-anchored suggestion popup with click confirmation
- `Alt+L` manual keyboard mode with arrow, Enter and Escape controls
- Incremental refresh after note creation, modification, rename, deletion or metadata changes
- Revalidated wikilink insertion in one CodeMirror transaction
- Protection against stale files, stale editor results, nested wikilinks and excluded notes

Semantic embeddings and model runtime work remain deliberately excluded.

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

No ZIP, model, WASM, checksum or documentation assets are attached. Release tags exactly match the manifest version without a `v` prefix. Every workflow action is pinned to an immutable commit, and each release asset receives a separate GitHub provenance attestation.

## Planning documents

- [Master plan](semantic-links-master-plan.md)
- [Master plan addendum](docs/master-plan-addendum.md)
- [Obsidian implementation guardrails](docs/obsidian-implementation-guardrails.md)
- [Phase 1 foundation checklist](docs/phase-1-foundation-checklist.md)
- [Phase 2 lexical checklist](docs/phase-2-lexical-checklist.md)
- [Community Plugins release checklist](docs/community-plugin-release-checklist.md)
- [GitHub Actions usage policy](GITHUB_ACTIONS_POLICY.md)

The addendum and guardrails are authoritative where they conflict with older implementation details in the original master plan.

## Privacy

Vault content, filenames, links, tags and index records remain on the device. The Phase 2 index is held in memory and is discarded when the plugin unloads. Future model or runtime downloads require explicit approval.

## Status

Phase 2 lexical suggestions are implemented. A manual Obsidian desktop walkthrough remains required before release. The next milestone is the local runtime feasibility spike for a later semantic phase.
