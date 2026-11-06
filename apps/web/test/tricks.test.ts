import { describe, expect, test } from "bun:test";
import { pickTrick, TRICKS } from "../src/scene.ts";

describe("trick animations", () => {
  test("the random set has a barrel roll and a front flip on different axes", () => {
    expect(TRICKS.map((t) => t.name)).toEqual(["Barrel roll", "Front flip"]);
    expect(new Set(TRICKS.map((t) => t.axis)).size).toBe(TRICKS.length);
  });

  test("every roll in [0, 1) lands on a trick, covering the whole set", () => {
    expect(pickTrick(0)).toBe(TRICKS[0]);
    expect(pickTrick(0.999999)).toBe(TRICKS[TRICKS.length - 1]);
    expect(pickTrick(1)).toBe(TRICKS[TRICKS.length - 1]);
    const seen = new Set(Array.from({ length: 200 }, () => pickTrick().name));
    expect(seen.size).toBe(TRICKS.length);
  });
});
