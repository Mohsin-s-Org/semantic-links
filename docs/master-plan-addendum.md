# Master plan addendum

This addendum updates the implementation and release portions of `semantic-links-master-plan.md`. Product, indexing, retrieval, ranking, and privacy goals remain unchanged.

## Repository structure

Keep generated `main.js`, custom Obsidian type stubs, model binaries, runtime binaries, and generated indexes out of source history.

```text
.github/workflows/
docs/
scripts/
src/
tests/
manifest.json
versions.json
styles.css
package.json
package-lock.json
esbuild.config.mjs
eslint.config.mjs
tsconfig.json
LICENSE
README.md
```

## Runtime delivery

Model weights, tokenizer files, and ONNX/WASM runtime files are not official release assets. Future downloads must happen after installation with explicit consent, pinned revisions, size and integrity checks, and recoverable failure handling.

A clean three-file install must start in lexical-only mode.

## Editor requirements

- one controller per editor owns debounce, request identity, cancellation, composition, popup context, and suppression
- document and selection changes share the same request path
- a different request key cancels stale in-flight work immediately
- suggestion acceptance is exactly one CodeMirror transaction
- Undo restores the original text without immediate reopening or reinsertion
- redo does not duplicate feedback
- plugin transactions and IME composition suppress automatic work

## Settings requirements

- use official Obsidian types matching the declared API level
- validate `loadData()` from `unknown`
- include `settingsVersion` and explicit migrations
- repair invalid current-schema values without overwriting future-schema data
- use `PluginSettingTab.getSettingDefinitions()` and `Setting.setHeading()`

The plugin requires Obsidian 1.13.0, so the declarative settings implementation is the single source of truth. Add a traditional `display()` fallback only if the minimum supported version is later reduced below 1.13.0.

## Command requirements

Use short local IDs because Obsidian applies the plugin namespace automatically. Register a command only when it performs useful work.

Phase 1 registers:

```text
show-suggestions
```

Later phases may add:

```text
rebuild-index
pause-indexing
show-index-status
download-model
remove-model
clear-feedback
open-diagnostics
```

## CI requirements

CI runs on pull requests and pushes to `main`:

1. `npm ci`
2. strict type checking
3. unsafe TypeScript linting for plugin source
4. unit and integration tests
5. production build
6. `node --check main.js`
7. version and repository policy validation
8. exact release-asset validation
9. clean-vault packaging smoke test

CI rejects custom Obsidian type stubs, committed generated bundles, model/runtime binaries, unsupported assets, and minified release output.

## Release requirements

The release tag exactly matches `manifest.json` without a `v` prefix. The release contains only:

```text
main.js
manifest.json
styles.css
```

Each asset receives a separate GitHub build-provenance attestation. The workflow uses:

```yaml
permissions:
  contents: write
  id-token: write
  attestations: write
```

## Phase ordering

Complete this foundation before the embedding feasibility spike:

1. official types and strict TypeScript
2. settings validation and migration
3. per-editor request controller
4. atomic mock wikilink insertion
5. undo, composition, selection-change, and deduplication tests
6. CI and exact release allowlist

Then run the local-runtime feasibility spike, followed by the lexical index and real suggestions.

## Definition of done

Version 1.0 additionally requires searchable settings, no unsafe TypeScript warnings, one-step Undo without reopening, a three-asset official release with provenance, reproducible readable output, and a successful manual Obsidian desktop walkthrough.
