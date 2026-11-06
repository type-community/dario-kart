import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { TRICK_SECONDS } from "@dario-kart/sim";
import { pickTrickAnimation, TRICK_ANIMATIONS, TrickPlayer } from "../src/scene.ts";

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

describe("TrickPlayer", () => {
  test("picks a new animation each time a trick starts and runs it over TRICK_SECONDS", () => {
    const picks = [TRICK_ANIMATIONS[1], TRICK_ANIMATIONS[0]];
    let calls = 0;
    const player = new TrickPlayer(() => picks[calls++]);
    const body = new THREE.Group();

    // First trick starts: front flip, halfway through.
    player.apply(body, TRICK_SECONDS, false);
    expect(calls).toBe(1);
    body.rotation.set(0, 0, 0);
    player.apply(body, TRICK_SECONDS / 2, false);
    expect(calls).toBe(1);
    expect(body.rotation.x).toBeCloseTo(Math.PI);
    expect(body.rotation.z).toBe(0);

    // Trick ends, then a second trick starts: re-pick (barrel roll).
    player.apply(body, 0, false);
    body.rotation.set(0, 0, 0);
    player.apply(body, TRICK_SECONDS / 2, false);
    expect(calls).toBe(2);
    expect(body.rotation.z).toBeCloseTo(Math.PI);
    expect(body.rotation.x).toBe(0);
  });

  test("does not pose a squashed kart", () => {
    const player = new TrickPlayer(() => TRICK_ANIMATIONS[1]);
    const body = new THREE.Group();
    player.apply(body, TRICK_SECONDS / 2, true);
    expect(body.rotation.x).toBe(0);
    expect(body.rotation.z).toBe(0);
  });
});
