import assert from "node:assert/strict";
import test from "node:test";
import type { IndexSnapshot } from "../../src/indexing/types.ts";
import { prepareGenerationFiles } from "../../src/storage/index-integrity.ts";
import {
  createEmptyIndexManifest,
  PersistentIndexStore,
  type IndexStorageAdapter
} from "../../src/storage/index-store.ts";

class MemoryAdapter implements IndexStorageAdapter {
  readonly files = new Map<string, string | ArrayBuffer>();
  readonly directories = new Set<string>();

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path) || this.directories.has(path));
  }

  read(path: string): Promise<string> {
    const value = this.files.get(path);
    return typeof value === "string"
      ? Promise.resolve(value)
      : Promise.reject(new Error(`Missing text file: ${path}`));
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.files.get(path);
    return value instanceof ArrayBuffer
      ? Promise.resolve(value.slice(0))
      : Promise.reject(new Error(`Missing binary file: ${path}`));
  }

  write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    return Promise.resolve();
  }

  append(path: string, data: string): Promise<void> {
    const current = this.files.get(path);
    if (current instanceof ArrayBuffer) {
      return Promise.reject(new Error(`Cannot append text to binary file: ${path}`));
    }
    this.files.set(path, `${current ?? ""}${data}`);
    return Promise.resolve();
  }

  writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data.slice(0));
    return Promise.resolve();
  }

  mkdir(path: string): Promise<void> {
    this.directories.add(path);
    return Promise.resolve();
  }

  rmdir(path: string, recursive: boolean): Promise<void> {
    if (!recursive) {
      return Promise.reject(new Error("Tests require recursive directory removal."));
    }
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.files.delete(key);
      }
    }
    this.directories.delete(path);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    const value = this.files.get(oldPath);
    if (value === undefined) {
      return Promise.reject(new Error(`Missing rename source: ${oldPath}`));
    }
    this.files.set(newPath, cloneValue(value));
    this.files.delete(oldPath);
    return Promise.resolve();
  }

  copy(oldPath: string, newPath: string): Promise<void> {
    const value = this.files.get(oldPath);
    if (value === undefined) {
      return Promise.reject(new Error(`Missing copy source: ${oldPath}`));
    }
    this.files.set(newPath, cloneValue(value));
    return Promise.resolve();
  }
}

const ROOT = "plugin/index";

