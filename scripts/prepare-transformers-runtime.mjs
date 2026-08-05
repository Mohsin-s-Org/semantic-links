import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const PACKAGE = "@huggingface/transformers@4.2.0";
const EXPECTED_INTEGRITY = "sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE/MnUJ5/h/zTfEP3fDIft+nk7TqB8xXEyABGitBjQ==";
const outputDir = path.resolve(".build/transformers");
const runtimePath = path.join(outputDir, "transformers.web.js");

await mkdir(outputDir, { recursive: true });
if (await isPrepared(runtimePath)) {
  process.exit(0);
}

const packed = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["pack", PACKAGE, "--silent", "--json", "--pack-destination", outputDir],
  { encoding: "utf8" }
);
if (packed.status !== 0) {
  throw new Error(packed.stderr || "Unable to download the pinned Transformers.js package.");
}

const result = JSON.parse(packed.stdout);
const filename = result[0]?.filename;
if (typeof filename !== "string") {
  throw new Error("npm pack did not return a package filename.");
}
const archive = path.join(outputDir, filename);
await verifyIntegrity(archive, EXPECTED_INTEGRITY);

const extracted = spawnSync(
  "tar",
  ["-xzf", archive, "--strip-components=2", "-C", outputDir,
    "package/dist/transformers.web.js", "package/LICENSE"],
  { encoding: "utf8" }
);
await rm(archive, { force: true });
if (extracted.status !== 0) {
  throw new Error(extracted.stderr || "Unable to extract the Transformers.js browser runtime.");
}
if (!await isPrepared(runtimePath)) {
  throw new Error("The Transformers.js browser runtime was not extracted.");
}

async function verifyIntegrity(file, integrity) {
  const [algorithm, expected] = integrity.split("-", 2);
  const actual = createHash(algorithm).update(await readFile(file)).digest("base64");
  if (actual !== expected) {
    throw new Error(`Transformers.js package integrity failed: expected ${expected}, received ${actual}.`);
  }
}

async function isPrepared(file) {
  try {
    return (await readFile(file)).byteLength > 1_000_000;
  } catch {
    return false;
  }
}
