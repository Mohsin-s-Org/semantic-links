export interface CheckpointPolicy {
  idleMs: number;
  changeThreshold: number;
}

export interface CheckpointStateSnapshot {
  dirty: boolean;
  checkpointing: boolean;
  pendingChanges: number;
}

export const DEFAULT_CHECKPOINT_POLICY: Readonly<CheckpointPolicy> = Object.freeze({
  idleMs: 2_000,
  changeThreshold: 64
});

export class CoalescedCheckpointState {
  private readonly policy: CheckpointPolicy;
  private dirtyValue = false;
  private checkpointingValue = false;
  private pendingChangesValue = 0;

  constructor(policy: CheckpointPolicy = DEFAULT_CHECKPOINT_POLICY) {
    if (!Number.isFinite(policy.idleMs) || policy.idleMs < 0) {
      throw new Error("Checkpoint idle delay must be a non-negative number.");
    }
    if (!Number.isInteger(policy.changeThreshold) || policy.changeThreshold < 1) {
      throw new Error("Checkpoint change threshold must be a positive integer.");
    }
    this.policy = policy;
  }

  get current(): CheckpointStateSnapshot {
    return {
      dirty: this.dirtyValue,
      checkpointing: this.checkpointingValue,
      pendingChanges: this.pendingChangesValue
    };
  }

  markDirty(changeCount = 1): number {
    if (!Number.isInteger(changeCount) || changeCount < 1) {
      throw new Error("Checkpoint change count must be a positive integer.");
    }
    this.dirtyValue = true;
    this.pendingChangesValue += changeCount;
    return this.pendingChangesValue >= this.policy.changeThreshold
      ? 0
      : this.policy.idleMs;
  }

  begin(): boolean {
    if (!this.dirtyValue || this.checkpointingValue) {
      return false;
    }
    this.checkpointingValue = true;
    return true;
  }

  succeed(): void {
    if (!this.checkpointingValue) {
      throw new Error("Cannot complete a checkpoint that is not running.");
    }
    this.checkpointingValue = false;
    this.dirtyValue = false;
    this.pendingChangesValue = 0;
  }

  fail(): void {
    if (!this.checkpointingValue) {
      throw new Error("Cannot fail a checkpoint that is not running.");
    }
    this.checkpointingValue = false;
  }

  reset(): void {
    this.dirtyValue = false;
    this.checkpointingValue = false;
    this.pendingChangesValue = 0;
  }
}
