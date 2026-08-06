import type {
  IndexSnapshot,
  IndexedChunk,
  IndexedDocument,
  ModelDescriptor
} from "../indexing/types.ts";
import { isRecord } from "../utils/validation.ts";

export interface JournalStorageAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface IndexJournalIdentity {
  baseGeneration: number;
  vaultFingerprint: string;
  scopeFingerprint: string;
  model: ModelDescriptor | null;
}

export interface JournalChunkState {
  chunk: IndexedChunk;
  vector: Float32Array | null;
}

export interface JournalDocumentState {
  document: IndexedDocument;
  chunks: JournalChunkState[];
}

export interface IndexJournalDelta {
  upserts: JournalDocumentState[];
  removals: string[];
}

export interface JournalReplayResult {
  snapshot: IndexSnapshot;
  recordCount: number;
  lastSequence: number;
  repaired: boolean;
}

interface JournalHeaderPayload extends IndexJournalIdentity {
  type: "header";
  schemaVersion: 1;
}

interface StoredJournalHeader extends JournalHeaderPayload {
  checksum: string;
}

interface StoredChunkState {
  chunk: IndexedChunk;
  vectorBase64: string | null;
}

interface StoredDocumentState {
  document: IndexedDocument;
  chunks: StoredChunkState[];
}

interface StoredJournalDelta {
  removals: string[];
  upserts: StoredDocumentState[];
}

interface JournalRecordPayload {
  type: "delta";
  schemaVersion: 1;
  sequence: number;
  createdAt: number;
  delta: StoredJournalDelta;
}

interface StoredJournalRecord extends JournalRecordPayload {
  checksum: string;
}

interface ParsedJournal {
  header: StoredJournalHeader;
  records: StoredJournalRecord[];
  repaired: boolean;
  serializedValidPrefix: string;
}

const JOURNAL_SCHEMA_VERSION = 1;
const JOURNAL_FILE = "journal.ndjson";
const MAX_JOURNAL_RECORDS = 10_000;

export class IndexJournal {
  private readonly adapter: JournalStorageAdapter;
  private readonly rootPath: string;
  private initializedIdentity: string | null = null;
  private lastSequence = 0;

  constructor(adapter: JournalStorageAdapter, rootPath: string) {
    this.adapter = adapter;
    this.rootPath = rootPath;
  }

  async replay(
    snapshot: IndexSnapshot,
    identity: IndexJournalIdentity
  ): Promise<JournalReplayResult> {
    const parsed = await this.read(identity);
    if (parsed === null) {
      this.initializedIdentity = identityKey(identity);
      this.lastSequence = 0;
      return {
        snapshot,
        recordCount: 0,
        lastSequence: 0,
        repaired: false
      };
    }
    if (parsed.repaired) {
      await this.adapter.write(this.path(), parsed.serializedValidPrefix);
    }
    const replayed = applyRecords(snapshot, parsed.records);
    this.initializedIdentity = identityKey(identity);
    this.lastSequence = parsed.records.at(-1)?.sequence ?? 0;
    return {
      snapshot: replayed,
      recordCount: parsed.records.length,
      lastSequence: this.lastSequence,
      repaired: parsed.repaired
    };
  }

  async append(delta: IndexJournalDelta, identity: IndexJournalIdentity): Promise<number> {
    if (delta.upserts.length === 0 && delta.removals.length === 0) {
      return this.lastSequence;
    }
    await this.ensureInitialized(identity);
    if (this.lastSequence >= MAX_JOURNAL_RECORDS) {
      throw new Error("The semantic index journal exceeded its safety record limit.");
    }
    const payload: JournalRecordPayload = {
      type: "delta",
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      sequence: this.lastSequence + 1,
      createdAt: Date.now(),
      delta: storeDelta(delta)
    };
    const record: StoredJournalRecord = {
      ...payload,
      checksum: await checksum(payload)
    };
    try {
      await this.adapter.append(this.path(), `${JSON.stringify(record)}\n`);
      this.lastSequence = record.sequence;
      return record.sequence;
    } catch (error) {
      this.initializedIdentity = null;
      throw error;
    }
  }

  async clear(): Promise<void> {
    if (await this.adapter.exists(this.path())) {
      await this.adapter.remove(this.path());
    }
    this.initializedIdentity = null;
    this.lastSequence = 0;
  }

