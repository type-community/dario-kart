export const InputBit = {
  Throttle: 1,
  Brake: 2,
  Drift: 4,
  Item: 8,
  Back: 16,
  Nitro: 32,
} as const;

export interface Input {
  /** -1 (left) .. 1 (right) */
  steer: number;
  bits: number;
  /** Client input sequence number; 0 for bots. */
  seq: number;
}

export const makeInput = (): Input => ({ steer: 0, bits: 0, seq: 0 });

export const copyInput = (from: Input, to: Input): Input => {
  to.steer = from.steer;
  to.bits = from.bits;
  to.seq = from.seq;
  return to;
};
