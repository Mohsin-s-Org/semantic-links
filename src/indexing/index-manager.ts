import type { App, TFile } from "obsidian";
import { isMarkdownFile } from "../lexical/vault-index.ts";
import { topDotProducts } from "../retrieval/exact-search.ts";
import { SemanticSearchWorker } from "../retrieval/semantic-search-worker.ts";
import type { SemanticMatch } from "../retrieval/semantic-types.ts";
import { isFileExcluded } from "../scope/exclusions.ts";
import type { SemanticLinksSettings } from "../settings/types.ts";
import {
  createEmptyIndexManifest,
  type PersistentIndexStore
} from "../storage/index-store.ts";
import {
  canReuseDocument,
  findRemovedChunkIds,
  needsDocumentRead
} from "./change-detection.ts";
import { EmbeddingBatcher } from "./embedding-batcher.ts";
import { parseIndexDocument, type ParsedIndexDocument } from "./note-parser.ts";
import { createIndexScopeFingerprint } from "./scope-fingerprint.ts";
import type {
  EmbeddingClient,
  IndexSnapshot,
  IndexStatus,
  IndexedChunk,
  IndexedDocument,
  ModelDescriptor
} from "./types.ts";

type TimerHandle = ReturnType<typeof setTimeout>;
type StatusListener = (status: IndexStatus) => void;

interface SemanticCandidate {
  chunk: IndexedChunk;
  document: IndexedDocument;
}

interface ScoredSemanticCandidate {
  value: SemanticCandidate;
  score: number;
}

export class PersistentIndexManager {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly documentsById = new Map<string, IndexedDocument>();
  private readonly chunks = new Map<string, IndexedChunk>();
  private readonly vectors = new Map<string, Float32Array>();
  private readonly pendingPaths = new Set<string>();
  private readonly listeners = new Set<StatusListener>();
  private readonly lifecycle = new AbortController();
  private readonly searchWorker = new SemanticSearchWorker();
  private searchEntries: SemanticCandidate[] = [];
  private searchDocumentOrdinals = new Map<string, number>();
  private operation: Promise<void> = Promise.resolve();
  private flushTimer: TimerHandle | null = null;
  private scopeTimer: TimerHandle | null = null;
  private scopeFingerprint: string;
  private indexingEnabled: boolean;
  private pendingScopeReset = false;
  private pendingEnabledChange = false;
  private generation = 0;
  private lastCompletedAt: number | null = null;
  private model: ModelDescriptor | null = null;
  private embeddingClient: EmbeddingClient | null;
  private opened = false;
  private disposed = false;
  private status: IndexStatus = createStatus("closed", "Index is closed.");

  constructor(
    private readonly app: App,
    private readonly store: PersistentIndexStore,
    private readonly pluginVersion: string,
    private readonly vaultFingerprint: string,
    private readonly getSettings: () => SemanticLinksSettings,
    embeddingClient: EmbeddingClient | null = null
  ) {
    this.embeddingClient = embeddingClient;
    const settings = getSettings();
    this.scopeFingerprint = createIndexScopeFingerprint(settings);
    this.indexingEnabled = settings.semanticIndexingEnabled;
  }

