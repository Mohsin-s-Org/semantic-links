import assert from "node:assert/strict";
import test from "node:test";
import {
  createSnapshotIntegrity,
  parseSnapshotIntegrity,
  verifySnapshotIntegrity
} from "../../src/storage/snapshot-integrity.ts";

test("creates deterministic sizes and SHA-256 checksums", async () => {
  const vectors = new Float32Array([0.25, 0.75]).buffer;
  const first = await createSnapshotIntegrity("[]\n", "[]\n", vectors);
  const second = await createSnapshotIntegrity("[]\n", "[]\n", vectors);

  assert.deepEqual(first, second);
  assert.equal(first.files.documents.size, 3);
  assert.equal(first.files.vectors.size, 8);
  assert.match(first.files.vectors.sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    parseSnapshotIntegrity(`${JSON.stringify(first)}\n`),
    first
  );
});

test("verifies exact serialized bytes", async () => {
  const vectors = new Float32Array([0.25, 0.75]).buffer;
  const integrity = await createSnapshotIntegrity("[]\n", "[]\n", vectors);

  await verifySnapshotIntegrity(integrity, "[]\n", "[]\n", vectors);
  await assert.rejects(
    verifySnapshotIntegrity(integrity, "[ ]\n", "[]\n", vectors),
    /documents\.json/u
  );
  await assert.rejects(
    verifySnapshotIntegrity(
      integrity,
      "[]\n",
      "[]\n",
      new Float32Array([0.25, 0.5]).buffer
    ),
    /vectors\.f32 checksum/u
  );
});

test("rejects malformed integrity metadata", () => {
  assert.throws(() => parseSnapshotIntegrity("{}"));
  assert.throws(() => parseSnapshotIntegrity(JSON.stringify({
    schemaVersion: 1,
    files: {
      documents: { size: -1, sha256: "bad" },
      chunks: { size: 0, sha256: "0".repeat(64) },
      vectors: { size: 0, sha256: "0".repeat(64) }
    }
  })));
});