  private async ensureInitialized(identity: IndexJournalIdentity): Promise<void> {
    const key = identityKey(identity);
    if (this.initializedIdentity === key) {
      return;
    }
    const parsed = await this.read(identity);
    if (parsed !== null) {
      if (parsed.repaired) {
        await this.adapter.write(this.path(), parsed.serializedValidPrefix);
      }
      this.initializedIdentity = key;
      this.lastSequence = parsed.records.at(-1)?.sequence ?? 0;
      return;
    }
    const payload: JournalHeaderPayload = {
      type: "header",
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      ...identity
    };
    const header: StoredJournalHeader = {
      ...payload,
      checksum: await checksum(payload)
    };
    await this.adapter.write(this.path(), `${JSON.stringify(header)}\n`);
    this.initializedIdentity = key;
    this.lastSequence = 0;
  }

  private async read(identity: IndexJournalIdentity): Promise<ParsedJournal | null> {
    if (!await this.adapter.exists(this.path())) {
      return null;
    }
    let parsed: ParsedJournal;
    try {
      parsed = await parseJournal(await this.adapter.read(this.path()));
    } catch {
      await this.clear();
      return null;
    }
    if (!identitiesEqual(parsed.header, identity)) {
      await this.clear();
      return null;
    }
    return parsed;
  }

  private path(): string {
    return `${this.rootPath}/${JOURNAL_FILE}`;
  }
}

async function parseJournal(text: string): Promise<ParsedJournal> {
  const complete = text.endsWith("\n");
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (!complete && lines.length > 0) {
    lines.pop();
  }
  const headerLine = lines[0];
  if (headerLine === undefined) {
    throw new Error("Semantic index journal header is missing.");
  }
  const header = await parseHeader(headerLine);
  const records: StoredJournalRecord[] = [];
  const validLines = [headerLine];
  let repaired = !complete;
  let expectedSequence = 1;
  for (const line of lines.slice(1)) {
    try {
      const record = await parseRecord(line, expectedSequence);
      records.push(record);
      validLines.push(line);
      expectedSequence += 1;
    } catch {
      repaired = true;
      break;
    }
  }
  if (validLines.length !== lines.length) {
    repaired = true;
  }
  return {
    header,
    records,
    repaired,
    serializedValidPrefix: `${validLines.join("\n")}\n`
  };
}

async function parseHeader(line: string): Promise<StoredJournalHeader> {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) {
    throw new Error("Semantic index journal header is invalid.");
  }
  const payload = parseHeaderPayload(value);
  const expected = value["checksum"];
  if (typeof expected !== "string" || expected !== await checksum(payload)) {
    throw new Error("Semantic index journal header checksum failed.");
  }
  return { ...payload, checksum: expected };
}

function parseHeaderPayload(value: Record<string, unknown>): JournalHeaderPayload {
  const baseGeneration = readInteger(value, "baseGeneration");
  if (
    value["type"] !== "header"
    || value["schemaVersion"] !== JOURNAL_SCHEMA_VERSION
    || baseGeneration < 0
  ) {
    throw new Error("Semantic index journal identity is invalid.");
  }
  return {
    type: "header",
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    baseGeneration,
    vaultFingerprint: readString(value, "vaultFingerprint"),
    scopeFingerprint: readString(value, "scopeFingerprint"),
    model: parseModel(value["model"])
  };
}

async function parseRecord(line: string, expectedSequence: number): Promise<StoredJournalRecord> {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) {
    throw new Error("Semantic index journal record is invalid.");
  }
  const payload = parseRecordPayload(value, expectedSequence);
  const expected = value["checksum"];
  if (typeof expected !== "string" || expected !== await checksum(payload)) {
    throw new Error("Semantic index journal record checksum failed.");
  }
  return { ...payload, checksum: expected };
}

function parseRecordPayload(
  value: Record<string, unknown>,
  expectedSequence: number
): JournalRecordPayload {
  const createdAt = readNumber(value, "createdAt");
  if (
    value["type"] !== "delta"
    || value["schemaVersion"] !== JOURNAL_SCHEMA_VERSION
    || value["sequence"] !== expectedSequence
  ) {
    throw new Error("Semantic index journal sequence is invalid.");
  }
  return {
    type: "delta",
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    sequence: expectedSequence,
    createdAt,
    delta: parseStoredDelta(value["delta"])
  };
}

