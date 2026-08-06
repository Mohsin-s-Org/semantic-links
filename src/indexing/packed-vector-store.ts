export interface PackedVectorStats {
  dimensions: number;
  size: number;
  capacity: number;
  allocatedBytes: number;
  liveBytes: number;
  freeRows: number;
}

export interface PackedVectorSnapshot {
  dimensions: number;
  vectors: Float32Array;
  rowIds: Array<string | null>;
}

const INITIAL_CAPACITY = 16;

/**
 * Canonical row-major float32 storage for semantic vectors.
 *
 * Vector bytes are copied into one geometrically grown matrix. Returned views
 * are valid until the store grows, clears or compacts and must be treated as
 * read-only by callers.
 */
export class PackedVectorStore implements Iterable<[string, Float32Array]> {
  private readonly rowsById = new Map<string, number>();
  private rowIds: Array<string | null> = [];
  private freeRows: number[] = [];
  private matrix = new Float32Array();
  private dimensionsValue = 0;

  get size(): number {
    return this.rowsById.size;
  }

  get dimensions(): number {
    return this.dimensionsValue;
  }

  get capacity(): number {
    return this.rowIds.length;
  }

  get stats(): PackedVectorStats {
    return {
      dimensions: this.dimensionsValue,
      size: this.size,
      capacity: this.capacity,
      allocatedBytes: this.matrix.byteLength,
      liveBytes: this.size * this.dimensionsValue * Float32Array.BYTES_PER_ELEMENT,
      freeRows: this.freeRows.length
    };
  }

  has(id: string): boolean {
    return this.rowsById.has(id);
  }

  rowOf(id: string): number | undefined {
    return this.rowsById.get(id);
  }

  idAt(row: number): string | null | undefined {
    return this.rowIds[row];
  }

  /** Returns an internal row view. Callers must not mutate it. */
  get(id: string): Float32Array | undefined {
    const row = this.rowsById.get(id);
    return row === undefined ? undefined : this.rowView(row);
  }

  getCopy(id: string): Float32Array | undefined {
    const view = this.get(id);
    return view === undefined ? undefined : new Float32Array(view);
  }

  /** Returns a stable copy suitable for worker transfer or persistence. */
  snapshot(): PackedVectorSnapshot {
    return {
      dimensions: this.dimensionsValue,
      vectors: new Float32Array(this.matrix),
      rowIds: [...this.rowIds]
    };
  }

  set(id: string, vector: Float32Array): this {
    validateId(id);
    this.ensureDimensions(vector.length);
    validateVector(vector, this.dimensionsValue);

    let row = this.rowsById.get(id);
    if (row === undefined) {
      row = this.takeFreeRow();
      if (row === undefined) {
        this.ensureCapacity(this.capacity + 1);
        row = this.takeFreeRow();
      }
      if (row === undefined) {
        throw new Error("Packed vector storage could not allocate a row.");
      }
      this.rowsById.set(id, row);
      this.rowIds[row] = id;
    }
    this.matrix.set(vector, row * this.dimensionsValue);
    return this;
  }

  delete(id: string): boolean {
    const row = this.rowsById.get(id);
    if (row === undefined) {
      return false;
    }
    this.rowsById.delete(id);
    this.rowIds[row] = null;
    this.rowView(row).fill(0);
    this.freeRows.push(row);
    this.freeRows.sort((left, right) => right - left);
    return true;
  }

  clear(): void {
    this.rowsById.clear();
    this.rowIds = [];
    this.freeRows = [];
    this.matrix = new Float32Array();
    this.dimensionsValue = 0;
  }

  /**
   * Rewrites live rows in deterministic id order and releases unused capacity.
   * Existing row views become invalid.
   */
  compact(order: readonly string[] = [...this.rowsById.keys()].sort()): void {
    if (order.length !== this.size || new Set(order).size !== order.length) {
      throw new Error("Packed vector compaction order must contain every live id exactly once.");
    }
    const capacity = order.length === 0 ? 0 : Math.max(INITIAL_CAPACITY, order.length);
    const next = new Float32Array(capacity * this.dimensionsValue);
    const nextRows = new Map<string, number>();
    const nextIds: Array<string | null> = Array.from({ length: capacity }, () => null);
    order.forEach((id, row) => {
      const vector = this.get(id);
      if (vector === undefined) {
        throw new Error(`Packed vector compaction referenced an unknown id: ${id}`);
      }
      next.set(vector, row * this.dimensionsValue);
      nextRows.set(id, row);
      nextIds[row] = id;
    });
    this.matrix = next;
    this.rowsById.clear();
    for (const [id, row] of nextRows) {
      this.rowsById.set(id, row);
    }
    this.rowIds = nextIds;
    this.freeRows = [];
    for (let row = capacity - 1; row >= order.length; row -= 1) {
      this.freeRows.push(row);
    }
  }

  *entries(): IterableIterator<[string, Float32Array]> {
    for (let row = 0; row < this.rowIds.length; row += 1) {
      const id = this.rowIds[row];
      if (id !== null && id !== undefined) {
        yield [id, this.rowView(row)];
      }
    }
  }

  [Symbol.iterator](): IterableIterator<[string, Float32Array]> {
    return this.entries();
  }

  private ensureDimensions(dimensions: number): void {
    if (!Number.isInteger(dimensions) || dimensions < 1) {
      throw new Error("Packed vector dimensions must be a positive integer.");
    }
    if (this.dimensionsValue === 0) {
      this.dimensionsValue = dimensions;
      return;
    }
    if (this.dimensionsValue !== dimensions) {
      throw new Error(
        `Packed vector has ${dimensions} dimensions; expected ${this.dimensionsValue}.`
      );
    }
  }

  private ensureCapacity(requiredRows: number): void {
    if (requiredRows <= this.capacity) {
      return;
    }
    let capacity = Math.max(INITIAL_CAPACITY, this.capacity || INITIAL_CAPACITY);
    while (capacity < requiredRows) {
      capacity *= 2;
    }
    const next = new Float32Array(capacity * this.dimensionsValue);
    next.set(this.matrix);
    this.matrix = next;
    const oldCapacity = this.rowIds.length;
    this.rowIds.length = capacity;
    for (let row = capacity - 1; row >= oldCapacity; row -= 1) {
      this.rowIds[row] = null;
      this.freeRows.push(row);
    }
    this.freeRows.sort((left, right) => right - left);
  }

  private takeFreeRow(): number | undefined {
    return this.freeRows.pop();
  }

  private rowView(row: number): Float32Array {
    const start = row * this.dimensionsValue;
    return this.matrix.subarray(start, start + this.dimensionsValue);
  }
}

function validateId(id: string): void {
  if (id.length === 0) {
    throw new Error("Packed vector id cannot be empty.");
  }
}

function validateVector(vector: Float32Array, dimensions: number): void {
  if (vector.length !== dimensions) {
    throw new Error(`Packed vector has ${vector.length} dimensions; expected ${dimensions}.`);
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error("Packed vector contains a non-finite value.");
    }
  }
}
