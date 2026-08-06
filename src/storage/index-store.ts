import { INDEX_SCHEMA_VERSION } from "../constants.ts";
import type {
  IndexFileIntegrity,
  IndexGenerationIntegrity,
  IndexManifest,
  IndexedChunk,
  IndexedDocument,
  IndexSnapshot,
  ModelDescriptor
} from "../indexing/types.ts";
import { isRecord } from "../utils/validation.ts";
import {
  prepareGenerationFiles,
  serializeIndexJson,
  verifyGenerationFiles,
  type PreparedGenerationFiles
} from "./index-integrity.ts";
import {
  IndexJournal,
  type IndexJournalDelta,
  type IndexJournalIdentity,
  type JournalReplayResult,
  type JournalStorageAdapter
} from "./index-journal.ts";

export interface IndexStorageAdapter extends JournalStorageAdapter {
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(oldPath: string, newPath: string): Promise<void>;
}

export interface IndexOpenResult extends JournalReplayResult {}

const DATA_FILES = ["documents.json", "chunks.json", "vectors.f32"] as const;
const ALL_FILES = ["manifest.json", ...DATA_FILES] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TRUSTED_VECTOR_SAMPLE_SIZE = 32;

export class PersistentIndexStore {
  private readonly adapter: IndexStorageAdapter;
  private readonly rootPath: string;
  private readonly createEmptyManifest: () => IndexManifest;
  private readonly journal: IndexJournal;

  constructor(
    adapter: IndexStorageAdapter,
    rootPath: string,
    createEmptyManifest: () => IndexManifest
  ) {
    this.adapter = adapter;
    this.rootPath = rootPath;
    this.createEmptyManifest = createEmptyManifest;
    this.journal = new IndexJournal(adapter, rootPath);
  }

  async open(): Promise<IndexSnapshot> {
    await this.ensureDirectory();
    await this.recoverInterruptedWrite();
    if (!await this.adapter.exists(this.path("manifest.json"))) {
      const previous = await this.tryReadSnapshot(".previous");
      if (previous !== null) {
        await this.restorePreviousGeneration();
        return previous;
      }
      await this.cleanupSuffix("next");
      await this.cleanupSuffix("previous");
      return this.emptySnapshot();
    }

    try {
      return await this.readSnapshot("");
    } catch (error) {
      const previous = await this.tryReadSnapshot(".previous");
      if (previous !== null) {
        await this.restorePreviousGeneration();
        return previous;
      }
      if (isUnsupportedSchemaError(error)) {
        await this.delete();
        await this.ensureDirectory();
        return this.emptySnapshot();
      }
      throw error;
    }
  }

  async openWithJournal(): Promise<IndexOpenResult> {
    const snapshot = await this.open();
    const replayed = await this.journal.replay(snapshot, identityFromSnapshot(snapshot));
    validateIndexSnapshot(replayed.snapshot);
    return replayed;
  }

  async appendJournal(
    delta: IndexJournalDelta,
    identity: IndexJournalIdentity
  ): Promise<number> {
    await this.ensureDirectory();
    return this.journal.append(delta, identity);
  }

  async write(snapshot: IndexSnapshot): Promise<IndexSnapshot> {
    const normalized = normalizeSnapshot(snapshot, false);
    validateTrustedIndexSnapshot(normalized);
    const files = await prepareGenerationFiles(
      normalized.documents,
      normalized.chunks,
      normalized.vectors
    );
    const clean: IndexSnapshot = {
      ...normalized,
      manifest: {
        ...normalized.manifest,
        files: files.integrity
      }
    };
    validateTrustedIndexSnapshot(clean);

    await this.ensureDirectory();
    await this.backupStableGeneration();
    await this.adapter.write(this.path("manifest.json"), serializeIndexJson({
      ...clean.manifest,
      dirty: true
    }));

    try {
      await this.writeNextGeneration(clean.manifest, files);
      await this.promoteNextGeneration();
    } catch (error) {
      await this.restorePreviousGeneration();
      throw error;
    }

    // Keep one prior generation as a checksum-verified recovery source. It is
    // replaced at the start of the next checkpoint.
    await this.journal.clear().catch(() => undefined);
    return clean;
  }

