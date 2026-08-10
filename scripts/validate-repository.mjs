import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8"
}).split("\0").filter(Boolean);

const requiredFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "manifest.json",
  "versions.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "eslint.config.mjs",
  "esbuild.config.mjs",
  "styles.css",
  "scripts/verify-reproducible-build.mjs",
  "src/main.ts",
  "src/editor/context.ts",
  "src/editor/suggestion-popup.ts",
  "src/lexical/index.ts",
  "src/lexical/text.ts",
  "src/lexical/types.ts",
  "src/lexical/vault-index.ts",
  "src/indexing/chunker.ts",
  "src/indexing/embedding-batcher.ts",
  "src/indexing/index-manager.ts",
  "src/indexing/note-metadata.ts",
  "src/indexing/note-parser.ts",
  "src/indexing/scope-fingerprint.ts",
  "src/indexing/types.ts",
  "src/settings/settings-tab.ts",
  "src/storage/index-store.ts",
  "src/views/index-status-view.ts",
  "src/types/obsidian-history-handler-fix.d.ts"
];
for (const path of requiredFiles) {
  assert(trackedFiles.includes(path), `Missing required implementation file: ${path}`);
}

for (const path of trackedFiles) {
  const normalized = path.toLocaleLowerCase();
  assert(path !== "main.js", "Generated main.js must not be committed.");
  assert(!normalized.endsWith("/obsidian.d.ts") && normalized !== "obsidian.d.ts", "Custom Obsidian API stubs are prohibited.");
  assert(!normalized.endsWith(".onnx"), "Model binaries must not be committed.");
  assert(!normalized.endsWith(".wasm"), "WASM runtime binaries must not be committed.");
  assert(!/^(?:index|model|models|dist)\//u.test(normalized), `Generated runtime or release asset is tracked: ${path}`);
}

const [
  manifest,
  packageJson,
  tsconfig,
  constantsSource,
  mainSource,
  managerSource,
  parserSource,
  settingsSource,
  storeSource,
  buildSource,
  ciWorkflow,
  releaseWorkflow
] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("tsconfig.json"),
  readFile("src/constants.ts", "utf8"),
  readFile("src/main.ts", "utf8"),
  readFile("src/indexing/index-manager.ts", "utf8"),
  readFile("src/indexing/note-parser.ts", "utf8"),
  readFile("src/settings/settings-tab.ts", "utf8"),
  readFile("src/storage/index-store.ts", "utf8"),
  readFile("esbuild.config.mjs", "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile(".github/workflows/release.yml", "utf8")
]);

assert(manifest.isDesktopOnly === true, "The plugin must remain desktop-only.");
assert(manifest.minAppVersion === "1.13.0", "Declarative settings require Obsidian 1.13.0 or later.");
assert(/explicit confirmation/iu.test(manifest.description), "Manifest description must state the explicit-confirmation rule.");
assert(packageJson.devDependencies?.obsidian === "1.13.1", "Use the official Obsidian 1.13 type package.");
assert(packageJson.scripts?.["verify:reproducible-build"] !== undefined, "A reproducible-build check must remain configured.");
assert(tsconfig.compilerOptions?.strict === true, "Strict TypeScript must remain enabled.");
assert(tsconfig.compilerOptions?.skipLibCheck === false, "Library type checking must not be skipped.");
assert(constantsSource.includes('SHOW_SUGGESTIONS_COMMAND_ID = "show-suggestions"'), "Suggestion command must use a short local id.");
assert(constantsSource.includes('SHOW_INDEX_STATUS_COMMAND_ID = "show-index-status"'), "Index status command must use a short local id.");
assert(constantsSource.includes('REBUILD_INDEX_COMMAND_ID = "rebuild-index"'), "Rebuild command must use a short local id.");
assert(constantsSource.includes('DELETE_INDEX_COMMAND_ID = "delete-index"'), "Delete command must use a short local id.");
assert(mainSource.includes("new LexicalVaultIndex"), "The local lexical index must remain available.");
assert(mainSource.includes("new PersistentIndexManager"), "Phase 3 must initialize the persistent index after layout readiness.");
assert(mainSource.includes("createSuggestionPopupExtension"), "The inline confirmation popup must remain registered.");
assert(managerSource.includes("findRemovedChunkIds"), "Modified notes must retain unchanged passage vectors.");
assert(managerSource.includes("createIndexScopeFingerprint"), "Stored indexes must be bound to their exclusion scope.");
assert(parserSource.indexOf("isFileExcluded") < parserSource.indexOf("cachedRead"), "Excluded notes must be rejected before content is read.");
assert(settingsSource.includes("getSettingDefinitions"), "Obsidian 1.13 settings must remain declarative.");
assert(!settingsSource.includes(".display("), "Declarative settings must not call deprecated display().");
assert(storeSource.includes("scopeFingerprint"), "The persistent manifest must record its exclusion scope.");
assert(storeSource.includes("manifest.json.next"), "Persistent writes must stage a next manifest.");
assert(storeSource.includes("manifest.json.previous"), "Persistent writes must retain a recoverable previous manifest.");
assert(!buildSource.includes("--minify"), "The release bundle must remain readable for review.");
assert(ciWorkflow.includes("npm run verify:reproducible-build"), "CI must compare two production builds.");
assert(releaseWorkflow.includes("uses: actions/attest@"), "Releases must use the current GitHub attestation action.");

for (const workflow of [ciWorkflow, releaseWorkflow]) {
  for (const match of workflow.matchAll(/^\s*uses:\s+[^@\s]+@([^\s#]+)/gmu)) {
    assert(/^[0-9a-f]{40}$/u.test(match[1] ?? ""), `GitHub Action is not pinned to a full commit SHA: ${match[0].trim()}`);
  }
}

console.log(`Repository policy verified across ${trackedFiles.length} tracked files.`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
