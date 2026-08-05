import { INDEX_SCHEMA_VERSION } from "../constants.ts";
import type {
  IndexManifest,
  IndexedChunk,
  IndexedDocument,
  IndexSnapshot,
  ModelDescriptor
} from "../indexing/types.ts";
import { isRecord } from "../utils/validation.ts";

export interface IndexStorageAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
  remove(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(oldPath: string, newPath: string): Promise<void>;
}

const TEXT_FILES = ["manifest.json", "documents.json", "chunks.json", "journal.json"] as const;
const DATA_FILES = ["documents.json", "chunks.json", "vectors.f32", "journal.json"] as const;
const ALL_FILES = [...TEXT_FILES, "vectors.f32"] as const;

export class PersistentIndexStore {
  constructor(
    private readonly adapter: IndexStorageAdapter,
    private readonly rootPath: string,
    private readonly createEmptyManifest: () => IndexManifest
  ) {}

  async open(): Promise<IndexSnapshot> {
    await this.ensureDirectory();
    await this.recoverInterruptedWrite();
    if (!await this.adapter.exists(this.path("manifest.json"))) {
      return this.emptySnapshot();
    }

    const snapshot = await this.readStableSnapshot();
    validateSnapshot(snapshot);
    return snapshot;
  }

  async write(snapshot: IndexSnapshot): Promise<IndexSnapshot> {
    const clean = normalizeSnapshot(snapshot, false);
    validateSnapshot(clean);
    await this.ensureDirectory();
    await this.backupStableGeneration();

    const dirtyManifest: IndexManifest = {
      ...clean.manifest,
      dirty: true
    };
    await this.adapter.write(this.path("manifest.json"), serialize(dirtyManifest));

    try {
      await this.writeNextGeneration(clean);
      const candidate = await this.readNextSnapshot();
      validateSnapshot(candidate);
      await this.promoteNextGeneration();
      await this.cleanupSuffix("previous");
      return clean;
    } catch (error) {
      await this.restorePreviousGeneration();
      throw error;
    }
  }

  async delete(): Promise<void> {
    if (await this.adapter.exists(this.rootPath)) {
      await this.adapter.rmdir(this.rootPath, true);
    }
  }

  private async writeNextGeneration(snapshot: IndexSnapshot): Promise<void> {
    await this.adapter.write(this.path("documents.json.next"), serialize(snapshot.documents));
    await this.adapter.write(this.path("chunks.json.next"), serialize(snapshot.chunks));
    await this.adapter.writeBinary(this.path("vectors.f32.next"), toArrayBuffer(snapshot.vectors));
    await this.adapter.write(this.path("journal.json.next"), serialize({
      generation: snapshot.manifest.generation,
      completedAt: snapshot.manifest.lastCompletedAt,
      documentCount: snapshot.documents.length,
      chunkCount: snapshot.chunks.length,
      vectorCount: snapshot.manifest.vectorCount
    }));
    await this.adapter.write(this.path("manifest.json.next"), serialize(snapshot.manifest));
  }

  private async readStableSnapshot(): Promise<IndexSnapshot> {
    return this.readSnapshot("");
  }

  private async readNextSnapshot(): Promise<IndexSnapshot> {
    return this.readSnapshot(".next");
  }

  private async readSnapshot(suffix: "" | ".next" | ".previous"): Promise<IndexSnapshot> {
    const manifest = parseManifest(await this.adapter.read(this.path(`manifest.json${suffix}`)));
    const documents = parseDocuments(await this.adapter.read(this.path(`documents.json${suffix}`)));
    const chunks = parseChunks(await this.adapter.read(this.path(`chunks.json${suffix}`)));
    const vectors = readVectors(await this.adapter.readBinary(this.path(`vectors.f32${suffix}`)));
    return { manifest, documents, chunks, vectors };
  }

  private async backupStableGeneration(): Promise<void> {
    await this.cleanupSuffix("previous");
    for (const file of ALL_FILES) {
      const stable = this.path(file);
      if (await this.adapter.exists(stable)) {
        await this.adapter.copy(stable, this.path(`${file}.previous`));
      }
    }
  }

  private async promoteNextGeneration(): Promise<void> {
    for (const file of DATA_FILES) {
      await this.replace(this.path(`${file}.next`), this.path(file));
    }
    await this.replace(this.path("manifest.json.next"), this.path("manifest.json"));
  }

