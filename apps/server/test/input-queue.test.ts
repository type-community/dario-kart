import { describe, expect, test } from "bun:test";
import { InputBit } from "@dario-kart/sim";
import { InputQueue } from "../src/room.ts";

/** A client that sends two inputs every other tick, like the real one. */
const run = (queue: InputQueue, ticks: number, start: number, stallAt = -1, stallTicks = 0) => {
  let seq = start;
  const depths: number[] = [];
  const held: Array<number> = [];
  for (let tick = 0; tick < ticks; tick++) {
    // During a stall the client keeps making inputs; they arrive together afterwards.
    held.push(++seq);
    const stalled = stallAt >= 0 && tick >= stallAt && tick < stallAt + stallTicks;
    if (!stalled && held.length >= 2) {
      for (const s of held) queue.push(s, 0, InputBit.Throttle);
      held.length = 0;
    }
    const taken = queue.take().seq;
    depths.push(seq - taken);
  }
  return { seq, depths };
};

describe("input queue", () => {
  test("a stall doesn't leave lasting input lag behind it", () => {
    const queue = new InputQueue();
    const { depths } = run(queue, 600, 0, 120, 20);
    const settled = depths.slice(-60);
    // Steady state is one or two inputs behind; a 6-deep standing queue would be 100 ms of lag.
    expect(Math.max(...settled)).toBeLessThanOrEqual(3);
  });

  test("a skipped input keeps its fire tap", () => {
    const queue = new InputQueue();
    for (let s = 1; s <= 10; s++) queue.push(s, 0, s === 2 ? InputBit.Item : 0);
    // Over the cap: the oldest inputs are skipped, including the one that fired.
    const first = queue.take();
    expect(first.bits & InputBit.Item).toBe(InputBit.Item);
  });
});
