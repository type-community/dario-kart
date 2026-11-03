/** Seeded PRNG. Never use Math.random in the sim: server and clients must agree. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
}

/** Stateless hash to [0, 1): lets client prediction and server agree on per-tick randomness. */
export const hash01 = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(b + 0x9e3779b9, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae3d) ^ Math.imul(c + 0x61c88647, 0x27d4eb2f);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
