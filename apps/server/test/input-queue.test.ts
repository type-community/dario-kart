import { describe, expect, test } from "bun:test";
import { InputBit, inputsPerPacket } from "@dario-kart/sim";
import { InputQueue } from "../src/room.ts";

/** A client that sends `batch` inputs every `batch` ticks, like the real one. */
const run = (queue: InputQueue, ticks: number, start: number, stallAt = -1, stallTicks = 0, batch = 2) => {
  let seq = start;
  const depths: number[] = [];
  const held: Array<number> = [];
  for (let tick = 0; tick < ticks; tick++) {
    // During a stall the client keeps making inputs; they arrive together afterwards.
    held.push(++seq);
    const stalled = stallAt >= 0 && tick >= stallAt && tick < stallAt + stallTicks;
    if (!stalled && held.length >= batch) {
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

  test("big lobbies send fewer, bigger packets", () => {
    expect(inputsPerPacket(1)).toBe(2);
    expect(inputsPerPacket(20)).toBe(2);
    expect(inputsPerPacket(50)).toBe(5);
    expect(inputsPerPacket(100)).toBe(10);
    // The whole race stays under the budget that froze a 40-player race at 30 Hz.
    for (let n = 1; n <= 100; n++) expect((n * 60) / inputsPerPacket(n)).toBeLessThanOrEqual(600);
  });

  test("bigger packets are neither dropped nor left queued", () => {
    const queue = new InputQueue();
    queue.clear(5);
    const taken: number[] = [];
    let seq = 0;
    for (let tick = 0; tick < 600; tick++) {
      // Jitter often lands two packets together.
      if (tick % 10 === 0) for (let i = 0; i < 10; i++) queue.push(++seq, 0, 0);
      taken.push(queue.take().seq);
    }
    // Every input is used once, in order: none were shed as "too far behind".
    expect(taken.slice(-500)).toEqual(Array.from({ length: 500 }, (_, i) => taken.at(-500)! + i));
  });

  test("a stall leaves no lag behind in a big race either", () => {
    for (const batch of [5, 10]) {
      const calm = new InputQueue();
      calm.clear(batch);
      const baseline = Math.max(...run(calm, 600, 0, -1, 0, batch).depths.slice(-60));
      const queue = new InputQueue();
      queue.clear(batch);
      // A burst after a stall, landing out of step with the packet rhythm.
      const { depths } = run(queue, 900, 0, 123, 37, batch);
      expect(Math.max(...depths.slice(-60))).toBeLessThanOrEqual(baseline + 1);
    }
  });

  test("a skipped input keeps its fire tap", () => {
    const queue = new InputQueue();
    for (let s = 1; s <= 10; s++) queue.push(s, 0, s === 2 ? InputBit.Item : 0);
    // Over the cap: the oldest inputs are skipped, including the one that fired.
    const first = queue.take();
    expect(first.bits & InputBit.Item).toBe(InputBit.Item);
  });
});
