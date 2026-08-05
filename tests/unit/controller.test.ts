import assert from "node:assert/strict";
import test from "node:test";
import {
  EditorSuggestionController,
  type ControllerScheduler,
  type SuggestionRequestTicket
} from "../../src/editor/controller.ts";
import {
  createContextHash,
  serializeRequestKey,
  type SuggestionRequestKey
} from "../../src/editor/request-key.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

interface ScheduledTask {
  handle: TimerHandle;
  dueAt: number;
  callback: () => void;
}

class FakeScheduler implements ControllerScheduler {
  private currentTime = 0;
  private nextHandle = 1;
  private readonly tasks = new Map<TimerHandle, ScheduledTask>();

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const handle = this.nextHandle as unknown as TimerHandle;
    this.nextHandle += 1;
    this.tasks.set(handle, {
      handle,
      dueAt: this.currentTime + delayMs,
      callback
    });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.tasks.delete(handle);
  }

  advanceBy(milliseconds: number): void {
    this.currentTime += milliseconds;
    const ready = [...this.tasks.values()]
      .filter((task) => task.dueAt <= this.currentTime)
      .sort((left, right) => left.dueAt - right.dueAt);
    for (const task of ready) {
      this.tasks.delete(task.handle);
      task.callback();
    }
  }

  get size(): number {
    return this.tasks.size;
  }
}

function createKey(overrides: Partial<SuggestionRequestKey> = {}): SuggestionRequestKey {
  return {
    filePath: "Notes/source.md",
    documentVersion: 1,
    anchorStart: 4,
    anchorEnd: 9,
    anchorText: "water",
    contextHash: createContextHash("some water context"),
    mode: "automatic",
    ...overrides
  };
}

test("tracks the current editor document version", () => {
  const controller = new EditorSuggestionController();

  assert.equal(controller.documentVersion, 0);
  controller.noteDocumentChange();
  controller.noteDocumentChange();
  assert.equal(controller.documentVersion, 2);

  controller.dispose();
});

test("identical transaction events schedule one request", () => {
  const scheduler = new FakeScheduler();
  const controller = new EditorSuggestionController(scheduler);
  const key = createKey();
  const tickets: SuggestionRequestTicket[] = [];

  assert.equal(controller.schedule(key, 25, (ticket) => {
    tickets.push(ticket);
  }), "scheduled");
  assert.equal(controller.schedule(key, 25, (ticket) => {
    tickets.push(ticket);
  }), "duplicate");

  scheduler.advanceBy(25);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0]?.serializedKey, serializeRequestKey(key));
});

test("a new context aborts stale work before its debounce expires", () => {
  const scheduler = new FakeScheduler();
  const controller = new EditorSuggestionController(scheduler);
  const firstKey = createKey();
  const secondKey = createKey({
    filePath: "Notes/other.md",
    documentVersion: 2,
    anchorText: "cycle",
    contextHash: createContextHash("new cycle context")
  });
  const tickets: SuggestionRequestTicket[] = [];
  const pending = new Promise<void>(() => undefined);

  controller.schedule(firstKey, 0, (ticket) => {
    tickets.push(ticket);
    return pending;
  });
  scheduler.advanceBy(0);

  assert.equal(controller.schedule(secondKey, 100, (ticket) => {
    tickets.push(ticket);
    return pending;
  }), "scheduled");
  assert.equal(tickets[0]?.signal.aborted, true);
  assert.equal(tickets.length, 1);

  scheduler.advanceBy(100);
  const secondTicket = tickets[1];
  assert.ok(secondTicket);
  assert.equal(secondTicket.signal.aborted, false);
  assert.equal(controller.acceptResult(secondTicket, secondKey), true);
});

test("failed requests can be retried for the same context", () => {
  const scheduler = new FakeScheduler();
  const controller = new EditorSuggestionController(scheduler);
  const key = createKey();

  controller.schedule(key, 0, () => {
    throw new Error("expected test failure");
  });
  scheduler.advanceBy(0);

  assert.equal(controller.schedule(key, 0, () => undefined), "scheduled");
});

test("composition and undo suppress immediate scheduling", () => {
  const scheduler = new FakeScheduler();
  const controller = new EditorSuggestionController(scheduler);
  const key = createKey();

  controller.setComposing(true);
  assert.equal(controller.schedule(key, 0, () => undefined), "suppressed");
  controller.setComposing(false);
  assert.equal(controller.schedule(key, 0, () => undefined), "scheduled");

  controller.noteUndoRedo();
  assert.equal(controller.schedule(key, 0, () => undefined), "suppressed");
  scheduler.advanceBy(500);
  assert.equal(controller.schedule(key, 0, () => undefined), "scheduled");
});

test("dispose cancels timers and prevents later requests", () => {
  const scheduler = new FakeScheduler();
  const controller = new EditorSuggestionController(scheduler);
  const key = createKey();
  let calls = 0;

  controller.schedule(key, 100, () => {
    calls += 1;
  });
  assert.equal(scheduler.size, 1);

  controller.dispose();
  scheduler.advanceBy(100);

  assert.equal(calls, 0);
  assert.equal(scheduler.size, 0);
  assert.equal(controller.schedule(key, 0, () => undefined), "disposed");
});
