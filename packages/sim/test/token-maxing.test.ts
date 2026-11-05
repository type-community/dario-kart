import { describe, expect, test } from "bun:test";
import {
  BoostKind, DT, InputBit, ItemKind, KARTS, Phase, SQUASH_SECONDS, SlowFlag, TOKEN_MAXING_SECONDS, World,
  applyKartFields, botInput, decodeSnapshot, encodeSnapshot, makeInput, snapshotSize,
} from "../src/index.ts";

const race = (predict = false) => {
  const world = new World({ theme: "sf", seed: 21, predict,
    racers: [0, 1, 2].map((kart) => ({ kart, character: kart, bot: false })) });
  world.phase = Phase.Racing;
  world.tick = 200;
  world.boxReadyTick.fill(100000);
  world.karts.forEach((k, i) => { k.dist = 20 + i * 50; k.d = 0; });
  return world;
};

const runOver = (world: World, giantSlot = 0, victimSlot = 1) => {
  const giant = world.karts[giantSlot], victim = world.karts[victimSlot];
  giant.giantT = 5;
  giant.speed = 30;
  giant.dist = victim.dist - 2.8;
  giant.d = victim.d = 0;
  giant.z = victim.z = 0;
  giant.vz = victim.vz = 0;
  world.step(world.karts.map(() => makeInput()));
};

