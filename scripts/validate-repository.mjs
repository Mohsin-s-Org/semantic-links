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
  "src/main.ts",
  "src/types/obsidian-history-handler-fix.d.ts"
];
for (const path of requiredFiles) {
  assert(trackedFiles.includes(path), `Missing required foundation file: ${path}`);
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
  buildSource,
  ciWorkflow,
  releaseWorkflow
] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("tsconfig.json"),
  readFile("src/constants.ts", "utf8"),
  readFile("esbuild.config.mjs", "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile(".github/workflows/release.yml", "utf8")
]);

assert(manifest.isDesktopOnly === true, "Phase 1 must remain desktop-only.");
assert(manifest.minAppVersion === "1.13.0", "Declarative settings require Obsidian 1.13.0 or later.");
assert(/explicit confirmation/iu.test(manifest.description), "Manifest description must state the explicit-confirmation rule.");
assert(packageJson.devDependencies?.obsidian === "1.13.1", "Use the official Obsidian 1.13 type package.");
assert(tsconfig.compilerOptions?.strict === true, "Strict TypeScript must remain enabled.");
assert(tsconfig.compilerOptions?.skipLibCheck === false, "Library type checking must not be skipped.");
assert(constantsSource.includes('SHOW_SUGGESTIONS_COMMAND_ID = "show-suggestions"'), "The implemented command must use a short local id.");
assert(!buildSource.includes("--minify"), "The release bundle must remain readable for review.");
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
