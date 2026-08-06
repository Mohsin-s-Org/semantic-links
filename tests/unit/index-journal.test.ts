import assert from "node:assert/strict";
import test from "node:test";
import type { IndexSnapshot, IndexedDocument } from "../../src/indexing/types.ts";
import {
  IndexJournal,
  type IndexJournalDelta,
  type IndexJournalIdentity,
  type JournalStorageAdapter
} from "../../src/storage/index-journal.ts";
import { createEmptyIndexManifest } from "../../src/storage/index-store.ts";

class MemoryJournalAdapter implements JournalStorageAdapter {
  readonly files = new Map<string, string>();

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  read(path: string): Promise<string> {
    const value = this.files.get(path);
    return value === undefined
      ? Promise.reject(new Error(`Missing file: ${path}`))
      : Promise.resolve(value);
  }

  write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    return Promise.resolve();
  }

  append(path: string, data: string): Promise<void> {
    this.files.set(path, `${this.files.get(path) ?? ""}${data}`);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }
}

const ROOT = "plugin/index";
const JOURNAL_PATH = `${ROOT}/journal.ndjson`;
const IDENTITY: IndexJournalIdentity = {
  baseGeneration: 1,
  vaultFingerprint: "vault",
  scopeFingerprint: "scope",
  model: {
    id: "test/model",
    revision: "fixed",
    quantization: "q8",
    dimensions: 2,
    tokenizerVersion: "test",
    runtimeVersion: "test"
  }
};

test("replays appended replacement and removal records", async () => {
  const adapter = new MemoryJournalAdapter();
  const journal = new IndexJournal(adapter, ROOT);
  await journal.append(deltaFor("Notes/changed.md", "changed", [0.8, 0.2]), IDENTITY);
  await journal.append({ upserts: [], removals: ["Notes/stable.md"] }, IDENTITY);

  const replayed = await new IndexJournal(adapter, ROOT).replay(baseSnapshot(), IDENTITY);

  assert.equal(replayed.recordCount, 2);
  assert.equal(replayed.lastSequence, 2);
  assert.equal(replayed.snapshot.documents.length, 1);
  assert.equal(replayed.snapshot.documents[0]?.path, "Notes/changed.md");
  assert.deepEqual([...replayed.snapshot.vectors], approximately([0.8, 0.2]));
});

test("repairs a partial trailing record while preserving earlier records", async () => {
  const adapter = new MemoryJournalAdapter();
  const journal = new IndexJournal(adapter, ROOT);
  await journal.append(deltaFor("Notes/one.md", "one", [0.6, 0.4]), IDENTITY);
  await adapter.append(JOURNAL_PATH, "{\"type\":\"delta\"");

  const replayed = await new IndexJournal(adapter, ROOT).replay(baseSnapshot(), IDENTITY);

  assert.equal(replayed.recordCount, 1);
  assert.equal(replayed.repaired, true);
  const repaired = await adapter.read(JOURNAL_PATH);
  assert.equal(repaired.endsWith("\n"), true);
  assert.equal(repaired.includes("{\"type\":\"delta\""), true);
  assert.equal(repaired.endsWith("{\"type\":\"delta\""), false);
});

test("stops at a checksum failure and discards later records", async () => {
  const adapter = new MemoryJournalAdapter();
  const journal = new IndexJournal(adapter, ROOT);
  await journal.append(deltaFor("Notes/one.md", "one", [0.6, 0.4]), IDENTITY);
  await journal.append(deltaFor("Notes/two.md", "two", [0.3, 0.7]), IDENTITY);
  const lines = (await adapter.read(JOURNAL_PATH)).trimEnd().split("\n");
  const second = JSON.parse(lines[2] ?? "{}") as { checksum?: string };
  second.checksum = "corrupted";
  lines[2] = JSON.stringify(second);
  await adapter.write(JOURNAL_PATH, `${lines.join("\n")}\n`);

  const replayed = await new IndexJournal(adapter, ROOT).replay(baseSnapshot(), IDENTITY);

  assert.equal(replayed.recordCount, 1);
  assert.equal(replayed.repaired, true);
  assert.equal(replayed.snapshot.documents.some((document) => document.path === "Notes/one.md"), true);
  assert.equal(replayed.snapshot.documents.some((document) => document.path === "Notes/two.md"), false);
});

test("rejects a stale journal from another base generation", async () => {
  const adapter = new MemoryJournalAdapter();
  const journal = new IndexJournal(adapter, ROOT);
  await journal.append(deltaFor("Notes/one.md", "one", [0.6, 0.4]), IDENTITY);

  const replayed = await new IndexJournal(adapter, ROOT).replay(baseSnapshot(), {
    ...IDENTITY,
    baseGeneration: 2
  });

  assert.equal(replayed.recordCount, 0);
  assert.equal(await adapter.exists(JOURNAL_PATH), false);
});

function deltaFor(
  path: string,
  name: string,
  vector: readonly [number, number]
): IndexJournalDelta {
  const document = createDocument(path, name);
  const chunkId = document.chunkIds[0] ?? "";
  return {
    removals: [],
    upserts: [{
      document,
      chunks: [{
        chunk: {
          id: chunkId,
          documentId: document.id,
          headingPath: [],
          startOffset: 0,
          endOffset: 10,
          startLine: 1,
          endLine: 1,
          textPreview: name,
          lexicalTerms: [name],
          embeddingText: `passage: ${name}`,
          vectorRow: -1
        },
        vector: new Float32Array(vector)
      }]
    }]
  };
}

function baseSnapshot(): IndexSnapshot {
  const document = createDocument("Notes/stable.md", "stable");
  const chunkId = document.chunkIds[0] ?? "";
  return {
    manifest: {
      ...createEmptyIndexManifest("0.1.0", "vault", "scope"),
      model: IDENTITY.model,
      dimensions: 2,
      vectorCount: 1,
      generation: 1,
      lastCompletedAt: 1
    },
    documents: [document],
    chunks: [{
      id: chunkId,
      documentId: document.id,
      headingPath: [],
      startOffset: 0,
      endOffset: 10,
      startLine: 1,
      endLine: 1,
      textPreview: "stable",
      lexicalTerms: ["stable"],
      embeddingText: "passage: stable",
      vectorRow: 0
    }],
    vectors: new Float32Array([0.25, 0.75])
  };
}

function createDocument(path: string, name: string): IndexedDocument {
  const id = `document-${name}`;
  return {
    id,
    path,
    title: name,
    aliases: [],
    tags: [],
    headings: [],
    outgoingPaths: [],
    contentHash: name,
    modifiedAt: 1,
    chunkIds: [`chunk-${name}`]
  };
}

function approximately(values: readonly number[]): number[] {
  return values.map((value) => Number(new Float32Array([value])[0]?.toFixed(6)));
}
