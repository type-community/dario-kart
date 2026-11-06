import { describe, expect, test } from "bun:test";
import {
  BoostKind, TRICK_KINDS, TrickKind, CHAIN_WINDOW, CLOSE_PASS_WIDTH, InputBit, NITRO_CLOSE_PASS, NITRO_MIN, NITRO_SECONDS, SlowFlag, ItemKind, KARTS, Phase, THEMES, World, botInput, decodeInputs, decodeSnapshot, encodeInputs,
  encodeSnapshot, GapStats, cleanNetReport, generateTrack, makeInput, snapshotSize, targetTrackLength,
} from "../src/index.ts";

const racers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ kart: i % KARTS.length, character: i % 10, bot: true }));

const runRace = (world: World, maxSeconds: number) => {
  const inputs = world.karts.map(() => makeInput());
  for (let t = 0; t < maxSeconds * 60 && world.phase !== Phase.Finished; t++) {
    world.karts.forEach((kart, i) => botInput(world, kart, inputs[i]));
    world.step(inputs);
  }
};

describe("track generation", () => {
  test("tracks grow with the lobby", () => {
    const small = generateTrack("sf", 1, 4);
    const big = generateTrack("sf", 1, 30);
    expect(big.length).toBeGreaterThan(small.length * 1.15);
    expect(big.halfWidth).toBeGreaterThan(small.halfWidth);
    expect(Math.abs(small.length - targetTrackLength(4)) / targetTrackLength(4)).toBeLessThan(0.45);
  });

  test("every theme generates drivable geometry across seeds", () => {
    for (const theme of THEMES) {
      for (let seed = 1; seed <= 12; seed++) {
        for (const players of [2, 8, 30]) {
          const track = generateTrack(theme.id, seed * 7919, players);
          let maxK = 0;
          for (const k of track.curvature) maxK = Math.max(maxK, Math.abs(k));
          expect(maxK * track.halfWidth).toBeLessThan(0.95);
          expect(track.itemBoxes.length).toBeGreaterThan(5);
          expect(track.features.length).toBeGreaterThan(3);
        }
      }
    }
  });

  test("generation is deterministic", () => {
    const a = generateTrack("shenzhen", 42, 12);
    const b = generateTrack("shenzhen", 42, 12);
    expect(a.length).toBe(b.length);
    expect(Array.from(a.px)).toEqual(Array.from(b.px));
    expect(a.features).toEqual(b.features);
  });
});

describe("headless races", () => {
  for (const theme of THEMES) {
    test(`a race on ${theme.name} is about 50 seconds`, () => {
      const world = new World({ theme: theme.id, seed: 1234, racers: racers(8) });
      runRace(world, 400);
      expect(world.karts.filter((k) => k.finished).length).toBeGreaterThanOrEqual(5);
      const winner = Math.min(...world.karts.filter((k) => k.finished).map((k) => k.finishTick)) / 60 - 3;
      expect(winner).toBeGreaterThan(30);
      expect(winner).toBeLessThan(60);
    });
  }

  test("simulation is deterministic", () => {
    const a = new World({ theme: "nyc", seed: 77, racers: racers(10) });
    const b = new World({ theme: "nyc", seed: 77, racers: racers(10) });
    runRace(a, 40);
    runRace(b, 40);
    expect(a.karts.map((k) => k.dist)).toEqual(b.karts.map((k) => k.dist));
    expect(a.events.length).toBe(b.events.length);
  });

  test("items get used", () => {
    const world = new World({ theme: "fab", seed: 9, racers: racers(12) });
    runRace(world, 120);
    expect(world.events.some((e) => e.type === "item")).toBe(true);
    expect(world.events.some((e) => e.type === "use")).toBe(true);
  });
});

