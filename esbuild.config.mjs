import { spawn, spawnSync } from "node:child_process";

const production = process.argv[2] === "production";
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const nodeExecutable = process.execPath;
const prepared = spawnSync(nodeExecutable, ["scripts/prepare-transformers-runtime.mjs"], {
  stdio: "inherit"
});
if (prepared.status !== 0) {
  process.exitCode = prepared.status ?? 1;
} else {
  const args = [
    "--yes",
    "esbuild@0.25.5",
    "src/main.ts",
    "--bundle",
    "--platform=node",
    "--target=es2018",
    "--format=cjs",
    "--external:obsidian",
    "--external:electron",
    "--external:@codemirror/state",
    "--external:@codemirror/view",
    "--alias:@semantic-links/transformers=./.build/transformers/transformers.web.js",
    "--outfile=main.js",
    "--log-level=info"
  ];

  if (!production) {
    args.push("--sourcemap=inline", "--watch");
  }

  const child = spawn(executable, args, { stdio: "inherit" });
  child.on("error", (error) => {
    console.error("Unable to start esbuild.", error);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
