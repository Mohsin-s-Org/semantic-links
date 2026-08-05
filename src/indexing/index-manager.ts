import type { App, TFile } from "obsidian";
import { isMarkdownFile } from "../lexical/vault-index.ts";
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

export class PersistentIndexManager {
  private readonly app: App;
  private readonly store: PersistentIndexStore;
  private readonly pluginVersion: string;
  private readonly vaultFingerprint: string;
  private readonly getSettings: () => SemanticLinksSettings;
  private readonly embeddingClient: EmbeddingClient | null;
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly chunks = new Map<string, IndexedChunk>();
  private readonly vectors = new Map<string, Float32Array>();
  private readonly pendingPaths = new Set<string>();
  private readonly listeners = new Set<StatusListener>();
  private readonly lifecycle = new AbortController();
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
  private opened = false;
  private disposed = false;
  private status: IndexStatus = createStatus("closed", "Index is closed.");

  constructor(
    app: App,
    store: PersistentIndexStore,
    pluginVersion: string,
    vaultFingerprint: string,
    getSettings: () => SemanticLinksSettings,
    embeddingClient: EmbeddingClient | null = null
  ) {
    this.app = app;
    this.store = store;
    this.pluginVersion = pluginVersion;
    this.vaultFingerprint = vaultFingerprint;
    this.getSettings = getSettings;
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
    return () => {
      this.listeners.delete(listener);
    };
  }

