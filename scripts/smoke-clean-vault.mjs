import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const vaultRoot = await mkdtemp(join(tmpdir(), "semantic-links-vault-"));
const pluginDirectory = join(
  vaultRoot,
  ".obsidian",
  "plugins",
  "semantic-links"
);

try {
  await mkdir(pluginDirectory, { recursive: true });
  for (const asset of ["main.js", "manifest.json", "styles.css"]) {
    await cp(join("dist", "release", asset), join(pluginDirectory, asset));
  }

  const installedFiles = (await readdir(pluginDirectory)).sort();
  assert(
    JSON.stringify(installedFiles) === JSON.stringify(["main.js", "manifest.json", "styles.css"]),
    "Clean-vault install contained unexpected assets."
  );

  const manifest = JSON.parse(await readFile(join(pluginDirectory, "manifest.json"), "utf8"));
  assert(manifest.id === "semantic-links", "Clean-vault manifest id is invalid.");
  assert(manifest.isDesktopOnly === true, "Clean-vault manifest must remain desktop-only.");

  const syntaxCheck = spawnSync(
    process.execPath,
    ["--check", join(pluginDirectory, "main.js")],
    { encoding: "utf8" }
  );
  assert(
    syntaxCheck.status === 0,
    syntaxCheck.stderr || "Generated main.js failed the syntax check."
  );

  console.log(`Clean-vault smoke check passed for ${manifest.version}.`);
} finally {
  await rm(vaultRoot, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
