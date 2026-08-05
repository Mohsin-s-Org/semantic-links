import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const firstBuild = await readFile("main.js");
const rebuild = spawnSync(
  process.execPath,
  ["esbuild.config.mjs", "production"],
  { stdio: "inherit" }
);

if (rebuild.status !== 0) {
  throw new Error("The comparison build failed.");
}

const secondBuild = await readFile("main.js");
if (!firstBuild.equals(secondBuild)) {
  throw new Error("Production builds are not byte-for-byte reproducible.");
}

console.log("Production bundle is byte-for-byte reproducible.");
