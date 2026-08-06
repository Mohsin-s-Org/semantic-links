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
  private runningPriority: number | null = null;

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

  hasPriority(priority: number): boolean {
    return this.runningPriority === priority
      || this.queue.some((entry) => entry.priority === priority);
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
        this.runningPriority = entry.priority;
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
          this.runningPriority = null;
          finish();
        }
      }
    } finally {
      this.running = false;
      this.runningPriority = null;
      semanticDiagnostics.setGauge("inference.queue_depth", this.queue.length);
    }
  }
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}
