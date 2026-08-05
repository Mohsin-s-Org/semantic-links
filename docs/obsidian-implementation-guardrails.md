# Obsidian implementation guardrails

These rules are authoritative where they conflict with older implementation details in the master plan.

## 1. Use official types

- Use the published `obsidian` package that matches the API level in `manifest.json`.
- Keep strict TypeScript enabled.
- Do not add handwritten Obsidian API stubs or silence errors with broad assertions.
- Validate disk data, network data, worker messages, parsed JSON, and index records from `unknown`.

## 2. Keep settings single-source

`minAppVersion` is 1.13.0, so implement settings with `PluginSettingTab.getSettingDefinitions()` only. Obsidian handles rendering, search indexing, simple value persistence, and validation.

Use `render` only for controls that cannot bind directly to one settings key, and save those changes explicitly. Create section headings with `Setting.setHeading()`.

If support is later lowered below 1.13.0, add an imperative `display()` fallback then. Do not maintain two settings implementations without a supported-version reason.

Load settings field by field, preserve intentional legacy choices, repair invalid current-schema values, and do not overwrite data written by a future schema version.

## 3. Register only useful commands

Obsidian automatically namespaces command IDs. Use short local IDs such as `show-suggestions`.

Do not register placeholder commands for features that do not exist yet. Add future IDs when their behavior is implemented.

## 4. Make editor changes atomic

Accepting a suggestion must dispatch exactly one CodeMirror transaction containing the replacement, selection, and plugin annotation.

Before dispatch:

- revalidate the anchor range and text
- confirm the target still exists
- render a valid Obsidian link path

Write feedback only after dispatch succeeds. One Undo must restore the exact pre-insertion text without immediately recreating the link or reopening the suggestion.

## 5. Use one controller per editor

The controller owns debounce, request identity, cancellation, active keys, visible context, IME state, plugin-transaction state, and undo/redo suppression.

Every request key includes the file path, document version, anchor range, context hash, and mode. The same key must not start twice while pending.

A different key cancels incompatible in-flight work immediately, before the replacement debounce expires. Only the newest compatible request may update UI.

## 6. Handle editor state, not only keystrokes

Suppress automatic work during:

- undo and redo
- IME composition
- plugin-generated insertion
- incompatible programmatic updates

React to both document and selection changes. Cursor-only movement, including movement caused by automatic brackets or quotes, can change the active context without changing text.

Keyboard listeners may support UX but cannot be the source of truth.

## 7. Revalidate async results

Before displaying or accepting a result, verify:

- request ID and key are current
- active file and editor still match
- document version and anchor are compatible
- target still exists and is eligible
- the request was not cancelled

Discard stale results silently. They must never mutate a note.

## 8. Keep startup cheap

`onload()` may register settings, commands, editor extensions, views, and cleanup. It must not scan the vault, open the semantic index, initialise a model runtime, calculate embeddings, or read every note.

Start real index and background services from `workspace.onLayoutReady()` when they exist. Do not create empty service abstractions solely to satisfy a future architecture diagram.

## 9. Respect network and privacy boundaries

The plugin must not send note text, titles, filenames, tags, links, embeddings, or index data off-device.

Future model/runtime downloads require explicit consent, pinned sources, expected size, integrity verification, and recoverable partial-download handling. Lexical functionality must remain available without them.

## 10. Keep releases reviewable

The official release contains only:

```text
main.js
manifest.json
styles.css
```

Do not attach manual archives, models, WASM, checksums, or documentation bundles. Keep generated files out of source history and keep `main.js` readable rather than minified or obfuscated.

The release workflow runs the clean verification pipeline, validates version metadata, checks JavaScript syntax, and creates separate provenance attestations for all three assets.

## 11. Required foundation tests

Before semantic work begins, cover:

- settings validation, migration, repair, and future-schema preservation
- local command IDs
- duplicate request suppression
- cancellation before a replacement debounce
- stale result rejection
- file, document, anchor, and cursor changes
- IME and undo/redo suppression
- plugin unload cancellation
- one-transaction insertion and one-step Undo/redo behavior
- release version agreement and exact asset allowlist

A manual desktop walkthrough remains required because a packaging smoke test cannot prove Obsidian UI load, unload, settings search, persistence, or command behavior.
