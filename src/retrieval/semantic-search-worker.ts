import { isRecord } from "../utils/validation.ts";

export interface WorkerSearchResult {
  row: number;
  score: number;
}

interface PendingSearch {
  resolve(value: WorkerSearchResult[]): void;
  reject(reason: unknown): void;
  removeAbortListener(): void;
}

export class SemanticSearchWorker {
  private readonly pending = new Map<number, PendingSearch>();
  private readonly worker: Worker | null;
  private readonly workerUrl: string | null;
  private requestId = 0;

  constructor() {
    if (
      typeof Worker === "undefined"
      || typeof Blob === "undefined"
      || typeof URL.createObjectURL !== "function"
    ) {
      this.worker = null;
      this.workerUrl = null;
      return;
    }
    this.workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], {
      type: "text/javascript"
    }));
    this.worker = new Worker(this.workerUrl, { name: "semantic-links-search" });
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = () => {
      this.rejectAll(new Error("The semantic search worker failed."));
    };
  }

  get available(): boolean {
    return this.worker !== null;
  }

  update(vectors: Float32Array, documents: Int32Array, dimensions: number): void {
    if (this.worker === null) {
      return;
    }
    const vectorBuffer = transferableBuffer(vectors);
    const documentBuffer = transferableBuffer(documents);
    this.worker.postMessage({
      type: "update",
      vectors: vectorBuffer,
      documents: documentBuffer,
      dimensions
    }, [vectorBuffer, documentBuffer]);
  }

  search(
    query: Float32Array,
    excludedDocument: number,
    limit: number,
    signal: AbortSignal
  ): Promise<WorkerSearchResult[]> {
    if (this.worker === null) {
      return Promise.resolve([]);
    }
    if (signal.aborted) {
      return Promise.reject(abortError(signal));
    }
    const id = ++this.requestId;
    const copy = new Float32Array(query);
    const queryBuffer = transferableBuffer(copy);
    return new Promise<WorkerSearchResult[]>((resolve, reject) => {
      const abort = (): void => {
        this.pending.delete(id);
        reject(abortError(signal));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        removeAbortListener: () => signal.removeEventListener("abort", abort)
      });
      this.worker?.postMessage({
        type: "search",
        id,
        query: queryBuffer,
        excludedDocument,
        limit
      }, [queryBuffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    if (this.workerUrl !== null) {
      URL.revokeObjectURL(this.workerUrl);
    }
    this.rejectAll(new Error("The semantic search worker was disposed."));
  }

  private handleMessage(value: unknown): void {
    if (!isRecord(value) || value["type"] !== "result") {
      return;
    }
    const id = value["id"];
    const rows = value["rows"];
    const scores = value["scores"];
    if (
      typeof id !== "number"
      || !(rows instanceof Int32Array)
      || !(scores instanceof Float32Array)
      || rows.length !== scores.length
    ) {
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(id);
    pending.removeAbortListener();
    pending.resolve(Array.from(rows, (row, index) => ({
      row,
      score: scores[index] ?? Number.NEGATIVE_INFINITY
    })));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.removeAbortListener();
      pending.reject(error);
    }
    this.pending.clear();
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

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type === "update") {
    vectors = new Float32Array(message.vectors);
    documents = new Int32Array(message.documents);
    dimensions = message.dimensions;
    return;
  }
  if (message?.type !== "search") return;
  const query = new Float32Array(message.query);
  const limit = Math.max(0, Math.floor(message.limit));
  const rows = [];
  const scores = [];
  const rowCount = dimensions > 0 ? vectors.length / dimensions : 0;

  for (let row = 0; row < rowCount; row += 1) {
    if (documents[row] === message.excludedDocument) continue;
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
    rows: outputRows,
    scores: outputScores
  }, [outputRows.buffer, outputScores.buffer]);
};
`;