  async open(): Promise<void> {
    await this.enqueue(async () => {
      if (this.disposed || this.opened) {
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
      const files = this.app.vault.getMarkdownFiles()
        .sort((left, right) => left.path.localeCompare(right.path));
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
    if (this.disposed || !this.opened || !isMarkdownFile(file)) {
      return;
    }
    this.pendingPaths.add(file.path);
    this.scheduleFlush(delayMs);
  }

  scheduleRemove(path: string, delayMs = 50): void {
    if (this.disposed || !this.opened) {
      return;
    }
    this.pendingPaths.delete(path);
    void this.enqueue(async () => {
      if (this.removeFromMemory(path)) {
        await this.persistCurrentGeneration();
      }
      this.updateReadyStatus();
    }, delayMs);
  }

  scheduleScopeRebuild(delayMs = 500): void {
    if (this.disposed) {
      return;
    }
    const settings = this.getSettings();
    const nextScope = createIndexScopeFingerprint(settings);
    const nextEnabled = settings.semanticIndexingEnabled;
    const scopeChanged = nextScope !== this.scopeFingerprint;
    const enabledChanged = nextEnabled !== this.indexingEnabled;
    if (!scopeChanged && !enabledChanged) {
      return;
    }

    this.scopeFingerprint = nextScope;
    this.indexingEnabled = nextEnabled;
    this.pendingScopeReset = this.pendingScopeReset || scopeChanged;
    this.pendingEnabledChange = this.pendingEnabledChange || enabledChanged;
    this.pendingPaths.clear();
    this.cancelScheduledFlush();
    this.cancelScopeTimer();
    this.scopeTimer = globalThis.setTimeout(() => {
      this.scopeTimer = null;
      void this.enqueue(() => this.applyPendingSettingsChange());
    }, Math.max(0, delayMs));
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
    this.clearMemory();
    this.status = createStatus("closed", "Index is closed.");
  }

  private async applyPendingSettingsChange(): Promise<void> {
    const scopeChanged = this.pendingScopeReset;
    const enabledChanged = this.pendingEnabledChange;
    this.pendingScopeReset = false;
    this.pendingEnabledChange = false;
    if (!this.opened || this.disposed) {
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
      return;
    }
    if (enabledChanged && this.indexingEnabled) {
      await this.rebuildInternal();
      return;
    }
    this.updateReadyStatus();
  }

  private async rebuildInternal(): Promise<void> {
    if (!this.opened || this.disposed) {
      return;
    }
    this.clearMemory();
    if (!this.indexingEnabled) {
      this.updateReadyStatus();
      return;
    }
    const files = this.app.vault.getMarkdownFiles()
      .sort((left, right) => left.path.localeCompare(right.path));
    await this.processFiles(files, true, "Rebuilding the semantic index");
  }

  private scheduleFlush(delayMs: number): void {
    this.cancelScheduledFlush();
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending();
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
      await this.processFiles(files, changed, "Updating changed notes");
    });
  }

  private async processFiles(
    files: readonly TFile[],
    changedBeforeRead: boolean,
    message: string
  ): Promise<void> {
    const signal = this.lifecycle.signal;
    const parsed: ParsedIndexDocument[] = [];
    let changed = changedBeforeRead;
    let processed = 0;
    this.updateStatus("indexing", message, {
      totalCount: files.length,
      processedCount: 0,
      queuedCount: files.length
    });

    for (const file of files) {
      if (signal.aborted || this.disposed) {
        return;
      }
      const result = await parseIndexDocument(this.app, file, this.getSettings());
      processed += 1;
      if (result === null) {
        changed = this.removeFromMemory(file.path) || changed;
      } else if (result !== undefined) {
        const previous = this.documents.get(file.path);
        if (canReuseDocument(previous, result.document.contentHash)) {
          this.documents.set(file.path, {
            ...previous,
            modifiedAt: result.document.modifiedAt
          });
          changed = previous.modifiedAt !== result.document.modifiedAt || changed;
        } else {
          this.replaceDocument(result);
          parsed.push(result);
          changed = true;
        }
      }
      this.updateStatus("indexing", message, {
        totalCount: files.length,
        processedCount: processed,
        queuedCount: Math.max(0, files.length - processed)
      });
      if (processed % 20 === 0) {
        await yieldToEventLoop();
      }
    }

    await this.embedNewChunks(parsed, signal);
    if (changed) {
      await this.persistCurrentGeneration();
    }
    this.updateReadyStatus();
  }

  private async embedNewChunks(
    parsed: readonly ParsedIndexDocument[],
    signal: AbortSignal
  ): Promise<void> {
    if (this.embeddingClient === null) {
      return;
    }
    const inputs = parsed.flatMap(({ chunks }) => chunks
      .filter((chunk) => !this.vectors.has(chunk.id))
      .map((chunk) => ({ id: chunk.id, text: chunk.embeddingText })));
    if (inputs.length === 0) {
      return;
    }
    const result = await new EmbeddingBatcher(this.embeddingClient).embed(
      inputs,
      signal,
      (completed, total) => {
        this.updateStatus("indexing", `Embedding passages ${completed}/${total}`);
      }
    );
    this.model = this.embeddingClient.descriptor;
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
    this.documents.set(parsed.document.path, parsed.document);
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
    for (const id of document.chunkIds) {
      this.chunks.delete(id);
      this.vectors.delete(id);
    }
    return true;
  }

  private async persistCurrentGeneration(): Promise<void> {
    const completedAt = Date.now();
    const written = await this.store.write(this.createSnapshot(completedAt));
    this.generation = written.manifest.generation;
    this.lastCompletedAt = written.manifest.lastCompletedAt;
  }

  private createSnapshot(completedAt: number): IndexSnapshot {
    const model = this.embeddingClient?.descriptor ?? this.model;
    const dimensions = model?.dimensions ?? 0;
    const chunks = [...this.chunks.values()]
      .sort((left, right) => left.id.localeCompare(right.id));
    const rows: number[] = [];
    let vectorRow = 0;
    const storedChunks = chunks.map((chunk) => {
      const vector = this.vectors.get(chunk.id);
      if (vector === undefined || dimensions === 0) {
        return { ...chunk, vectorRow: -1 };
      }
      rows.push(...vector);
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
      vectors: new Float32Array(rows)
    };
  }

  private loadSnapshot(snapshot: IndexSnapshot): void {
    this.clearMemory();
    this.generation = snapshot.manifest.generation;
    this.lastCompletedAt = snapshot.manifest.lastCompletedAt;
    this.model = snapshot.manifest.model;
    for (const document of snapshot.documents) {
      this.documents.set(document.path, document);
    }
    const dimensions = snapshot.manifest.dimensions;
    for (const chunk of snapshot.chunks) {
      this.chunks.set(chunk.id, chunk);
      if (chunk.vectorRow >= 0 && dimensions > 0) {
        const start = chunk.vectorRow * dimensions;
        this.vectors.set(chunk.id, snapshot.vectors.slice(start, start + dimensions));
      }
    }
  }

  private clearMemory(): void {
    this.documents.clear();
    this.chunks.clear();
    this.vectors.clear();
    this.generation = 0;
    this.lastCompletedAt = null;
    this.model = null;
  }

  private canIndex(): boolean {
    return this.opened && !this.disposed && this.indexingEnabled;
  }

  private isCompatible(snapshot: IndexSnapshot): boolean {
    return snapshot.manifest.vaultFingerprint === this.vaultFingerprint
      && snapshot.manifest.scopeFingerprint === this.scopeFingerprint
      && (
        this.embeddingClient === null
        || modelsEqual(snapshot.manifest.model, this.embeddingClient.descriptor)
      );
  }

  private updateReadyStatus(message?: string): void {
    if (!this.opened) {
      this.updateStatus("closed", message ?? "Index is closed.");
      return;
    }
    if (!this.indexingEnabled) {
      this.updateStatus("paused", message ?? "Semantic indexing is disabled. Lexical suggestions remain available.");
      return;
    }
    const vectorMessage = this.embeddingClient === null
      ? this.vectors.size > 0
        ? `${this.vectors.size} stored passage vectors are available; the local model runtime is not loaded.`
        : "Passages are stored; vectors await the consent-based local model runtime."
      : `${this.vectors.size} passage vectors are ready.`;
    this.updateStatus("ready", message ?? vectorMessage, {
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

  private enqueue(task: () => Promise<void>, delayMs = 0): Promise<void> {
    const run = async (): Promise<void> => {
      if (delayMs > 0) {
        await delay(delayMs);
      }
      if (!this.disposed) {
        try {
          await task();
        } catch (error) {
          this.updateStatus("error", error instanceof Error ? error.message : "Semantic index operation failed.");
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

function modelsEqual(
  left: EmbeddingClient["descriptor"] | null,
  right: EmbeddingClient["descriptor"]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function yieldToEventLoop(): Promise<void> {
  return delay(0);
}