  get currentStatus(): IndexStatus {
    return { ...this.status };
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.currentStatus);
    return () => this.listeners.delete(listener);
  }

  async open(): Promise<void> {
    await this.enqueue(async () => {
      if (this.opened) {
        return;
      }
      this.updateStatus("opening", "Opening the local semantic index.");
      let snapshot = await this.store.open();
      let message: string | undefined;
      if (!this.isCompatible(snapshot)) {
        await this.store.delete();
        snapshot = await this.store.open();
        message = "The stored index was incompatible with the current vault, scope or model and was reset safely.";
      }
      this.loadSnapshot(snapshot);
      this.opened = true;
      this.updateReadyStatus(message);
    });
  }

  async reconcile(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.canIndex()) {
        this.updateReadyStatus();
        return;
      }
      const files = this.sortedMarkdownFiles();
      const livePaths = new Set(files.map((file) => file.path));
      let changed = false;
      for (const path of [...this.documents.keys()]) {
        if (!livePaths.has(path)) {
          changed = this.removeFromMemory(path) || changed;
        }
      }
      const pending = files.filter((file) => {
        if (isFileExcluded(this.app.metadataCache, file, this.getSettings())) {
          changed = this.removeFromMemory(file.path) || changed;
          return false;
        }
        return needsDocumentRead(this.documents.get(file.path), file.stat.mtime);
      });
      await this.processFiles(pending, changed, "Reconciling changed notes");
    });
  }

  scheduleRefresh(file: TFile, delayMs = 250): void {
    if (!this.disposed && this.opened && isMarkdownFile(file)) {
      this.pendingPaths.add(file.path);
      this.scheduleFlush(delayMs);
    }
  }

  scheduleRemove(path: string, delayMs = 50): void {
    if (!this.disposed && this.opened) {
      this.pendingPaths.add(path);
      this.scheduleFlush(delayMs);
    }
  }

  scheduleRename(file: TFile, oldPath: string, delayMs = 250): void {
    if (!isMarkdownFile(file)) {
      this.scheduleRemove(oldPath, delayMs);
      return;
    }
    const document = this.documents.get(oldPath);
    if (document !== undefined) {
      this.documents.delete(oldPath);
      document.path = file.path;
      document.modifiedAt = -1;
      this.documents.set(file.path, document);
    }
    this.pendingPaths.delete(oldPath);
    this.pendingPaths.add(file.path);
    this.scheduleFlush(delayMs);
  }

  scheduleScopeRebuild(delayMs = 500): void {
    if (this.disposed) {
      return;
    }
    const settings = this.getSettings();
    const scope = createIndexScopeFingerprint(settings);
    const enabled = settings.semanticIndexingEnabled;
    const scopeChanged = scope !== this.scopeFingerprint;
    const enabledChanged = enabled !== this.indexingEnabled;
    if (!scopeChanged && !enabledChanged) {
      return;
    }
    this.scopeFingerprint = scope;
    this.indexingEnabled = enabled;
    this.pendingScopeReset ||= scopeChanged;
    this.pendingEnabledChange ||= enabledChanged;
    this.pendingPaths.clear();
    this.cancelScheduledFlush();
    this.cancelScopeTimer();
    this.scopeTimer = globalThis.setTimeout(() => {
      this.scopeTimer = null;
      void this.enqueue(() => this.applyPendingSettingsChange()).catch(() => undefined);
    }, Math.max(0, delayMs));
  }

  async setEmbeddingClient(
    client: EmbeddingClient | null,
    clearVectors = false
  ): Promise<void> {
    await this.enqueue(async () => {
      const previous = this.embeddingClient;
      this.embeddingClient = client;
      if (previous !== client) {
        previous?.dispose();
      }
      const modelChanged = client !== null
        && !modelsEqual(this.model, client.descriptor);
      if (clearVectors || modelChanged) {
        this.vectors.clear();
        this.model = client?.descriptor ?? null;
      }
      if (!this.opened || !this.indexingEnabled) {
        this.updateReadyStatus();
        return;
      }
      if (client !== null) {
        await this.embedMissingChunks(this.lifecycle.signal);
      }
      if (clearVectors || modelChanged || client !== null) {
        await this.persistCurrentGeneration();
      }
      this.updateReadyStatus();
    });
  }

  async searchSemantic(
    query: Float32Array,
    sourcePath: string,
    limit: number,
    signal: AbortSignal
  ): Promise<SemanticMatch[]> {
    if (
      this.model === null
      || query.length !== this.model.dimensions
      || limit < 1
      || signal.aborted
    ) {
      return [];
    }
    const scored = this.searchWorker.available
      ? await this.searchWorkerMatches(query, sourcePath, signal)
      : topDotProducts(query, this.semanticCandidates(sourcePath), 40);
    return groupMatches(scored, limit);
  }

  async rebuild(): Promise<void> {
    await this.enqueue(() => this.rebuildInternal());
  }

  async deleteIndex(): Promise<void> {
    await this.enqueue(async () => {
      this.updateStatus("deleting", "Deleting the local semantic index.");
      this.clearMemory();
      await this.store.delete();
      this.loadSnapshot(await this.store.open());
      this.updateReadyStatus("The local semantic index was deleted.");
    });
  }

  async flush(): Promise<void> {
    this.cancelScheduledFlush();
    if (this.scopeTimer !== null) {
      this.cancelScopeTimer();
      await this.enqueue(() => this.applyPendingSettingsChange());
    }
    await this.operation;
    if (this.pendingPaths.size > 0) {
      await this.flushPending();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.lifecycle.abort();
    this.cancelScheduledFlush();
    this.cancelScopeTimer();
    this.pendingPaths.clear();
    this.listeners.clear();
    this.embeddingClient?.dispose();
    this.embeddingClient = null;
    this.searchWorker.dispose();
    this.clearMemory(false);
    this.status = createStatus("closed", "Index is closed.");
  }

  private async searchWorkerMatches(
    query: Float32Array,
    sourcePath: string,
    signal: AbortSignal
  ): Promise<ScoredSemanticCandidate[]> {
    const excluded = this.searchDocumentOrdinals.get(sourcePath) ?? -1;
    const results = await this.searchWorker.search(query, excluded, 40, signal);
    return results.flatMap(({ row, score }) => {
      const value = this.searchEntries[row];
      return value === undefined ? [] : [{ value, score }];
    });
  }

  private *semanticCandidates(sourcePath: string): Iterable<{
    value: SemanticCandidate;
    vector: Float32Array;
  }> {
    for (const [chunkId, vector] of this.vectors) {
      const chunk = this.chunks.get(chunkId);
      const document = chunk === undefined
        ? undefined
        : this.documentsById.get(chunk.documentId);
      if (
        chunk !== undefined
        && document !== undefined
        && document.path !== sourcePath
      ) {
        yield { value: { chunk, document }, vector };
      }
    }
  }

  private refreshSearchIndex(): void {
    const dimensions = this.model?.dimensions ?? 0;
    if (dimensions < 1) {
      this.searchEntries = [];
      this.searchDocumentOrdinals.clear();
      this.searchWorker.update(new Float32Array(), new Int32Array(), 0);
      return;
    }

    const entries: SemanticCandidate[] = [];
    const vectorRows: Float32Array[] = [];
    const documentRows: number[] = [];
    const documentOrdinals = new Map<string, number>();

    for (const [chunkId, vector] of this.vectors) {
      const chunk = this.chunks.get(chunkId);
      const document = chunk === undefined
        ? undefined
        : this.documentsById.get(chunk.documentId);
      if (
        chunk === undefined
        || document === undefined
        || vector.length !== dimensions
      ) {
        continue;
      }
      let ordinal = documentOrdinals.get(document.path);
      if (ordinal === undefined) {
        ordinal = documentOrdinals.size;
        documentOrdinals.set(document.path, ordinal);
      }
      entries.push({ chunk, document });
      vectorRows.push(vector);
      documentRows.push(ordinal);
    }

    const matrix = new Float32Array(vectorRows.length * dimensions);
    vectorRows.forEach((vector, row) => {
      matrix.set(vector, row * dimensions);
    });
    this.searchEntries = entries;
    this.searchDocumentOrdinals = documentOrdinals;
    this.searchWorker.update(matrix, new Int32Array(documentRows), dimensions);
  }

  private async applyPendingSettingsChange(): Promise<void> {
    const scopeChanged = this.pendingScopeReset;
    const enabledChanged = this.pendingEnabledChange;
    this.pendingScopeReset = false;
    this.pendingEnabledChange = false;
    if (!this.opened) {
      return;
    }
    if (scopeChanged) {
      if (this.indexingEnabled) {
        await this.rebuildInternal();
      } else {
        this.clearMemory();
        await this.store.delete();
        this.loadSnapshot(await this.store.open());
        this.updateReadyStatus("The stored index was cleared because its exclusion scope changed while indexing was disabled.");
      }
    } else if (enabledChanged && this.indexingEnabled) {
      await this.rebuildInternal();
    } else {
      this.updateReadyStatus();
    }
  }

  private async rebuildInternal(): Promise<void> {
    if (!this.canIndex()) {
      this.updateReadyStatus();
      return;
    }
    const files = this.sortedMarkdownFiles();
    const livePaths = new Set(files.map((file) => file.path));
    for (const path of [...this.documents.keys()]) {
      if (!livePaths.has(path)) {
        this.removeFromMemory(path);
      }
    }
    await this.processFiles(files, true, "Rebuilding the semantic index", true);
  }

  private sortedMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles()
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private scheduleFlush(delayMs: number): void {
    this.cancelScheduledFlush();
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending().catch(() => undefined);
    }, Math.max(0, delayMs));
  }

  private async flushPending(): Promise<void> {
    const paths = [...this.pendingPaths];
    this.pendingPaths.clear();
    await this.enqueue(async () => {
      if (!this.canIndex()) {
        this.updateReadyStatus();
        return;
      }
      const files: TFile[] = [];
      let changed = false;
      for (const path of paths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (isMarkdownFile(file)) {
          files.push(file);
        } else {
          changed = this.removeFromMemory(path) || changed;
        }
      }
      files.sort((left, right) => left.path.localeCompare(right.path));
      await this.processFiles(files, changed, "Updating changed notes");
    });
  }

  private async processFiles(
    files: readonly TFile[],
    changedBeforeRead: boolean,
    message: string,
    replaceUnchanged = false
  ): Promise<void> {
    const signal = this.lifecycle.signal;
    let changed = changedBeforeRead;
    let processed = 0;
    this.updateStatus("indexing", message, {
      totalCount: files.length,
      processedCount: 0,
      queuedCount: files.length
    });

    for (const file of files) {
      if (this.shouldStop()) {
        return;
      }
      const previous = this.documents.get(file.path);
      const result = await parseIndexDocument(
        this.app,
        file,
        this.getSettings(),
        previous?.id
      );
      if (this.shouldStop()) {
        return;
      }
      processed += 1;
      if (result === null) {
        changed = this.removeFromMemory(file.path) || changed;
      } else if (result !== undefined) {
        if (
          !replaceUnchanged
          && canReuseDocument(previous, result.document.contentHash)
        ) {
          previous.modifiedAt = result.document.modifiedAt;
          changed = true;
        } else {
          this.replaceDocument(result);
          changed = true;
        }
      }
      this.updateStatus("indexing", message, {
        totalCount: files.length,
        processedCount: processed,
        queuedCount: files.length - processed
      });
      if (processed % 20 === 0) {
        await yieldToEventLoop();
      }
    }

    await this.embedMissingChunks(signal);
    if (changed) {
      await this.persistCurrentGeneration();
    }
    this.updateReadyStatus();
  }

  private async embedMissingChunks(signal: AbortSignal): Promise<void> {
    const client = this.embeddingClient;
    if (client === null || this.shouldStop()) {
      return;
    }
    const inputs = [...this.chunks.values()]
      .filter((chunk) => !this.vectors.has(chunk.id))
      .map((chunk) => ({ id: chunk.id, text: chunk.embeddingText }));
    if (inputs.length === 0) {
      this.model = client.descriptor;
      return;
    }
    const result = await new EmbeddingBatcher(client).embed(
      inputs,
      signal,
      (completed, total) => {
        this.updateStatus("indexing", `Embedding passages ${completed}/${total}`);
      }
    );
    this.model = client.descriptor;
    for (const [id, vector] of result.vectorsById) {
      this.vectors.set(id, vector);
    }
  }

  private replaceDocument(parsed: ParsedIndexDocument): void {
    const previous = this.documents.get(parsed.document.path);
    for (const id of findRemovedChunkIds(previous, parsed.document.chunkIds)) {
      this.chunks.delete(id);
      this.vectors.delete(id);
    }
    if (previous !== undefined && previous.id !== parsed.document.id) {
      this.documentsById.delete(previous.id);
    }
    this.documents.set(parsed.document.path, parsed.document);
    this.documentsById.set(parsed.document.id, parsed.document);
    for (const chunk of parsed.chunks) {
      this.chunks.set(chunk.id, chunk);
    }
  }

  private removeFromMemory(path: string): boolean {
    const document = this.documents.get(path);
    if (document === undefined) {
      return false;
    }
    this.documents.delete(path);
    this.documentsById.delete(document.id);
    for (const id of document.chunkIds) {
      this.chunks.delete(id);
      this.vectors.delete(id);
    }
    return true;
  }

  private async persistCurrentGeneration(): Promise<void> {
    const written = await this.store.write(this.createSnapshot(Date.now()));
    this.generation = written.manifest.generation;
    this.lastCompletedAt = written.manifest.lastCompletedAt;
    this.refreshSearchIndex();
  }

  private createSnapshot(completedAt: number): IndexSnapshot {
    const model = this.embeddingClient?.descriptor ?? this.model;
    const dimensions = model?.dimensions ?? 0;
    const chunks = [...this.chunks.values()]
      .sort((left, right) => left.id.localeCompare(right.id));
    const vectorCount = dimensions === 0
      ? 0
      : chunks.reduce((count, chunk) => {
          return count + (this.vectors.has(chunk.id) ? 1 : 0);
        }, 0);
    const vectors = new Float32Array(vectorCount * dimensions);
    let vectorRow = 0;
    const storedChunks = chunks.map((chunk) => {
      const vector = this.vectors.get(chunk.id);
      if (vector === undefined || dimensions === 0) {
        return { ...chunk, vectorRow: -1 };
      }
      vectors.set(vector, vectorRow * dimensions);
      return { ...chunk, vectorRow: vectorRow++ };
    });
    return {
      manifest: {
        ...createEmptyIndexManifest(
          this.pluginVersion,
          this.vaultFingerprint,
          this.scopeFingerprint
        ),
        model,
        dimensions,
        vectorCount: vectorRow,
        lastCompletedAt: completedAt,
        generation: this.generation + 1
      },
      documents: [...this.documents.values()],
      chunks: storedChunks,
      vectors
    };
  }

  private loadSnapshot(snapshot: IndexSnapshot): void {
    this.clearMemory();
    this.generation = snapshot.manifest.generation;
    this.lastCompletedAt = snapshot.manifest.lastCompletedAt;
    this.model = snapshot.manifest.model;
    for (const document of snapshot.documents) {
      this.documents.set(document.path, document);
      this.documentsById.set(document.id, document);
    }
    const dimensions = snapshot.manifest.dimensions;
    for (const chunk of snapshot.chunks) {
      this.chunks.set(chunk.id, chunk);
      if (chunk.vectorRow >= 0 && dimensions > 0) {
        const start = chunk.vectorRow * dimensions;
        this.vectors.set(
          chunk.id,
          snapshot.vectors.slice(start, start + dimensions)
        );
      }
    }
    this.refreshSearchIndex();
  }

  private clearMemory(refreshWorker = true): void {
    this.documents.clear();
    this.documentsById.clear();
    this.chunks.clear();
    this.vectors.clear();
    this.searchEntries = [];
    this.searchDocumentOrdinals.clear();
    this.generation = 0;
    this.lastCompletedAt = null;
    this.model = null;
    if (refreshWorker) {
      this.searchWorker.update(new Float32Array(), new Int32Array(), 0);
    }
  }

  private canIndex(): boolean {
    return this.opened && !this.disposed && this.indexingEnabled;
  }

  private shouldStop(): boolean {
    return this.disposed || this.lifecycle.signal.aborted || !this.indexingEnabled;
  }

  private isCompatible(snapshot: IndexSnapshot): boolean {
    return snapshot.manifest.vaultFingerprint === this.vaultFingerprint
      && snapshot.manifest.scopeFingerprint === this.scopeFingerprint
      && (
        this.embeddingClient === null
        || snapshot.manifest.model === null
        || modelsEqual(snapshot.manifest.model, this.embeddingClient.descriptor)
      );
  }

  private updateReadyStatus(message?: string): void {
    if (!this.opened) {
      this.updateStatus("closed", message ?? "Index is closed.");
      return;
    }
    if (!this.indexingEnabled) {
      this.updateStatus(
        "paused",
        message ?? "Semantic indexing is disabled. Lexical suggestions remain available.",
        resetProgress()
      );
      return;
    }
    const vectorMessage = this.embeddingClient === null
      ? "Passages are ready; install or load the local model to create vectors."
      : `${this.vectors.size} passage vectors are ready.`;
    this.updateStatus("ready", message ?? vectorMessage, {
      ...resetProgress(),
      lastCompletedAt: this.lastCompletedAt
    });
  }

  private updateStatus(
    phase: IndexStatus["phase"],
    message: string,
    patch: Partial<IndexStatus> = {}
  ): void {
    this.status = {
      ...this.status,
      phase,
      message,
      documentCount: this.documents.size,
      chunkCount: this.chunks.size,
      vectorCount: this.vectors.size,
      ...patch
    };
    for (const listener of this.listeners) {
      listener(this.currentStatus);
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = async (): Promise<void> => {
      if (!this.disposed) {
        try {
          await task();
        } catch (error) {
          this.updateStatus(
            "error",
            error instanceof Error
              ? error.message
              : "Semantic index operation failed."
          );
          throw error;
        }
      }
    };
    this.operation = this.operation.then(run, run);
    return this.operation;
  }

  private cancelScheduledFlush(): void {
    if (this.flushTimer !== null) {
      globalThis.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private cancelScopeTimer(): void {
    if (this.scopeTimer !== null) {
      globalThis.clearTimeout(this.scopeTimer);
      this.scopeTimer = null;
    }
  }
}

function groupMatches(
  candidates: readonly ScoredSemanticCandidate[],
  limit: number
): SemanticMatch[] {
  const grouped = new Map<string, SemanticMatch>();
  for (const { value, score } of candidates) {
    const heading = value.chunk.headingPath.at(-1) ?? null;
    const key = `${value.document.path}\u0000${heading ?? ""}`;
    const existing = grouped.get(key);
    if (existing === undefined || score > existing.similarity) {
      grouped.set(key, {
        targetPath: value.document.path,
        targetTitle: value.document.title,
        targetHeading: heading,
        similarity: score,
        preview: value.chunk.textPreview
      });
    }
  }
  return [...grouped.values()]
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit);
}

function createStatus(phase: IndexStatus["phase"], message: string): IndexStatus {
  return {
    phase,
    documentCount: 0,
    chunkCount: 0,
    vectorCount: 0,
    queuedCount: 0,
    processedCount: 0,
    totalCount: 0,
    message,
    lastCompletedAt: null
  };
}

function resetProgress(): Pick<IndexStatus, "queuedCount" | "processedCount" | "totalCount"> {
  return { queuedCount: 0, processedCount: 0, totalCount: 0 };
}

function modelsEqual(left: ModelDescriptor | null, right: ModelDescriptor): boolean {
  return left !== null
    && left.id === right.id
    && left.revision === right.revision
    && left.quantization === right.quantization
    && left.dimensions === right.dimensions
    && left.tokenizerVersion === right.tokenizerVersion
    && left.runtimeVersion === right.runtimeVersion;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
