# Phase 1 foundation checklist

This checklist defines the foundation required before lexical or semantic retrieval work begins.

## 1. Repository files

Create:

```text
.github/workflows/ci.yml
.github/workflows/release.yml
src/main.ts
src/settings/defaults.ts
src/settings/schema.ts
src/settings/settings-tab.ts
src/editor/controller.ts
src/editor/insertion.ts
src/editor/request-key.ts
src/utils/validation.ts
tests/unit/
tests/integration/
manifest.json
versions.json
styles.css
package.json
package-lock.json
tsconfig.json
eslint.config.mjs
esbuild.config.mjs
LICENSE
README.md
```

Do not add generated `main.js`, custom Obsidian type stubs, model or WASM binaries, index files, or manual release archives.

## 2. Manifest

Use the stable ID `semantic-links`, version `0.1.0`, and `minAppVersion` `1.13.0`. Keep the plugin desktop-only until the planned local runtime is proven on mobile.

Review the minimum version against the APIs actually used before release. Do not lower it only to increase compatibility.

## 3. TypeScript and lint baseline

- strict TypeScript
- official `obsidian` dependency matching the API used
- no `skipLibCheck` workaround
- no implicit or explicit `any` in plugin source
- no unvalidated JSON casts
- unsafe TypeScript lint rules are errors for `src/**`
- test-only exceptions must be narrow and documented in lint configuration

Treat disk data, downloaded JSON, worker messages, model metadata, index manifests, and browser storage records as `unknown` until validated.

## 4. Settings schema

Implement:

- `settingsVersion`
- safe defaults
- field validation and normalization
- explicit legacy migration
- declarative `getSettingDefinitions()`
- `Setting.setHeading()` for sections

Because `minAppVersion` is 1.13.0, use the declarative settings API only. Add an imperative `display()` fallback only if the minimum version is later lowered below 1.13.0.

## 5. Editor controller

Use one controller per editor view. It owns the debounce timer, request identity, active request keys, cancellation, composition state, plugin-transaction state, visible context, and undo/redo suppression.

Tests must prove:

- duplicate triggers collapse into one request
- a new context cancels stale work immediately, before its debounce expires
- stale request IDs are ignored
- file, document, anchor, and cursor changes invalidate incompatible results
- IME composition suppresses work
- Undo suppresses automatic reopening
- unload cancels timers and requests

The controller may initially return mock results. Retrieval comes later.

## 6. Atomic insertion contract

Insertion must:

1. revalidate the expected range
2. resolve the target through Obsidian metadata APIs
3. render the configured valid link path
4. dispatch one CodeMirror transaction
5. return success or a typed failure
6. write feedback only after dispatch succeeds

One Undo must restore the exact original text without reopening or reinserting the accepted suggestion.

## 7. Cheap lifecycle

`onload()` may register commands, settings, editor extensions, views, and cleanup. It must not scan the vault, open an index, download a model, initialise a runtime, or read every note.

Use `workspace.onLayoutReady()` for real index or background services when those services exist. Do not create empty service layers solely as placeholders; retain cancellation and cleanup at the owning lifecycle boundary.

Register only commands that perform useful work. Future command IDs do not need placeholder command-palette entries.

## 8. CI

CI runs:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run build
node --check main.js
```

It also rejects version disagreement, committed generated bundles, unsupported release assets, custom Obsidian type stubs, model/runtime binaries, and unreadable minified release output.

## 9. Release workflow

The workflow must:

- run the same clean checks as CI
- build from source
- validate version metadata
- attest each supported asset separately
- use an unprefixed tag matching the manifest version
- upload only `main.js`, `manifest.json`, and `styles.css`

Model and runtime downloads happen after installation with explicit consent.

## 10. Exit criteria

Phase 1 is complete when:

- the settings page is searchable on Obsidian 1.13+
- strict type and lint checks pass
- command IDs are short local identifiers
- a mock suggestion is accepted in one undoable transaction
- Undo does not immediately recreate or reopen it
- duplicate and stale editor work is suppressed
- selection-only context changes are handled
- CI passes from a clean dependency install
- the release workflow contains the exact three-file allowlist and attestations
- a manual Obsidian desktop walkthrough confirms load, unload, settings persistence, command behavior, and Undo
