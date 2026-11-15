/** Percentile with linear interpolation between closest ranks. p in [0, 100]. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return NaN;
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export const median = (values: ArrayLike<number>) => percentile(values, 50);

/** Interquartile range (p75 - p25). */
export const iqr = (values: ArrayLike<number>) => percentile(values, 75) - percentile(values, 25);

/** Fixed-capacity numeric ring buffer: O(1) push, no allocation after creation. */
export class RingBuffer {
  private data: Float64Array;
  private start = 0;
  length = 0;

  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity);
  }

  push(value: number): void {
    const end = (this.start + this.length) % this.capacity;
    this.data[end] = value;
    if (this.length < this.capacity) this.length++;
    else this.start = (this.start + 1) % this.capacity;
  }

  /** i = 0 is the oldest value still held. */
  at(i: number): number {
    return this.data[(this.start + i) % this.capacity];
  }

  toArray(): number[] {
    return Array.from({ length: this.length }, (_, i) => this.at(i));
  }

  clear(): void {
    this.start = 0;
    this.length = 0;
  }
}
