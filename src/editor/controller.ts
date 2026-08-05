import {
  PLUGIN_TRANSACTION_SUPPRESSION_MS,
  UNDO_REDO_SUPPRESSION_MS
} from "../constants.ts";
import {
  serializeRequestKey,
  type SuggestionRequestKey
} from "./request-key.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ControllerScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface SuggestionRequestTicket {
  requestId: number;
  key: SuggestionRequestKey;
  serializedKey: string;
  signal: AbortSignal;
}

export type SuggestionRequestRunner = (
  ticket: SuggestionRequestTicket
) => void | Promise<void>;

export type ScheduleResult = "scheduled" | "duplicate" | "suppressed" | "disposed";

const browserScheduler: ControllerScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle)
};

export class EditorSuggestionController {
  private latestRequestId = 0;
  private currentDocumentVersion = 0;
  private timerId: TimerHandle | null = null;
  private scheduledKey: string | null = null;
  private latestKey: string | null = null;
  private lastCompletedKey: string | null = null;
  private readonly pendingKeys = new Set<string>();
  private readonly abortControllers = new Map<number, AbortController>();
  private readonly scheduler: ControllerScheduler;
  private suppressedUntil = 0;
  private composing = false;
  private applyingPluginTransaction = false;
  private visibleContextHash: string | null = null;
  private disposed = false;

  constructor(scheduler: ControllerScheduler = browserScheduler) {
    this.scheduler = scheduler;
  }

  get documentVersion(): number {
    return this.currentDocumentVersion;
  }

  noteDocumentChange(): void {
    this.currentDocumentVersion += 1;
  }

  schedule(
    key: SuggestionRequestKey,
    delayMs: number,
    runner: SuggestionRequestRunner
  ): ScheduleResult {
    if (this.disposed) {
      return "disposed";
    }
    if (this.shouldSuppress()) {
      return "suppressed";
    }

    const serializedKey = serializeRequestKey(key);
    if (
      this.scheduledKey === serializedKey
      || this.pendingKeys.has(serializedKey)
      || this.lastCompletedKey === serializedKey
    ) {
      return "duplicate";
    }

    this.cancelScheduledRequest();
    this.supersedeInFlightRequests();
    this.lastCompletedKey = null;
    this.scheduledKey = serializedKey;
    this.timerId = this.scheduler.setTimeout(() => {
      this.timerId = null;
      this.scheduledKey = null;
      if (!this.shouldSuppress()) {
        this.startRequest(key, serializedKey, runner);
      }
    }, Math.max(0, delayMs));

    return "scheduled";
  }

  acceptResult(
    ticket: SuggestionRequestTicket,
    currentKey: SuggestionRequestKey
  ): boolean {
    const accepted = !this.disposed
      && !ticket.signal.aborted
      && ticket.requestId === this.latestRequestId
      && ticket.serializedKey === this.latestKey
      && ticket.serializedKey === serializeRequestKey(currentKey)
      && this.pendingKeys.has(ticket.serializedKey)
      && !this.shouldSuppress();

    if (accepted) {
      this.visibleContextHash = ticket.key.contextHash;
    }
    return accepted;
  }

  hideVisibleSuggestions(): void {
    this.visibleContextHash = null;
  }

  setComposing(composing: boolean): void {
    if (this.composing === composing) {
      return;
    }

    this.composing = composing;
    if (composing) {
      this.invalidate();
    }
  }

  beginPluginTransaction(): void {
    this.applyingPluginTransaction = true;
    this.invalidate();
    this.suppressFor(PLUGIN_TRANSACTION_SUPPRESSION_MS);
  }

  endPluginTransaction(): void {
    this.applyingPluginTransaction = false;
    this.suppressFor(PLUGIN_TRANSACTION_SUPPRESSION_MS);
  }

  notePluginTransaction(): void {
    this.invalidate();
    this.suppressFor(PLUGIN_TRANSACTION_SUPPRESSION_MS);
  }

  noteUndoRedo(): void {
    this.invalidate();
    this.suppressFor(UNDO_REDO_SUPPRESSION_MS);
  }

  suppressFor(durationMs: number): void {
    this.suppressedUntil = Math.max(
      this.suppressedUntil,
      this.scheduler.now() + Math.max(0, durationMs)
    );
    this.cancelScheduledRequest();
    this.visibleContextHash = null;
  }

  invalidate(): void {
    this.latestRequestId += 1;
    this.latestKey = null;
    this.lastCompletedKey = null;
    this.visibleContextHash = null;
    this.cancelScheduledRequest();
    this.cancelInFlightRequests();
  }

  dispose(): void {
    if (!this.disposed) {
      this.invalidate();
      this.disposed = true;
    }
  }

  private shouldSuppress(): boolean {
    return this.composing
      || this.applyingPluginTransaction
      || this.scheduler.now() < this.suppressedUntil;
  }

  private cancelScheduledRequest(): void {
    if (this.timerId !== null) {
      this.scheduler.clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.scheduledKey = null;
  }

  private supersedeInFlightRequests(): void {
    if (this.abortControllers.size === 0) {
      return;
    }

    this.latestRequestId += 1;
    this.latestKey = null;
    this.cancelInFlightRequests();
  }

  private cancelInFlightRequests(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.pendingKeys.clear();
  }

  private startRequest(
    key: SuggestionRequestKey,
    serializedKey: string,
    runner: SuggestionRequestRunner
  ): void {
    const requestId = this.latestRequestId + 1;
    this.latestRequestId = requestId;
    this.latestKey = serializedKey;
    this.pendingKeys.add(serializedKey);

    const abortController = new AbortController();
    this.abortControllers.set(requestId, abortController);
    const ticket: SuggestionRequestTicket = {
      requestId,
      key,
      serializedKey,
      signal: abortController.signal
    };

    try {
      const result = runner(ticket);
      void Promise.resolve(result).then(
        () => this.finishRequest(ticket, true),
        () => this.finishRequest(ticket, false)
      );
    } catch {
      this.finishRequest(ticket, false);
    }
  }

  private finishRequest(ticket: SuggestionRequestTicket, succeeded: boolean): void {
    this.pendingKeys.delete(ticket.serializedKey);
    this.abortControllers.delete(ticket.requestId);
    if (
      succeeded
      && ticket.requestId === this.latestRequestId
      && ticket.serializedKey === this.latestKey
      && !ticket.signal.aborted
    ) {
      this.lastCompletedKey = ticket.serializedKey;
    }
  }
}
