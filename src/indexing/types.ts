export interface ModelDescriptor {
  id: string;
  revision: string;
  quantization: string;
  dimensions: number;
  tokenizerVersion: string;
  runtimeVersion: string;
}

export interface IndexManifest {
  schemaVersion: number;
  pluginVersion: string;
  vaultFingerprint: string;
  scopeFingerprint: string;
  model: ModelDescriptor | null;
  vectorCount: number;
  dimensions: number;
  lastCompletedAt: number | null;
  dirty: boolean;
  generation: number;
}

export interface IndexedHeading {
  text: string;
  level: number;
}

export interface IndexedDocument {
  id: string;
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: IndexedHeading[];
  outgoingPaths: string[];
  contentHash: string;
  modifiedAt: number;
  chunkIds: string[];
}

export interface IndexedChunk {
  id: string;
  documentId: string;
  headingPath: string[];
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  textPreview: string;
  lexicalTerms: string[];
  embeddingText: string;
  vectorRow: number;
}

export interface IndexSnapshot {
  manifest: IndexManifest;
  documents: IndexedDocument[];
  chunks: IndexedChunk[];
  vectors: Float32Array;
}

export type IndexPhase =
  | "closed"
  | "opening"
  | "ready"
  | "indexing"
  | "paused"
  | "deleting"
  | "error";

export interface IndexStatus {
  phase: IndexPhase;
  documentCount: number;
  chunkCount: number;
  vectorCount: number;
  queuedCount: number;
  processedCount: number;
  totalCount: number;
  message: string;
  lastCompletedAt: number | null;
}

export interface EmbeddingInput {
  id: string;
  text: string;
}

export interface EmbeddingOutput {
  id: string;
  vector: Float32Array;
}

export interface EmbeddingClient {
  readonly descriptor: ModelDescriptor;
  embed(inputs: readonly EmbeddingInput[], signal: AbortSignal): Promise<EmbeddingOutput[]>;
  dispose(): void;
}
