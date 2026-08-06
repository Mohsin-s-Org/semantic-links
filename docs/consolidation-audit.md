# Semantic implementation consolidation audit

This audit compares the cumulative implementation through issue #18 with the master plan, addendum, Obsidian guardrails and semantic-efficiency epic.

## Included implementation

- Phase 3 persistent structural passage index
- Verified consent-based local q8 multilingual E5 runtime
- Stage A diagnostics and repository-safe relevance evaluation
- Stage B checkpoint, journal, packed-vector, worker-update, integrity, batching and thread-tuning work
- Stage C focused semantic query context through issue #18

Issues #19–#25 are intentionally not marked complete by this consolidation. They require tokenizer-budget, fusion or scale-gate evidence that is not present in the validated remote PR stack.

## Audit conclusions

### Architecture

The implementation keeps editor control, lexical retrieval, model lifecycle, indexing, storage and semantic search in separate modules. Large orchestration files remain explicit where splitting them would duplicate state or obscure transaction and recovery ordering.

The audit did not introduce an ANN index, database, GPU path, lower-precision model or post-hoc dimension truncation. Exact float32 search remains the reference and fallback.

### Obsidian compliance

- `onload()` registers settings, commands, editor extensions, views and lifecycle hooks only.
- Vault scans, persistent-index opening and cached-model loading begin after `workspace.onLayoutReady()`.
- Official Obsidian 1.13 types and declarative `getSettingDefinitions()` remain authoritative.
- Suggestion acceptance remains one revalidated CodeMirror transaction.
- Existing stale-request, IME, undo/redo and plugin-unload protections remain intact.
- The release remains desktop-only and contains exactly `main.js`, `manifest.json` and `styles.css`.

### Privacy and release safety

- Vault content and embeddings remain local.
- Model/runtime downloads require explicit consent, pinned allowlists and integrity verification.
- No model, WASM, index, archive or documentation asset is added to Community Plugins releases.
- Generated bundles and local indexes remain excluded from source history.

## Corrections made during consolidation

- Allow semantic-only suggestions when lexical matching is disabled.
- Skip lexical search work when its setting is disabled.
- Drive adaptive background activity from the editor-controller path rather than global document keyboard/input listeners.
- Keep active-leaf changes as an explicit activity signal.
- Handle asynchronous settings actions without unhandled promise rejections.
- Remove a duplicate TypeScript pass from the CI pipeline while preserving standalone `npm run build` typechecking.
- Update the README to describe the actual local model, persistence, diagnostics and efficiency implementation.
- Add deterministic policy tests for lexical-only, semantic-only, hybrid and fully disabled modes.

## Deliberately retained complexity

The index manager, journal and generation store encode ordered state transitions, recovery boundaries and validation rules. The audit favours small pure helpers where they remove duplication, but does not split these transaction-heavy modules merely to reduce line counts. Their current explicit sequencing is safer and easier to review than multiple stateful wrappers.

## Validation policy

Earlier stack heads through PR #35 passed strict TypeScript, unsafe-pattern linting, unit and integration tests, verified production bundling, reproducibility, repository policy, exact release staging and clean-vault smoke checks.

The consolidated PR must pass the same complete pipeline once on the self-hosted runner. No artifact upload, job matrix, scheduled workflow or repeated hosted build is introduced.

Live Obsidian walkthroughs and representative performance/relevance reports remain required before release and before measurement-gated issues are closed.
