import { ItemKind, KARTS, type Perk, type ThemeId } from "./content.ts";
import { type Input, InputBit } from "./input.ts";
import { hash01 } from "./rng.ts";
import { FeatureKind, type Track, curvatureAt, generateTrack, gridSlot, makeSurface, surfaceAt, wrapS } from "./track.ts";

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const LAPS = 2;
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const RESET_TICKS = 10 * TICK_RATE;
export const KART_RADIUS = 1.0;
/** Once someone finishes, everyone else has this long before the race is called. */
export const FINISH_GRACE_TICKS = 20 * TICK_RATE;
const GRAVITY = 34;
const SLOPE_GRAVITY = 16;
/** Seconds the item roulette spins before you can use what you got. */
export const ITEM_ROLL_SECONDS = 1.1;
export const DRIFT_TIER1 = 0.7;
export const DRIFT_TIER2 = 1.4;
export const DRIFT_TIER3 = 2.3;
/** Each GPU adds this share of top speed and acceleration. */
export const GPU_BONUS = 0.01;
export const MAX_GPUS = 10;
const COIN_RESPAWN_TICKS = 10 * TICK_RATE;
/** Rocket start window: throttle pressed this many ticks before GO. */
export const START_PERFECT_TICKS = 24;
export const START_GOOD_TICKS = 54;
export const START_FLOOD_TICKS = 100;
/** Far behind the leader, a little extra top speed keeps the race close (max +5%). */
const comebackBonus = (world: World, kart: Kart): number => {
  const leader = world.order[0];
  if (!leader || leader === kart || kart.finished) return 0;
  const gap = leader.dist - kart.dist;
  return Math.max(0, Math.min(1, (gap - 120) / 600)) * 0.05;
};

/** Slipstream: tucked in behind another kart, a charge builds into a boost. */
export const DRAFT_SECONDS = 1.2;
const updateDraft = (world: World, kart: Kart, grounded: boolean): boolean => {
  const L = world.track.length;
  let drafting = false;
  if (grounded && kart.speed > 25 && kart.boostKind !== BoostKind.Draft) {
    for (const other of world.karts) {
      if (other === kart || other.finished || other.z > 2) continue;
      let ds = (other.dist - kart.dist) % L;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      if (ds > 3 && ds < 24 && Math.abs(other.d - kart.d) < 2.4) {
        drafting = true;
        break;
      }
    }
  }
  if (drafting) {
    kart.draftCharge += DT;
    if (kart.draftCharge >= DRAFT_SECONDS) {
      giveBoost(kart, 1.0, BoostKind.Draft);
      kart.draftCharge = 0;
    }
  } else {
    kart.draftCharge = Math.max(0, kart.draftCharge - 2 * DT);
  }
  return drafting;
};

/** Banked, assisted cornering: this share of the road's turn rotates the kart with it. */
export const CORNER_ASSIST = 0.16;
export const STAT = {
  speedBase: 47.5,
  speedPer: 0.6,
  accelBase: 16,
  accelLight: 1.6,
  accelHandling: 0.5,
  steerBase: 1.5,
  steerPer: 0.14,
  assistPer: 0.012,
  stunBase: 1.45,
  stunPerDurability: 0.075,
};
/** Why a kart is slower than it wants to be, so the HUD can always say. */
export const SlowFlag = { Wall: 1, SlowZone: 2, Oil: 4, Reset: 8, Hit: 16 } as const;
export const BoostKind = { None: 0, Pad: 1, Drift: 2, SuperDrift: 3, Landing: 4, Item: 5, UltraDrift: 6, Draft: 7, Trick: 8, Rocket: 9 } as const;
const MISSILE_SPEED = 88;
const BULLET_SPEED = 96;
const BOX_RESPAWN_TICKS = 2 * TICK_RATE;

