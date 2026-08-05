# Master plan addendum

This addendum updates the implementation and release portions of `semantic-links-master-plan.md` using lessons learned while taking Quran Autocomplete through Obsidian's automated review.

The product, indexing, retrieval, ranking, and privacy architecture in the master plan remains unchanged. The following implementation rules supersede conflicting details.

## Repository structure changes

The planned repository must not contain generated `main.js` or a custom `types/obsidian.d.ts`.

Use:

```text
semantic-links-obsidian/
├─ .github/workflows/
│  ├─ ci.yml
│  └─ release.yml
├─ docs/
├─ scripts/
├─ src/
├─ tests/
├─ manifest.json
├─ versions.json
├─ styles.css
├─ package.json
├─ package-lock.json
├─ esbuild.config.mjs
├─ eslint.config.mjs
├─ tsconfig.json
├─ LICENSE
└─ README.md
```

`main.js` is generated in CI and attached to releases only.

## Updated Phase 0 requirement

The runtime feasibility spike must prove the model and runtime can be downloaded after installation. The official Obsidian release cannot depend on additional GitHub release assets beyond `main.js`, `manifest.json`, and `styles.css`.

Therefore:

- model weights, tokenizer files, ONNX WASM files, and worker support files are not official release assets
- every download requires explicit consent
- source revisions and integrity expectations are pinned
- interrupted downloads can resume or restart safely
- lexical suggestions remain fully functional without the model
- a clean installation containing only the three supported plugin files can launch and reach lexical-only mode

## Updated editor requirements

The planned request-ID checks remain required, with these additions:

- one per-editor controller owns all timers, pending keys, popup state, composition state, and suppression state
- overlapping key, cursor, editor-change, and async events must deduplicate through the same request key
- suggestion acceptance is exactly one CodeMirror transaction
- Undo restores the pre-link text and suppresses immediate reopening or reinsertion
- redo must not duplicate feedback
- plugin-generated transactions must not start a new automatic query until the editor has settled
- IME composition and auto-paired punctuation must be tested explicitly

## Updated settings requirements

The settings implementation must:

- use official Obsidian types
- validate `loadData()` output from `unknown`
- include `settingsVersion`
- migrate saved settings explicitly
- use `Setting.setHeading()` for settings sections
- implement `PluginSettingTab.getSettingDefinitions()` so settings appear in search on Obsidian 1.13.0 and later

## Updated command requirements

Commands shown to users remain prefixed automatically by Obsidian, but their IDs must be local:

```text
show-suggestions
rebuild-index
pause-indexing
show-index-status
download-model
remove-model
clear-feedback
open-diagnostics
```

Do not use IDs such as `semantic-links-show-suggestions`.

## Updated CI requirements

CI runs on pull requests and pushes to `main`:

1. `npm ci`
2. strict type check
3. ESLint with unsafe TypeScript rules enabled for plugin source
4. unit tests
5. integration tests
6. production build
7. `node --check main.js`
8. version agreement validation
9. generated-file policy validation
10. release-asset allowlist validation
11. clean-vault smoke test

CI must reject handwritten Obsidian API stubs and committed generated bundles.

## Updated release requirements

The official release tag exactly matches `manifest.json` and has no `v` prefix.

The release contains only:

```text
main.js
manifest.json
styles.css
```

Do not attach:

- a manual ZIP
- checksums
- model files
- WASM files
- documentation bundles
- custom source archives

The workflow creates a separate GitHub build-provenance attestation for each supported asset using permissions:

```yaml
permissions:
  contents: write
  id-token: write
  attestations: write
```

The release build must reproduce `main.js` from the repository source byte-for-byte.

## Updated phase ordering

Before the embedding feasibility spike becomes the dominant workstream, complete a small foundation slice:

1. official types and strict TypeScript
2. settings schema and migration framework
3. per-editor request controller
4. atomic mock wikilink insertion
5. Undo/redo and event-deduplication tests
6. CI and release allowlist

Then run the local-model feasibility spike. This reduces the risk of debugging editor lifecycle, unsafe typing, packaging, and model runtime issues simultaneously.

## Updated definition of done

Version 1.0 additionally requires:

- settings are searchable on current Obsidian
- no unsafe TypeScript warnings in plugin source
- one Undo removes an accepted link without immediate recreation
- official release contains only the three supported assets
- all three assets have build-provenance attestations
- a clean build reproduces the released `main.js`