function parseStoredDelta(value: unknown): StoredJournalDelta {
  if (!isRecord(value) || !Array.isArray(value["upserts"]) || !Array.isArray(value["removals"])) {
    throw new Error("Semantic index journal delta is invalid.");
  }
  const removals = value["removals"].map((path) => {
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("Semantic index journal removal path is invalid.");
    }
    return path;
  });
  const upserts = value["upserts"].map(parseStoredDocumentState);
  return { removals, upserts };
}

function parseStoredDocumentState(value: unknown): StoredDocumentState {
  if (!isRecord(value) || !Array.isArray(value["chunks"])) {
    throw new Error("Semantic index journal document state is invalid.");
  }
  return {
    document: parseDocument(value["document"]),
    chunks: value["chunks"].map((entry) => {
      if (!isRecord(entry)) {
        throw new Error("Semantic index journal chunk state is invalid.");
      }
      const vectorBase64 = entry["vectorBase64"];
      if (vectorBase64 !== null && typeof vectorBase64 !== "string") {
        throw new Error("Semantic index journal vector encoding is invalid.");
      }
      return {
        chunk: parseChunk(entry["chunk"]),
        vectorBase64
      };
    })
  };
}

function parseDocument(value: unknown): IndexedDocument {
  if (!isRecord(value) || !Array.isArray(value["headings"])) {
    throw new Error("Semantic index journal document is invalid.");
  }
  return {
    id: readString(value, "id"),
    path: readString(value, "path"),
    title: readString(value, "title"),
    aliases: readStrings(value, "aliases"),
    tags: readStrings(value, "tags"),
    headings: value["headings"].map((heading) => {
      if (!isRecord(heading)) {
        throw new Error("Semantic index journal heading is invalid.");
      }
      return {
        text: readString(heading, "text"),
        level: readInteger(heading, "level")
      };
    }),
    outgoingPaths: readStrings(value, "outgoingPaths"),
    contentHash: readString(value, "contentHash"),
    modifiedAt: readNumber(value, "modifiedAt"),
    chunkIds: readStrings(value, "chunkIds")
  };
}

function parseChunk(value: unknown): IndexedChunk {
  if (!isRecord(value)) {
    throw new Error("Semantic index journal chunk is invalid.");
  }
  return {
    id: readString(value, "id"),
    documentId: readString(value, "documentId"),
    headingPath: readStrings(value, "headingPath"),
    startOffset: readInteger(value, "startOffset"),
    endOffset: readInteger(value, "endOffset"),
    startLine: readInteger(value, "startLine"),
    endLine: readInteger(value, "endLine"),
    textPreview: readString(value, "textPreview"),
    lexicalTerms: readStrings(value, "lexicalTerms"),
    embeddingText: readString(value, "embeddingText"),
    vectorRow: readInteger(value, "vectorRow")
  };
}

function storeDelta(delta: IndexJournalDelta): StoredJournalDelta {
  return {
    removals: [...new Set(delta.removals)].sort((left, right) => left.localeCompare(right)),
    upserts: [...delta.upserts]
      .sort((left, right) => left.document.path.localeCompare(right.document.path))
      .map((state) => ({
        document: cloneDocument(state.document),
        chunks: [...state.chunks]
          .sort((left, right) => left.chunk.id.localeCompare(right.chunk.id))
          .map(({ chunk, vector }) => ({
            chunk: {
              ...chunk,
              headingPath: [...chunk.headingPath],
              lexicalTerms: [...chunk.lexicalTerms],
              vectorRow: -1
            },
            vectorBase64: vector === null ? null : encodeVector(vector)
          }))
      }))
  };
}