  async delete(): Promise<void> {
    await this.journal.clear().catch(() => undefined);
    if (await this.adapter.exists(this.rootPath)) {
      await this.adapter.rmdir(this.rootPath, true);
    }
  }

  private async writeNextGeneration(
    manifest: IndexManifest,
    files: PreparedGenerationFiles
  ): Promise<void> {
    await this.adapter.write(
      this.path("documents.json.next"),
      files.documentsText
    );
    await this.adapter.write(
      this.path("chunks.json.next"),
      files.chunksText
    );
    await this.adapter.writeBinary(
      this.path("vectors.f32.next"),
      files.vectorBuffer
    );
    await this.adapter.write(
      this.path("manifest.json.next"),
      serializeIndexJson(manifest)
    );
  }

  private async readSnapshot(
    suffix: "" | ".next" | ".previous"
  ): Promise<IndexSnapshot> {
    const manifest = parseManifest(await this.adapter.read(
      this.path(`manifest.json${suffix}`)
    ));
    if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) {
      throw new Error(`Unsupported semantic index schema: ${manifest.schemaVersion}`);
    }
    if (manifest.files === null) {
      throw new Error("Semantic index generation integrity metadata is missing.");
    }
    const [documentsText, chunksText, vectorBuffer] = await Promise.all([
      this.adapter.read(this.path(`documents.json${suffix}`)),
      this.adapter.read(this.path(`chunks.json${suffix}`)),
      this.adapter.readBinary(this.path(`vectors.f32${suffix}`))
    ]);
    await verifyGenerationFiles(
      manifest.files,
      documentsText,
      chunksText,
      vectorBuffer
    );
    const snapshot: IndexSnapshot = {
      manifest,
      documents: parseDocuments(documentsText),
      chunks: parseChunks(chunksText),
      vectors: readVectors(vectorBuffer)
    };
    validateIndexSnapshot(snapshot);
    return snapshot;
  }

  private async tryReadSnapshot(
    suffix: "" | ".next" | ".previous"
  ): Promise<IndexSnapshot | null> {
    try {
      return await this.readSnapshot(suffix);
    } catch {
      return null;
    }
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
    await this.replace(
      this.path("manifest.json.next"),
      this.path("manifest.json")
    );
  }

  private async recoverInterruptedWrite(): Promise<void> {
    const manifestPath = this.path("manifest.json");
    if (!await this.adapter.exists(manifestPath)) {
      await this.cleanupSuffix("next");
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
      return;
    }

    const previous = await this.tryReadSnapshot(".previous");
    if (previous !== null) {
      await this.restorePreviousGeneration();
      return;
    }
    for (const file of ALL_FILES) {
      await this.removeIfExists(this.path(file));
    }
    await this.cleanupSuffix("next");
    await this.cleanupSuffix("previous");
  }

  private async restorePreviousGeneration(): Promise<void> {
    if (await this.adapter.exists(this.path("manifest.json.previous"))) {
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
  vaultFingerprint: string,
  scopeFingerprint: string
): IndexManifest {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    pluginVersion,
    vaultFingerprint,
    scopeFingerprint,
    model: null,
    vectorCount: 0,
    dimensions: 0,
    lastCompletedAt: null,
    dirty: false,
    generation: 0,
    files: null
  };
}

function identityFromSnapshot(snapshot: IndexSnapshot): IndexJournalIdentity {
  return {
    baseGeneration: snapshot.manifest.generation,
    vaultFingerprint: snapshot.manifest.vaultFingerprint,
    scopeFingerprint: snapshot.manifest.scopeFingerprint,
    model: snapshot.manifest.model
  };
}

function normalizeSnapshot(snapshot: IndexSnapshot, dirty: boolean): IndexSnapshot {
  return {
    manifest: {
      ...snapshot.manifest,
      vectorCount: snapshot.manifest.dimensions === 0
        ? 0
        : snapshot.vectors.length / snapshot.manifest.dimensions,
      dirty,
      files: null
    },
    documents: [...snapshot.documents]
      .sort((left, right) => left.path.localeCompare(right.path)),
    chunks: [...snapshot.chunks]
      .sort((left, right) => left.id.localeCompare(right.id)),
    vectors: snapshot.vectors
  };
}

