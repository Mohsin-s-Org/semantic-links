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

export interface ControllerStateSnapshot {
  latestRequestId: number;
  scheduledKey: string | null;
  pendingKeys: string[];
  suppressedUntil: number;
  composing: boolean;
  applyingPluginTransaction: boolean;
  visibleContextHash: string | null;
  disposed: boolean;
}

const browserScheduler: ControllerScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle)
};

export class EditorSuggestionController {
  private latestRequestId = 0;
  private timerId: TimerHandle | null = null;
  private scheduledKey: string | null = null;
  private latestKey: string | null = null;
  private lastCompletedKey: string | null = null;
  private readonly pendingKeys = new Set<string>();
  private readonly abortControllers = new Map<number, AbortController>();
  private suppressedUntil = 0;
  private composing = false;
  private applyingPluginTransaction = false;
  private visibleContextHash: string | null = null;
  private disposed = false;

  constructor(private readonly scheduler: ControllerScheduler = browserScheduler) {}

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
    this.scheduledKey = serializedKey;
    this.timerId = this.scheduler.setTimeout(() => {
      this.timerId = null;
      this.scheduledKey = null;

      if (this.shouldSuppress()) {
        return;
      }

      this.startRequest(key, serializedKey, runner);
    }, Math.max(0, delayMs));

    return "scheduled";
  }

  acceptResult(
    ticket: SuggestionRequestTicket,
    currentKey: SuggestionRequestKey
  ): boolean {
    const currentSerializedKey = serializeRequestKey(currentKey);
    const accepted = !this.disposed
      && !ticket.signal.aborted
      && ticket.requestId === this.latestRequestId
      && ticket.serializedKey === this.latestKey
      && ticket.serializedKey === currentSerializedKey
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

    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.pendingKeys.clear();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.invalidate();
    this.disposed = true;
  }

  getSnapshot(): ControllerStateSnapshot {
    return {
      latestRequestId: this.latestRequestId,
      scheduledKey: this.scheduledKey,
      pendingKeys: [...this.pendingKeys],
      suppressedUntil: this.suppressedUntil,
      composing: this.composing,
      applyingPluginTransaction: this.applyingPluginTransaction,
      visibleContextHash: this.visibleContextHash,
      disposed: this.disposed
    };
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

  private startRequest(
    key: SuggestionRequestKey,
    serializedKey: string,
    runner: SuggestionRequestRunner
  ): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.pendingKeys.clear();

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
      void Promise.resolve(result)
        .catch(() => undefined)
        .finally(() => {
          this.finishRequest(ticket);
        });
    } catch {
      this.finishRequest(ticket);
    }
  }

  private finishRequest(ticket: SuggestionRequestTicket): void {
    this.pendingKeys.delete(ticket.serializedKey);
    this.abortControllers.delete(ticket.requestId);
    if (
      ticket.requestId === this.latestRequestId
      && ticket.serializedKey === this.latestKey
      && !ticket.signal.aborted
    ) {
      this.lastCompletedKey = ticket.serializedKey;
    }
  }
}
