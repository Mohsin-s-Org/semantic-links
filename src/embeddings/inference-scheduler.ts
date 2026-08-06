import { semanticDiagnostics } from "../diagnostics/performance.ts";

type Task<T> = () => Promise<T>;

interface QueueEntry<T> {
  priority: number;
  enqueuedAt: number;
  task: Task<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export class InferenceScheduler {
  private readonly queue: Array<QueueEntry<unknown>> = [];
  private running = false;

  run<T>(priority: number, task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        priority,
        enqueuedAt: monotonicNow(),
        task,
        resolve: (value) => resolve(value as T),
        reject
      });
      this.queue.sort((left, right) => left.priority - right.priority);
      semanticDiagnostics.setGauge("inference.queue_depth", this.queue.length);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift();
        if (entry === undefined) {
          break;
        }
        semanticDiagnostics.setGauge("inference.queue_depth", this.queue.length);
        const lane = entry.priority === 0 ? "query" : "background";
        semanticDiagnostics.record(
          `inference.${lane}_queue_wait_ms`,
          Math.max(0, monotonicNow() - entry.enqueuedAt)
        );
        const finish = semanticDiagnostics.startSpan(`inference.${lane}_task_ms`);
        try {
          entry.resolve(await entry.task());
        } catch (error) {
          entry.reject(error);
        } finally {
          finish();
        }
      }
    } finally {
      this.running = false;
      semanticDiagnostics.setGauge("inference.queue_depth", this.queue.length);
    }
  }
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}