describe("protocol", () => {
  test("snapshot round trip", () => {
    const world = new World({ theme: "beijing", seed: 5, racers: racers(6) });
    runRace(world, 20);
    const buf = new DataView(new ArrayBuffer(snapshotSize(world)));
    const len = encodeSnapshot(world, buf);
    expect(len).toBe(buf.byteLength);
    const snap = decodeSnapshot(buf)!;
    expect(snap.header.tick).toBe(world.tick);
    expect(snap.header.kartCount).toBe(6);
    expect(snap.karts[0]).toBeCloseTo(world.karts[0].dist, 2);
  });

  test("input round trip", () => {
    const buf = new DataView(new ArrayBuffer(64));
    encodeInputs([{ seq: 10, steer: -0.5, bits: 5 }, { seq: 11, steer: 1, bits: 1 }], buf, 777);
    const got: number[][] = [];
    expect(decodeInputs(buf, 777, (seq, steer, bits) => got.push([seq, Math.round(steer * 100) / 100, bits]))).toBe(777);
    expect(got).toEqual([[10, -0.5, 5], [11, 1, 1]]);
    // A packet from another race is never applied.
    const stale: number[] = [];
    expect(decodeInputs(buf, 778, (seq) => stale.push(seq))).toBe(777);
    expect(stale).toEqual([]);
  });
});

describe("feel", () => {
  const solo = (theme: "sf" | "nyc" = "sf") => new World({ theme, seed: 3, racers: racers(4) });
  const skipCountdown = (world: World) => {
    const idle = world.karts.map(() => makeInput());
    while (world.phase !== Phase.Racing) world.step(idle);
  };

  test("a kart with no throttle stays put", () => {
    const world = solo();
    skipCountdown(world);
    const start = world.karts[0].dist;
    const idle = world.karts.map(() => makeInput());
    for (let t = 0; t < 180; t++) world.step(idle);
    expect(Math.abs(world.karts[0].dist - start)).toBeLessThan(0.5);
  });

  test("letting off the throttle slows you down quickly", () => {
    const world = solo();
    skipCountdown(world);
    const kart = world.karts[0];
    kart.speed = 50;
    const idle = world.karts.map(() => makeInput());
    for (let t = 0; t < 60; t++) world.step(idle);
    expect(kart.speed).toBeLessThan(20);
  });

  test("every theme has at least one loop", () => {
    for (const theme of THEMES) expect(generateTrack(theme.id, 11, 8).loops.length).toBeGreaterThan(0);
  });

  test("holding Nitro burns the Compute meter as a boost", () => {
    const world = solo();
    skipCountdown(world);
    const kart = world.karts[0];
    const inputs = world.karts.map(() => makeInput());
    kart.nitro = NITRO_MIN / 2;
    inputs[0].bits = InputBit.Nitro | InputBit.Throttle;
    world.step(inputs);
    // Too little to light.
    expect(kart.nitroLit).toBe(0);
    kart.nitro = 1;
    let ticks = 0;
    while (kart.nitro > 0 && ticks < 600) {
      world.step(inputs);
      expect(kart.nitroLit).toBe(1);
      ticks++;
    }
    // Once lit it burns all the way down, past the lighting minimum.
    expect(ticks / 60).toBeCloseTo(NITRO_SECONDS, 1);
    inputs[0].bits = InputBit.Throttle;
    world.step(inputs);
    expect(kart.nitroLit).toBe(0);
    // Holding the button on an empty meter doesn't relight it as the meter refills.
    inputs[0].bits = InputBit.Nitro | InputBit.Throttle;
    kart.nitro = NITRO_MIN / 2;
    world.step(inputs);
    expect(kart.nitroLit).toBe(0);
  });

  test("nitro stacks on top of another boost", () => {
    const top = (nitro: boolean) => {
      const world = solo();
      skipCountdown(world);
      const kart = world.karts[1];
      const inputs = world.karts.map(() => makeInput());
      inputs[1].bits = InputBit.Throttle | (nitro ? InputBit.Nitro : 0);
      kart.nitro = 1;
      kart.speed = 40;
      for (let t = 0; t < 90; t++) {
        kart.boostT = 1;
        kart.boostKind = BoostKind.Pad;
        kart.d = 0;
        kart.heading = 0;
        world.step(inputs);
      }
      return kart.speed;
    };
    expect(top(true)).toBeGreaterThan(top(false) * 1.03);
  });

  test("item boxes give an item you can use straight away", () => {
    const world = solo();
    skipCountdown(world);
    const kart = world.karts[0];
    const box = world.track.itemBoxes[0];
    kart.dist = box.s;
    kart.d = box.d;
    const inputs = world.karts.map(() => makeInput());
    world.step(inputs);
    const item = kart.item;
    expect(item === ItemKind.Missile || item === ItemKind.TokenMaxing).toBe(true);
    inputs[0].bits = InputBit.Item;
    world.step(inputs);
    expect(kart.item).toBe(ItemKind.None);
    if (item === ItemKind.Missile) expect(world.missiles.some((m) => m.active)).toBe(true);
    else expect(kart.giantT).toBeGreaterThan(0);
  });

  test("letting go of the steering lines the kart back up with the road", () => {
    const world = solo();
    skipCountdown(world);
    const kart = world.karts[0];
    kart.speed = 30;
    kart.heading = 0.4;
    const inputs = world.karts.map(() => makeInput());
    inputs[0].bits = InputBit.Throttle;
    for (let t = 0; t < 60; t++) world.step(inputs);
    expect(Math.abs(kart.heading)).toBeLessThan(0.15);
  });

  test("a glancing wall scrape costs almost nothing, a head-on hit is flagged", () => {
    const world = solo();
    skipCountdown(world);
    // Not Claude: its perk shrugs walls off.
    const kart = world.karts[1];
    const limit = world.track.halfWidth - 1;
    const idle = world.karts.map(() => makeInput());
    kart.d = limit - 0.05;
    kart.speed = 50;
    kart.heading = 0.08;
    world.step(idle);
    expect(kart.speed).toBeGreaterThan(48);
    expect(kart.slowFlags & SlowFlag.Wall).toBe(0);
    for (let t = 0; t < 30; t++) world.step(idle);
    kart.d = limit - 0.2;
    kart.wallT = 0;
    kart.speed = 50;
    kart.heading = 1.2;
    world.step(idle);
    world.step(idle);
    expect(kart.speed).toBeLessThan(45);
    expect(kart.slowFlags & SlowFlag.Wall).toBeTruthy();
  });

  test("your own missile never hits you", () => {
    const world = solo();
    skipCountdown(world);
    const me = world.karts[0];
    world.spawnMissile(me, true);
    const m = world.missiles.find((x) => x.active)!;
    m.dist = me.dist;
    m.d = me.d;
    m.age = 2;
    world.step(world.karts.map(() => makeInput()));
    expect(me.stunT).toBe(0);
  });
});

