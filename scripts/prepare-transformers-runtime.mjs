import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TRANSFORMERS_PACKAGE = "@huggingface/transformers@4.2.0";
const TRANSFORMERS_INTEGRITY = "sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE/MnUJ5/h/zTfEP3fDIft+nk7TqB8xXEyABGitBjQ==";
const ORT_VERSION = "1.26.0-dev.20260416-b7804b056c";
const ORT_PACKAGE = `onnxruntime-web@${ORT_VERSION}`;
const ORT_INTEGRITY = "sha512-MD6Ss4GSpQBo6zqoJzyT9LRbKYs7x/JVN23FT24EcEvlqF4VuzPOeH6X38orZPKHQDbprn7K+SBpu0/mj2CQiw==";
const ORT_ASSETS = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm"
];
const outputDir = path.resolve(".build/transformers");
const runtimePath = path.join(outputDir, "transformers.web.js");
const manifestPath = path.join(outputDir, "runtime-integrity.js");

await mkdir(outputDir, { recursive: true });
if (!await isPrepared(runtimePath) || !await isPrepared(manifestPath, 100)) {
  await prepareTransformers();
  await prepareOnnxRuntimeManifest();
}

async function prepareTransformers() {
  const archive = await pack(TRANSFORMERS_PACKAGE, TRANSFORMERS_INTEGRITY);
  extract(archive, outputDir, 2, "package/dist/transformers.web.js");
  extract(archive, outputDir, 1, "package/LICENSE");
  await rm(archive, { force: true });
  if (!await isPrepared(runtimePath)) {
    throw new Error("The Transformers.js browser runtime was not extracted.");
  }
}

async function prepareOnnxRuntimeManifest() {
  const archive = await pack(ORT_PACKAGE, ORT_INTEGRITY);
  const temporary = path.join(outputDir, "ort-integrity");
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  for (const asset of ORT_ASSETS) {
    extract(archive, temporary, 2, `package/dist/${asset}`);
  }
  await rm(archive, { force: true });

  const assets = {};
  for (const asset of ORT_ASSETS) {
    const bytes = await readFile(path.join(temporary, asset));
    assets[asset] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength
    };
  }
  await rm(temporary, { recursive: true, force: true });
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

function extract(archive, destination, stripComponents, member) {
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
