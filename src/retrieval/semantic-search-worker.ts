import { semanticDiagnostics } from "../diagnostics/performance.ts";
import { isRecord } from "../utils/validation.ts";

export interface WorkerSearchResult {
  row: number;
  score: number;
}

export interface WorkerSnapshotDiff {
  capacity: number;
  rows: Int32Array;
  vectors: Float32Array;
  documents: Int32Array;
  removals: Int32Array;
}

interface PendingSearch {
  resolve(value: WorkerSearchResult[]): void;
  reject(reason: unknown): void;
  removeAbortListener(): void;
  finish(): void;
}

export class SemanticSearchWorker {
  private readonly pending = new Map<number, PendingSearch>();
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private shadowVectors = new Float32Array();
  private shadowDocuments = new Int32Array();
  private dimensions = 0;
  private generation = 0;
  private requestId = 0;
  private disposed = false;

  constructor() {
    this.createWorker();
  }

  get available(): boolean {
    return this.worker !== null;
  }

  update(vectors: Float32Array, documents: Int32Array, dimensions: number): void {
    validateSnapshot(vectors, documents, dimensions);
    const nextVectors = new Float32Array(vectors);
    const nextDocuments = new Int32Array(documents);
    if (this.worker === null) {
      this.shadowVectors = nextVectors;
      this.shadowDocuments = nextDocuments;
      this.dimensions = dimensions;
      return;
    }

    const mustReset = this.generation === 0
      || this.dimensions !== dimensions
      || nextDocuments.length < this.shadowDocuments.length;
    if (mustReset) {
      this.shadowVectors = nextVectors;
      this.shadowDocuments = nextDocuments;
      this.dimensions = dimensions;
      this.generation += 1;
      this.postReset();
      return;
    }

    const diff = diffWorkerSnapshot(
      this.shadowVectors,
      this.shadowDocuments,
      nextVectors,
      nextDocuments,
      dimensions
    );
    this.shadowVectors = nextVectors;
    this.shadowDocuments = nextDocuments;
    this.dimensions = dimensions;
    if (diff.rows.length === 0 && diff.removals.length === 0) {
      semanticDiagnostics.increment("search.worker_noop_update");
      return;
    }

    const baseGeneration = this.generation;
    this.generation += 1;
    const finish = semanticDiagnostics.startSpan("search.worker_patch_post_ms");
    try {
      semanticDiagnostics.setGauge("search.worker_patch_rows", diff.rows.length);
      semanticDiagnostics.setGauge("search.worker_removed_rows", diff.removals.length);
      semanticDiagnostics.setGauge(
        "search.worker_patch_bytes",
        diff.rows.byteLength
          + diff.vectors.byteLength
          + diff.documents.byteLength
          + diff.removals.byteLength
      );
      const rowsBuffer = transferableBuffer(diff.rows);
      const vectorsBuffer = transferableBuffer(diff.vectors);
      const documentsBuffer = transferableBuffer(diff.documents);
      const removalsBuffer = transferableBuffer(diff.removals);
      this.worker.postMessage({
        type: "patch",
        baseGeneration,
        generation: this.generation,
        capacity: diff.capacity,
        dimensions,
        rows: rowsBuffer,
        vectors: vectorsBuffer,
        documents: documentsBuffer,
        removals: removalsBuffer
      }, [rowsBuffer, vectorsBuffer, documentsBuffer, removalsBuffer]);
    } finally {
      finish();
    }
  }

  search(
    query: Float32Array,
    excludedDocument: number,
    limit: number,
    signal: AbortSignal
  ): Promise<WorkerSearchResult[]> {
    if (this.worker === null || this.generation === 0) {
      return Promise.resolve([]);
    }
    if (signal.aborted) {
      return Promise.reject(abortError(signal));
    }
    const id = ++this.requestId;
    const copy = semanticDiagnostics.measureSync("search.query_copy_ms", () => {
      return new Float32Array(query);
    });
    const queryBuffer = transferableBuffer(copy);
    const finish = semanticDiagnostics.startSpan("search.worker_round_trip_ms");
    semanticDiagnostics.setGauge("search.worker_query_bytes", query.byteLength);
    semanticDiagnostics.setGauge("search.worker_limit", limit);
    return new Promise<WorkerSearchResult[]>((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.finish();
        semanticDiagnostics.increment("search.worker_cancelled");
        reject(abortError(signal));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        finish,
        removeAbortListener: () => signal.removeEventListener("abort", abort)
      });
      this.worker?.postMessage({
        type: "search",
        id,
        generation: this.generation,
        query: queryBuffer,
        excludedDocument,
        limit
      }, [queryBuffer]);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.revokeWorkerUrl();
    this.rejectAll(new Error("The semantic search worker was disposed."));
  }