describe("Token Maxing", () => {
  // Isolate engine behavior from hills, corners, pickups and track boosts.
  const straight = () => {
    const world = new World({ theme: "sf", seed: 21, racers: [{ kart: 0, character: 0, bot: false }] });
    world.phase = Phase.Racing;
    world.track.curvature.fill(0);
    world.track.pitch.fill(0);
    world.track.ty.fill(0);
    world.track.loop.fill(0);
    world.track.bucketStart.fill(0);
    world.boxReadyTick.fill(100000);
    world.coinReadyTick.fill(100000);
    return world;
  };

  test("giant mode pulls ahead modestly, then sheds the extra speed after expiry", () => {
    const normal = straight(), giant = straight(), input = makeInput();
    const a = normal.karts[0], b = giant.karts[0];
    a.speed = a.maxSpeed;
    b.speed = b.maxSpeed;
    b.giantT = TOKEN_MAXING_SECONDS;
    input.bits = InputBit.Throttle;
    for (let i = 0; i < 240; i++) { normal.stepOne(a, input); giant.stepOne(b, input); }
    expect(b.speed / a.speed).toBeGreaterThan(1.08);
    expect(b.speed / a.speed).toBeLessThan(1.12);
    expect(b.dist - a.dist).toBeGreaterThan(10);
    for (let i = 0; i < 450; i++) giant.stepOne(b, input);
    expect(b.giantT).toBe(0);
    expect(b.speed).toBeCloseTo(b.maxSpeed, 1);
  });

  test("stacking giant mode, nitro, GPUs and a drift boost respects the speed cap", () => {
    const world = straight(), kart = world.karts[0], input = makeInput();
    kart.giantT = TOKEN_MAXING_SECONDS;
    kart.speed = kart.maxSpeed;
    kart.gpus = 10;
    kart.nitro = 1;
    kart.boostT = 5;
    kart.boostKind = BoostKind.UltraDrift;
    input.bits = InputBit.Throttle | InputBit.Nitro;
    for (let i = 0; i < 180; i++) {
      world.stepOne(kart, input);
      expect(kart.speed).toBeLessThanOrEqual(kart.maxSpeed * 1.5);
    }
    expect(kart.speed).toBeGreaterThan(kart.maxSpeed * 1.45);
  });

  test("bots use the extra speed instead of lifting at their normal cruising speed", () => {
    const world = straight(), kart = world.karts[0], input = makeInput();
    kart.speed = kart.maxSpeed * 1.05;
    kart.giantT = 4;
    botInput(world, kart, input, 1);
    expect(input.bits & InputBit.Throttle).toBeTruthy();
    kart.giantT = 0;
    botInput(world, kart, input, 1);
    expect(input.bits & InputBit.Throttle).toBe(0);
  });

  test("boxes award both items deterministically", () => {
    const a = race(), b = race(), drops: number[] = [];
    for (let i = 0; i < 60; i++) {
      for (const world of [a, b]) {
        const kart = world.karts[0], box = world.track.itemBoxes[0];
        kart.dist = box.s; kart.d = box.d; kart.z = kart.vz = kart.speed = 0;
        kart.item = ItemKind.None;
        world.boxReadyTick[0] = 0;
        world.step(world.karts.map(() => makeInput()));
      }
      expect(a.karts[0].item).toBe(b.karts[0].item);
      drops.push(a.karts[0].item);
    }
    expect(drops).toContain(ItemKind.Missile);
    expect(drops).toContain(ItemKind.TokenMaxing);
  });

  test("activation consumes one item, promotes the spare, and expires", () => {
    const world = race(), kart = world.karts[0], input = makeInput();
    kart.item = ItemKind.TokenMaxing; kart.itemCount = 1;
    kart.item2 = ItemKind.Missile; kart.item2Count = 1;
    input.bits = InputBit.Item | InputBit.Back;
    world.stepOne(kart, input);
    expect(kart.giantT).toBe(TOKEN_MAXING_SECONDS);
    expect(kart.item).toBe(ItemKind.Missile);
    expect(kart.item2).toBe(ItemKind.None);
    expect(world.missiles.some((m) => m.active)).toBe(false);
    input.bits = 0;
    for (let i = 0; i <= TOKEN_MAXING_SECONDS / DT; i++) world.stepOne(kart, input);
    expect(kart.giantT).toBe(0);
  });

  test("a spare Token Maxing is kept while giant mode is already active", () => {
    const world = race(), kart = world.karts[0], input = makeInput();
    kart.giantT = 4; kart.item = ItemKind.TokenMaxing; kart.itemCount = 1;
    input.bits = InputBit.Item;
    world.stepOne(kart, input);
    expect(kart.itemCount).toBe(1);
    expect(kart.giantT).toBeLessThan(4);
    expect(world.events.filter((e) => e.type === "use")).toHaveLength(0);
  });

  for (const giantSlot of [0, 1]) test(`run-over works in either collision order (giant slot ${giantSlot})`, () => {
    const world = race(), victimSlot = 1 - giantSlot, victim = world.karts[victimSlot];
    victim.boostT = 2; victim.nitro = 1; victim.drifting = 1; victim.driftCharge = 2;
    runOver(world, giantSlot, victimSlot);
    expect(victim.squashT).toBe(SQUASH_SECONDS);
    expect(victim.speed).toBe(0);
    expect(victim.boostT).toBe(0);
    expect(victim.drifting).toBe(0);
    expect(victim.hp).toBe(victim.hpMax);
    expect(world.events.filter((e) => e.type === "squash")).toEqual([{ type: "squash", victim: victimSlot, by: giantSlot }]);
    const dist = victim.dist, d = victim.d, input = makeInput();
    input.bits = InputBit.Throttle | InputBit.Nitro | InputBit.Item | InputBit.Drift;
    input.steer = 1;
    victim.item = ItemKind.Missile; victim.itemCount = 1;
    for (let i = 0; i < 60; i++) world.stepOne(victim, input);
    expect(victim.dist).toBe(dist);
    expect(victim.d).toBe(d);
    expect(victim.speed).toBe(0);
    expect(victim.nitro).toBe(1);
    expect(victim.item).toBe(ItemKind.Missile);
    expect(victim.slowFlags & SlowFlag.Squashed).toBeTruthy();
    for (let i = 0; i < 20; i++) world.stepOne(victim, input);
    expect(victim.squashT).toBe(0);
    expect(victim.speed).toBeGreaterThan(0);
    expect(victim.squashGuardT).toBeGreaterThan(0);
    runOver(world, giantSlot, victimSlot);
    expect(victim.squashT).toBe(0);
    expect(world.events.filter((e) => e.type === "squash")).toHaveLength(1);
    victim.squashGuardT = 0;
    runOver(world, giantSlot, victimSlot);
    expect(world.events.filter((e) => e.type === "squash")).toHaveLength(2);
  });

  test("giants cannot squash each other or a jumping or finished racer", () => {
    for (const state of ["giant", "air", "finished"] as const) {
      const world = race(), a = world.karts[0], b = world.karts[1];
      a.giantT = 5; a.speed = 30; a.dist = b.dist - 2;
      if (state === "giant") b.giantT = 5;
      if (state === "air") { b.z = 3; b.vz = 1; }
      if (state === "finished") b.finishTick = world.tick;
      world.step(world.karts.map(() => makeInput()));
      expect(b.squashT).toBe(0);
      expect(a.squashT).toBe(0);
    }
  });

  test("bots resume driving instead of treating the squash as being stuck", () => {
    const world = race(), victim = world.karts[1], input = makeInput();
    runOver(world);
    for (let i = 0; i < 90; i++) {
      botInput(world, victim, input);
      expect(input.bits & InputBit.Brake).toBe(0);
      world.stepOne(victim, input);
    }
    expect(victim.squashT).toBe(0);
    expect(victim.speed).toBeGreaterThan(0);
  });

  test("a run-over crosses the lap seam and squashes exact overlaps", () => {
    for (const seam of [false, true]) {
      const world = race(), a = world.karts[0], b = world.karts[1];
      a.giantT = 5; a.speed = b.speed = 30;
      a.dist = 20; b.dist = 20 + (seam ? world.track.length : 0);
      world.step(world.karts.map(() => makeInput()));
      expect(b.squashT).toBe(SQUASH_SECONDS);
    }
  });

  test("replicated giant, squash and grace timers replay without predicting item use", () => {
    const authority = race(), client = race(true), a = authority.karts[0];
    a.giantT = 6; a.squashT = .8; a.squashGuardT = 1.8;
    a.item = ItemKind.TokenMaxing; a.itemCount = 1;
    const buffer = new DataView(new ArrayBuffer(snapshotSize(authority)));
    expect(encodeSnapshot(authority, buffer)).toBe(buffer.byteLength);
    const snapshot = decodeSnapshot(buffer)!;
    applyKartFields(snapshot.karts, 0, client.karts[0]);
    const b = client.karts[0], input = makeInput();
    input.bits = InputBit.Throttle | InputBit.Nitro | InputBit.Item;
    for (let i = 0; i < 20; i++) { authority.stepOne(a, input); client.stepOne(b, input); }
    expect(b.giantT).toBeCloseTo(a.giantT, 5);
    expect(b.squashT).toBeCloseTo(a.squashT, 5);
    expect(b.squashGuardT).toBeCloseTo(a.squashGuardT, 5);
    expect(b.speed).toBe(0);
    b.squashT = b.giantT = b.prevBits = 0;
    client.stepOne(b, input);
    expect(b.giantT).toBe(0);
    expect(b.item).toBe(ItemKind.TokenMaxing);
  });

  test("twin-engine boxes keep the second item slot", () => {
    const model = KARTS.findIndex((k) => k.perk === "twin-engine");
    const world = new World({ theme: "sf", seed: 21, racers: [{ kart: model, character: 0, bot: false }] });
    world.phase = Phase.Racing;
    const kart = world.karts[0], box = world.track.itemBoxes[0];
    kart.item = ItemKind.TokenMaxing; kart.itemCount = 1;
    kart.dist = box.s; kart.d = box.d;
    world.step([makeInput()]);
    expect(kart.item).toBe(ItemKind.TokenMaxing);
    expect(kart.item2 === ItemKind.Missile || kart.item2 === ItemKind.TokenMaxing).toBe(true);
    expect(kart.item2Count).toBe(1);
  });
});
