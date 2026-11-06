import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { pickTrickAnimation, TRICK_ANIMATIONS } from "../src/scene.ts";

describe("trick animations", () => {
  test("the random set has a barrel roll and a front flip, each a full turn", () => {
    expect(TRICK_ANIMATIONS.length).toBe(2);
    const [roll, flip] = TRICK_ANIMATIONS.map((animate) => {
      const body = new THREE.Group();
      animate(body, 1);
      return body.rotation;
    });
    expect(roll.z).toBeCloseTo(Math.PI * 2);
    expect(roll.x).toBe(0);
    expect(flip.x).toBeCloseTo(Math.PI * 2);
    expect(flip.z).toBe(0);
  });

  test("every animation in the set can be picked", () => {
    expect(pickTrickAnimation(0)).toBe(TRICK_ANIMATIONS[0]);
    expect(pickTrickAnimation(0.99)).toBe(TRICK_ANIMATIONS[1]);
    expect(pickTrickAnimation(1)).toBe(TRICK_ANIMATIONS[1]);
  });
});
