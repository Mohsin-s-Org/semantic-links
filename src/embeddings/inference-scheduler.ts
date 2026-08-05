type Task<T> = () => Promise<T>;

interface QueueEntry<T> {
  priority: number;
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
        task,
        resolve: (value) => resolve(value as T),
        reject
      });
      this.queue.sort((left, right) => left.priority - right.priority);
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
        try {
          entry.resolve(await entry.task());
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
