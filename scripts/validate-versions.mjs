import { readFile } from "node:fs/promises";

const [manifest, packageJson, versions] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("versions.json")
]);

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
assert(manifest.id === "semantic-links", "manifest.json must keep the stable id semantic-links.");
assert(typeof manifest.version === "string" && semverPattern.test(manifest.version), "Manifest version must be semantic versioning.");
assert(packageJson.version === manifest.version, "package.json and manifest.json versions must agree.");
assert(
  versions[manifest.version] === manifest.minAppVersion,
  "versions.json must map the current version to manifest.minAppVersion."
);

if (process.env.GITHUB_REF_TYPE === "tag") {
  assert(
    process.env.GITHUB_REF_NAME === manifest.version,
    "Release tags must be the exact manifest version without a v prefix."
  );
}

console.log(`Version agreement verified for ${manifest.version}.`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
