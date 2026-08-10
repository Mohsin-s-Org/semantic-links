import assert from "node:assert/strict";
import test from "node:test";
import { InferenceScheduler } from "../../src/embeddings/inference-scheduler.ts";

test("runs a live query before queued background work and exposes its state", async () => {
  const scheduler = new InferenceScheduler();
  const order: string[] = [];
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = scheduler.run(1, async () => {
    order.push("first-background");
    assert.equal(scheduler.hasPriority(1), true);
    await gate;
  });
  const second = scheduler.run(1, () => {
    order.push("second-background");
    return Promise.resolve();
  });
  const query = scheduler.run(0, () => {
    order.push("query");
    assert.equal(scheduler.hasPriority(0), true);
    return Promise.resolve();
  });

  assert.equal(scheduler.hasPriority(0), true);
  assert.equal(scheduler.hasPriority(1), true);
  release();
  await Promise.all([first, second, query]);
  assert.deepEqual(order, ["first-background", "query", "second-background"]);
  assert.equal(scheduler.hasPriority(0), false);
  assert.equal(scheduler.hasPriority(1), false);
});