  private async recoverInterruptedWrite(): Promise<void> {
    const manifestPath = this.path("manifest.json");
    if (!await this.adapter.exists(manifestPath)) {
      await this.cleanupSuffix("next");
      await this.cleanupSuffix("previous");
      return;
    }

    let dirty = true;
    try {
      dirty = parseManifest(await this.adapter.read(manifestPath)).dirty;
    } catch {
      dirty = true;
    }
    if (!dirty) {
      await this.cleanupSuffix("next");
      await this.cleanupSuffix("previous");
      return;
    }
    await this.restorePreviousGeneration();
  }

  private async restorePreviousGeneration(): Promise<void> {
    const previousManifest = this.path("manifest.json.previous");
    if (await this.adapter.exists(previousManifest)) {
      for (const file of ALL_FILES) {
        const previous = this.path(`${file}.previous`);
        if (await this.adapter.exists(previous)) {
          await this.replace(previous, this.path(file));
        } else {
          await this.removeIfExists(this.path(file));
        }
      }
    } else {
      for (const file of ALL_FILES) {
        await this.removeIfExists(this.path(file));
      }
    }
    await this.cleanupSuffix("next");
    await this.cleanupSuffix("previous");
  }

  private async cleanupSuffix(suffix: "next" | "previous"): Promise<void> {
    for (const file of ALL_FILES) {
      await this.removeIfExists(this.path(`${file}.${suffix}`));
    }
  }

  private async replace(source: string, destination: string): Promise<void> {
    await this.removeIfExists(destination);
    await this.adapter.rename(source, destination);
  }

  private async removeIfExists(path: string): Promise<void> {
    if (await this.adapter.exists(path)) {
      await this.adapter.remove(path);
    }
  }

  private async ensureDirectory(): Promise<void> {
    if (!await this.adapter.exists(this.rootPath)) {
      await this.adapter.mkdir(this.rootPath);
    }
  }

  private emptySnapshot(): IndexSnapshot {
    return {
      manifest: this.createEmptyManifest(),
      documents: [],
      chunks: [],
      vectors: new Float32Array()
    };
  }

  private path(name: string): string {
    return `${this.rootPath}/${name}`;
  }
}

export function createEmptyIndexManifest(
  pluginVersion: string,
  vaultFingerprint: string
): IndexManifest {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    pluginVersion,
    vaultFingerprint,
    model: null,
    vectorCount: 0,
    dimensions: 0,
    lastCompletedAt: null,
    dirty: false,
    generation: 0
  };
}

function normalizeSnapshot(snapshot: IndexSnapshot, dirty: boolean): IndexSnapshot {
  const documents = [...snapshot.documents].sort((left, right) => left.path.localeCompare(right.path));
  const chunks = [...snapshot.chunks].sort((left, right) => left.id.localeCompare(right.id));
  return {
    manifest: {
      ...snapshot.manifest,
      vectorCount: snapshot.manifest.dimensions === 0
        ? 0
        : snapshot.vectors.length / snapshot.manifest.dimensions,
      dirty
    },
    documents,
    chunks,
    vectors: new Float32Array(snapshot.vectors)
  };
}

