import assert from "node:assert/strict";
import test from "node:test";
import { CoalescedCheckpointState } from "../../src/indexing/checkpoint-state.ts";

test("coalesces ordinary changes behind the idle delay", () => {
  const state = new CoalescedCheckpointState({ idleMs: 2_000, changeThreshold: 4 });

  assert.equal(state.markDirty(), 2_000);
  assert.equal(state.markDirty(2), 2_000);
  assert.deepEqual(state.current, {
    dirty: true,
    checkpointing: false,
    pendingChanges: 3
  });
});

test("requests an immediate checkpoint at the dirty threshold", () => {
  const state = new CoalescedCheckpointState({ idleMs: 2_000, changeThreshold: 4 });

  assert.equal(state.markDirty(4), 0);
  assert.equal(state.current.pendingChanges, 4);
});

test("retains dirty state after a failed checkpoint", () => {
  const state = new CoalescedCheckpointState({ idleMs: 10, changeThreshold: 2 });
  state.markDirty();

  assert.equal(state.begin(), true);
  assert.equal(state.begin(), false);
  state.fail();
  assert.deepEqual(state.current, {
    dirty: true,
    checkpointing: false,
    pendingChanges: 1
  });
});

test("clears dirty state only after a successful checkpoint", () => {
  const state = new CoalescedCheckpointState({ idleMs: 10, changeThreshold: 2 });
  state.markDirty(2);

  assert.equal(state.begin(), true);
  state.succeed();
  assert.deepEqual(state.current, {
    dirty: false,
    checkpointing: false,
    pendingChanges: 0
  });
});

test("validates policy and change counts", () => {
  assert.throws(() => new CoalescedCheckpointState({ idleMs: -1, changeThreshold: 1 }));
  assert.throws(() => new CoalescedCheckpointState({ idleMs: 1, changeThreshold: 0 }));
  const state = new CoalescedCheckpointState();
  assert.throws(() => state.markDirty(0));
});
