import { ItemKind, KARTS, type Perk, type ThemeId } from "./content.ts";
import { type Input, InputBit } from "./input.ts";
import { hash01 } from "./rng.ts";
import { FeatureKind, type Track, curvatureAt, generateTrack, gridSlot, makeSurface, surfaceAt, wrapS } from "./track.ts";

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const LAPS = 2;
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const KART_RADIUS = 1.0;
/** Once someone finishes, everyone else has this long before the race is called. */
export const FINISH_GRACE_TICKS = 20 * TICK_RATE;
const GRAVITY = 34;
const SLOPE_GRAVITY = 16;
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
/** Far behind the leader, a little extra top speed keeps the race close (max +5%). */
const comebackBonus = (world: World, kart: Kart): number => {
  const leader = world.order[0];
  if (!leader || leader === kart || kart.finished) return 0;
  const gap = leader.dist - kart.dist;
  return Math.max(0, Math.min(1, (gap - 120) / 600)) * 0.05;
};

/**
 * Compute meter (the nitrous): driving with style fills it, holding Nitro
 * burns it as a boost. A full meter lasts this many seconds.
 */
export const NITRO_SECONDS = 2.2;
/** Extra top speed when the nitro burns during another boost. */
const NITRO_STACK = 1.12;
/** You can't light the nitro on less than this; once lit it burns until empty or released. */
export const NITRO_MIN = 0.1;
/** Everyone starts with a little, so the meter is there to try from the first corner. */
export const NITRO_START = 0.25;
/** Meter per second while fully tucked into a slipstream. */
const NITRO_DRAFT = 0.3;
/** Meter per second while drifting, before the chain bonus. */
const NITRO_DRIFT = 0.1;
/** Overtaking someone without hitting them. */
export const NITRO_CLOSE_PASS = 0.18;
const NITRO_TRICK = 0.1;
/** Passing within this many meters to the side counts as a close pass. */
export const CLOSE_PASS_WIDTH = 4.2;
const CLOSE_PASS_COOLDOWN = 0.6;
/** Start the next drift within this long of the last drift boost to keep the chain. */
export const CHAIN_WINDOW = 2;
export const MAX_CHAIN = 4;
/** Each chained drift makes its boost this much longer. */
const CHAIN_BOOST = 0.12;

