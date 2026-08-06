import assert from "node:assert/strict";
import test from "node:test";
import type { IndexSnapshot } from "../../src/indexing/types.ts";
import {
  createEmptyIndexManifest,
  PersistentIndexStore,
  type IndexStorageAdapter
} from "../../src/storage/index-store.ts";

class IntegrityMemoryAdapter implements IndexStorageAdapter {
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
    const value = this.files.get(path);
    if (value instanceof ArrayBuffer) {
      return Promise.reject(new Error(`Cannot append text to binary file: ${path}`));
    }
    this.files.set(path, `${value ?? ""}${data}`);
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
      return Promise.reject(new Error("Tests require recursive removal."));
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
    this.files.set(newPath, clone(value));
    this.files.delete(oldPath);
    return Promise.resolve();
  }

  copy(oldPath: string, newPath: string): Promise<void> {
    const value = this.files.get(oldPath);
    if (value === undefined) {
      return Promise.reject(new Error(`Missing copy source: ${oldPath}`));
    }
    this.files.set(newPath, clone(value));
    return Promise.resolve();
  }
}

test("writes and verifies integrity metadata with every new generation", async () => {
  const adapter = new IntegrityMemoryAdapter();
  const store = createStore(adapter);
  await store.write(snapshot(1));

  assert.equal(await adapter.exists("plugin/index/integrity.json"), true);
  const opened = await store.open();
  assert.equal(opened.manifest.generation, 1);
  assert.deepEqual([...opened.vectors], [0.25, 0.75]);
});

test("rejects checksummed document corruption before parsing", async () => {
  const adapter = new IntegrityMemoryAdapter();
  const store = createStore(adapter);
  await store.write(snapshot(1));
  await adapter.write("plugin/index/documents.json", "[]\n");

  await assert.rejects(store.open(), /documents\.json/u);
});

test("rejects vector truncation by size before constructing float rows", async () => {
  const adapter = new IntegrityMemoryAdapter();
  const store = createStore(adapter);
  await store.write(snapshot(1));
  await adapter.writeBinary(
    "plugin/index/vectors.f32",
    new Float32Array([0.25]).buffer
  );

  await assert.rejects(store.open(), /vectors\.f32 size mismatch/u);
});

test("opens a validated legacy generation and adds integrity on next checkpoint", async () => {
  const adapter = new IntegrityMemoryAdapter();
  const store = createStore(adapter);
  await store.write(snapshot(1));
  await adapter.remove("plugin/index/integrity.json");

  const legacy = await store.open();
  assert.equal(legacy.manifest.generation, 1);
  assert.equal(await adapter.exists("plugin/index/integrity.json"), false);

  await store.write({
    ...legacy,
    manifest: {
      ...legacy.manifest,
      generation: 2,
      lastCompletedAt: 2
    }
  });
  assert.equal(await adapter.exists("plugin/index/integrity.json"), true);
});

function createStore(adapter: IntegrityMemoryAdapter): PersistentIndexStore {
  return new PersistentIndexStore(
    adapter,
    "plugin/index",
    () => createEmptyIndexManifest("0.1.0", "vault", "scope")
  );
}

function snapshot(generation: number): IndexSnapshot {
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
      id: "document",
      path: "Notes/test.md",
      title: "test",
      aliases: [],
      tags: [],
      headings: [],
      outgoingPaths: [],
      contentHash: "hash",
      modifiedAt: generation,
      chunkIds: ["chunk"]
    }],
    chunks: [{
      id: "chunk",
      documentId: "document",
      headingPath: [],
      startOffset: 0,
      endOffset: 10,
      startLine: 1,
      endLine: 1,
      textPreview: "test",
      lexicalTerms: ["test"],
      embeddingText: "passage: test",
      vectorRow: 0
    }],
    vectors: new Float32Array([0.25, 0.75])
  };
}

function clone(value: string | ArrayBuffer): string | ArrayBuffer {
  return typeof value === "string" ? value : value.slice(0);
}
