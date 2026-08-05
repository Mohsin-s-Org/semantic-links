import { cp, mkdir, rm } from "node:fs/promises";

const outputDirectory = "dist/release";
const releaseAssets = ["main.js", "manifest.json", "styles.css"];

await rm("dist", { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const asset of releaseAssets) {
  await cp(asset, `${outputDirectory}/${asset}`);
}

console.log(`Staged ${releaseAssets.join(", ")} in ${outputDirectory}.`);
