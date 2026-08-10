import type {
  IndexFileIntegrity,
  IndexGenerationIntegrity,
  IndexedChunk,
  IndexedDocument
} from "../indexing/types.ts";

export interface PreparedGenerationFiles {
  documentsText: string;
  chunksText: string;
  vectorBuffer: ArrayBuffer;
  integrity: IndexGenerationIntegrity;
}

const encoder = new TextEncoder();

export async function prepareGenerationFiles(
  documents: readonly IndexedDocument[],
  chunks: readonly IndexedChunk[],
  vectors: Float32Array
): Promise<PreparedGenerationFiles> {
  const documentsText = serializeIndexJson(documents);
  const chunksText = serializeIndexJson(chunks);
  const vectorBuffer = exactVectorBuffer(vectors);
  const [documentsIntegrity, chunksIntegrity, vectorsIntegrity] = await Promise.all([
    integrityForText(documentsText),
    integrityForText(chunksText),
    integrityForBuffer(vectorBuffer)
  ]);
  return {
    documentsText,
    chunksText,
    vectorBuffer,
    integrity: {
      documents: documentsIntegrity,
      chunks: chunksIntegrity,
      vectors: vectorsIntegrity
    }
  };
}

export async function verifyGenerationFiles(
  expected: IndexGenerationIntegrity,
  documentsText: string,
  chunksText: string,
  vectorBuffer: ArrayBuffer
): Promise<void> {
  const [documents, chunks, vectors] = await Promise.all([
    integrityForText(documentsText),
    integrityForText(chunksText),
    integrityForBuffer(vectorBuffer)
  ]);
  verifyFile("documents", expected.documents, documents);
  verifyFile("chunks", expected.chunks, chunks);
  verifyFile("vectors", expected.vectors, vectors);
}

export function serializeIndexJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exactVectorBuffer(vectors: Float32Array): ArrayBuffer {
  const buffer = vectors.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("Shared semantic vector buffers cannot be persisted.");
  }
  if (vectors.byteOffset === 0 && vectors.byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(vectors.byteOffset, vectors.byteOffset + vectors.byteLength);
}

function exactByteBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("Shared encoded index buffers cannot be checksummed.");
  }
  if (bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function integrityForText(value: string): Promise<IndexFileIntegrity> {
  const bytes = encoder.encode(value);
  return {
    bytes: bytes.byteLength,
    sha256: await sha256Hex(exactByteBuffer(bytes))
  };
}

async function integrityForBuffer(buffer: ArrayBuffer): Promise<IndexFileIntegrity> {
  return {
    bytes: buffer.byteLength,
    sha256: await sha256Hex(buffer)
  };
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("SHA-256 is unavailable in this Obsidian runtime.");
  }
  const digest = await subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function verifyFile(
  name: string,
  expected: IndexFileIntegrity,
  actual: IndexFileIntegrity
): void {
  if (actual.bytes !== expected.bytes) {
    throw new Error(
      `Semantic index ${name} size mismatch: expected ${expected.bytes}, received ${actual.bytes}.`
    );
  }
  if (actual.sha256 !== expected.sha256) {
    throw new Error(`Semantic index ${name} checksum mismatch.`);
  }
}