export const Phase = {
  Countdown: 1,
  Racing: 2,
  Finished: 3,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export interface RacerSpec {
  readonly kart: number;
  readonly character: number;
  readonly bot: boolean;
}

export class Kart {
  readonly slot: number;
  readonly kartModel: number;
  readonly character: number;
  readonly bot: boolean;
  readonly perk: Perk;
  readonly maxSpeed: number;
  readonly accel: number;
  readonly steerRate: number;
  readonly grip: number;
  /** Reliability as traction: how much speed walls, slow zones and oil can take from you. */
  readonly traction: number;
  readonly hpMax: number;
  readonly mass: number;
  readonly durability: number;
  readonly cornerAssist: number;

  dist = 0;
  d = 0;
  z = 0;
  vz = 0;
  heading = 0;
  slip = 0;
  speed = 0;
  boostT = 0;
  stunT = 0;
  slickT = 0;
  slickImmuneT = 0;
  wallT = 0;
  slowFlags = 0;
  bulletT = 0;
  agiT = 0;
  airT = 0;
  kickV = 0;
  itemRollT = 0;
  boostKind = 0;
  gpus = 0;
  draftCharge = 0;
  trickT = 0;
  trickPending = 0;
  startHold = 0;
  /** -1 flooded, 0 normal, 1 good, 2 perfect */
  startResult = 0;
  botStartTick = 0;
  botSkill = 0.85;
  drifting = 0;
  driftDir = 0;
  driftCharge = 0;
  hp = 0;
  item: number = ItemKind.None;
  itemCount = 0;
  item2: number = ItemKind.None;
  item2Count = 0;
  finishTick = -1;
  prevBits = 0;
  inReset = 0;
  slowZone = 0;
  rank = 0;
  botLane = 0;
  botItemDelay = 0;
  botStuckT = 0;

  constructor(slot: number, spec: RacerSpec) {
    const model = KARTS[spec.kart] ?? KARTS[0];
    this.slot = slot;
    this.kartModel = spec.kart;
    this.character = spec.character;
    this.bot = spec.bot;
    this.perk = model.perk;
    // Tuned with scripts/balance.ts: every kart should win about equally often.
    this.maxSpeed = STAT.speedBase + model.speed * STAT.speedPer;
    this.accel = STAT.accelBase + (10 - model.speed) * STAT.accelLight + model.handling * STAT.accelHandling;
    this.steerRate = STAT.steerBase + model.handling * STAT.steerPer;
    this.grip = 3.5 + model.handling * 0.45;
    this.cornerAssist = CORNER_ASSIST + model.handling * STAT.assistPer;
    this.traction = model.reliability / 10;
    this.hpMax = 60 + model.durability * 10;
    this.mass = 0.75 + model.durability * 0.07;
    this.durability = model.durability;
    this.hp = this.hpMax;
  }

  get invincible(): boolean {
    return this.agiT > 0 || this.bulletT > 0;
  }

  get finished(): boolean {
    return this.finishTick >= 0;
  }
}

/**
 * Kart fields replicated over the network, in wire order. Everything the
 * physics step reads lives here so a client can rewind to a snapshot and
 * replay its own unacknowledged inputs.
 */
export const KART_NET_FIELDS = [
  "dist", "d", "z", "vz", "heading", "slip", "speed", "kickV",
  "boostT", "boostKind", "stunT", "slickT", "slickImmuneT", "slowFlags", "bulletT", "agiT", "airT", "itemRollT",
  "drifting", "driftDir", "driftCharge", "hp", "gpus", "draftCharge", "trickT", "trickPending", "startResult",
  "item", "itemCount", "item2", "item2Count", "finishTick", "prevBits",
] as const satisfies ReadonlyArray<keyof Kart>;

export class Missile {
  active = false;
  dist = 0;
  d = 0;
  heading = 0;
  life = 0;
  owner = -1;
  bounces = 0;
  age = 0;
}

export class Oil {
  active = false;
  dist = 0;
  d = 0;
  life = 0;
  owner = -1;
  age = 0;
}

export class ResetWall {
  active = false;
  owner = -1;
  dist = 0;
  speed = 0;
  ticksLeft = 0;
}

export type GameEvent =
  | { readonly type: "hit"; readonly victim: number; readonly by: number; readonly cause: "missile" | "ram" }
  | { readonly type: "item"; readonly slot: number; readonly item: number }
  | { readonly type: "use"; readonly slot: number; readonly item: number }
  | { readonly type: "finish"; readonly slot: number; readonly place: number }
  | { readonly type: "gpu"; readonly slot: number; readonly count: number };

export interface WorldOptions {
  readonly theme: ThemeId;
  readonly seed: number;
  readonly racers: ReadonlyArray<RacerSpec>;
  readonly laps?: number;
  /** Prediction worlds skip authoritative side effects (pickups, item use). */
  readonly predict?: boolean;
}

export class World {
  readonly track: Track;
  readonly seed: number;
  readonly laps: number;
  readonly predict: boolean;
  readonly karts: Kart[];
  readonly order: Kart[];
  readonly missiles: Missile[] = Array.from({ length: 96 }, () => new Missile());
  readonly oils: Oil[] = Array.from({ length: 48 }, () => new Oil());
  readonly reset = new ResetWall();
  readonly boxReadyTick: Int32Array;
  readonly coinReadyTick: Int32Array;
  readonly finishOrder: number[] = [];
  readonly events: GameEvent[] = [];
  tick = 0;
  phase: Phase = Phase.Countdown;
  phaseTicks = COUNTDOWN_TICKS;
  private oilCursor = 0;

  constructor(options: WorldOptions) {
    this.seed = options.seed;
    this.laps = options.laps ?? LAPS;
    this.predict = options.predict ?? false;
    this.track = generateTrack(options.theme, options.seed, options.racers.length);
    this.karts = options.racers.map((spec, slot) => {
      const kart = new Kart(slot, spec);
      const grid = gridSlot(this.track, slot);
      kart.dist = grid.dist;
      kart.d = grid.d;
      kart.botLane = grid.d;
      kart.botItemDelay = 1 + hash01(options.seed, slot, 99) * 2;
      kart.botStartTick = 6 + Math.floor(hash01(options.seed, slot, 77) * 70);
      kart.botSkill = 0.8 + hash01(options.seed, slot, 55) * 0.1;
      return kart;
    });
    this.order = this.karts.slice();
    this.boxReadyTick = new Int32Array(this.track.itemBoxes.length);
    this.coinReadyTick = new Int32Array(this.track.coins.length);
  }

  get raceLength(): number {
    return this.laps * this.track.length;
  }

  lapOf(kart: Kart): number {
    return Math.min(this.laps, Math.max(1, Math.floor(kart.dist / this.track.length) + 1));
  }

  /** Advance one fixed tick. `inputs[slot]` is that racer's input for this tick. */
  step(inputs: ReadonlyArray<Input>): void {
    this.tick++;
    if (this.phase === Phase.Countdown) {
      this.phaseTicks--;
      // Rocket start: how long has each driver been on the throttle?
      for (let i = 0; i < this.karts.length; i++) {
        const kart = this.karts[i];
        if (inputs[i] && inputs[i].bits & InputBit.Throttle) kart.startHold++;
        else kart.startHold = 0;
      }
      if (this.phaseTicks <= 0) {
        this.phase = Phase.Racing;
        for (const kart of this.karts) applyStart(kart);
      }
      return;
    }
    if (this.phase === Phase.Finished) return;

    const karts = this.karts;
    for (let i = 0; i < karts.length; i++) stepKart(this, karts[i], inputs[i]);
    this.collideKarts();
    if (!this.predict) {
      this.stepMissiles();
      this.stepOils();
    }
    this.stepReset();
    this.updateRanks();
  }

  /** Step a single kart in isolation; used by clients replaying unacknowledged inputs. */
  stepOne(kart: Kart, input: Input): void {
    if (this.phase !== Phase.Racing) return;
    stepKart(this, kart, input);
  }

  private collideKarts(): void {
    const karts = this.karts;
    const L = this.track.length;
    for (let i = 0; i < karts.length; i++) {
      const a = karts[i];
      for (let j = i + 1; j < karts.length; j++) {
        const b = karts[j];
        // AGI and the Nerf Bullet hit anything their aura touches, not just the chassis.
        const reach = a.invincible !== b.invincible ? 3.6 : KART_RADIUS * 2;
        let ds = (a.dist - b.dist) % L;
        if (ds > L / 2) ds -= L;
        if (ds < -L / 2) ds += L;
        if (ds > reach || ds < -reach) continue;
        const dd = a.d - b.d;
        if (dd > reach || dd < -reach || Math.abs(a.z - b.z) > 2.5) continue;
        const len = Math.hypot(ds, dd);
        if (len >= reach || len < 1e-6) continue;
        const nx = ds / len;
        const ny = dd / len;
        if (a.invincible !== b.invincible) {
          if (!this.predict) {
            const [attacker, victim, side] = a.invincible ? [a, b, -ny] : [b, a, ny];
            knockOut(this, victim, attacker.slot, side === 0 ? 1 : Math.sign(side));
          }
          continue;
        }
        const overlap = reach - len;
        const total = a.mass + b.mass;
        const pushA = (overlap * b.mass) / total;
        const pushB = (overlap * a.mass) / total;
        a.dist += nx * pushA;
        a.d += ny * pushA;
        b.dist -= nx * pushB;
        b.d -= ny * pushB;
        a.kickV += ny * 5 * (b.mass / total);
        b.kickV -= ny * 5 * (a.mass / total);
        if (nx > 0) b.speed *= 0.97;
        else a.speed *= 0.97;
      }
    }
  }

  private stepMissiles(): void {
    const track = this.track;
    const L = track.length;
    for (const m of this.missiles) {
      if (!m.active) continue;
      m.age += DT;
      m.life -= DT;
      if (m.life <= 0) {
        m.active = false;
        continue;
      }
      const k = curvatureAt(track, m.dist);
      const dsdt = (MISSILE_SPEED * Math.cos(m.heading)) / Math.max(0.2, 1 - k * m.d);
      m.dist += dsdt * DT;
      m.d += MISSILE_SPEED * Math.sin(m.heading) * DT;
      m.heading -= k * dsdt * DT;
      const limit = track.halfWidth - 0.6;
      if (m.d > limit || m.d < -limit) {
        m.d = m.d > 0 ? limit : -limit;
        m.heading = -m.heading;
        m.bounces++;
        if (m.bounces > 8) m.active = false;
      }
      for (const kart of this.karts) {
        if (kart.finished || kart.z > 3) continue;
        // Your own missiles never hit you, even after a bounce.
        if (kart.slot === m.owner) continue;
        let ds = (kart.dist - m.dist) % L;
        if (ds > L / 2) ds -= L;
        if (ds < -L / 2) ds += L;
        if (Math.abs(ds) > 2.4 || Math.abs(kart.d - m.d) > 2.0) continue;
        m.active = false;
        if (!kart.invincible) {
          damage(this, kart, kart.perk === "tank" ? 17 : 34, m.owner);
        }
        break;
      }
    }
  }

  private stepOils(): void {
    const L = this.track.length;
    for (const oil of this.oils) {
      if (!oil.active) continue;
      oil.age += DT;
      oil.life -= DT;
      if (oil.life <= 0) {
        oil.active = false;
        continue;
      }
      for (const kart of this.karts) {
        if (kart.invincible || kart.z > 1 || kart.slickImmuneT > 0) continue;
        // Nothing you drop can ever slow you down.
        if (kart.slot === oil.owner) continue;
        let ds = (kart.dist - oil.dist) % L;
        if (ds > L / 2) ds -= L;
        if (ds < -L / 2) ds += L;
        if (ds * ds + (kart.d - oil.d) * (kart.d - oil.d) > 16) continue;
        kart.slickT = kart.perk === "constitutional" ? 0.75 : 1.5;
        kart.slickImmuneT = kart.slickT + 1;
        kart.drifting = 0;
      }
    }
  }

  private stepReset(): void {
    const reset = this.reset;
    for (const kart of this.karts) kart.inReset = 0;
    if (!reset.active) return;
    reset.ticksLeft--;
    if (reset.ticksLeft <= 0) {
      reset.active = false;
      return;
    }
    reset.speed += 9 * DT;
    reset.dist += reset.speed * DT;
    for (const kart of this.karts) {
      if (kart.slot === reset.owner || kart.finished || kart.invincible) continue;
      if (kart.dist < reset.dist) kart.inReset = 1;
    }
  }

  private updateRanks(): void {
    const order = this.order;
    order.sort(compareKarts);
    for (let i = 0; i < order.length; i++) order[i].rank = i;
    if (this.predict) return;
    const hasHumans = this.karts.some((k) => !k.bot);
    let allDone = true;
    for (const kart of this.karts) {
      if (!kart.finished && kart.dist >= this.raceLength) {
        kart.finishTick = this.tick;
        this.finishOrder.push(kart.slot);
        this.events.push({ type: "finish", slot: kart.slot, place: this.finishOrder.length });
      }
      if (!kart.finished && (!kart.bot || !hasHumans)) allDone = false;
    }
    const first = this.finishOrder.length > 0 ? this.karts[this.finishOrder[0]].finishTick : -1;
    const graceOver = first >= 0 && this.tick - first > FINISH_GRACE_TICKS;
    if (allDone || graceOver) this.phase = Phase.Finished;
  }

  spawnMissile(owner: Kart, backward: boolean): void {
    const m = this.missiles.find((x) => !x.active);
    if (!m) return;
    m.active = true;
    m.owner = owner.slot;
    m.dist = owner.dist + (backward ? -3 : 3);
    m.d = owner.d;
    m.heading = backward ? Math.PI : owner.heading - owner.slip;
    m.life = 4;
    m.bounces = 0;
    m.age = 0;
  }

  spawnOil(owner: Kart): void {
    const oil = this.oils[this.oilCursor];
    this.oilCursor = (this.oilCursor + 1) % this.oils.length;
    oil.active = true;
    oil.owner = owner.slot;
    oil.dist = owner.dist - 3.5;
    oil.d = owner.d;
    oil.life = 25;
    oil.age = 0;
  }

  triggerReset(owner: Kart): void {
    let back = Number.POSITIVE_INFINITY;
    for (const kart of this.karts) {
      if (kart.slot !== owner.slot && !kart.finished) back = Math.min(back, kart.dist);
    }
    if (!Number.isFinite(back)) back = owner.dist - 200;
    const reset = this.reset;
    reset.active = true;
    reset.owner = owner.slot;
    reset.dist = back - 40;
    reset.speed = 32;
    reset.ticksLeft = RESET_TICKS;
  }
}

const applyStart = (kart: Kart): void => {
  const held = kart.startHold;
  if (held <= 0) kart.startResult = 0;
  else if (held <= START_PERFECT_TICKS) {
    kart.startResult = 2;
    giveBoost(kart, 1.6, BoostKind.Rocket);
  } else if (held <= START_GOOD_TICKS) {
    kart.startResult = 1;
    giveBoost(kart, 0.8, BoostKind.Rocket);
  } else if (held >= START_FLOOD_TICKS) {
    kart.startResult = -1;
    kart.stunT = 0.9;
  } else kart.startResult = 0;
  kart.startHold = 0;
};

const compareKarts = (a: Kart, b: Kart): number => {
  if (a.finished && b.finished) return a.finishTick - b.finishTick;
  if (a.finished) return -1;
  if (b.finished) return 1;
  return b.dist - a.dist;
};

const wrapAngle = (a: number): number => {
  if (a > Math.PI) a -= 2 * Math.PI;
  else if (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

const stun = (kart: Kart, seconds: number): void => {
  const recovery = kart.perk === "open-weights" ? 0.65 : 1;
  kart.stunT = Math.max(kart.stunT, seconds * recovery * (STAT.stunBase - kart.durability * STAT.stunPerDurability));
  kart.speed *= 0.3;
  kart.drifting = 0;
  kart.driftCharge = 0;
  kart.boostT = 0;
};

const spillGpus = (kart: Kart): void => {
  kart.gpus = Math.max(0, kart.gpus - (kart.perk === "tank" ? 1 : 3));
};

const damage = (world: World, kart: Kart, amount: number, by: number): void => {
  spillGpus(kart);
  kart.hp -= amount;
  if (kart.hp <= 0) {
    kart.hp = kart.hpMax;
    stun(kart, 2.2);
  } else {
    stun(kart, 1.2);
  }
  kart.vz = 9;
  kart.z = Math.max(kart.z, 0.05);
  world.events.push({ type: "hit", victim: kart.slot, by, cause: "missile" });
};

/** AGI / Nerf Bullet contact: launch the victim up and sideways like a pinball. */
const knockOut = (world: World, kart: Kart, by: number, side: number): void => {
  if (kart.stunT > 0.4) return;
  spillGpus(kart);
  stun(kart, 1.4);
  kart.kickV = side * 24;
  kart.vz = 15;
  kart.z = Math.max(kart.z, 0.05);
  world.events.push({ type: "hit", victim: kart.slot, by, cause: "ram" });
};

const rollItem = (world: World, kart: Kart): number => {
  const n = world.karts.length;
  const frac = n > 1 ? kart.rank / (n - 1) : 0;
  const leader = world.order[0];
  const gap = leader ? leader.dist - kart.dist : 0;
  const r = hash01(world.seed, world.tick, kart.slot * 31 + 7);
  const resetFree = !world.reset.active;
  let table: ReadonlyArray<readonly [number, number]>;
  if (frac > 0.85 && gap > 250 && n >= 4) {
    table = [[ItemKind.NerfBullet, 45], [ItemKind.Agi, 30], [ItemKind.TripleMissile, 25]];
  } else if (frac > 0.6) {
    table = [[ItemKind.Agi, 32], [ItemKind.TripleMissile, 25], [ItemKind.Missile, 15], [ItemKind.Reset, resetFree ? 16 : 0], [ItemKind.Oil, 12]];
  } else if (frac > 0.25) {
    table = [[ItemKind.Missile, 30], [ItemKind.TripleMissile, 22], [ItemKind.Oil, 20], [ItemKind.Reset, resetFree ? 16 : 0], [ItemKind.Agi, 12]];
  } else {
    table = [[ItemKind.Missile, 42], [ItemKind.Oil, 40], [ItemKind.TripleMissile, 10], [ItemKind.Reset, resetFree ? 8 : 0]];
  }
  let total = 0;
  for (const [, w] of table) total += w;
  let pick = r * total;
  for (const [item, w] of table) {
    pick -= w;
    if (pick < 0) return item;
  }
  return ItemKind.Missile;
};

const giveItem = (world: World, kart: Kart): void => {
  const item = rollItem(world, kart);
  const count = item === ItemKind.TripleMissile ? 3 : 1;
  if (kart.item === ItemKind.None) {
    kart.item = item;
    kart.itemCount = count;
    kart.itemRollT = ITEM_ROLL_SECONDS;
  } else if (kart.perk === "twin-engine" && kart.item2 === ItemKind.None) {
    kart.item2 = item;
    kart.item2Count = count;
  } else {
    return;
  }
  world.events.push({ type: "item", slot: kart.slot, item });
};

const useItem = (world: World, kart: Kart, backward: boolean): void => {
  const item = kart.item;
  if (item === ItemKind.None || kart.itemRollT > 0) return;
  const timed = kart.perk === "plugins" ? 1.2 : 1;
  switch (item) {
    case ItemKind.Missile:
    case ItemKind.TripleMissile:
      world.spawnMissile(kart, backward);
      break;
    case ItemKind.Oil:
      world.spawnOil(kart);
      break;
    case ItemKind.Reset:
      world.triggerReset(kart);
      break;
    case ItemKind.NerfBullet:
      kart.bulletT = 6 * timed;
      kart.stunT = 0;
      kart.drifting = 0;
      break;
    case ItemKind.Agi:
      kart.agiT = 7 * timed;
      kart.stunT = 0;
      kart.boostT = Math.max(kart.boostT, 1);
      kart.boostKind = BoostKind.Item;
      break;
  }
  world.events.push({ type: "use", slot: kart.slot, item });
  kart.itemCount--;
  if (kart.itemCount <= 0) {
    kart.item = kart.item2;
    kart.itemCount = kart.item2Count;
    kart.item2 = ItemKind.None;
    kart.item2Count = 0;
  }
};

const giveBoost = (kart: Kart, seconds: number, kind: number): void => {
  if (seconds >= kart.boostT) kart.boostKind = kind;
  kart.boostT = Math.max(kart.boostT, seconds);
};

const applyFeatures = (world: World, kart: Kart): void => {
  const track = world.track;
  const s = wrapS(track, kart.dist);
  const bucket = Math.floor(s / track.bucketSize);
  const start = track.bucketStart[bucket];
  const end = track.bucketStart[bucket + 1];
  kart.slowZone = 0;
  for (let i = start; i < end; i++) {
    const f = track.features[track.bucketItems[i]];
    if (f.kind === FeatureKind.Bumper) {
      const ds = s - f.s;
      const dd = kart.d - f.d;
      const reach = f.halfWidth + KART_RADIUS;
      const dist2 = ds * ds + dd * dd;
      if (dist2 >= reach * reach || kart.z > 2) continue;
      const len = Math.sqrt(dist2) || 1e-3;
      kart.dist += (ds / len) * (reach - len);
      kart.d += (dd / len) * (reach - len);
      // Pinball: fire the kart sideways off the bumper and keep it racing forward.
      const side = dd === 0 ? 1 : Math.sign(dd);
      kart.kickV = side * 20;
      kart.heading *= 0.5;
      kart.slip = 0;
      kart.drifting = 0;
      kart.speed = Math.max(kart.speed, Math.min(kart.maxSpeed * 1.25, Math.abs(kart.speed) * 1.12 + 6));
      kart.vz = Math.max(kart.vz, 7);
      kart.z = Math.max(kart.z, 0.05);
      continue;
    }
    if (kart.z > 1.2) continue;
    if (s < f.s || s > f.s + f.length) continue;
    if (Math.abs(kart.d - f.d) > f.halfWidth) continue;
    if (f.kind === FeatureKind.Boost) {
      giveBoost(kart, 1.8, BoostKind.Pad);
    } else if (f.kind === FeatureKind.Slow) {
      if (kart.bulletT <= 0 && kart.agiT <= 0) kart.slowZone = 1;
    } else if (f.kind === FeatureKind.Ramp || f.kind === FeatureKind.Launch) {
      if (kart.z < 0.3 && kart.vz <= 0 && kart.speed > 10) {
        const launch = f.kind === FeatureKind.Launch;
        kart.vz = launch ? Math.min(22, 6 + kart.speed * 0.3) : Math.min(16, 4 + kart.speed * 0.22);
        kart.z = 0.05;
        if (launch) giveBoost(kart, 1.4, BoostKind.Pad);
      }
    }
  }

  if (world.predict || kart.finished) return;
  const coins = track.coins;
  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    const ds = s - coin.s;
    if (ds > 1.8 || ds < -1.8) continue;
    if (Math.abs(kart.d - coin.d) > 1.8 || Math.abs(kart.z + 0.6 - coin.h) > 1.9) continue;
    if (world.coinReadyTick[i] > world.tick) continue;
    world.coinReadyTick[i] = world.tick + COIN_RESPAWN_TICKS;
    if (kart.gpus < MAX_GPUS) kart.gpus++;
    world.events.push({ type: "gpu", slot: kart.slot, count: kart.gpus });
  }
  const boxes = track.itemBoxes;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const ds = s - box.s;
    if (ds > 2 || ds < -2) continue;
    if (Math.abs(kart.d - box.d) > 2.2 || kart.z > 3) continue;
    if (world.boxReadyTick[i] > world.tick) continue;
    world.boxReadyTick[i] = world.tick + BOX_RESPAWN_TICKS;
    giveItem(world, kart);
  }
};

const surface = makeSurface();

const stepKart = (world: World, kart: Kart, input: Input): void => {
  const track = world.track;
  const bits = kart.finished ? InputBit.Throttle : input.bits;
  const pressed = bits & ~kart.prevBits;
  kart.prevBits = bits;
  const control = kart.stunT <= 0;
  const grounded = kart.z <= 0 && kart.vz <= 0;

  if (kart.boostT > 0) kart.boostT -= DT;
  if (kart.boostT <= 0) kart.boostKind = BoostKind.None;
  if (kart.stunT > 0) kart.stunT -= DT;
  if (kart.slickT > 0) kart.slickT -= DT;
  if (kart.slickImmuneT > 0) kart.slickImmuneT -= DT;
  if (kart.wallT > 0) kart.wallT -= DT;
  if (kart.bulletT > 0) kart.bulletT -= DT;
  if (kart.agiT > 0) kart.agiT -= DT;
  if (kart.itemRollT > 0) kart.itemRollT -= DT;
  if (kart.trickT > 0) kart.trickT -= DT;

  // Tap drift in the air to pull a trick; land it for a boost.
  if (!grounded && control && pressed & InputBit.Drift && kart.airT > 0.06 && !kart.trickPending && kart.bulletT <= 0) {
    kart.trickT = 0.45;
    kart.trickPending = 1;
  }

  if (!world.predict && control && pressed & InputBit.Item) {
    useItem(world, kart, (bits & InputBit.Back) !== 0);
  }

  const throttleHeld = (bits & InputBit.Throttle) !== 0;
  const engineCut = false;

  surfaceAt(track, kart.dist, surface);
  const k = surface.curvature;
  // Keep a wall flag briefly so the HUD can name it; everything else is live state.
  kart.slowFlags = (kart.slowFlags & SlowFlag.Wall && kart.wallT > 0.1 ? SlowFlag.Wall : 0)
    | (kart.slowZone ? SlowFlag.SlowZone : 0)
    | (kart.slickT > 0 ? SlowFlag.Oil : 0)
    | (kart.inReset ? SlowFlag.Reset : 0)
    | (kart.stunT > 0 ? SlowFlag.Hit : 0);
  let steer = control ? Math.max(-1, Math.min(1, input.steer)) : 0;
  if (kart.slickT > 0) steer = steer * 0.35 + Math.sin(world.tick * 0.33 + kart.slot) * 0.9;

  if (kart.bulletT > 0) {
    kart.speed += (BULLET_SPEED - kart.speed) * Math.min(1, 3 * DT);
    const want = Math.max(-0.45, Math.min(0.45, -kart.d * 0.08));
    kart.heading += (want - kart.heading) * Math.min(1, 6 * DT);
    kart.slip = 0;
    kart.drifting = 0;
  } else {
    let maxSpeed = kart.maxSpeed;
    let accel = kart.accel;
    const gpuBonus = 1 + kart.gpus * GPU_BONUS;
    maxSpeed *= gpuBonus * (1 + comebackBonus(world, kart));
    accel *= gpuBonus;
    if (updateDraft(world, kart, grounded)) maxSpeed *= 1.04;
    if (kart.boostT > 0) {
      maxSpeed *= kart.perk === "unhinged" ? 1.42 : 1.36;
      accel *= 2.2;
    }
    if (kart.agiT > 0) maxSpeed *= 1.3;
    if (kart.slowZone) maxSpeed *= 0.55 + kart.traction * 0.2;
    if (kart.inReset) maxSpeed *= 0.42;

    const throttle = control && !engineCut && (throttleHeld || kart.boostT > 0);
    const brake = control && (bits & InputBit.Brake) !== 0;
    if (throttle && kart.speed < maxSpeed) {
      const ratio = Math.max(0, kart.speed) / maxSpeed;
      kart.speed = Math.min(maxSpeed, kart.speed + accel * (1 - 0.7 * ratio) * DT);
    } else if (kart.speed > maxSpeed) {
      // Momentum: after a boost the extra speed fades out gently instead of cutting off.
      kart.speed -= (kart.speed - maxSpeed) * Math.min(1, (kart.slowZone || kart.inReset ? 3 : 0.55) * DT);
    } else if (brake) {
      kart.speed = kart.speed > 0 ? kart.speed - 48 * DT : Math.max(-14, kart.speed - 20 * DT);
    } else {
      // Off the throttle the kart slows down noticeably: drag plus rolling resistance.
      const drop = (Math.abs(kart.speed) * 1.1 + 7) * DT;
      kart.speed = Math.abs(kart.speed) <= drop ? 0 : kart.speed - Math.sign(kart.speed) * drop;
    }
    if (!control) kart.speed -= kart.speed * 2.5 * DT;

    const driftHeld = (bits & InputBit.Drift) !== 0;
    if (control && grounded && driftHeld && !kart.drifting && Math.abs(steer) > 0.3 && kart.speed > 14) {
      kart.drifting = 1;
      kart.driftDir = Math.sign(steer);
      kart.driftCharge = 0;
    }
    if (kart.drifting) {
      kart.driftCharge += DT;
      if (!driftHeld || kart.speed < 10 || !control) {
        const charge = kart.driftCharge;
        const story = kart.perk === "storyteller" ? 1.4 : 1;
        if (control && charge >= DRIFT_TIER3) giveBoost(kart, 1.8 * story, BoostKind.UltraDrift);
        else if (control && charge >= DRIFT_TIER2) giveBoost(kart, 1.25 * story, BoostKind.SuperDrift);
        else if (control && charge >= DRIFT_TIER1) giveBoost(kart, 0.7 * story, BoostKind.Drift);
        kart.drifting = 0;
        kart.driftCharge = 0;
      }
    }

    const absSpeed = Math.abs(kart.speed);
    const speedFactor = Math.min(1, absSpeed / 10) * (1 - 0.3 * Math.min(1, absSpeed / 60));
    let yaw = kart.drifting
      ? kart.steerRate * speedFactor * (kart.driftDir * 0.8 + steer * 0.5)
      : steer * kart.steerRate * speedFactor * (kart.speed < 0 ? -1 : 1);
    if (!grounded) yaw *= 0.5;
    kart.heading += yaw * DT;

    const slipTarget = kart.drifting ? kart.driftDir * 0.38 : 0;
    const slipRate = kart.drifting ? 3 : kart.slickT > 0 ? 0.8 : kart.grip;
    kart.slip += (slipTarget - kart.slip) * Math.min(1, slipRate * DT);
  }

  if (grounded) {
    kart.speed -= SLOPE_GRAVITY * surface.slope * (surface.loop ? 0.5 : 1) * DT;
    if (surface.loop && kart.speed < 26) kart.speed = 26;
  }

  const move = kart.heading - kart.slip;
  const dsdt = (kart.speed * Math.cos(move)) / Math.max(0.2, 1 - k * kart.d);
  kart.dist += dsdt * DT;
  kart.d += (kart.speed * Math.sin(move) + kart.kickV) * DT;
  kart.kickV -= kart.kickV * Math.min(1, 2.6 * DT);
  // In the air the kart keeps following the road's curve, so jumps don't land you in the wall.
  const assist = surface.loop ? 0 : grounded ? kart.cornerAssist : 0.9;
  kart.heading = wrapAngle(kart.heading - k * dsdt * DT * (1 - assist));

  const limit = track.halfWidth - KART_RADIUS;
  if (kart.d > limit || kart.d < -limit) {
    const side = kart.d > 0 ? 1 : -1;
    kart.d = side * limit;
    if (kart.kickV * side > 0) kart.kickV = -kart.kickV * 0.45;
    const impact = Math.sin(move) * side;
    if (impact > 0) {
      const h = kart.heading;
      kart.heading = Math.abs(h) < Math.PI / 2 ? h * 0.35 : Math.sign(h) * (Math.PI - (Math.PI - Math.abs(h)) * 0.35);
      kart.slip = 0;
      // Walls are glancing: a scrape costs almost nothing, only a head-on hit hurts.
      if (kart.wallT <= 0 && kart.bulletT <= 0) {
        const loss = impact * impact * (0.32 - kart.traction * 0.12);
        kart.speed *= 1 - loss;
        if (loss > 0.03) kart.slowFlags |= SlowFlag.Wall;
      }
      kart.wallT = 0.3;
    }
  }

  if (surface.loop) {
    // Loops are magnetic: you can't fall off.
    kart.z = 0;
    kart.vz = 0;
    kart.airT = 0;
    kart.trickPending = 0;
  } else {
    // Relative to the road: gravity pulls down, a crest falls away beneath you.
    const relative = -GRAVITY * Math.max(0.35, surface.upY) - kart.speed * kart.speed * surface.pitch;
    if (grounded && relative > 12 && kart.speed > 24) {
      kart.z = 0.02;
      kart.vz = 0.5;
    }
    if (kart.z > 0 || kart.vz > 0) {
      kart.vz += Math.min(18, relative) * DT;
      kart.z += kart.vz * DT;
      kart.airT += DT;
      if (kart.z <= 0) {
        kart.z = 0;
        kart.vz = 0;
        if (kart.trickPending && kart.stunT <= 0) giveBoost(kart, 1.0, BoostKind.Trick);
        else if (kart.airT > 0.55 && kart.stunT <= 0) giveBoost(kart, 0.5, BoostKind.Landing);
        kart.trickPending = 0;
        kart.airT = 0;
      }
    }
  }

  applyFeatures(world, kart);
};