  private createWorker(): void {
    if (
      this.disposed
      || typeof Worker === "undefined"
      || typeof Blob === "undefined"
      || typeof URL.createObjectURL !== "function"
    ) {
      semanticDiagnostics.increment("search.worker_unavailable");
      return;
    }
    this.revokeWorkerUrl();
    this.workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], {
      type: "text/javascript"
    }));
    this.worker = new Worker(this.workerUrl, { name: "semantic-links-search" });
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = () => {
      semanticDiagnostics.increment("search.worker_error");
      this.restartWorker(new Error("The semantic search worker failed."));
    };
    if (this.generation > 0) {
      this.postReset();
    }
  }

  private postReset(): void {
    if (this.worker === null) {
      return;
    }
    const vectors = new Float32Array(this.shadowVectors);
    const documents = new Int32Array(this.shadowDocuments);
    const vectorBuffer = transferableBuffer(vectors);
    const documentBuffer = transferableBuffer(documents);
    semanticDiagnostics.setGauge(
      "search.worker_vector_count",
      this.dimensions > 0 ? this.shadowVectors.length / this.dimensions : 0
    );
    semanticDiagnostics.setGauge("search.worker_dimensions", this.dimensions);
    semanticDiagnostics.setGauge(
      "search.worker_reset_bytes",
      vectors.byteLength + documents.byteLength
    );
    semanticDiagnostics.increment("search.worker_full_reset");
    this.worker.postMessage({
      type: "reset",
      generation: this.generation,
      vectors: vectorBuffer,
      documents: documentBuffer,
      dimensions: this.dimensions
    }, [vectorBuffer, documentBuffer]);
  }

  private handleMessage(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }
    if (value["type"] === "resync") {
      semanticDiagnostics.increment("search.worker_resync");
      this.rejectAll(new Error("Semantic search worker state was resynchronised."));
      this.postReset();
      return;
    }
    if (value["type"] !== "result") {
      return;
    }
    const id = value["id"];
    const generation = value["generation"];
    const rows = value["rows"];
    const scores = value["scores"];
    if (
      typeof id !== "number"
      || generation !== this.generation
      || !(rows instanceof Int32Array)
      || !(scores instanceof Float32Array)
      || rows.length !== scores.length
    ) {
      semanticDiagnostics.increment("search.worker_invalid_result");
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      semanticDiagnostics.increment("search.worker_stale_result");
      return;
    }
    this.pending.delete(id);
    pending.removeAbortListener();
    pending.finish();
    semanticDiagnostics.setGauge("search.worker_result_count", rows.length);
    pending.resolve(Array.from(rows, (row, index) => ({
      row,
      score: scores[index] ?? Number.NEGATIVE_INFINITY
    })));
  }

  private restartWorker(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectAll(error);
    semanticDiagnostics.increment("search.worker_restart");
    this.createWorker();
  }

  private revokeWorkerUrl(): void {
    if (this.workerUrl !== null) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.removeAbortListener();
      pending.finish();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function diffWorkerSnapshot(
  previousVectors: Float32Array,
  previousDocuments: Int32Array,
  nextVectors: Float32Array,
  nextDocuments: Int32Array,
  dimensions: number
): WorkerSnapshotDiff {
  validateSnapshot(previousVectors, previousDocuments, dimensions);
  validateSnapshot(nextVectors, nextDocuments, dimensions);
  const changedRows: number[] = [];
  const removedRows: number[] = [];
  const vectors: number[] = [];
  const documents: number[] = [];
  const rowCount = Math.max(previousDocuments.length, nextDocuments.length);

  for (let row = 0; row < rowCount; row += 1) {
    const previousDocument = previousDocuments[row] ?? -1;
    const nextDocument = nextDocuments[row] ?? -1;
    if (nextDocument < 0) {
      if (previousDocument >= 0) {
        removedRows.push(row);
      }
      continue;
    }
    const changed = previousDocument !== nextDocument
      || row >= previousDocuments.length
      || !rowsEqual(previousVectors, nextVectors, row, dimensions);
    if (!changed) {
      continue;
    }
    changedRows.push(row);
    documents.push(nextDocument);
    const start = row * dimensions;
    for (let column = 0; column < dimensions; column += 1) {
      vectors.push(nextVectors[start + column] ?? 0);
    }
  }

  return {
    capacity: nextDocuments.length,
    rows: new Int32Array(changedRows),
    vectors: new Float32Array(vectors),
    documents: new Int32Array(documents),
    removals: new Int32Array(removedRows)
  };
}

function rowsEqual(
  previous: Float32Array,
  next: Float32Array,
  row: number,
  dimensions: number
): boolean {
  const start = row * dimensions;
  for (let column = 0; column < dimensions; column += 1) {
    if (previous[start + column] !== next[start + column]) {
      return false;
    }
  }
  return true;
}

function validateSnapshot(
  vectors: Float32Array,
  documents: Int32Array,
  dimensions: number
): void {
  if (!Number.isInteger(dimensions) || dimensions < 0) {
    throw new Error("Semantic search worker dimensions are invalid.");
  }
  if (dimensions === 0) {
    if (vectors.length !== 0 || documents.length !== 0) {
      throw new Error("A vectorless worker snapshot contains rows.");
    }
    return;
  }
  if (vectors.length !== documents.length * dimensions) {
    throw new Error("Semantic search worker snapshot dimensions do not match its rows.");
  }
}

function transferableBuffer(view: Float32Array | Int32Array): ArrayBuffer {
  const buffer = view.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("Shared buffers cannot be transferred to the semantic search worker.");
  }
  return buffer;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The semantic search was cancelled.", "AbortError");
}

