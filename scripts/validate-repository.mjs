import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8"
}).split("\0").filter(Boolean);

const requiredFiles = [
  "manifest.json",
  "versions.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "eslint.config.mjs",
  "esbuild.config.mjs",
  "styles.css",
  "src/main.ts"
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

const [manifest, packageJson, tsconfig, mainSource] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("tsconfig.json"),
  readFile("src/main.ts", "utf8")
]);

assert(manifest.isDesktopOnly === true, "Phase 1 must remain desktop-only.");
assert(/explicit confirmation/iu.test(manifest.description), "Manifest description must state the explicit-confirmation rule.");
assert(typeof packageJson.devDependencies?.obsidian === "string", "The official obsidian package must be a development dependency.");
assert(tsconfig.compilerOptions?.strict === true, "Strict TypeScript must remain enabled.");
assert(tsconfig.compilerOptions?.skipLibCheck === false, "Library type checking must not be skipped.");

const requiredCommandIds = [
  "show-suggestions",
  "rebuild-index",
  "pause-indexing",
  "show-index-status",
  "download-model",
  "remove-model",
  "clear-feedback",
  "open-diagnostics"
];
for (const commandId of requiredCommandIds) {
  assert(mainSource.includes(`\"${commandId}\"`), `Missing reserved local command id: ${commandId}`);
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
