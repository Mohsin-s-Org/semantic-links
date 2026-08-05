# Community Plugins release checklist

Use this checklist for every public Semantic Links release. The official release tag must exactly match `manifest.json` without a `v` prefix.

## Repository

- [ ] Public repository with a clear README and MIT licence
- [ ] Stable plugin ID: `semantic-links`
- [ ] `package-lock.json` committed
- [ ] Official `obsidian` package used for API types
- [ ] No handwritten type stub that replaces Obsidian APIs
- [ ] Generated `main.js` not committed
- [ ] No model binaries, indexes, downloaded assets, or vault content committed

## Manifest and versions

- [ ] `manifest.json` version matches `package.json`
- [ ] `versions.json` maps the release to the correct minimum Obsidian version
- [ ] `isDesktopOnly` remains `true` until mobile support is tested
- [ ] Description states that links require explicit confirmation
- [ ] Command IDs are short local identifiers

## Source review

- [ ] Strict TypeScript and full library checking pass
- [ ] Unsafe TypeScript lint rules pass for plugin source
- [ ] Searchable declarative settings use `getSettingDefinitions()` and `Setting.setHeading()`
- [ ] Disk, worker, and network data is validated from `unknown`
- [ ] No obfuscation, minification, suspicious network behavior, or note-content logging
- [ ] `onload()` performs no vault scan, model initialisation, or embedding work
- [ ] Upstream type compatibility declarations are narrow, documented, and still necessary

## Editor safety

- [ ] Suggestions never alter text without explicit confirmation
- [ ] Acceptance revalidates the active file, target, range, text, and protected context
- [ ] Link insertion is one editor transaction
- [ ] One Undo restores the original text without reopening or reinserting
- [ ] Redo does not duplicate feedback
- [ ] New context or focus loss cancels stale work immediately
- [ ] Duplicate request keys cannot start twice
- [ ] Document, cursor, IME, plugin-transaction, and Undo/redo changes are handled
- [ ] Existing links, URLs, code, YAML, HTML, and math are protected
- [ ] Normal editor keys remain unchanged when the chooser is not active

## Privacy and model handling

Before semantic functionality is released:

- [ ] Model download requires explicit consent
- [ ] Lexical suggestions work without the model
- [ ] Model source and revision are pinned
- [ ] Integrity and partial-download recovery are implemented
- [ ] Vault text and embeddings never leave the device by default
- [ ] Exclusions are applied before embedding work
- [ ] Remove-model and delete-index actions delete managed files

## CI

- [ ] `npm ci`
- [ ] typecheck and lint
- [ ] unit and integration tests
- [ ] readable production build
- [ ] byte-for-byte reproducible build comparison
- [ ] `node --check main.js`
- [ ] version and repository policy checks
- [ ] exact release-asset allowlist
- [ ] clean-vault packaging smoke check
- [ ] every third-party action is pinned to a full commit SHA

## Official GitHub release

The release contains exactly:

- [ ] `main.js`
- [ ] `manifest.json`
- [ ] `styles.css`

It does not contain:

- [ ] manual installation ZIP
- [ ] model or WASM files
- [ ] checksum files
- [ ] documentation bundles
- [ ] other custom assets

GitHub's automatically generated source archives are expected and are not plugin assets.

## Provenance

- [ ] Workflow permissions include `contents: write`, `id-token: write`, and `attestations: write`
- [ ] Current `actions/attest` action is pinned to a full commit SHA
- [ ] Separate provenance attestation exists for each of the three release assets

## Manual verification

- [ ] Install only the three assets into a clean test vault
- [ ] Enable, disable, and reload the plugin without developer files
- [ ] Confirm searchable settings and persistence
- [ ] Test the command, protected contexts, insertion, Undo, and redo
- [ ] Test light and dark themes
- [ ] Test Windows, macOS, and Linux
- [ ] Confirm release `main.js` matches a clean source build byte-for-byte

The automated packaging smoke check does not replace this desktop walkthrough.
