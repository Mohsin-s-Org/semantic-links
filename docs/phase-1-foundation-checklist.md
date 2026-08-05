# Phase 1 foundation checklist

This checklist replaces the vague instruction to “scaffold the plugin.” It defines the exact foundation that must exist before lexical or semantic features are built.

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

Do not add:

```text
main.js
custom obsidian.d.ts
model binaries
WASM binaries
index files
manual release ZIP
```

## 2. Initial manifest

Use a stable ID from the first commit:

```json
{
  "id": "semantic-links",
  "name": "Semantic Links",
  "version": "0.1.0",
  "minAppVersion": "1.13.0",
  "description": "Suggest contextually relevant internal links while you write using local lexical and semantic matching.",
  "author": "Mohsin Osman",
  "isDesktopOnly": true
}
```

The minimum version should be reviewed against the APIs actually used before release. Do not lower it merely to increase compatibility.

## 3. TypeScript and lint baseline

- `strict: true`
- official `obsidian` dependency
- no `skipLibCheck` workaround for plugin source problems
- no implicit `any`
- no `as any`
- no unvalidated JSON casts
- lint unsafe TypeScript rules as errors for `src/**`
- test files may use narrower exceptions where justified

Treat these boundaries as `unknown`:

- `loadData()` output
- worker messages
- model metadata
- downloaded JSON
- index manifests
- browser storage records

## 4. Settings schema from day one

Implement:

- `settingsVersion`
- defaults
- field validators
- migration function
- traditional settings tab
- declarative `getSettingDefinitions()`
- `Setting.setHeading()` for visual sections

The first schema should include all switches needed for the lexical-only fallback, even before semantic indexing exists.

## 5. Editor controller before retrieval

Build the per-editor state machine before implementing matching:

```ts
interface EditorSuggestionController {
  latestRequestId: number;
  pendingKeys: Set<string>;
  debounceTimer: number | null;
  suppressUntil: number;
  isComposing: boolean;
  isApplyingPluginTransaction: boolean;
  visibleContextHash: string | null;
}
```

First tests should prove:

- duplicate triggers collapse into one request
- stale request IDs are ignored
- changing files invalidates results
- changing anchor text invalidates results
- Undo suppresses automatic reopening
- unload cancels timers

The controller may initially return mock suggestions. Retrieval comes later.

## 6. Atomic insertion contract

Implement wikilink rendering and editor insertion as a pure, tested unit before the popup:

```ts
interface LinkInsertionRequest {
  from: number;
  to: number;
  expectedText: string;
  targetPath: string;
  heading?: string;
  displayText: string;
}
```

Insertion must:

1. revalidate the expected range
2. resolve the target through Obsidian metadata APIs
3. render the shortest valid link according to settings
4. dispatch one CodeMirror transaction
5. return success or a typed failure
6. write feedback only after success

## 7. Cheap lifecycle scaffold

`onload()` registers only:

- commands
- settings tab
- editor extension
- optional views
- lifecycle cleanup

`workspace.onLayoutReady()` starts:

- index storage opening
- vault listeners
- metadata comparison
- background queues

The initial scaffold must include abort controllers and cleanup paths even while services are placeholders.

## 8. CI before feature work

The first PR must establish CI that runs:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run build
node --check main.js
```

CI must also fail when:

- versions disagree
- a generated `main.js` is committed
- an unsupported release asset is configured
- a custom Obsidian type stub appears

## 9. Release workflow before beta

The release workflow must be present and reviewable before the first beta tag. It should:

- run the same clean checks as CI
- build from source
- validate version metadata
- attest each supported asset separately
- create or update the matching unprefixed release tag
- upload only `main.js`, `manifest.json`, and `styles.css`

Model/runtime downloads happen after installation and are not GitHub release assets.

## 10. Foundation exit criteria

Phase 1 is complete only when:

- the plugin loads and unloads in a clean vault
- the settings page is searchable on current Obsidian
- strict type and lint checks pass without unsafe warnings
- commands use local IDs
- a mock suggestion can be accepted in one undoable transaction
- Undo does not immediately recreate or reopen it
- duplicate editor events do not duplicate work
- CI passes from a clean dependency install
- the release workflow contains the three-file allowlist and attestations
