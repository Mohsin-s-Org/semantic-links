# Community Plugins release checklist

Use this checklist for every public Semantic Links release. The official release tag must exactly match the version in `manifest.json` and must not use a `v` prefix.

## Repository

- [ ] Public repository with a clear README and MIT licence
- [ ] Stable plugin ID: `semantic-links`
- [ ] Display name uses only permitted punctuation
- [ ] `package-lock.json` committed
- [ ] Official `obsidian` package used for API types
- [ ] No handwritten type stub that turns Obsidian APIs into `any`
- [ ] Generated `main.js` not committed to the normal source tree
- [ ] No model binaries, indexes, downloaded assets, or vault content committed

## Manifest and versions

- [ ] `manifest.json` version matches `package.json`
- [ ] `versions.json` contains the release version and correct minimum Obsidian version
- [ ] `isDesktopOnly` remains `true` until mobile support is actually tested
- [ ] Description accurately states that the plugin suggests links and does not insert them automatically
- [ ] Command IDs do not repeat the plugin ID

## Source review

- [ ] Strict TypeScript passes
- [ ] ESLint passes without unsafe-call, unsafe-member-access, unsafe-assignment, unsafe-return, unsafe-argument, or unexpected-any warnings in plugin source
- [ ] Settings headings use `Setting.setHeading()`
- [ ] `PluginSettingTab.getSettingDefinitions()` is implemented for settings search
- [ ] Data loaded from disk, workers, and network is validated from `unknown`
- [ ] No suspicious network patterns
- [ ] No obfuscation
- [ ] No note contents logged in production
- [ ] `onload()` performs no vault scan, model initialisation, or embedding work

## Editor safety

- [ ] Suggestions never alter text without explicit confirmation
- [ ] Link insertion is one editor transaction
- [ ] One Undo restores the original text
- [ ] Undo does not immediately recreate the link or reopen an accepted suggestion
- [ ] Redo does not duplicate feedback
- [ ] Stale async results cannot alter the current note
- [ ] Duplicate editor/key events cannot start the same query twice
- [ ] IME composition is respected
- [ ] Existing wikilinks, URLs, code, YAML, HTML, and math are guarded
- [ ] Normal Enter, Tab, and arrow behaviour is unchanged when the popup is not focused

## Privacy and model handling

- [ ] Semantic model download requires explicit user consent
- [ ] Lexical suggestions work without the model
- [ ] Model source and revision are pinned
- [ ] Integrity and partial-download recovery are implemented
- [ ] Vault text and embeddings never leave the device in the default provider
- [ ] Exclusions are applied before text enters the embedding queue
- [ ] Remove-model and delete-index commands actually delete managed files

## CI

- [ ] `npm ci`
- [ ] type check
- [ ] ESLint
- [ ] unit tests
- [ ] integration tests
- [ ] production build
- [ ] `node --check main.js`
- [ ] version agreement check
- [ ] release asset allowlist check
- [ ] reproducible build comparison
- [ ] clean-vault installation test

## Official GitHub release

The official release contains exactly:

- [ ] `main.js`
- [ ] `manifest.json`
- [ ] `styles.css`

It must not contain:

- [ ] manual installation ZIP
- [ ] model files
- [ ] WASM files
- [ ] checksum files
- [ ] extra documentation assets
- [ ] custom source archives

GitHub's automatically generated `Source code (zip)` and `Source code (tar.gz)` entries are expected and are not plugin assets.

## Provenance

- [ ] Workflow permissions include `contents: write`, `id-token: write`, and `attestations: write`
- [ ] Separate build-provenance attestation created for `main.js`
- [ ] Separate build-provenance attestation created for `manifest.json`
- [ ] Separate build-provenance attestation created for `styles.css`

## Manual verification

- [ ] Install only the three release assets into a clean test vault
- [ ] Enable plugin without developer files present
- [ ] Test first launch with no model downloaded
- [ ] Test model download cancellation and failure
- [ ] Test indexing pause, resume, rebuild, and deletion
- [ ] Test suggestion insertion and Undo
- [ ] Test light and dark themes
- [ ] Test Windows, macOS, and Linux
- [ ] Confirm release `main.js` matches a clean source build byte-for-byte