describe("fun mechanics", () => {
  const countdownWith = (pressAt: number) => {
    const world = new World({ theme: "sf", seed: 8, racers: racers(2) });
    const inputs = world.karts.map(() => makeInput());
    while (world.phase === Phase.Countdown) {
      inputs[0].bits = world.phaseTicks <= pressAt ? InputBit.Throttle : 0;
      world.step(inputs);
    }
    return world.karts[0];
  };

  test("rocket start: press just before go", () => {
    const perfect = countdownWith(15);
    expect(perfect.startResult).toBe(2);
    expect(perfect.boostKind).toBe(BoostKind.Rocket);
    expect(countdownWith(40).startResult).toBe(1);
    // Holding the throttle through the whole countdown is a normal start, not a stall.
    const early = countdownWith(170);
    expect(early.startResult).toBe(0);
    expect(early.stunT).toBe(0);
    expect(countdownWith(-1).startResult).toBe(0);
  });

  test("a client predicts GO and the rocket start the same as the server", () => {
    // The server steps everyone; the client counts down alone with predictOne.
    for (const pressAt of [15, 40, 170, -1]) {
      const server = new World({ theme: "sf", seed: 8, racers: racers(2) });
      const client = new World({ theme: "sf", seed: 8, predict: true, racers: racers(2) });
      const inputs = server.karts.map(() => makeInput());
      for (let t = 0; t < 240; t++) {
        inputs[0].bits = server.phase === Phase.Countdown ? (server.phaseTicks <= pressAt ? InputBit.Throttle : 0) : InputBit.Throttle;
        server.step(inputs);
        client.predictOne(client.karts[0], inputs[0]);
      }
      expect(client.phase).toBe(Phase.Racing);
      expect(client.karts[0].startResult).toBe(server.karts[0].startResult);
      expect(client.karts[0].dist).toBeCloseTo(server.karts[0].dist, 3);
    }
  });

  test("every kart is a different machine", () => {
    const kinds = new Set(KARTS.map((k) => k.chassis.kind));
    expect(kinds.size).toBe(KARTS.length);
    for (const k of KARTS) expect(k.speed + k.handling + k.reliability + k.durability).toBe(28);
    const world = new World({ theme: "sf", seed: 3, racers: KARTS.map((_, i) => ({ kart: i, character: 0, bot: true })) });
    const by = (id: string) => world.karts[KARTS.findIndex((k) => k.id === id)];
    expect(by("grok").maxSpeed).toBeGreaterThan(by("qwen").maxSpeed);
    expect(by("qwen").accel).toBeGreaterThan(by("grok").accel * 1.5);
    expect(by("astra").mass).toBeGreaterThan(by("qwen").mass * 2);
  });

  test("slipstream tows you and fills the Compute meter", () => {
    const world = new World({ theme: "nyc", seed: 4, racers: racers(2) });
    const inputs = world.karts.map(() => makeInput());
    while (world.phase !== Phase.Racing) world.step(inputs);
    const [chaser, leader] = world.karts;
    const before = chaser.nitro;
    for (let t = 0; t < 90; t++) {
      leader.dist = chaser.dist + 10;
      leader.d = chaser.d;
      chaser.speed = Math.max(chaser.speed, 40);
      world.step(inputs);
    }
    expect(chaser.draft).toBe(1);
    expect(chaser.nitro).toBeGreaterThan(before + 0.3);
  });

  test("a close pass fills the meter, a bump doesn't count", () => {
    const pass = (side: number) => {
      const world = new World({ theme: "nyc", seed: 4, racers: racers(2) });
      const inputs = world.karts.map(() => makeInput());
      while (world.phase !== Phase.Racing) world.step(inputs);
      const [me, them] = world.karts;
      me.nitro = 0;
      me.dist = them.dist - 3;
      me.d = them.d + side;
      me.speed = 45;
      them.speed = 25;
      inputs[0].bits = InputBit.Throttle;
      for (let t = 0; t < 30; t++) world.step(inputs);
      return me;
    };
    const close = pass(3);
    expect(close.passes).toBe(1);
    expect(close.nitro).toBeGreaterThanOrEqual(NITRO_CLOSE_PASS);
    expect(pass(CLOSE_PASS_WIDTH + 2).passes).toBe(0);
  });

  test("chained drifts build bigger boosts; a wall breaks the chain", () => {
    // Grok: Claude's perk shrugs off the wall hit this test needs.
    const world = new World({ theme: "sf", seed: 2, racers: [{ kart: 1, character: 0, bot: true }] });
    const inputs = world.karts.map(() => makeInput());
    while (world.phase !== Phase.Racing) world.step(inputs);
    const kart = world.karts[0];
    const flat = () => {
      kart.d = 0;
      kart.z = 0;
      kart.vz = 0;
    };
    const drift = () => {
      flat();
      kart.heading = 0;
      kart.speed = 40;
      inputs[0].steer = 1;
      inputs[0].bits = InputBit.Throttle | InputBit.Drift;
      for (let t = 0; t < 50; t++) {
        flat();
        world.step(inputs);
      }
      inputs[0].bits = InputBit.Throttle;
      inputs[0].steer = 0;
      world.step(inputs);
      return kart.boostT;
    };
    const first = drift();
    expect(kart.driftChain).toBe(1);
    drift();
    const third = drift();
    expect(kart.driftChain).toBe(3);
    expect(third).toBeGreaterThan(first * 1.2);
    // A head-on wall hit breaks it.
    kart.d = world.track.halfWidth - 1.2;
    kart.heading = 1.2;
    kart.wallT = 0;
    world.step(inputs);
    world.step(inputs);
    expect(kart.driftChain).toBe(0);
    // So does waiting too long between drifts.
    drift();
    drift();
    expect(kart.driftChain).toBe(2);
    for (let t = 0; t < CHAIN_WINDOW * 60 + 5; t++) {
      flat();
      world.step(inputs);
    }
    drift();
    expect(kart.driftChain).toBe(1);
  });

  test("a trick in the air pays out on landing", () => {
    const world = new World({ theme: "sf", seed: 2, racers: racers(1) });
    const inputs = world.karts.map(() => makeInput());
    while (world.phase !== Phase.Racing) world.step(inputs);
    const kart = world.karts[0];
    kart.speed = 30;
    kart.z = 0.05;
    kart.vz = 12;
    for (let t = 0; t < 6; t++) world.step(inputs);
    inputs[0].bits = InputBit.Drift;
    world.step(inputs);
    expect(kart.trickPending).toBe(1);
    inputs[0].bits = 0;
    for (let t = 0; t < 120 && kart.z > 0; t++) world.step(inputs);
    expect(kart.boostKind).toBe(BoostKind.Trick);
  });

  test("tricks pick from the whole animation set, deterministically", () => {
    const pullTrick = (seed: number) => {
      const world = new World({ theme: "sf", seed, racers: racers(1) });
      const inputs = world.karts.map(() => makeInput());
      while (world.phase !== Phase.Racing) world.step(inputs);
      const kart = world.karts[0];
      kart.speed = 30;
      kart.z = 0.05;
      kart.vz = 12;
      for (let t = 0; t < 6; t++) world.step(inputs);
      inputs[0].bits = InputBit.Drift;
      world.step(inputs);
      expect(kart.trickPending).toBe(1);
      return kart.trickKind;
    };
    const kinds = Array.from({ length: 40 }, (_, seed) => pullTrick(seed + 1));
    expect(TRICK_KINDS).toBe(Object.keys(TrickKind).length);
    for (let k = 0; k < TRICK_KINDS; k++) expect(kinds).toContain(k);
    expect(pullTrick(7)).toBe(kinds[6]);
  });

  test("GPUs raise top speed and spill on hits", () => {
    const world = new World({ theme: "fab", seed: 6, racers: racers(8) });
    const inputs = world.karts.map(() => makeInput());
    for (let t = 0; t < 60 * 90; t++) {
      world.karts.forEach((k, i) => botInput(world, k, inputs[i]));
      world.step(inputs);
    }
    expect(world.events.some((e) => e.type === "gpu")).toBe(true);
    expect(world.track.coins.length).toBeGreaterThan(30);
  });
});

describe("connection stats", () => {
  test("gap summary counts hitches and skips paused stretches", () => {
    const gaps = new GapStats();
    let t = 0;
    for (let i = 0; i < 100; i++) gaps.arrive((t += 50));
    gaps.arrive((t += 400));
    gaps.pause();
    gaps.arrive((t += 10_000));
    gaps.arrive((t += 50));
    const s = gaps.summary();
    expect(s.n).toBe(101);
    expect(s.p50).toBe(50);
    expect(s.max).toBe(400);
    expect(s.over150).toBe(1);
    expect(s.over300).toBe(1);
  });

  test("untrusted reports are clamped", () => {
    const r = cleanNetReport({ down: { p99: 1e12, n: "7" }, rttP50: -5, connection: "4g".repeat(50), reconnects: 1e6 })!;
    expect(r.down.p99).toBe(600_000);
    expect(r.down.n).toBe(7);
    expect(r.rttP50).toBe(0);
    expect(r.connection.length).toBe(16);
    expect(r.reconnects).toBe(100);
    expect(cleanNetReport("nope")).toBeNull();
  });
});
