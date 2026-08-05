# Phase 2 lexical suggestions checklist

## Vault indexing

- [x] Wait for `workspace.onLayoutReady` before the initial scan
- [x] Index Markdown files only
- [x] Respect excluded folders and tags before reading note content
- [x] Index frontmatter title and aliases
- [x] Index headings and tags from Obsidian's metadata cache
- [x] Index cleaned body text without frontmatter, code, URLs, comments or math
- [x] Refresh changed files and remove deleted or renamed paths
- [x] Keep all index data in memory and clear it on unload

## Retrieval and ranking

- [x] Normalize Unicode and remove combining marks for matching
- [x] Normalize common Arabic alif variants without changing displayed text
- [x] Support exact title, alias, heading and tag matches
- [x] Support prefix, token-overlap and n-gram fuzzy matches
- [x] Use indexed body terms as a lower-weight lexical signal
- [x] Exclude the active source note
- [x] Apply the configured confidence threshold and result limit

## Editor behaviour

- [x] Extract the active word or a single-line selected phrase
- [x] Add active sentence and paragraph context
- [x] Retain all protected-Markdown checks
- [x] Debounce and cancel automatic requests per editor
- [x] Show suggestions in a CodeMirror tooltip anchored to the text
- [x] Keep normal arrow and Enter behaviour until manual keyboard mode is active
- [x] Require click or Enter confirmation before insertion
- [x] Revalidate file, request, anchor and target before insertion
- [x] Insert one wikilink in one undoable CodeMirror transaction

## Verification

- [x] Unit tests cover normalization, Markdown cleaning and all lexical fields
- [x] Unit tests cover source exclusion and index updates
- [x] Context tests cover active words and selected phrases
- [x] Existing controller tests continue to cover stale request cancellation
- [ ] Complete a manual Obsidian desktop walkthrough before release
