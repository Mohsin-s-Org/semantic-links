import { readFile, readdir, stat } from "node:fs/promises";

const directory = process.argv[2] ?? "dist/release";
const expected = ["main.js", "manifest.json", "styles.css"];
const actual = (await readdir(directory)).sort();
assert(
  JSON.stringify(actual) === JSON.stringify(expected),
  `Release directory must contain exactly ${expected.join(", ")}; found ${actual.join(", ")}.`
);

for (const name of actual) {
  const details = await stat(`${directory}/${name}`);
  assert(details.isFile(), `Release asset must be a regular file: ${name}`);
  assert(details.size > 0, `Release asset must not be empty: ${name}`);
}

const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
assert(manifest.id === "semantic-links", "Staged manifest has the wrong plugin id.");
assert(typeof manifest.version === "string", "Staged manifest has no version.");

console.log(`Release allowlist verified in ${directory}.`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
