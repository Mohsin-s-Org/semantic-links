import { isRecord } from "../utils/validation.ts";

export interface FileIntegrity {
  size: number;
  sha256: string;
}

export interface SnapshotIntegrity {
  schemaVersion: 1;
  files: {
    documents: FileIntegrity;
    chunks: FileIntegrity;
    vectors: FileIntegrity;
  };
}

export async function createSnapshotIntegrity(
  documents: string,
  chunks: string,
  vectors: ArrayBuffer
): Promise<SnapshotIntegrity> {
  const documentBytes = new TextEncoder().encode(documents);
  const chunkBytes = new TextEncoder().encode(chunks);
  return {
    schemaVersion: 1,
    files: {
      documents: await describeBytes(documentBytes),
      chunks: await describeBytes(chunkBytes),
      vectors: await describeBytes(new Uint8Array(vectors))
    }
  };
}

export async function verifySnapshotIntegrity(
  integrity: SnapshotIntegrity,
  documents: string,
  chunks: string,
  vectors: ArrayBuffer
): Promise<void> {
  await verifyFile(
    "documents.json",
    integrity.files.documents,
    new TextEncoder().encode(documents)
  );
  await verifyFile(
    "chunks.json",
    integrity.files.chunks,
    new TextEncoder().encode(chunks)
  );
  await verifyFile(
    "vectors.f32",
    integrity.files.vectors,
    new Uint8Array(vectors)
  );
}

export function parseSnapshotIntegrity(value: string): SnapshotIntegrity {
  const input: unknown = JSON.parse(value);
  if (!isRecord(input) || input["schemaVersion"] !== 1 || !isRecord(input["files"])) {
    throw new Error("Semantic index integrity metadata is invalid.");
  }
  const files = input["files"];
  return {
    schemaVersion: 1,
    files: {
      documents: parseFileIntegrity(files["documents"], "documents.json"),
      chunks: parseFileIntegrity(files["chunks"], "chunks.json"),
      vectors: parseFileIntegrity(files["vectors"], "vectors.f32")
    }
  };
}

async function describeBytes(bytes: Uint8Array): Promise<FileIntegrity> {
  return {
    size: bytes.byteLength,
    sha256: await sha256(bytes)
  };
}

async function verifyFile(
  name: string,
  expected: FileIntegrity,
  bytes: Uint8Array
): Promise<void> {
  if (bytes.byteLength !== expected.size) {
    throw new Error(
      `Semantic index ${name} size mismatch: expected ${expected.size}, received ${bytes.byteLength}.`
    );
  }
  const actual = await sha256(bytes);
  if (actual !== expected.sha256) {
    throw new Error(`Semantic index ${name} checksum mismatch.`);
  }
}

function parseFileIntegrity(value: unknown, name: string): FileIntegrity {
  if (
    !isRecord(value)
    || !Number.isInteger(value["size"])
    || (value["size"] as number) < 0
    || typeof value["sha256"] !== "string"
    || !/^[0-9a-f]{64}$/u.test(value["sha256"])
  ) {
    throw new Error(`Semantic index integrity for ${name} is invalid.`);
  }
  return {
    size: value["size"] as number,
    sha256: value["sha256"]
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("SHA-256 is unavailable for semantic index integrity checks.");
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
