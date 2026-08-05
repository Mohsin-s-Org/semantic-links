# Semantic Links for Obsidian

A privacy-first Obsidian plugin that will suggest meaningful internal links while you write, including links where the wording differs but the underlying meaning is related.

The repository is currently in the planning and foundation-design stage. No production plugin code has been implemented yet.

## Product direction

- Context-aware suggestions from the current sentence and paragraph
- Hybrid title, alias, keyword, graph, and semantic matching
- Local embedding inference by default
- Suggestions only; links are never inserted without user confirmation
- Lexical suggestions remain available without downloading a model
- Desktop-first MVP, with mobile support assessed only after the local runtime is proven

## Example

Typing:

```markdown
Plants lose water through their leaves during transpiration.
```

could suggest:

```text
Plant transpiration
Water cycle#Evaporation
Water movement in plants
```

Accepting `Plant transpiration` would create one undoable editor transaction:

```markdown
Plants lose [[Plant transpiration|water]] through their leaves during transpiration.
```

The plugin will never insert that link automatically.

## Planning documents

- [Master plan](semantic-links-master-plan.md) — product architecture, indexing, retrieval, ranking, storage, testing, and delivery phases
- [Master plan addendum](docs/master-plan-addendum.md) — updated implementation and release rules learned from building and publishing another Obsidian plugin
- [Obsidian implementation guardrails](docs/obsidian-implementation-guardrails.md) — typing, settings, editor lifecycle, undo, async safety, network, and release constraints
- [Phase 1 foundation checklist](docs/phase-1-foundation-checklist.md) — exact scaffold and exit criteria before semantic-model work begins
- [Community Plugins release checklist](docs/community-plugin-release-checklist.md) — source review, CI, release assets, provenance, and manual verification

The addendum and guardrails are authoritative where they conflict with older implementation details in the original master plan.

## Key engineering decisions

### Official Obsidian types

The plugin will use the published `obsidian` package under strict TypeScript. It will not use a handwritten type stub that converts the API to `any`.

### Safe editor behaviour

A single per-editor controller will own debounce timers, request IDs, in-flight keys, popup state, IME composition state, and undo/redo suppression. Overlapping editor and keyboard events must not create duplicate searches or duplicate UI.

Accepting a suggestion will be one CodeMirror transaction. One Undo must restore the original text without immediately recreating the link or reopening the accepted suggestion.

### Versioned settings

Saved settings will be validated from `unknown`, include a schema version, and use explicit migrations. The settings tab will support current settings search through `getSettingDefinitions()` and use Obsidian's `Setting.setHeading()` API.

### Local model delivery

The official GitHub release cannot contain model weights or runtime files. A clean installation containing only the normal plugin assets must work in lexical-only mode. Semantic model and runtime downloads will require explicit user consent and remain local.

### Official release assets

Community Plugins releases will contain exactly:

```text
main.js
manifest.json
styles.css
```

No manual ZIP, model files, WASM files, checksum files, or other custom assets will be attached to the official release. Each supported asset will receive a separate GitHub build-provenance attestation.

## Planned implementation order

1. Strict Obsidian plugin foundation
2. Settings schema and migration framework
3. Per-editor request and cancellation controller
4. Atomic mock wikilink insertion with Undo tests
5. CI, release allowlist, and artifact attestations
6. Local embedding runtime feasibility spike
7. Lexical vault index and suggestions
8. Persistent semantic index
9. Hybrid ranking and explanations
10. Feedback, diagnostics, performance testing, and release preparation

This order prevents editor lifecycle, unsafe typing, packaging, and model-runtime problems from being debugged at the same time.

## Privacy target

Vault content, filenames, links, tags, embeddings, and index records will remain on the device in the default implementation. Network access will be limited to explicit model/runtime downloads approved by the user.

## Status

Current status: architecture and implementation constraints documented. The next coding milestone is the Phase 1 foundation described in [docs/phase-1-foundation-checklist.md](docs/phase-1-foundation-checklist.md).