export function validateIndexSnapshot(snapshot: IndexSnapshot): void {
  validateSnapshot(snapshot, true);
}

function validateTrustedIndexSnapshot(snapshot: IndexSnapshot): void {
  validateSnapshot(snapshot, false);
}

function validateSnapshot(snapshot: IndexSnapshot, scanAllVectors: boolean): void {
  const { manifest, documents, chunks, vectors } = snapshot;
  if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported semantic index schema: ${manifest.schemaVersion}`);
  }
  if (manifest.dirty) {
    throw new Error("A dirty semantic index generation cannot be opened.");
  }
  if (
    manifest.pluginVersion.length === 0
    || manifest.vaultFingerprint.length === 0
    || manifest.scopeFingerprint.length === 0
  ) {
    throw new Error("Semantic index identity metadata is incomplete.");
  }
  if (!Number.isInteger(manifest.dimensions) || manifest.dimensions < 0) {
    throw new Error("Semantic index dimensions are invalid.");
  }
  if (!Number.isInteger(manifest.vectorCount) || manifest.vectorCount < 0) {
    throw new Error("Semantic index vector count is invalid.");
  }
  if (manifest.files !== null) {
    validateGenerationIntegrity(manifest.files);
  }
  if (manifest.model === null) {
    if (manifest.dimensions !== 0) {
      throw new Error("A vectorless semantic index declares dimensions.");
    }
  } else if (
    !Number.isInteger(manifest.model.dimensions)
    || manifest.model.dimensions < 1
    || manifest.dimensions !== manifest.model.dimensions
  ) {
    throw new Error("Semantic model dimensions do not match the index.");
  }
  if (manifest.dimensions === 0) {
    if (manifest.vectorCount !== 0 || vectors.length !== 0) {
      throw new Error("A vectorless index contains vector data.");
    }
  } else if (vectors.length !== manifest.vectorCount * manifest.dimensions) {
    throw new Error("Semantic vector byte length does not match the manifest.");
  }
  if (scanAllVectors) {
    validateAllVectors(vectors);
  } else {
    validateVectorSample(vectors);
  }

  const documentsById = new Map<string, IndexedDocument>();
  const documentPaths = new Set<string>();
  for (const document of documents) {
    if (documentsById.has(document.id)) {
      throw new Error(`Duplicate semantic document id: ${document.id}`);
    }
    if (documentPaths.has(document.path)) {
      throw new Error(`Duplicate semantic document path: ${document.path}`);
    }
    documentsById.set(document.id, document);
    documentPaths.add(document.path);
  }

  const chunksById = new Map<string, IndexedChunk>();
  const vectorRows = new Set<number>();
  for (const chunk of chunks) {
    if (chunksById.has(chunk.id) || !documentsById.has(chunk.documentId)) {
      throw new Error(`Invalid semantic chunk: ${chunk.id}`);
    }
    if (
      chunk.startOffset < 0
      || chunk.endOffset < chunk.startOffset
      || chunk.startLine < 1
      || chunk.endLine < chunk.startLine
    ) {
      throw new Error(`Semantic chunk has an invalid source range: ${chunk.id}`);
    }
    if (chunk.vectorRow < -1 || chunk.vectorRow >= manifest.vectorCount) {
      throw new Error(`Semantic chunk has an invalid vector row: ${chunk.id}`);
    }
    if (chunk.vectorRow >= 0 && vectorRows.has(chunk.vectorRow)) {
      throw new Error(`Semantic chunks reuse vector row ${chunk.vectorRow}.`);
    }
    if (chunk.vectorRow >= 0) {
      vectorRows.add(chunk.vectorRow);
    }
    chunksById.set(chunk.id, chunk);
  }
  if (vectorRows.size !== manifest.vectorCount) {
    throw new Error("Semantic index contains unreferenced vector rows.");
  }

  const referencedChunks = new Set<string>();
  for (const document of documents) {
    const localIds = new Set<string>();
    for (const id of document.chunkIds) {
      const chunk = chunksById.get(id);
      if (
        chunk === undefined
        || chunk.documentId !== document.id
        || localIds.has(id)
        || referencedChunks.has(id)
      ) {
        throw new Error(
          `Semantic document references an invalid chunk: ${document.path}`
        );
      }
      localIds.add(id);
      referencedChunks.add(id);
    }
  }
  if (referencedChunks.size !== chunks.length) {
    throw new Error("Semantic index contains unreferenced chunks.");
  }
}

function validateAllVectors(vectors: Float32Array): void {
  for (const value of vectors) {
    if (!Number.isFinite(value)) {
      throw new Error("Semantic vector data contains a non-finite value.");
    }
  }
}

function validateVectorSample(vectors: Float32Array): void {
  const sampleCount = Math.min(TRUSTED_VECTOR_SAMPLE_SIZE, vectors.length);
  if (sampleCount === 0) {
    return;
  }
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const index = sampleCount === 1
      ? 0
      : Math.floor(sample * (vectors.length - 1) / (sampleCount - 1));
    if (!Number.isFinite(vectors[index])) {
      throw new Error("Semantic vector data contains a non-finite sampled value.");
    }
  }
}

function validateGenerationIntegrity(integrity: IndexGenerationIntegrity): void {
  validateFileIntegrity("documents", integrity.documents);
  validateFileIntegrity("chunks", integrity.chunks);
  validateFileIntegrity("vectors", integrity.vectors);
}

function validateFileIntegrity(name: string, integrity: IndexFileIntegrity): void {
  if (!Number.isInteger(integrity.bytes) || integrity.bytes < 0) {
    throw new Error(`Semantic index ${name} byte size is invalid.`);
  }
  if (!SHA256_PATTERN.test(integrity.sha256)) {
    throw new Error(`Semantic index ${name} checksum metadata is invalid.`);
  }
}

function parseManifest(value: string): IndexManifest {
  const input: unknown = JSON.parse(value);
  if (!isRecord(input)) {
    throw new Error("Semantic index manifest is not an object.");
  }
  return {
    schemaVersion: readInteger(input, "schemaVersion"),
    pluginVersion: readString(input, "pluginVersion"),
    vaultFingerprint: readString(input, "vaultFingerprint"),
    scopeFingerprint: readString(input, "scopeFingerprint"),
    model: parseModel(input["model"]),
    vectorCount: readInteger(input, "vectorCount"),
    dimensions: readInteger(input, "dimensions"),
    lastCompletedAt: readNullableNumber(input, "lastCompletedAt"),
    dirty: readBoolean(input, "dirty"),
    generation: readInteger(input, "generation"),
    files: parseGenerationIntegrity(input["files"])
  };
}

function parseGenerationIntegrity(input: unknown): IndexGenerationIntegrity | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (!isRecord(input)) {
    throw new Error("Semantic index generation integrity metadata is invalid.");
  }
  return {
    documents: parseFileIntegrity(input["documents"], "documents"),
    chunks: parseFileIntegrity(input["chunks"], "chunks"),
    vectors: parseFileIntegrity(input["vectors"], "vectors")
  };
}

function parseFileIntegrity(input: unknown, name: string): IndexFileIntegrity {
  if (!isRecord(input)) {
    throw new Error(`Semantic index ${name} integrity metadata is invalid.`);
  }
  return {
    bytes: readInteger(input, "bytes"),
    sha256: readString(input, "sha256")
  };
}

function parseDocuments(value: string): IndexedDocument[] {
  const input: unknown = JSON.parse(value);
  if (!Array.isArray(input)) {
    throw new Error("Semantic documents file is not an array.");
  }
  return input.map(parseDocument);
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
  return new Float32Array(buffer);
}

function isUnsupportedSchemaError(error: unknown): boolean {
  return error instanceof Error
    && error.message.startsWith("Unsupported semantic index schema:");
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

function readNullableNumber(
  record: Record<string, unknown>,
  key: string
): number | null {
  return record[key] === null ? null : readNumber(record, key);
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${key} to be a boolean.`);
  }
  return value;
}