test("round-trips checksummed files without cloning the final vector matrix", async () => {
  const adapter = new MemoryAdapter();
  const store = createStore(adapter);
  const snapshot = createSnapshot(1, "first");
  const originalBuffer = snapshot.vectors.buffer;
  const written = await store.write(snapshot);
  const opened = await store.open();

  assert.equal(written.manifest.dirty, false);
  assert.equal(written.vectors.buffer, originalBuffer);
  assert.match(written.manifest.files?.documents.sha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(written.manifest.files?.chunks.sha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(written.manifest.files?.vectors.sha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(written.manifest.files?.vectors.bytes, snapshot.vectors.byteLength);
  assert.equal(opened.manifest.generation, 1);
  assert.equal(opened.manifest.scopeFingerprint, "scope");
  assert.equal(opened.documents[0]?.path, "Notes/first.md");
  assert.equal(opened.chunks[0]?.vectorRow, 0);
  assert.deepEqual([...opened.vectors], [0.25, 0.75]);
  assert.equal(await adapter.exists(`${ROOT}/journal.ndjson`), false);
});

test("restores the last validated generation after an interrupted write", async () => {
  const adapter = new MemoryAdapter();
  const store = createStore(adapter);
  await store.write(createSnapshot(1, "stable"));

  for (const name of [
    "manifest.json",
    "documents.json",
    "chunks.json",
    "vectors.f32"
  ]) {
    await adapter.copy(`${ROOT}/${name}`, `${ROOT}/${name}.previous`);
  }
  const dirty = {
    ...createSnapshot(2, "interrupted").manifest,
    dirty: true
  };
  await adapter.write(`${ROOT}/manifest.json`, `${JSON.stringify(dirty)}\n`);
  await adapter.write(`${ROOT}/documents.json.next`, "[]\n");

  const recovered = await createStore(adapter).open();

  assert.equal(recovered.manifest.generation, 1);
  assert.equal(recovered.manifest.dirty, false);
  assert.equal(recovered.documents[0]?.path, "Notes/stable.md");
  assert.equal(await adapter.exists(`${ROOT}/documents.json.next`), false);
  assert.equal(await adapter.exists(`${ROOT}/manifest.json.previous`), false);
});

test("restores the previous checksum-verified generation after corruption", async () => {
  const adapter = new MemoryAdapter();
  const store = createStore(adapter);
  await store.write(createSnapshot(1, "stable"));
  await store.write(createSnapshot(2, "current"));
  const current = await adapter.readBinary(`${ROOT}/vectors.f32`);
  new Uint8Array(current)[0] ^= 0xff;
  await adapter.writeBinary(`${ROOT}/vectors.f32`, current);

  const recovered = await createStore(adapter).open();

  assert.equal(recovered.manifest.generation, 1);
  assert.equal(recovered.documents[0]?.path, "Notes/stable.md");
});

test("rejects same-size checksum corruption without a prior generation", async () => {
  const adapter = new MemoryAdapter();
  await createStore(adapter).write(createSnapshot(1, "first"));
  const documents = await adapter.read(`${ROOT}/documents.json`);
  await adapter.write(`${ROOT}/documents.json`, documents.replace("first", "fIrst"));

  await assert.rejects(
    createStore(adapter).open(),
    /documents checksum mismatch/u
  );
});

test("rejects truncated generation files by recorded byte size", async () => {
  const adapter = new MemoryAdapter();
  await createStore(adapter).write(createSnapshot(1, "first"));
  const vectors = await adapter.readBinary(`${ROOT}/vectors.f32`);
  await adapter.writeBinary(`${ROOT}/vectors.f32`, vectors.slice(0, 4));

  await assert.rejects(
    createStore(adapter).open(),
    /vectors size mismatch/u
  );
});

test("fully scans untrusted vectors after checksum verification", async () => {
  const adapter = new MemoryAdapter();
  const written = await createStore(adapter).write(createSnapshot(1, "first"));
  const corrupted = new Float32Array(written.vectors);
  corrupted[1] = Number.NaN;
  const files = await prepareGenerationFiles(
    written.documents,
    written.chunks,
    corrupted
  );
  await adapter.writeBinary(`${ROOT}/vectors.f32`, files.vectorBuffer);
  await adapter.write(`${ROOT}/manifest.json`, `${JSON.stringify({
    ...written.manifest,
    files: files.integrity
  }, null, 2)}\n`);

  await assert.rejects(
    createStore(adapter).open(),
    /non-finite value/u
  );
});

test("rejects duplicate vector rows before writing", async () => {
  const adapter = new MemoryAdapter();
  const snapshot = createSnapshot(1, "invalid");
  const original = snapshot.chunks[0];
  assert.ok(original !== undefined);
  const duplicateId = `${original.id}-duplicate`;
  snapshot.chunks.push({
    ...original,
    id: duplicateId
  });
  snapshot.documents[0]?.chunkIds.push(duplicateId);

  await assert.rejects(
    createStore(adapter).write(snapshot),
    /reuse vector row/u
  );
});

function createStore(adapter: MemoryAdapter): PersistentIndexStore {
  return new PersistentIndexStore(
    adapter,
    ROOT,
    () => createEmptyIndexManifest("0.1.0", "vault", "scope")
  );
}

function createSnapshot(generation: number, name: string): IndexSnapshot {
  const documentId = `document-${name}`;
  const chunkId = `chunk-${name}`;
  return {
    manifest: {
      ...createEmptyIndexManifest("0.1.0", "vault", "scope"),
      model: {
        id: "test/model",
        revision: "fixed",
        quantization: "q8",
        dimensions: 2,
        tokenizerVersion: "test",
        runtimeVersion: "test"
      },
      dimensions: 2,
      vectorCount: 1,
      lastCompletedAt: generation,
      generation
    },
    documents: [{
      id: documentId,
      path: `Notes/${name}.md`,
      title: name,
      aliases: [],
      tags: [],
      headings: [],
      outgoingPaths: [],
      contentHash: name,
      modifiedAt: generation,
      chunkIds: [chunkId]
    }],
    chunks: [{
      id: chunkId,
      documentId,
      headingPath: [],
      startOffset: 0,
      endOffset: 10,
      startLine: 1,
      endLine: 1,
      textPreview: name,
      lexicalTerms: [name],
      embeddingText: `passage: ${name}`,
      vectorRow: 0
    }],
    vectors: new Float32Array([0.25, 0.75])
  };
}

function cloneValue(value: string | ArrayBuffer): string | ArrayBuffer {
  return typeof value === "string" ? value : value.slice(0);
}
