import {
  TFile,
  getAllTags,
  type App,
  type CachedMetadata
} from "obsidian";
import { isFileExcluded } from "../scope/exclusions.ts";
import type { SemanticLinksSettings } from "../settings/types.ts";
import { isRecord } from "../utils/validation.ts";
import { LexicalIndex } from "./index.ts";
import { stripMarkdownForLexicalIndex } from "./text.ts";
import type {
  LexicalDocumentInput,
  LexicalSearchQuery,
  LexicalSuggestion
} from "./types.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

export class LexicalVaultIndex {
  private readonly index = new LexicalIndex();
  private readonly refreshTimers = new Map<string, TimerHandle>();
  private readonly refreshVersions = new Map<string, number>();
  private rebuildTimer: TimerHandle | null = null;
  private scopeSignature: string;
  private generation = 0;
  private readyState = false;
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SemanticLinksSettings
  ) {
    this.scopeSignature = createScopeSignature(getSettings());
  }

  get ready(): boolean {
    return this.readyState && !this.disposed;
  }

  get size(): number {
    return this.index.size;
  }

  hasExactLabel(value: string): boolean {
    return this.ready && this.index.hasExactLabel(value);
  }

  search(query: LexicalSearchQuery): LexicalSuggestion[] {
    return this.ready ? this.index.search(query) : [];
  }

  async rebuild(signal?: AbortSignal): Promise<void> {
    if (this.disposed) {
      return;
    }

    const generation = this.generation + 1;
    this.generation = generation;
    this.readyState = false;
    this.clearRefreshTimers();
    this.index.clear();
    const files = this.app.vault.getMarkdownFiles()
      .sort((left, right) => left.path.localeCompare(right.path));

    for (let index = 0; index < files.length; index += 1) {
      if (this.shouldStop(generation, signal)) {
        return;
      }
      const file = files[index];
      if (file !== undefined) {
        const document = await this.readDocument(file);
        if (
          document !== null
          && document !== undefined
          && !this.shouldStop(generation, signal)
        ) {
          this.index.upsert(document);
        }
      }
      if ((index + 1) % 25 === 0) {
        await yieldToEventLoop();
      }
    }

    if (!this.shouldStop(generation, signal)) {
      this.readyState = true;
    }
  }

  scheduleRefresh(file: TFile, delayMs = 150): void {
    if (this.disposed || file.extension.toLocaleLowerCase() !== "md") {
      return;
    }

    const path = file.path;
    const version = (this.refreshVersions.get(path) ?? 0) + 1;
    this.refreshVersions.set(path, version);

    const previous = this.refreshTimers.get(path);
    if (previous !== undefined) {
      globalThis.clearTimeout(previous);
    }
    const timer = globalThis.setTimeout(() => {
      this.refreshTimers.delete(path);
      void this.refresh(file, path, version, this.generation);
    }, Math.max(0, delayMs));
    this.refreshTimers.set(path, timer);
  }

  scheduleScopeRebuild(delayMs = 500): void {
    const signature = createScopeSignature(this.getSettings());
    if (this.disposed || signature === this.scopeSignature) {
      return;
    }
    this.scopeSignature = signature;
    this.scheduleRebuild(delayMs);
  }

  remove(path: string): void {
    this.refreshVersions.set(path, (this.refreshVersions.get(path) ?? 0) + 1);
    const timer = this.refreshTimers.get(path);
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
      this.refreshTimers.delete(path);
    }
    this.index.remove(path);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.readyState = false;
    this.clearRefreshTimers();
    this.refreshVersions.clear();
    if (this.rebuildTimer !== null) {
      globalThis.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.index.clear();
  }

  private scheduleRebuild(delayMs: number): void {
    if (this.rebuildTimer !== null) {
      globalThis.clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = globalThis.setTimeout(() => {
      this.rebuildTimer = null;
      void this.rebuild();
    }, Math.max(0, delayMs));
  }

  private async refresh(
    file: TFile,
    path: string,
    version: number,
    generation: number
  ): Promise<void> {
    const document = await this.readDocument(file);
    if (
      this.shouldStop(generation)
      || file.path !== path
      || this.refreshVersions.get(path) !== version
      || document === undefined
    ) {
      return;
    }
    if (document === null) {
      this.index.remove(path);
    } else {
      this.index.upsert(document);
    }
  }

  private async readDocument(
    file: TFile
  ): Promise<LexicalDocumentInput | null | undefined> {
    if (isFileExcluded(this.app.metadataCache, file, this.getSettings())) {
      return null;
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter: unknown = cache?.frontmatter;
      const title = readFrontmatterTitle(frontmatter) ?? file.basename;
      return {
        path: file.path,
        title,
        basename: file.basename,
        aliases: readFrontmatterAliases(frontmatter),
        headings: readHeadings(cache),
        tags: cache === null ? [] : (getAllTags(cache) ?? []),
        body: stripMarkdownForLexicalIndex(content)
      };
    } catch {
      return undefined;
    }
  }

  private shouldStop(generation: number, signal?: AbortSignal): boolean {
    return this.disposed
      || generation !== this.generation
      || signal?.aborted === true;
  }

  private clearRefreshTimers(): void {
    for (const timer of this.refreshTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    this.refreshTimers.clear();
  }
}

function createScopeSignature(settings: SemanticLinksSettings): string {
  return JSON.stringify([
    [...settings.excludedFolders].sort(),
    [...settings.excludedTags].sort()
  ]);
}

function readFrontmatterTitle(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = value["title"];
  return typeof title === "string" && title.trim().length > 0
    ? title.trim()
    : null;
}

function readFrontmatterAliases(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }
  const aliases = value["aliases"] ?? value["alias"];
  if (typeof aliases === "string") {
    return aliases.trim().length > 0 ? [aliases.trim()] : [];
  }
  if (!Array.isArray(aliases)) {
    return [];
  }
  return [...new Set(aliases
    .filter((alias): alias is string => typeof alias === "string")
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0))];
}

function readHeadings(cache: CachedMetadata | null): Array<{ text: string; level: number }> {
  return (cache?.headings ?? [])
    .map((heading) => ({
      text: heading.heading.trim(),
      level: heading.level
    }))
    .filter((heading) => heading.text.length > 0);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

export function isMarkdownFile(value: unknown): value is TFile {
  return value instanceof TFile && value.extension.toLocaleLowerCase() === "md";
}
