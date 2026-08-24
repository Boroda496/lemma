/**
 * Seeded PRNG. Every random choice in this codebase flows through here so
 * that a problem, a probe sequence, or a failing test can be reproduced from
 * its seed alone. `Math.random` is never called in engine or curriculum code.
 */

export class Rng {
  private s: number;

  constructor(seed: number | string) {
    this.s = typeof seed === 'number' ? seed >>> 0 : Rng.hash(seed);
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  static hash(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** mulberry32 — small, fast, and good enough for problem generation. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Nonzero integer in [lo, hi]. */
  nonzeroInt(lo: number, hi: number): number {
    for (;;) {
      const v = this.int(lo, hi);
      if (v !== 0) return v;
    }
  }

  bigint(bits: number): bigint {
    let v = 0n;
    for (let i = 0; i < bits; i += 30) {
      v = (v << 30n) | BigInt(Math.floor(this.next() * (1 << 30)));
    }
    return v & ((1n << BigInt(bits)) - 1n);
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError('pick from an empty array');
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  /** `n` distinct elements, or the whole array when it is shorter. */
  sample<T>(arr: readonly T[], n: number): T[] {
    const copy = [...arr];
    this.shuffle(copy);
    return copy.slice(0, Math.min(n, copy.length));
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  /** Weighted choice. Weights need not be normalized. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }
}
