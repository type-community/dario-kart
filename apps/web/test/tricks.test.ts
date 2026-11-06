import { describe, expect, test } from "bun:test";
import { randomTrick, TRICK_SECONDS, TRICKS, trickPose } from "../src/tricks.ts";

describe("trick animations", () => {
  test("the random set has a barrel roll and a front flip", () => {
    expect(TRICKS).toEqual(["barrelRoll", "frontFlip"]);
    expect(randomTrick(0)).toBe("barrelRoll");
    expect(randomTrick(0.99)).toBe("frontFlip");
  });

  test("front flip turns end over end, a full turn over the trick", () => {
    expect(trickPose("frontFlip", TRICK_SECONDS)).toEqual({ x: 0, z: 0 });
    expect(trickPose("frontFlip", TRICK_SECONDS / 2).x).toBeCloseTo(Math.PI);
    expect(trickPose("frontFlip", 0).x).toBeCloseTo(Math.PI * 2);
    expect(trickPose("frontFlip", 0).z).toBe(0);
  });

  test("barrel roll still rolls a full turn", () => {
    expect(trickPose("barrelRoll", 0)).toEqual({ x: 0, z: Math.PI * 2 });
  });
});
