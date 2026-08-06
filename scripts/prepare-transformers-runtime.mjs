import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TRANSFORMERS_PACKAGE = "@huggingface/transformers@4.2.0";
const TRANSFORMERS_INTEGRITY = "sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE/MnUJ5/h/zTfEP3fDIft+nk7TqB8xXEyABGitBjQ==";
const ORT_VERSION = "1.26.0-dev.20260416-b7804b056c";
const ORT_PACKAGE = `onnxruntime-web@${ORT_VERSION}`;
const ORT_INTEGRITY = "sha512-MD6Ss4GSpQBo6zqoJzyT9LRbKYs7x/JVN23FT24EcEvlqF4VuzPOeH6X38orZPKHQDbprn7K+SBpu0/mj2CQiw==";
const ORT_COMMON_VERSION = "1.24.0-dev.20251116-b39e144322";
const ORT_COMMON_PACKAGE = `onnxruntime-common@${ORT_COMMON_VERSION}`;
const ORT_COMMON_INTEGRITY = "sha512-BOoomdHYmNRL5r4iQ4bMvsl2t0/hzVQ3OM3PHD0gxeXu1PmggqBv3puZicEUVOA3AtHHYmqZtjMj9FOfGrATTw==";
const ORT_ASSETS = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm"
];
const buildRoot = path.resolve(".build");
const outputDir = path.join(buildRoot, "transformers");
const nodeModulesDir = path.join(buildRoot, "node_modules");
const runtimePath = path.join(outputDir, "transformers.web.js");
const manifestPath = path.join(outputDir, "runtime-integrity.js");
const ortPackageDir = path.join(nodeModulesDir, "onnxruntime-web");
const ortCommonPackageDir = path.join(nodeModulesDir, "onnxruntime-common");

await mkdir(outputDir, { recursive: true });
await mkdir(nodeModulesDir, { recursive: true });
if (
  !await isPrepared(runtimePath)
  || !await isPrepared(manifestPath, 100)
  || !await isPrepared(path.join(ortPackageDir, "package.json"), 100)
  || !await isPrepared(path.join(ortCommonPackageDir, "package.json"), 100)
) {
  await prepareTransformers();
  await prepareOnnxRuntime();
}

async function prepareTransformers() {
  const archive = await pack(TRANSFORMERS_PACKAGE, TRANSFORMERS_INTEGRITY);
  extractMember(archive, outputDir, 2, "package/dist/transformers.web.js");
  extractMember(archive, outputDir, 1, "package/LICENSE");
  await rm(archive, { force: true });
  if (!await isPrepared(runtimePath)) {
    throw new Error("The Transformers.js browser runtime was not extracted.");
  }
}

async function prepareOnnxRuntime() {
  const ortArchive = await pack(ORT_PACKAGE, ORT_INTEGRITY);
  await extractPackage(ortArchive, ortPackageDir);
  await rm(ortArchive, { force: true });

  const commonArchive = await pack(ORT_COMMON_PACKAGE, ORT_COMMON_INTEGRITY);
  await extractPackage(commonArchive, ortCommonPackageDir);
  await rm(commonArchive, { force: true });

  const assets = {};
  for (const asset of ORT_ASSETS) {
    const bytes = await readFile(path.join(ortPackageDir, "dist", asset));
    assets[asset] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength
    };
  }
  await writeFile(manifestPath, [
    `export const ORT_VERSION = ${JSON.stringify(ORT_VERSION)};`,
    `export const ORT_ASSETS = Object.freeze(${JSON.stringify(assets, null, 2)});`,
    ""
  ].join("\n"));
}

async function pack(specification, integrity) {
  const packed = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", specification, "--silent", "--json", "--pack-destination", outputDir],
    { encoding: "utf8" }
  );
  if (packed.status !== 0) {
    throw new Error(packed.stderr || `Unable to download ${specification}.`);
  }
  const result = JSON.parse(packed.stdout);
  const filename = result[0]?.filename;
  if (typeof filename !== "string") {
    throw new Error(`npm pack did not return a filename for ${specification}.`);
  }
  const archive = path.join(outputDir, filename);
  await verifyIntegrity(archive, integrity, specification);
  return archive;
}

async function extractPackage(archive, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const result = spawnSync(
    "tar",
    ["-xzf", archive, "--strip-components=1", "-C", destination],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `Unable to extract ${archive}.`);
  }
}

function extractMember(archive, destination, stripComponents, member) {
  const result = spawnSync(
    "tar",
    ["-xzf", archive, `--strip-components=${stripComponents}`, "-C", destination, member],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `Unable to extract ${member}.`);
  }
}

async function verifyIntegrity(file, integrity, label) {
  const [algorithm, expected] = integrity.split("-", 2);
  const actual = createHash(algorithm).update(await readFile(file)).digest("base64");
  if (actual !== expected) {
    throw new Error(`${label} integrity failed: expected ${expected}, received ${actual}.`);
  }
}

async function isPrepared(file, minimumBytes = 1_000_000) {
  try {
    return (await readFile(file)).byteLength > minimumBytes;
  } catch {
    return false;
  }
}