/** Slipstream: tucked in behind another kart you get towed along and fill the meter. */
const updateDraft = (world: World, kart: Kart, grounded: boolean): void => {
  const L = world.track.length;
  let drafting = false;
  if (grounded && kart.speed > 25) {
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
  // Ramps in over half a second so a kart crossing in front doesn't count.
  kart.draft = drafting ? Math.min(1, kart.draft + 2 * DT) : Math.max(0, kart.draft - 3 * DT);
  if (kart.draft > 0) fillNitro(kart, NITRO_DRAFT * kart.draft * DT);
};

const fillNitro = (kart: Kart, amount: number): void => {
  kart.nitro = Math.min(1, kart.nitro + amount);
};

/** Banked, assisted cornering: this share of the road's turn rotates the kart with it. */
export const CORNER_ASSIST = 0.12;
/**
 * A drift mostly follows the road by itself: the nose points in, the kart
 * slides a little wide, and steering tightens or widens the line. Without
 * this a drift turns far faster than most bends and ends in the wall.
 */
export const DRIFT_ASSIST = 0.55;
/** Drift yaw, as shares of the kart's steer rate: a constant pull inward plus steering. */
export const DRIFT_PULL = 0.12;
export const DRIFT_STEER = 0.25;
/**
 * No stack of boosts, GPUs, slipstream and nitro takes a kart past this share
 * of its listed top speed. Without it, boosts compound and a race keeps
 * getting faster: by the last lap karts sat at 1.2x top speed and peaked at 1.77x.
 */
const SPEED_CEILING = 1.5;
/** Speed over the current top speed fades at this rate per second once a boost ends. */
const OVERSPEED_FADE = 1.6;
/** Hands off the steering, the kart's angle to the road decays at this rate per second. */
const SELF_ALIGN = 2.2;
/** A wall hit that costs more than this share of your speed breaks a drift chain. */
const CHAIN_BREAK_LOSS = 0.08;
export const STAT = {
  speedBase: 47.85,
  speedPer: 0.55,
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
export const SlowFlag = { Wall: 1, SlowZone: 2, Hit: 4 } as const;
export const BoostKind = { None: 0, Pad: 1, Drift: 2, SuperDrift: 3, Landing: 4, Nitro: 5, UltraDrift: 6, Trick: 8, Rocket: 9 } as const;
const MISSILE_SPEED = 88;
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
  /** Reliability as traction: how much speed walls and slow zones can take from you. */
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
  wallT = 0;
  slowFlags = 0;
  airT = 0;
  kickV = 0;
  boostKind = 0;
  gpus = 0;
  /** Slipstream strength, 0..1. */
  draft = 0;
  /** Compute meter, 0..1. */
  nitro = NITRO_START;
  /** 1 while the nitro is burning. */
  nitroLit = 0;
  /** Drifts chained back to back; each one makes the next boost bigger. */
  driftChain = 0;
  chainT = 0;
  /** Close passes so far; the HUD calls out each new one. */
  passes = 0;
  passT = 0;
  trickT = 0;
  trickPending = 0;
  startHold = 0;
  /** 0 normal, 1 good, 2 perfect */
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
  "boostT", "boostKind", "stunT", "slowFlags", "airT",
  "drifting", "driftDir", "driftCharge", "hp", "gpus", "draft", "nitro", "nitroLit", "driftChain", "chainT", "passes", "passT",
  "trickT", "trickPending", "startResult",
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

export type GameEvent =
  | { readonly type: "hit"; readonly victim: number; readonly by: number }
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
  readonly boxReadyTick: Int32Array;
  readonly coinReadyTick: Int32Array;
  /** Where each kart was at the start of this tick, to spot overtakes. */
  private readonly lastDist: Float64Array;
  readonly finishOrder: number[] = [];
  readonly events: GameEvent[] = [];
  tick = 0;
  phase: Phase = Phase.Countdown;
  phaseTicks = COUNTDOWN_TICKS;

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
    this.lastDist = new Float64Array(this.karts.length);
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
    for (let i = 0; i < karts.length; i++) this.lastDist[i] = karts[i].dist;
    for (let i = 0; i < karts.length; i++) stepKart(this, karts[i], inputs[i]);
    this.closePasses();
    this.collideKarts();
    if (!this.predict) this.stepMissiles();
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
        const reach = KART_RADIUS * 2;
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

  /** Overtaking someone close alongside without touching them fills your meter. */
  private closePasses(): void {
    const karts = this.karts;
    const L = this.track.length;
    const wrap = (x: number) => {
      x %= L;
      return x > L / 2 ? x - L : x < -L / 2 ? x + L : x;
    };
    for (let i = 0; i < karts.length; i++) {
      const a = karts[i];
      if (a.finished || a.passT > 0 || a.speed < 20 || a.stunT > 0) continue;
      for (let j = 0; j < karts.length; j++) {
        const b = karts[j];
        if (j === i || b.finished) continue;
        const before = wrap(this.lastDist[i] - this.lastDist[j]);
        const now = wrap(a.dist - b.dist);
        if (!(before < 0 && now >= 0) || before < -8) continue;
        const side = Math.abs(a.d - b.d);
        if (side >= CLOSE_PASS_WIDTH || side < KART_RADIUS * 2 - 0.05 || Math.abs(a.z - b.z) > 2.5) continue;
        a.passes++;
        a.passT = CLOSE_PASS_COOLDOWN;
        fillNitro(a, NITRO_CLOSE_PASS);
        break;
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
        if (m.bounces > 3) m.active = false;
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
        damage(this, kart, 34, m.owner);
        break;
      }
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
    m.life = 2.5;
    m.bounces = 0;
    m.age = 0;
  }
}

const applyStart = (kart: Kart): void => {
  // Holding the throttle too early is just a normal start, never a penalty.
  const held = kart.startHold;
  if (held <= 0) kart.startResult = 0;
  else if (held <= START_PERFECT_TICKS) {
    kart.startResult = 2;
    giveBoost(kart, 1.6, BoostKind.Rocket);
  } else if (held <= START_GOOD_TICKS) {
    kart.startResult = 1;
    giveBoost(kart, 0.8, BoostKind.Rocket);
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
  // A hit spins you out but you keep some momentum: getting hit should sting, not stop you dead.
  kart.speed *= 0.55;
  kart.drifting = 0;
  kart.driftCharge = 0;
  kart.driftChain = 0;
  kart.chainT = 0;
  kart.boostT = 0;
};

const spillGpus = (kart: Kart): void => {
  kart.gpus = Math.max(0, kart.gpus - (kart.perk === "tank" ? 1 : 3));
};

const damage = (world: World, kart: Kart, amount: number, by: number): void => {
  // Tank: half damage, a shorter spin-out.
  const tank = kart.perk === "tank" ? 0.5 : 1;
  const tankStun = kart.perk === "tank" ? 0.75 : 1;
  spillGpus(kart);
  kart.hp -= amount * tank;
  if (kart.hp <= 0) {
    kart.hp = kart.hpMax;
    stun(kart, 1.8 * tankStun);
  } else {
    stun(kart, 0.95 * tankStun);
  }
  kart.vz = 9;
  kart.z = Math.max(kart.z, 0.05);
  world.events.push({ type: "hit", victim: kart.slot, by });
};

/** Item boxes only hold missiles; boosts come from your Compute meter. */
const giveItem = (world: World, kart: Kart): void => {
  const item = ItemKind.Missile;
  if (kart.item === ItemKind.None) {
    kart.item = item;
    kart.itemCount = 1;
  } else if (kart.perk === "twin-engine" && kart.item2 === ItemKind.None) {
    kart.item2 = item;
    kart.item2Count = 1;
  } else {
    return;
  }
  world.events.push({ type: "item", slot: kart.slot, item });
};

const useItem = (world: World, kart: Kart, backward: boolean): void => {
  const item = kart.item;
  if (item === ItemKind.None) return;
  world.spawnMissile(kart, backward);
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
      kart.slowZone = 1;
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
  if (kart.wallT > 0) kart.wallT -= DT;
  if (kart.trickT > 0) kart.trickT -= DT;
  if (kart.passT > 0) kart.passT -= DT;
  if (kart.chainT > 0 && !kart.drifting) kart.chainT -= DT;

  // Tap drift in the air to pull a trick; land it for a boost.
  if (!grounded && control && pressed & InputBit.Drift && kart.airT > 0.06 && !kart.trickPending) {
    kart.trickT = 0.45;
    kart.trickPending = 1;
  }

  if (!world.predict && control && pressed & InputBit.Item) {
    useItem(world, kart, (bits & InputBit.Back) !== 0);
  }

  // Nitro: hold to burn the meter. Lighting it takes a minimum; once lit it runs until empty.
  if (control && bits & InputBit.Nitro && kart.nitro > 0 && (kart.nitroLit || kart.nitro >= NITRO_MIN)) {
    kart.nitro = Math.max(0, kart.nitro - DT / (NITRO_SECONDS * (kart.perk === "plugins" ? 1.25 : 1)));
    kart.nitroLit = 1;
    giveBoost(kart, 0.12, BoostKind.Nitro);
  } else {
    kart.nitroLit = 0;
  }

  const throttleHeld = (bits & InputBit.Throttle) !== 0;

  surfaceAt(track, kart.dist, surface);
  const k = surface.curvature;
  // Keep a wall flag briefly so the HUD can name it; everything else is live state.
  kart.slowFlags = (kart.slowFlags & SlowFlag.Wall && kart.wallT > 0.1 ? SlowFlag.Wall : 0)
    | (kart.slowZone ? SlowFlag.SlowZone : 0)
    | (kart.stunT > 0 ? SlowFlag.Hit : 0);
  const steer = control ? Math.max(-1, Math.min(1, input.steer)) : 0;

  let maxSpeed = kart.maxSpeed;
  let accel = kart.accel;
  const gpuBonus = 1 + kart.gpus * GPU_BONUS;
  maxSpeed *= gpuBonus * (1 + comebackBonus(world, kart));
  accel *= gpuBonus;
  updateDraft(world, kart, grounded);
  maxSpeed *= 1 + 0.05 * kart.draft;
  if (kart.boostT > 0) {
    maxSpeed *= kart.perk === "unhinged" ? 1.37 : 1.36;
    accel *= 2.2;
    // Nitro stacks on top of any other boost, so burning it always does something.
    if (kart.nitroLit && kart.boostKind !== BoostKind.Nitro) maxSpeed *= NITRO_STACK;
  }
  maxSpeed = Math.min(maxSpeed, kart.maxSpeed * SPEED_CEILING);
  if (kart.slowZone) maxSpeed *= kart.perk === "constitutional" ? 0.85 : 0.55 + kart.traction * 0.2;

  const throttle = control && (throttleHeld || kart.boostT > 0);
  const brake = control && (bits & InputBit.Brake) !== 0;
  if (throttle && kart.speed < maxSpeed) {
    const ratio = Math.max(0, kart.speed) / maxSpeed;
    kart.speed = Math.min(maxSpeed, kart.speed + accel * (1 - 0.7 * ratio) * DT);
  } else if (kart.speed > maxSpeed) {
    // Momentum: after a boost the extra speed fades out gently instead of cutting off.
    kart.speed -= (kart.speed - maxSpeed) * Math.min(1, (kart.slowZone ? 3 : OVERSPEED_FADE) * DT);
  } else if (brake) {
    kart.speed = kart.speed > 0 ? kart.speed - 48 * DT : Math.max(-14, kart.speed - 20 * DT);
  } else {
    // Off the throttle the kart slows down noticeably: drag plus rolling resistance.
    const drop = (Math.abs(kart.speed) * 1.1 + 7) * DT;
    kart.speed = Math.abs(kart.speed) <= drop ? 0 : kart.speed - Math.sign(kart.speed) * drop;
  }
  if (!control) kart.speed -= kart.speed * 0.3 * DT;
  kart.speed = Math.min(kart.speed, kart.maxSpeed * SPEED_CEILING);

  const driftHeld = (bits & InputBit.Drift) !== 0;
  if (control && grounded && driftHeld && !kart.drifting && Math.abs(steer) > 0.2 && kart.speed > 12) {
    kart.drifting = 1;
    kart.driftDir = Math.sign(steer);
    kart.driftCharge = 0;
    if (kart.chainT <= 0) kart.driftChain = 0;
  }
  if (kart.drifting) {
    kart.driftCharge += DT;
    fillNitro(kart, NITRO_DRIFT * (1 + 0.35 * kart.driftChain) * DT);
    if (!driftHeld || kart.speed < 10 || !control) {
      const charge = kart.driftCharge;
      const tier = !control ? 0 : charge >= DRIFT_TIER3 ? 3 : charge >= DRIFT_TIER2 ? 2 : charge >= DRIFT_TIER1 ? 1 : 0;
      if (tier > 0) {
        // Chain drifts back to back and every boost in the chain gets longer.
        kart.driftChain = Math.min(MAX_CHAIN, kart.driftChain + 1);
        kart.chainT = CHAIN_WINDOW;
        const scale = (kart.perk === "storyteller" ? 1.4 : 1) * (1 + CHAIN_BOOST * (kart.driftChain - 1));
        if (tier === 3) giveBoost(kart, 1.8 * scale, BoostKind.UltraDrift);
        else if (tier === 2) giveBoost(kart, 1.25 * scale, BoostKind.SuperDrift);
        else giveBoost(kart, 0.7 * scale, BoostKind.Drift);
      }
      // A drift too short to pay out neither adds to the chain nor breaks it.
      kart.drifting = 0;
      kart.driftCharge = 0;
    }
  }

  const absSpeed = Math.abs(kart.speed);
  const speedFactor = Math.min(1, absSpeed / 10) * (1 - 0.3 * Math.min(1, absSpeed / 60));
  let yaw = kart.drifting
    ? kart.steerRate * speedFactor * (kart.driftDir * DRIFT_PULL + steer * DRIFT_STEER)
    : steer * kart.steerRate * speedFactor * (kart.speed < 0 ? -1 : 1);
  if (!grounded) yaw *= 0.5;
  kart.heading += yaw * DT;
  // Forgiving: let go of the stick and the kart settles back in line with the road.
  if (control && grounded && !kart.drifting && Math.abs(steer) < 0.1 && Math.abs(kart.heading) < 1.2) {
    kart.heading -= kart.heading * Math.min(1, SELF_ALIGN * DT);
  }

  const slipTarget = kart.drifting ? kart.driftDir * 0.38 : 0;
  const slipRate = kart.drifting ? 3 : kart.grip;
  // The drift angle swings the nose without changing where the kart is going:
  // otherwise starting a drift flings you at the outside wall.
  const slipStep = (slipTarget - kart.slip) * Math.min(1, slipRate * DT);
  kart.slip += slipStep;
  if (grounded) kart.heading += slipStep;

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
  const assist = surface.loop ? 0 : !grounded ? 0.9 : kart.drifting ? Math.max(kart.cornerAssist, DRIFT_ASSIST) : kart.cornerAssist;
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
      if (kart.wallT <= 0) {
        const loss = impact * impact * (0.24 - kart.traction * 0.09) * (kart.perk === "constitutional" ? 0.25 : 1);
        kart.speed *= 1 - loss;
        // Only a real hit gets the HUD warning; scraping through a drift is part of driving.
        if (loss > 0.06) kart.slowFlags |= SlowFlag.Wall;
        if (loss > CHAIN_BREAK_LOSS) {
          kart.driftChain = 0;
          kart.chainT = 0;
        }
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
        if (kart.trickPending && kart.stunT <= 0) {
          giveBoost(kart, 1.0, BoostKind.Trick);
          fillNitro(kart, NITRO_TRICK);
        } else if (kart.airT > 0.55 && kart.stunT <= 0) giveBoost(kart, 0.5, BoostKind.Landing);
        kart.trickPending = 0;
        kart.airT = 0;
      }
    }
  }

  applyFeatures(world, kart);
};