const WORKER_SOURCE = String.raw`
let vectors = new Float32Array();
let documents = new Int32Array();
let dimensions = 0;
let generation = 0;

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type === "reset") {
    vectors = new Float32Array(message.vectors);
    documents = new Int32Array(message.documents);
    dimensions = message.dimensions;
    generation = message.generation;
    return;
  }
  if (message?.type === "patch") {
    if (message.baseGeneration !== generation || message.dimensions !== dimensions) {
      self.postMessage({ type: "resync" });
      return;
    }
    const capacity = Math.max(0, Math.floor(message.capacity));
    if (capacity !== documents.length) {
      const nextVectors = new Float32Array(capacity * dimensions);
      nextVectors.set(vectors.subarray(0, nextVectors.length));
      vectors = nextVectors;
      const nextDocuments = new Int32Array(capacity);
      nextDocuments.fill(-1);
      nextDocuments.set(documents.subarray(0, capacity));
      documents = nextDocuments;
    }
    const rows = new Int32Array(message.rows);
    const patchVectors = new Float32Array(message.vectors);
    const patchDocuments = new Int32Array(message.documents);
    const removals = new Int32Array(message.removals);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row < 0 || row >= capacity) {
        self.postMessage({ type: "resync" });
        return;
      }
      documents[row] = patchDocuments[index];
      const source = index * dimensions;
      vectors.set(patchVectors.subarray(source, source + dimensions), row * dimensions);
    }
    for (const row of removals) {
      if (row < 0 || row >= capacity) continue;
      documents[row] = -1;
      vectors.fill(0, row * dimensions, (row + 1) * dimensions);
    }
    generation = message.generation;
    return;
  }
  if (message?.type !== "search") return;
  if (message.generation !== generation) {
    self.postMessage({ type: "resync" });
    return;
  }
  const query = new Float32Array(message.query);
  const limit = Math.max(0, Math.floor(message.limit));
  const rows = [];
  const scores = [];
  const rowCount = dimensions > 0 ? vectors.length / dimensions : 0;

  for (let row = 0; row < rowCount; row += 1) {
    const document = documents[row];
    if (document < 0 || document === message.excludedDocument) continue;
    let score = 0;
    const offset = row * dimensions;
    for (let column = 0; column < dimensions; column += 1) {
      score += query[column] * vectors[offset + column];
    }
    if (rows.length < limit) {
      rows.push(row);
      scores.push(score);
      continue;
    }
    let lowest = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if (scores[index] < scores[lowest]) lowest = index;
    }
    if (score > scores[lowest]) {
      rows[lowest] = row;
      scores[lowest] = score;
    }
  }

  const order = rows.map((_, index) => index)
    .sort((left, right) => scores[right] - scores[left]);
  const outputRows = new Int32Array(order.map((index) => rows[index]));
  const outputScores = new Float32Array(order.map((index) => scores[index]));
  self.postMessage({
    type: "result",
    id: message.id,
    generation,
    rows: outputRows,
    scores: outputScores
  }, [outputRows.buffer, outputScores.buffer]);
};
`;
