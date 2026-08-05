# Obsidian implementation guardrails

This document records the engineering rules that must be followed while building Semantic Links. It incorporates practical lessons from taking another Obsidian plugin from prototype to a reviewable Community Plugins release.

Where this document conflicts with an older implementation detail in the master plan, this document is authoritative.

## 1. Start from the official Obsidian types

- Use the published `obsidian` package for TypeScript types.
- Do not add a handwritten `obsidian.d.ts` that replaces API types with `any`.
- Enable strict TypeScript from the first commit.
- Treat data loaded from disk, network responses, worker messages, and parsed JSON as `unknown` until validated.
- Avoid type assertions that merely silence errors.

The first plugin accumulated many unsafe-call and unsafe-member-access warnings because a local type stub converted the entire Obsidian API into `any`. Semantic Links must not repeat that mistake.

## 2. Settings must satisfy both current and older Obsidian versions

The settings implementation must provide:

1. A normal `PluginSettingTab` UI for supported Obsidian versions.
2. `getSettingDefinitions()` for settings search on Obsidian 1.13.0 and later.
3. Headings created with `new Setting(containerEl).setName(...).setHeading()` rather than raw heading elements.
4. A versioned settings schema and explicit migration path.

Settings loaded through `loadData()` must be validated field by field. Never merge an unvalidated object directly over defaults.

Recommended shape:

```ts
interface SemanticLinksSettings {
  settingsVersion: number;
  automaticSuggestions: boolean;
  semanticIndexingEnabled: boolean;
  debounceMs: number;
  maxSuggestions: number;
  minimumScore: number;
  excludedFolders: string[];
  excludedTags: string[];
  linkPathMode: "shortest" | "full";
}
```

A migration must preserve intentional user choices while introducing new defaults safely.

## 3. Command IDs are local identifiers

Obsidian namespaces command IDs with the plugin ID. Command IDs must therefore be short local names such as:

```text
show-suggestions
rebuild-index
pause-indexing
open-diagnostics
```

Do not include `semantic-links` in each command ID.

## 4. Editor changes must be atomic and undoable

Accepting a suggestion must produce exactly one CodeMirror transaction.

That transaction may include:

- replacing the selected or detected anchor text
- inserting the wikilink
- moving the cursor or selection
- recording an annotation used by the plugin

One Undo must restore the exact pre-insertion text. The plugin must not immediately recreate the link or reopen an accepted suggestion because Undo restored the original word.

The feedback record for an accepted link is written only after the editor transaction succeeds.

## 5. One event path, one result

Editor integrations often receive overlapping events. For example, a key event, editor-change event, cursor movement, composition event, and async search completion may all describe the same user action.

Semantic Links must use one per-editor controller that owns:

- debounce timers
- the latest request ID
- in-flight request keys
- visible suggestion state
- dismissed context hashes
- undo/redo suppression
- composition state

Every query is keyed by at least:

```ts
interface SuggestionRequestKey {
  filePath: string;
  documentVersion: number;
  anchorFrom: number;
  anchorTo: number;
  anchorText: string;
  contextHash: string;
}
```

The same key must not start twice while pending. Only the newest compatible request may update the popup.

## 6. Undo, redo, composition, and automatic pairs

Automatic suggestions must be suppressed while:

- an undo or redo operation is being processed
- the editor is in IME composition
- the plugin itself is dispatching a link insertion
- the document is applying a remote or programmatic update
- the current anchor was just restored by Undo

Listen for editor transaction metadata where possible. Keyboard listeners may support the UX but cannot be the sole source of truth because Undo can also come from menus, commands, mobile controls, or another plugin.

Automatic brackets, quotes, and Markdown pairs can move the cursor without inserting a character. Context detection must use the resulting editor state rather than assuming every meaningful cursor movement has a text-change event.

## 7. Async results must be revalidated

Before displaying or accepting an async result, verify all of the following:

- request ID is still current
- active file path is unchanged
- editor document version is compatible
- anchor range still contains the expected text
- suggestion target still exists
- target is not now excluded
- target is not already linked in the current context

A stale result is silently discarded. It must never mutate the note.

## 8. Keep startup cheap

`onload()` may register APIs, settings, commands, editor extensions, views, and cleanup handlers. It must not:

- scan the vault
- open the semantic index
- download a model
- initialise ONNX
- calculate embeddings
- read every note

Index validation and background work start only after `workspace.onLayoutReady()`.

## 9. Release assets are restricted

The official Obsidian release for a version must contain only:

```text
main.js
manifest.json
styles.css
```

Do not attach a manual ZIP, model file, checksum file, WASM binary, source archive, or other convenience asset to the official marketplace release.

GitHub's automatically generated source archives do not count as manually uploaded release assets.

The local model, tokenizer, and runtime assets must therefore be downloaded after explicit user consent and stored in plugin-managed local storage. Lexical functionality must remain available when the model is absent or download fails.

## 10. Release provenance

The release workflow must:

1. run `npm ci`
2. run strict type checking, linting, unit tests, integration tests, and the production build
3. validate `manifest.json`, `package.json`, and `versions.json`
4. verify `main.js` syntax
5. reproduce the exact release `main.js` from source
6. create separate GitHub build-provenance attestations for `main.js`, `manifest.json`, and `styles.css`
7. publish only those three assets

Required workflow permissions:

```yaml
permissions:
  contents: write
  id-token: write
  attestations: write
```

Use `actions/attest-build-provenance` separately for each supported asset so review tools can associate provenance with each filename.

## 11. Keep generated files out of normal source history

- Commit `package-lock.json`.
- Do not commit generated `main.js` to the normal source tree.
- Build `main.js` in CI and attach it to the release.
- Keep model binaries and generated indexes out of Git.
- Do not use obfuscation or minification that prevents review unless it remains reproducible and readable enough for Obsidian review.

## 12. Network boundaries

The first release may use the network only for user-approved model and runtime downloads.

It must not send:

- note text
- note titles
- filenames
- tags
- links
- embeddings
- index records

Any downloaded asset must have a pinned source, revision, expected size, and integrity verification strategy. Failed or partial downloads must be recoverable.

## 13. Tests required before semantic work begins

The plugin foundation is not complete until tests cover:

- settings validation and migration
- command registration IDs
- editor request deduplication
- stale async result rejection
- one-transaction link insertion
- Undo restoring original text without retriggering insertion
- redo not creating duplicate feedback
- IME composition suppression
- automatic bracket and quote cursor movement
- plugin unload cancelling timers, workers, and requests
- release version agreement
- release asset allowlist

These tests should exist before the semantic model is integrated, because the model will make editor timing and asynchronous behaviour more complex.