function validateSnapshot(snapshot: IndexSnapshot): void {
  const { manifest, documents, chunks, vectors } = snapshot;
  if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported semantic index schema: ${manifest.schemaVersion}`);
  }
  if (manifest.dirty) {
    throw new Error("A dirty semantic index generation cannot be opened.");
  }
  if (!Number.isInteger(manifest.dimensions) || manifest.dimensions < 0) {
    throw new Error("Semantic index dimensions are invalid.");
  }
  if (!Number.isInteger(manifest.vectorCount) || manifest.vectorCount < 0) {
    throw new Error("Semantic index vector count is invalid.");
  }
  if (manifest.dimensions === 0) {
    if (manifest.vectorCount !== 0 || vectors.length !== 0) {
      throw new Error("A vectorless index contains vector data.");
    }
  } else if (vectors.length !== manifest.vectorCount * manifest.dimensions) {
    throw new Error("Semantic vector byte length does not match the manifest.");
  }

  const documentIds = new Set<string>();
  const chunkIds = new Set<string>();
  for (const document of documents) {
    if (documentIds.has(document.id)) {
      throw new Error(`Duplicate semantic document id: ${document.id}`);
    }
    documentIds.add(document.id);
  }
  for (const chunk of chunks) {
    if (chunkIds.has(chunk.id) || !documentIds.has(chunk.documentId)) {
      throw new Error(`Invalid semantic chunk: ${chunk.id}`);
    }
    if (chunk.vectorRow < -1 || chunk.vectorRow >= manifest.vectorCount) {
      throw new Error(`Semantic chunk has an invalid vector row: ${chunk.id}`);
    }
    chunkIds.add(chunk.id);
  }
  for (const document of documents) {
    if (document.chunkIds.some((id) => !chunkIds.has(id))) {
      throw new Error(`Semantic document references a missing chunk: ${document.path}`);
    }
  }
}

function parseManifest(value: string): IndexManifest {
  const input: unknown = JSON.parse(value);
  if (!isRecord(input)) {
    throw new Error("Semantic index manifest is not an object.");
  }
  const model = parseModel(input["model"]);
  return {
    schemaVersion: readInteger(input, "schemaVersion"),
    pluginVersion: readString(input, "pluginVersion"),
    vaultFingerprint: readString(input, "vaultFingerprint"),
    model,
    vectorCount: readInteger(input, "vectorCount"),
    dimensions: readInteger(input, "dimensions"),
    lastCompletedAt: readNullableNumber(input, "lastCompletedAt"),
    dirty: readBoolean(input, "dirty"),
    generation: readInteger(input, "generation")
  };
}

function parseDocuments(value: string): IndexedDocument[] {
  const input: unknown = JSON.parse(value);
  if (!Array.isArray(input)) {
    throw new Error("Semantic documents file is not an array.");
  }
  return input.map((entry) => parseDocument(entry));
}

function parseDocument(input: unknown): IndexedDocument {
  if (!isRecord(input)) {
    throw new Error("Semantic document record is invalid.");
  }
  const headings = input["headings"];
  if (!Array.isArray(headings)) {
    throw new Error("Semantic document headings are invalid.");
  }
  return {
    id: readString(input, "id"),
    path: readString(input, "path"),
    title: readString(input, "title"),
    aliases: readStrings(input, "aliases"),
    tags: readStrings(input, "tags"),
    headings: headings.map((heading) => {
      if (!isRecord(heading)) {
        throw new Error("Semantic heading is invalid.");
      }
      return {
        text: readString(heading, "text"),
        level: readInteger(heading, "level")
      };
    }),
    outgoingPaths: readStrings(input, "outgoingPaths"),
    contentHash: readString(input, "contentHash"),
    modifiedAt: readNumber(input, "modifiedAt"),
    chunkIds: readStrings(input, "chunkIds")
  };
}

function parseChunks(value: string): IndexedChunk[] {
  const input: unknown = JSON.parse(value);
  if (!Array.isArray(input)) {
    throw new Error("Semantic chunks file is not an array.");
  }
  return input.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("Semantic chunk record is invalid.");
    }
    return {
      id: readString(entry, "id"),
      documentId: readString(entry, "documentId"),
      headingPath: readStrings(entry, "headingPath"),
      startOffset: readInteger(entry, "startOffset"),
      endOffset: readInteger(entry, "endOffset"),
      startLine: readInteger(entry, "startLine"),
      endLine: readInteger(entry, "endLine"),
      textPreview: readString(entry, "textPreview"),
      lexicalTerms: readStrings(entry, "lexicalTerms"),
      embeddingText: readString(entry, "embeddingText"),
      vectorRow: readInteger(entry, "vectorRow")
    };
  });
}

function parseModel(input: unknown): ModelDescriptor | null {
  if (input === null) {
    return null;
  }
  if (!isRecord(input)) {
    throw new Error("Semantic model descriptor is invalid.");
  }
  return {
    id: readString(input, "id"),
    revision: readString(input, "revision"),
    quantization: readString(input, "quantization"),
    dimensions: readInteger(input, "dimensions"),
    tokenizerVersion: readString(input, "tokenizerVersion"),
    runtimeVersion: readString(input, "runtimeVersion")
  };
}

function readVectors(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Semantic vector file has an invalid byte length.");
  }
  const copy = buffer.slice(0);
  return new Float32Array(copy);
}

function toArrayBuffer(vectors: Float32Array): ArrayBuffer {
  const bytes = new Uint8Array(vectors.byteLength);
  bytes.set(new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength));
  return bytes.buffer;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string.`);
  }
  return value;
}

function readStrings(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Expected ${key} to be a string array.`);
  }
  return [...value];
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${key} to be a finite number.`);
  }
  return value;
}

function readInteger(record: Record<string, unknown>, key: string): number {
  const value = readNumber(record, key);
  if (!Number.isInteger(value)) {
    throw new Error(`Expected ${key} to be an integer.`);
  }
  return value;
}

function readNullableNumber(record: Record<string, unknown>, key: string): number | null {
  return record[key] === null ? null : readNumber(record, key);
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${key} to be a boolean.`);
  }
  return value;
}
