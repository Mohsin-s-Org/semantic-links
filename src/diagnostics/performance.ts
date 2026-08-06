export interface DistributionSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface PerformanceBudgets {
  warmQueryP95Ms: number;
  eventLoopDelayP95Ms: number;
  longTaskMs: number;
  backgroundSliceP95Ms: number;
  checkpointP95Ms: number;
  modelAndIndexMemoryMb: number;
}

export interface SemanticDiagnosticsReport {
  schemaVersion: 1;
  startedAt: string | null;
  generatedAt: string;
  elapsedMs: number;
  samples: Record<string, DistributionSummary>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  budgets: PerformanceBudgets;
}

export const DEFAULT_PERFORMANCE_BUDGETS: Readonly<PerformanceBudgets> = Object.freeze({
  warmQueryP95Ms: 200,
  eventLoopDelayP95Ms: 16,
  longTaskMs: 50,
  backgroundSliceP95Ms: 100,
  checkpointP95Ms: 250,
  modelAndIndexMemoryMb: 512
});

const EVENT_LOOP_INTERVAL_MS = 250;
const MAX_SAMPLES_PER_METRIC = 2_048;
const METRIC_NAME = /^[a-z][a-z0-9_.-]*$/u;

type TimerHandle = ReturnType<typeof globalThis.setInterval>;

export class SemanticDiagnostics {
  private readonly samples = new Map<string, number[]>();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private enabledValue = false;
  private startedAtEpoch: number | null = null;
  private startedAtMonotonic = 0;
  private eventLoopTimer: TimerHandle | null = null;
  private nextEventLoopTick = 0;

  get enabled(): boolean {
    return this.enabledValue;
  }

  start(): void {
    this.reset();
    this.enabledValue = true;
    this.startedAtEpoch = Date.now();
    this.startedAtMonotonic = monotonicNow();
    this.captureMemory("start");
    this.startEventLoopProbe();
  }

  stop(): SemanticDiagnosticsReport {
    if (this.enabledValue) {
      this.captureMemory("stop");
    }
    const report = this.report();
    this.enabledValue = false;
    this.stopEventLoopProbe();
    return report;
  }

  reset(): void {
    this.stopEventLoopProbe();
    this.samples.clear();
    this.counters.clear();
    this.gauges.clear();
    this.startedAtEpoch = null;
    this.startedAtMonotonic = 0;
  }

  startSpan(name: string): () => void {
    if (!this.enabledValue) {
      return () => undefined;
    }
    validateMetricName(name);
    const started = monotonicNow();
    let finished = false;
    return () => {
      if (finished) {
        return;
      }
      finished = true;
      this.record(name, monotonicNow() - started);
    };
  }

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const finish = this.startSpan(name);
    try {
      return await operation();
    } finally {
      finish();
    }
  }

  measureSync<T>(name: string, operation: () => T): T {
    const finish = this.startSpan(name);
    try {
      return operation();
    } finally {
      finish();
    }
  }

  record(name: string, value: number): void {
    if (!this.enabledValue || !Number.isFinite(value) || value < 0) {
      return;
    }
    validateMetricName(name);
    const values = this.samples.get(name) ?? [];
    values.push(value);
    if (values.length > MAX_SAMPLES_PER_METRIC) {
      values.splice(0, values.length - MAX_SAMPLES_PER_METRIC);
      this.increment("diagnostics.sample_evictions");
    }
    this.samples.set(name, values);
  }

  increment(name: string, amount = 1): void {
    if (!this.enabledValue || !Number.isFinite(amount)) {
      return;
    }
    validateMetricName(name);
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  setGauge(name: string, value: number): void {
    if (!this.enabledValue || !Number.isFinite(value)) {
      return;
    }
    validateMetricName(name);
    this.gauges.set(name, value);
  }

  captureMemory(label: "start" | "warm" | "stop" | "unload" | "reload"): void {
    if (!this.enabledValue) {
      return;
    }
    const memory = readMemoryUsage();
    for (const [name, bytes] of Object.entries(memory)) {
      this.setGauge(`memory.${label}.${name}_bytes`, bytes);
    }
  }

  report(): SemanticDiagnosticsReport {
    const generatedAtEpoch = Date.now();
    const elapsedMs = this.startedAtEpoch === null
      ? 0
      : Math.max(0, monotonicNow() - this.startedAtMonotonic);
    const samples: Record<string, DistributionSummary> = {};
    for (const [name, values] of [...this.samples].sort(([left], [right]) => left.localeCompare(right))) {
      samples[name] = summarizeDistribution(values);
    }
    return {
      schemaVersion: 1,
      startedAt: this.startedAtEpoch === null
        ? null
        : new Date(this.startedAtEpoch).toISOString(),
      generatedAt: new Date(generatedAtEpoch).toISOString(),
      elapsedMs: round(elapsedMs),
      samples,
      counters: sortedRecord(this.counters),
      gauges: sortedRecord(this.gauges),
      budgets: { ...DEFAULT_PERFORMANCE_BUDGETS }
    };
  }

  private startEventLoopProbe(): void {
    this.stopEventLoopProbe();
    this.nextEventLoopTick = monotonicNow() + EVENT_LOOP_INTERVAL_MS;
    this.eventLoopTimer = globalThis.setInterval(() => {
      const now = monotonicNow();
      const delay = Math.max(0, now - this.nextEventLoopTick);
      this.record("event_loop.delay_ms", delay);
      if (delay >= DEFAULT_PERFORMANCE_BUDGETS.longTaskMs) {
        this.record("event_loop.long_task_ms", delay);
        this.increment("event_loop.long_task_count");
      }
      this.nextEventLoopTick = now + EVENT_LOOP_INTERVAL_MS;
    }, EVENT_LOOP_INTERVAL_MS);
  }

  private stopEventLoopProbe(): void {
    if (this.eventLoopTimer !== null) {
      globalThis.clearInterval(this.eventLoopTimer);
      this.eventLoopTimer = null;
    }
  }
}

export const semanticDiagnostics = new SemanticDiagnostics();

export function summarizeDistribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min: round(sorted[0] ?? 0),
    max: round(sorted.at(-1) ?? 0),
    mean: round(total / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99))
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function sortedRecord(values: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...values].sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, round(value)])
  );
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

function readMemoryUsage(): Record<string, number> {
  const result: Record<string, number> = {};
  const performanceMemory = (globalThis.performance as Performance & {
    memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
  }).memory;
  if (performanceMemory !== undefined) {
    copyFinite(result, "js_heap_used", performanceMemory.usedJSHeapSize);
    copyFinite(result, "js_heap_total", performanceMemory.totalJSHeapSize);
    copyFinite(result, "js_heap_limit", performanceMemory.jsHeapSizeLimit);
  }

  const processLike = (globalThis as { process?: {
    memoryUsage?: () => Record<string, unknown>;
  } }).process;
  const processMemory = processLike?.memoryUsage?.();
  if (processMemory !== undefined) {
    for (const [name, value] of Object.entries(processMemory)) {
      copyFinite(result, `process_${normalizeName(name)}`, value);
    }
  }
  return result;
}

function copyFinite(destination: Record<string, number>, name: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    destination[name] = value;
  }
}

function normalizeName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
}

function validateMetricName(name: string): void {
  if (!METRIC_NAME.test(name)) {
    throw new Error(`Invalid semantic diagnostics metric name: ${name}`);
  }
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