function applyRecords(snapshot: IndexSnapshot, records: readonly StoredJournalRecord[]): IndexSnapshot {
  const documents = new Map(snapshot.documents.map((document) => [document.path, cloneDocument(document)]));
  const chunks = new Map(snapshot.chunks.map((chunk) => [chunk.id, cloneChunk(chunk)]));
  const vectors = new Map<string, Float32Array>();
  const dimensions = snapshot.manifest.dimensions;
  for (const chunk of snapshot.chunks) {
    if (chunk.vectorRow >= 0 && dimensions > 0) {
      const start = chunk.vectorRow * dimensions;
      vectors.set(chunk.id, snapshot.vectors.slice(start, start + dimensions));
    }
  }

  for (const record of records) {
    for (const path of record.delta.removals) {
      removeDocument(path, documents, chunks, vectors);
    }
    for (const state of record.delta.upserts) {
      const document = cloneDocument(state.document);
      for (const [path, existing] of documents) {
        if (path === document.path || existing.id === document.id) {
          removeDocument(path, documents, chunks, vectors);
        }
      }
      const expectedChunks = new Set(document.chunkIds);
      const seenChunks = new Set<string>();
      for (const stored of state.chunks) {
        const chunk = cloneChunk(stored.chunk);
        if (
          chunk.documentId !== document.id
          || !expectedChunks.has(chunk.id)
          || seenChunks.has(chunk.id)
        ) {
          throw new Error(`Semantic index journal chunk mismatch: ${chunk.id}`);
        }
        seenChunks.add(chunk.id);
        chunk.vectorRow = -1;
        chunks.set(chunk.id, chunk);
        if (stored.vectorBase64 !== null) {
          const vector = decodeVector(stored.vectorBase64);
          if (vector.length !== dimensions) {
            throw new Error(`Semantic index journal vector dimensions are invalid: ${chunk.id}`);
          }
          for (const value of vector) {
            if (!Number.isFinite(value)) {
              throw new Error(`Semantic index journal vector contains a non-finite value: ${chunk.id}`);
            }
          }
          vectors.set(chunk.id, vector);
        }
      }
      if (seenChunks.size !== expectedChunks.size) {
        throw new Error(`Semantic index journal omitted chunks for ${document.path}`);
      }
      documents.set(document.path, document);
    }
  }

  const sortedChunks = [...chunks.values()].sort((left, right) => left.id.localeCompare(right.id));
  const packedVectors = new Float32Array(vectors.size * dimensions);
  let vectorRow = 0;
  const storedChunks = sortedChunks.map((chunk) => {
    const vector = vectors.get(chunk.id);
    if (vector === undefined || dimensions === 0) {
      return { ...chunk, vectorRow: -1 };
    }
    packedVectors.set(vector, vectorRow * dimensions);
    return { ...chunk, vectorRow: vectorRow++ };
  });
  return {
    manifest: {
      ...snapshot.manifest,
      vectorCount: vectorRow
    },
    documents: [...documents.values()].sort((left, right) => left.path.localeCompare(right.path)),
    chunks: storedChunks,
    vectors: packedVectors.slice(0, vectorRow * dimensions)
  };
}

function removeDocument(
  path: string,
  documents: Map<string, IndexedDocument>,
  chunks: Map<string, IndexedChunk>,
  vectors: Map<string, Float32Array>
): void {
  const document = documents.get(path);
  if (document === undefined) {
    return;
  }
  documents.delete(path);
  for (const chunkId of document.chunkIds) {
    chunks.delete(chunkId);
    vectors.delete(chunkId);
  }
}

function parseModel(value: unknown): ModelDescriptor | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Semantic index journal model identity is invalid.");
  }
  const dimensions = readInteger(value, "dimensions");
  if (dimensions < 1) {
    throw new Error("Semantic index journal model dimensions are invalid.");
  }
  return {
    id: readString(value, "id"),
    revision: readString(value, "revision"),
    quantization: readString(value, "quantization"),
    dimensions,
    tokenizerVersion: readString(value, "tokenizerVersion"),
    runtimeVersion: readString(value, "runtimeVersion")
  };
}

function identitiesEqual(header: JournalHeaderPayload, identity: IndexJournalIdentity): boolean {
  return header.baseGeneration === identity.baseGeneration
    && header.vaultFingerprint === identity.vaultFingerprint
    && header.scopeFingerprint === identity.scopeFingerprint
    && JSON.stringify(header.model) === JSON.stringify(identity.model);
}

function identityKey(identity: IndexJournalIdentity): string {
  return JSON.stringify(identity);
}

async function checksum(value: object): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("SHA-256 is unavailable for the semantic index journal.");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encodeVector(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8_192));
  }
  return globalThis.btoa(binary);
}

function decodeVector(value: string): Float32Array {
  const binary = globalThis.atob(value);
  if (binary.length % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Semantic index journal vector byte length is invalid.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Float32Array(bytes.buffer);
}

function cloneDocument(document: IndexedDocument): IndexedDocument {
  return {
    ...document,
    aliases: [...document.aliases],
    tags: [...document.tags],
    headings: document.headings.map((heading) => ({ ...heading })),
    outgoingPaths: [...document.outgoingPaths],
    chunkIds: [...document.chunkIds]
  };
}

function cloneChunk(chunk: IndexedChunk): IndexedChunk {
  return {
    ...chunk,
    headingPath: [...chunk.headingPath],
    lexicalTerms: [...chunk.lexicalTerms]
  };
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
