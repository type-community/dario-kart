import {
  BoostKind, COUNTDOWN_TICKS, type DecodedSnapshot, DT, type Input, InputBit, ItemKind, KART_NET_FIELDS, KART_RADIUS, type Kart,
  Phase, type RaceSlot, TICK_RATE, type ThemeId, World, applyKartFields, botInput, characterIndex,
  copyInput, kartIndex, makeInput, themeById, touchesBox, touchesCoin, wrapS,
} from "@dario-kart/sim";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { sound } from "./audio.ts";
import { EMOTES } from "./avatars.ts";
import type { Controls } from "./controls.ts";
import { Particles } from "./particles.ts";
import type { Hud, HudState, MapDot } from "./hud.ts";
import type { Net } from "./net.ts";
import {
  KartVisual, SPARK_COLORS, type TrackScene, buildTrackScene, makeBubble, makeMissileMesh,
  placeOnTrack, trackPoint, trackPose,
} from "./scene.ts";

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.3, 2500);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Rolling frame stats, readable from devtools as __dk.stage.stats. */
  readonly stats = { cpuMs: 0, frameMs: 16.7, calls: 0, triangles: 0 };

  // Adaptive resolution: drop pixel ratio when frames run long, raise it when there's headroom.
  private readonly maxRatio = Math.min(devicePixelRatio, 1.75);
  private ratio = Math.min(devicePixelRatio, 1.75);
  private menu = false;
  private slow = 0;
  private fast = 0;
  private sampled = 0;

  private applyRatio(): void {
    const target = this.menu ? Math.min(this.ratio, 0.75) : this.ratio;
    if (Math.abs(this.renderer.getPixelRatio() - target) > 0.01) {
      this.renderer.setPixelRatio(target);
      this.renderer.setSize(innerWidth, innerHeight, false);
    }
  }

  /** Menus show the race as a backdrop: render it cheaper. */
  setMenuMode(on: boolean): void {
    if (this.menu === on) return;
    this.menu = on;
    this.applyRatio();
  }

  recordFrame(cpuMs: number, dt: number): void {
    this.stats.cpuMs += (cpuMs - this.stats.cpuMs) * 0.05;
    this.stats.frameMs += (dt * 1000 - this.stats.frameMs) * 0.05;
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    if (this.menu || dt > 0.25) return;
    this.sampled++;
    if (dt > 0.0195) this.slow++;
    else if (dt < 0.0175) this.fast++;
    if (this.sampled < 120) return;
    if (this.slow > 40 && this.ratio > 0.75) this.ratio = Math.max(0.75, this.ratio - 0.25);
    else if (this.fast > 115 && this.ratio < this.maxRatio) this.ratio = Math.min(this.maxRatio, this.ratio + 0.25);
    this.sampled = this.slow = this.fast = 0;
    this.applyRatio();
  }
}

export interface RaceSetup {
  readonly seed: number;
  readonly track: ThemeId;
  readonly laps: number;
  readonly slots: ReadonlyArray<RaceSlot>;
  /** Your slot, or -1 to spectate. */
  readonly you: number;
}

export type RaceMode =
  | { readonly kind: "online"; readonly net: Net }
  | { readonly kind: "practice"; readonly autopilot?: boolean }
  | { readonly kind: "attract" };

interface Pose {
  dist: number;
  d: number;
  z: number;
  heading: number;
  slip: number;
}

interface Snap {
  tick: number;
  karts: Float32Array;
}

const F = KART_NET_FIELDS.length;
const FIELD = Object.fromEntries(KART_NET_FIELDS.map((k, i) => [k, i])) as Record<(typeof KART_NET_FIELDS)[number], number>;
const INTERP_TICKS = 7;
/**
 * Other karts are interpolated in the past, but your own kart is predicted
 * ahead of the server. They're pushed forward along their recent motion to
 * your kart's moment, so side-by-side on screen is side-by-side on the server.
 * Capped so a long stall doesn't send them sailing.
 */
const MAX_LEAD_SECONDS = 0.45;
/** How long a pickup you drove through stays hidden waiting for the server to agree. */
const PICKUP_HOLD_SECONDS = 1;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const lerpAngle = (a: number, b: number, t: number) => {
  let delta = b - a;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
};

const copyPose = (k: Kart | Pose, out: Pose) => {
  out.dist = k.dist;
  out.d = k.d;
  out.z = k.z;
  out.heading = k.heading;
  out.slip = k.slip;
};

export class RaceView {
  readonly world: World;
  readonly setup: RaceSetup;
  private readonly stage: Stage;
  private readonly mode: RaceMode;
  private readonly controls: Controls | null;
  private readonly hud: Hud | null;
  private readonly trackScene: TrackScene;
  private readonly visuals: KartVisual[];
  private readonly missiles: THREE.Mesh[] = [];
  private readonly prev: Pose[];
  private readonly render: Pose[];
  private readonly inputs: Input[];
  private accumulator = 0;
  private time = 0;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3(0, 1, 0);
  private readonly camDesired = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private camReady = false;
  private attractTarget = 0;

  // online state
  private seq = 0;
  private readonly pending: Input[] = [];
  private readonly outbox: Input[] = [];
  private readonly snaps: Snap[] = [];
  private latest: DecodedSnapshot | null = null;
  private tickOffset: number | null = null;
  private readonly correction = { dist: 0, d: 0 };
  /** Per remote kart: smoothed forward offset (dist, d) that brings it up to your kart's moment. */
  private readonly lead: Float32Array;
  private renderTick = 0;
  /** Server tick your predicted kart is at; other karts are drawn at it too. */
  private presentTick = 0;
  private presentGap = 0;
  // Pickups your predicted kart touched, hidden until the server confirms (or the hold runs out).
  private boxHold: Float32Array;
  private coinHold: Float32Array;
  private readonly boxesShown: Uint8Array;
  private readonly coinsShown: Uint8Array;
  private statusText = "";
  private statusUntil = 0;
  private statusBad = false;
  private lastItem = 0;

  onFinish: ((world: World) => void) | null = null;
  /** Practice only: freeze the simulation while the pause menu is open. */
  paused = false;
  private finishedReported = false;

  // juice
  private readonly sparks = new Particles(1600, 0.55, true);
  private readonly confetti = new Particles(700, 0.5, false);
  private shake = 0;
  private fovKick = 0;
  /** Camera pulls back while boosting, so speed reads as distance. */
  private camPull = 0;
  private readonly bubbles: Array<{ sprite: THREE.Sprite; parent: THREE.Object3D; until: number }> = [];
  private readonly prevStun: Float32Array;
  private readonly prevAir: Uint8Array;
  private readonly watch = {
    sec: 99, start: 0, boost: 0, gpus: 0, stun: 0, air: false, trick: 0, tier: 0, passes: 0,
    lap: 1, place: 0, finished: false, wrongT: 0, lapStart: 0, bestLap: Infinity, itemCount: 0, item: 0,
  };
  private readonly speedLines = document.getElementById("speedlines") as HTMLCanvasElement | null;
  private speedLinesDrawn = true;

  constructor(stage: Stage, setup: RaceSetup, mode: RaceMode, controls: Controls | null, hud: Hud | null) {
    this.stage = stage;
    this.setup = setup;
    this.mode = mode;
    this.controls = controls;
    this.hud = hud;
    this.world = new World({
      theme: setup.track,
      seed: setup.seed,
      laps: setup.laps,
      predict: mode.kind === "online",
      racers: setup.slots.map((s) => ({ kart: kartIndex(s.kart), character: characterIndex(s.character), bot: s.bot })),
    });
    const theme = themeById(setup.track);
    this.trackScene = buildTrackScene(this.world.track, theme, stage.scene);
    // Whoever grabs a box or GPU, it pops instead of just vanishing.
    this.trackScene.onPickup = (kind, at) => {
      if (kind === "box") this.sparks.burst(at, 18, [0xffc93c, 0xff3d7f, 0x3de0ff, 0xb18cff], 5, 0.4, 0, 2);
      else this.sparks.burst(at, 12, 0x9be22d, 4, 0.35, 0, 2);
    };
    this.visuals = setup.slots.map((slot, i) => {
      const v = new KartVisual({
        kart: slot.kart, character: slot.character, name: slot.name, primary: slot.primary, secondary: slot.secondary,
        me: i === setup.you && mode.kind !== "attract",
      });
      stage.scene.add(v.root);
      return v;
    });
    this.prev = this.world.karts.map((k) => {
      const p = { dist: 0, d: 0, z: 0, heading: 0, slip: 0 };
      copyPose(k, p);
      return p;
    });
    this.render = this.prev.map((p) => ({ ...p }));
    this.inputs = this.world.karts.map(() => makeInput());
    this.lead = new Float32Array(this.world.karts.length * 2);
    this.boxHold = new Float32Array(this.world.track.itemBoxes.length);
    this.coinHold = new Float32Array(this.world.track.coins.length);
    this.boxesShown = new Uint8Array(this.boxHold.length);
    this.coinsShown = new Uint8Array(this.coinHold.length);
    for (let i = 0; i < 24; i++) {
      const m = makeMissileMesh();
      m.visible = false;
      stage.scene.add(m);
      this.missiles.push(m);
    }
    hud?.setTrack(this.world.track);
    this.prevStun = new Float32Array(this.world.karts.length);
    this.prevAir = new Uint8Array(this.world.karts.length);
    stage.scene.add(this.sparks.points, this.confetti.points);
    if (mode.kind !== "attract") {
      sound.startMusic(setup.track);
      sound.setIntense(false);

    }
    if (mode.kind === "online") mode.net.onSnapshot = this.snapshotHandler;
    if (controls) controls.enabled = setup.you >= 0;
  }

  private get me(): Kart | null {
    return this.setup.you >= 0 ? this.world.karts[this.setup.you] : null;
  }

  status(text: string, bad: boolean): void {
    this.statusText = text;
    this.statusBad = bad;
    this.statusUntil = this.time + 1.6;
  }

  /* ---------------- simulation ---------------- */

  frame(dtSeconds: number): void {
    const dt = Math.min(0.1, dtSeconds);
    if (this.paused) {
      this.draw(0, dt);
      return;
    }
    this.time += dt;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= DT && steps < 5) {
      this.accumulator -= DT;
      steps++;
      if (this.mode.kind === "online") this.tickOnline();
      else this.tickLocal();
    }
    if (steps === 5) this.accumulator = 0;
    this.draw(this.accumulator / DT, dt);
  }

  private tickLocal(): void {
    const world = this.world;
    for (let i = 0; i < world.karts.length; i++) copyPose(world.karts[i], this.prev[i]);
    for (let i = 0; i < world.karts.length; i++) {
      const kart = world.karts[i];
      const autopilot = this.mode.kind === "practice" && this.mode.autopilot;
      if (i === this.setup.you && this.controls && !kart.finished && !autopilot) this.controls.sample(DT, this.inputs[i]);
      else botInput(world, kart, this.inputs[i]);
    }
    world.step(this.inputs);
    for (const event of world.events) this.describeLocal(event);
    world.events.length = 0;
    if (this.mode.kind === "attract" && world.phase === Phase.Finished) {
      world.phase = Phase.Racing;
    }
    if (world.phase === Phase.Finished && !this.finishedReported) {
      this.finishedReported = true;
      this.onFinish?.(world);
    }
  }

  private describeLocal(event: World["events"][number]): void {
    if (!this.hud || this.mode.kind === "attract") return;
    const name = (slot: number) => (slot === this.setup.you ? "You" : this.setup.slots[slot]?.name ?? "Someone");
    // Bots fighting each other is noise; only hits a human was part of make the feed.
    const human = (slot: number) => !this.setup.slots[slot]?.bot;
    if (event.type === "hit" && event.by >= 0 && event.by !== event.victim && (human(event.by) || human(event.victim))) {
      this.hud.feed(`${name(event.by)} hit ${name(event.victim)}`);
    } else if (event.type === "finish") {
      this.hud.feed(`${name(event.slot)} finished`);
    }
    if (event.type === "hit" && event.by >= 0 && this.setup.slots[event.by]?.bot && Math.random() < 0.35) {
      this.showEmote(event.by, Math.floor(Math.random() * 4));
    }
  }

  private tickOnline(): void {
    const me = this.me;
    if (!me || !this.controls) return;
    copyPose(me, this.prev[this.setup.you]);
    if (this.world.phase === Phase.Finished) return;
    // Inputs flow during the countdown too: that's how rocket starts work.
    const input = this.controls.sample(DT, this.inputs[this.setup.you]);
    input.seq = ++this.seq;
    const stored = copyInput(input, makeInput());
    this.pending.push(stored);
    this.outbox.push(stored);
    if (this.world.phase === Phase.Racing) this.world.stepOne(me, input);
    if (this.outbox.length >= 2) {
      this.mode.kind === "online" && this.mode.net.sendInputs(this.outbox, this.setup.seed);
      this.outbox.length = 0;
    }
  }

  private readonly snapshotHandler = (snap: DecodedSnapshot) => this.onSnapshot(snap);

  private onSnapshot(snap: DecodedSnapshot): void {
    const now = performance.now() / 1000;
    const target = snap.header.tick - now * TICK_RATE;
    if (this.tickOffset === null || target > this.tickOffset) this.tickOffset = target;
    else this.tickOffset += (target - this.tickOffset) * 0.05;

    this.latest = snap;
    this.snaps.push({ tick: snap.header.tick, karts: snap.karts });
    while (this.snaps.length > 24) this.snaps.shift();

    const world = this.world;
    world.tick = snap.header.tick;
    world.phase = snap.header.phase as Phase;
    world.phaseTicks = snap.header.phaseTicks;

    const you = this.setup.you;
    for (let i = 0; i < world.karts.length; i++) {
      if (i !== you) applyKartFields(snap.karts, i, world.karts[i]);
    }
    if (you >= 0) {
      const me = world.karts[you];
      const before = { dist: me.dist, d: me.d };
      applyKartFields(snap.karts, you, me);
      const ack = snap.header.ack;
      let drop = 0;
      while (drop < this.pending.length && this.pending[drop].seq <= ack) drop++;
      if (drop > 0) this.pending.splice(0, drop);
      for (const input of this.pending) world.stepOne(me, input);
      this.correction.dist += before.dist - me.dist;
      this.correction.d += before.d - me.d;
      if (Math.abs(this.correction.dist) > 12 || Math.abs(this.correction.d) > 6) {
        this.correction.dist = 0;
        this.correction.d = 0;
      }
      if (me.item !== this.lastItem) {
        this.lastItem = me.item;
      }
    }
  }

  /* ---------------- rendering ---------------- */

  /** Where in server time to draw remote karts and your own, for this frame. */
  private updateClock(dt: number): void {
    const snaps = this.snaps;
    if (snaps.length === 0 || this.tickOffset === null) return;
    this.renderTick = performance.now() / 1000 * TICK_RATE + this.tickOffset - INTERP_TICKS;
    const newest = snaps[snaps.length - 1].tick;
    // Spectators have no predicted kart to line up with, so they watch the smooth past.
    // Smooth the gap rather than the tick itself, which would trail a moving clock.
    const gap = this.me ? newest + this.pending.length - this.renderTick : 0;
    if (Math.abs(gap - this.presentGap) > 30) this.presentGap = gap;
    else this.presentGap += (gap - this.presentGap) * (1 - Math.exp(-8 * dt));
    this.presentTick = this.renderTick + this.presentGap;
  }

  private interpolate(i: number, out: Pose, dt: number): void {
    const kart = this.world.karts[i];
    const snaps = this.snaps;
    if (snaps.length === 0 || this.tickOffset === null) {
      copyPose(kart, out);
      return;
    }
    const renderTick = this.renderTick;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let s = snaps.length - 1; s > 0; s--) {
      if (snaps[s - 1].tick <= renderTick) {
        a = snaps[s - 1];
        b = snaps[s];
        break;
      }
    }
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderTick - a.tick) / span)) : 1;
    const base = i * F;
    const get = (snap: Snap, f: number) => snap.karts[base + f];
    out.dist = get(a, FIELD.dist) + (get(b, FIELD.dist) - get(a, FIELD.dist)) * t;
    out.d = get(a, FIELD.d) + (get(b, FIELD.d) - get(a, FIELD.d)) * t;
    out.z = Math.max(0, get(a, FIELD.z) + (get(b, FIELD.z) - get(a, FIELD.z)) * t);
    out.heading = lerpAngle(get(a, FIELD.heading), get(b, FIELD.heading), t);
    out.slip = get(a, FIELD.slip) + (get(b, FIELD.slip) - get(a, FIELD.slip)) * t;

    // Carry it forward along its latest motion (measured between the two newest
    // snapshots, so a spinning kart doesn't fly off along its nose).
    const drawnAt = a.tick + span * t;
    const ahead = Math.max(0, Math.min(MAX_LEAD_SECONDS, (this.presentTick - drawnAt) / TICK_RATE));
    let vs = 0;
    let vd = 0;
    if (snaps.length > 1) {
      const p = snaps[snaps.length - 2];
      const q = snaps[snaps.length - 1];
      const gap = (q.tick - p.tick) / TICK_RATE;
      if (gap > 0) {
        vs = (q.karts[base + FIELD.dist] - p.karts[base + FIELD.dist]) / gap;
        vd = (q.karts[base + FIELD.d] - p.karts[base + FIELD.d]) / gap;
      }
    }
    // Smoothed, so a kart that stops dead slows down on screen instead of jumping back.
    const k = 1 - Math.exp(-10 * dt);
    const lead = this.lead;
    lead[i * 2] += (vs * ahead - lead[i * 2]) * k;
    lead[i * 2 + 1] += (vd * ahead * 0.5 - lead[i * 2 + 1]) * k;
    out.dist += lead[i * 2];
    const edge = this.world.track.halfWidth - KART_RADIUS;
    out.d = Math.max(-edge, Math.min(edge, out.d + lead[i * 2 + 1]));
  }

  /** Grab boxes and GPUs the moment your predicted kart touches them, ahead of the server's word. */
  private predictPickups(): void {
    const me = this.me;
    const latest = this.latest;
    if (!latest) return;
    const track = this.world.track;
    const touching = me && this.world.phase === Phase.Racing && !me.finished && me.stunT <= 0;
    const s = me ? wrapS(track, me.dist) : 0;
    const now = this.time;
    for (let i = 0; i < track.itemBoxes.length; i++) {
      const ready = latest.boxesReady[i] === 1;
      if (!ready) this.boxHold[i] = 0;
      else if (touching && this.boxHold[i] === 0 && touchesBox(me, s, track.itemBoxes[i])) this.boxHold[i] = now + PICKUP_HOLD_SECONDS;
      // A hold that runs out without the server agreeing (someone beat you to it) gives the box back.
      if (this.boxHold[i] !== 0 && now > this.boxHold[i] && !(touching && touchesBox(me, s, track.itemBoxes[i]))) this.boxHold[i] = 0;
      this.boxesShown[i] = ready && this.boxHold[i] === 0 ? 1 : 0;
    }
    for (let i = 0; i < track.coins.length; i++) {
      const ready = latest.coinsReady[i] === 1;
      if (!ready) this.coinHold[i] = 0;
      else if (touching && this.coinHold[i] === 0 && touchesCoin(me, s, track.coins[i])) this.coinHold[i] = now + PICKUP_HOLD_SECONDS;
      if (this.coinHold[i] !== 0 && now > this.coinHold[i] && !(touching && touchesCoin(me, s, track.coins[i]))) this.coinHold[i] = 0;
      this.coinsShown[i] = ready && this.coinHold[i] === 0 ? 1 : 0;
    }
  }

  private draw(alpha: number, frameDt: number): void {
    const world = this.world;
    const track = world.track;
    const online = this.mode.kind === "online";
    const you = this.setup.you;
    const decay = Math.exp(-12 * (1 / 60));
    this.correction.dist *= decay;
    this.correction.d *= decay;
    if (online) this.updateClock(frameDt);

    const point = new THREE.Vector3();
    for (let i = 0; i < world.karts.length; i++) {
      const kart = world.karts[i];
      const r = this.render[i];
      if (online && i !== you) {
        this.interpolate(i, r, frameDt);
      } else {
        const p = this.prev[i];
        r.dist = p.dist + (kart.dist - p.dist) * alpha;
        r.d = p.d + (kart.d - p.d) * alpha;
        r.z = p.z + (kart.z - p.z) * alpha;
        r.heading = lerpAngle(p.heading, kart.heading, alpha);
        r.slip = p.slip + (kart.slip - p.slip) * alpha;
        if (online && i === you) {
          r.dist += this.correction.dist;
          r.d += this.correction.d;
        }
      }
      const v = this.visuals[i];
      placeOnTrack(track, r.dist, r.d, r.z, r.heading, v.root);
      point.copy(v.root.position);
      v.apply({
        speed: kart.speed, boostT: kart.boostT, stunT: kart.stunT,
        drifting: kart.drifting, driftCharge: kart.driftCharge, trickT: kart.trickT, slip: r.slip, time: this.time,
        showLabel: this.mode.kind !== "attract" && i !== you && point.distanceToSquared(this.stage.camera.position) > 144,
      });
    }

    this.drawMissiles();

    if (online) this.predictPickups();
    const live = online && this.latest;
    this.trackScene.update(this.time, live ? this.boxesShown : online ? null : this.localBoxes(), live ? this.coinsShown : online ? null : this.localCoins(), this.kartNear);

    this.emitParticles(point);
    this.react();
    this.sparks.update(1 / 60);
    this.confetti.update(1 / 60);
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (this.time > b.until) {
        b.parent.remove(b.sprite);
        b.sprite.material.map?.dispose();
        b.sprite.material.dispose();
        this.bubbles.splice(i, 1);
      }
    }
    this.updateCamera();
    this.drawSpeedLines();
    this.updateHud();
    this.stage.render();
  }

  private coinsReadyLocal: Uint8Array | null = null;
  private boxesReadyLocal: Uint8Array | null = null;

  private localCoins(): Uint8Array {
    const ready = (this.coinsReadyLocal ??= new Uint8Array(this.world.coinReadyTick.length));
    for (let i = 0; i < ready.length; i++) ready[i] = this.world.coinReadyTick[i] <= this.world.tick ? 1 : 0;
    return ready;
  }

  private localBoxes(): Uint8Array {
    const ready = (this.boxesReadyLocal ??= new Uint8Array(this.world.boxReadyTick.length));
    for (let i = 0; i < ready.length; i++) ready[i] = this.world.boxReadyTick[i] <= this.world.tick ? 1 : 0;
    return ready;
  }

  private drawMissiles(): void {
    const world = this.world;
    const track = world.track;
    const online = this.mode.kind === "online";
    // Missiles are drawn at your kart's moment too, so what you dodge is where it really is.
    const since = online && this.latest && this.tickOffset !== null
      ? Math.max(0, Math.min(MAX_LEAD_SECONDS, (this.presentTick - this.latest.header.tick) / TICK_RATE))
      : 0;
    // Walk the source lists in place: no per-frame arrays.
    let used = 0;
    const netMissiles = online ? this.latest?.missiles : undefined;
    const missileCount = online ? netMissiles?.length ?? 0 : world.missiles.length;
    for (let i = 0; i < missileCount && used < this.missiles.length; i++) {
      const m = online ? netMissiles![i] : world.missiles[i];
      if (!online && !world.missiles[i].active) continue;
      const mesh = this.missiles[used++];
      mesh.visible = true;
      placeOnTrack(track, m.dist + Math.cos(m.heading) * 88 * since, m.d + Math.sin(m.heading) * 88 * since, 0.8, m.heading, mesh);
    }
    for (let i = used; i < this.missiles.length; i++) this.missiles[i].visible = false;
  }

  /** Pop a speech bubble over a kart. */
  showEmote(slot: number, n: number): void {
    const visual = this.visuals[slot];
    const spec = this.setup.slots[slot];
    if (!visual || !spec) return;
    const lines = EMOTES[spec.character];
    if (!lines) return;
    for (const b of this.bubbles.filter((x) => x.parent === visual.root)) b.until = 0;
    const sprite = makeBubble(lines[n % 4], spec.primary);
    visual.root.add(sprite);
    this.bubbles.push({ sprite, parent: visual.root, until: this.time + 2.8 });
    if (slot === this.setup.you || visual.root.position.distanceTo(this.stage.camera.position) < 60) sound.emote();
  }

  private readonly tmpA = new THREE.Vector3();

  private readonly kartNear = (s: number, d: number): boolean => {
    const track = this.world.track;
    const half = track.length / 2;
    for (const r of this.render) {
      let ds = wrapS(track, r.dist) - s;
      if (ds > half) ds -= track.length;
      if (ds < -half) ds += track.length;
      if (Math.abs(ds) < 3.5 && Math.abs(r.d - d) < 3.5 && r.z < 2) return true;
    }
    return false;
  };

  private emitParticles(_scratch: THREE.Vector3): void {
    const track = this.world.track;
    const cam = this.stage.camera.position;
    for (let i = 0; i < this.world.karts.length; i++) {
      const kart = this.world.karts[i];
      const r = this.render[i];
      const root = this.visuals[i].root;
      if (root.position.distanceToSquared(cam) > 90 * 90) {
        this.prevStun[i] = kart.stunT;
        continue;
      }
      const c = Math.cos(r.heading);
      const sn = Math.sin(r.heading);
      if (kart.drifting && kart.z < 0.2) {
        const tier = kart.driftCharge >= 2.3 ? 3 : kart.driftCharge >= 1.4 ? 2 : kart.driftCharge >= 0.7 ? 1 : 0;
        for (const side of [-1, 1]) {
          trackPoint(track, r.dist - c * 1.1 - sn * side * 0.95, r.d - sn * 1.1 + c * side * 0.95, 0.2, this.tmpA);
          this.sparks.emit(this.tmpA.x, this.tmpA.y, this.tmpA.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, SPARK_COLORS[tier], 0.35, 14);
        }
      }
      if (kart.boostT > 0) {
        trackPoint(track, r.dist - c * 2.3, r.d - sn * 2.3, 0.5 + r.z, this.tmpA);
        const nitro = kart.nitroLit > 0;
        const color = kart.boostKind === BoostKind.UltraDrift ? 0xb18cff : nitro ? 0x7af0ff : 0x3de0ff;
        this.sparks.emit(this.tmpA.x, this.tmpA.y, this.tmpA.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, color, 0.3);
      }
      if (kart.stunT > this.prevStun[i] + 0.3) {
        this.tmpA.copy(root.position).y += 1;
        this.sparks.burst(this.tmpA, 40, [0xff3d7f, 0xffc93c, 0xffffff], 14, 0.7, 20, 4);
      }
      const air = kart.z > 0.3 ? 1 : 0;
      if (this.prevAir[i] && !air) {
        this.tmpA.copy(root.position);
        this.sparks.burst(this.tmpA, 14, 0xd7dce6, 6, 0.4, 6);
      }
      this.prevAir[i] = air;
      this.prevStun[i] = kart.stunT;
    }
  }

  /** Turn state changes on your kart into sound, shake, particles and HUD moments. */
  private react(): void {
    const me = this.me;
    const hud = this.hud;
    if (!me || !hud || this.mode.kind === "attract") return;
    const w = this.watch;
    const world = this.world;
    const root = this.visuals[me.slot].root;

    if (world.phase === Phase.Countdown) {
      const sec = Math.ceil(world.phaseTicks / TICK_RATE);
      if (sec !== w.sec && sec <= 3) sound.countdown(sec);
      w.sec = sec;
    } else if (w.sec > 0 && w.sec < 99) {
      sound.countdown(0);
      w.sec = 0;
      w.lapStart = this.time;
    }
    if (world.phase === Phase.Racing && me.startResult !== w.start) {
      w.start = me.startResult;
      sound.rocket(me.startResult);
      if (me.startResult === 2) hud.banner("Perfect start!", "Rocket boost", "boost");
      else if (me.startResult === 1) hud.banner("Good start", "Hit W a moment later for a perfect one", "boost");
    }
    if (me.boostKind !== w.boost) {
      if (me.boostKind) {
        sound.boost(me.boostKind);
        this.shake = Math.max(this.shake, me.boostKind === 6 ? 0.7 : 0.3);
        this.fovKick = Math.max(this.fovKick, me.boostKind === 6 ? 14 : me.boostKind === 3 || me.boostKind === 9 ? 10 : 6);
      }
      w.boost = me.boostKind;
    }
    if (me.gpus > w.gpus) {
      sound.gpu(me.gpus);
      this.tmpA.copy(root.position).y += 1.2;
      this.sparks.burst(this.tmpA, 12, 0x76b900, 5, 0.5, 0, 2);
    } else if (me.gpus < w.gpus) {
      sound.spill();
      this.tmpA.copy(root.position).y += 1;
      this.sparks.burst(this.tmpA, 20, 0x76b900, 10, 0.8, 18, 6);
    }
    w.gpus = me.gpus;
    if (me.stunT > w.stun + 0.3) {
      sound.hit();
      this.shake = 1.2;
    }
    w.stun = me.stunT;
    const air = me.z > 0.3;
    if (w.air && !air) {
      sound.land();
      this.shake = Math.max(this.shake, 0.35);
    }
    w.air = air;
    if (me.trickT > 0 && w.trick <= 0) {
      sound.trick();
      hud.calloutText("Trick!", "item");
    }
    w.trick = me.trickT;
    const tier = me.drifting ? (me.driftCharge >= 2.3 ? 3 : me.driftCharge >= 1.4 ? 2 : me.driftCharge >= 0.7 ? 1 : 0) : 0;
    if (tier > w.tier) sound.driftTier(tier);
    w.tier = tier;
    if (me.item && !w.item) sound.itemLand();
    if (w.item === ItemKind.Missile && (me.itemCount < w.itemCount || me.item === ItemKind.None)) sound.fire();
    w.item = me.item;
    w.itemCount = me.itemCount;
    if (me.passes > w.passes) sound.whoosh();
    w.passes = me.passes;

    if (world.phase === Phase.Racing && !me.finished) {
      const lap = world.lapOf(me);
      if (lap > w.lap) {
        const split = this.time - w.lapStart;
        const best = split < w.bestLap;
        w.bestLap = Math.min(w.bestLap, split);
        w.lapStart = this.time;
        const final = lap === world.laps;
        sound.lap(final);
        if (final) sound.setIntense(true);
        hud.banner(final ? "Final lap!" : `Lap ${lap}`, `${best && w.lap > 1 ? "Best lap! " : ""}Last lap ${split.toFixed(2)}s`, final ? "final" : "boost");
      }
      w.lap = lap;
      const place = world.order.indexOf(me) + 1;
      if (w.place && place !== w.place && this.time - w.lapStart > 2) {
        sound.overtake(place < w.place);
        hud.placePop(place, place < w.place);
      }
      w.place = place;
      if (Math.abs(me.heading) > 2.2 && Math.abs(me.speed) > 3) w.wrongT += 1 / 60;
      else w.wrongT = 0;
      hud.wrongWay(w.wrongT > 1);
    }
    if (me.finished && !w.finished) {
      w.finished = true;
      const place = world.order.indexOf(me) + 1;
      sound.finish(place);
      sound.setIntense(false);
      this.tmpA.copy(root.position).y += 3;
      this.confetti.burst(this.tmpA, 260, [0xffc93c, 0xff3d7f, 0x3de0ff, 0x76b900, 0xffffff, 0xb18cff], 22, 3.2, 14, 10);
      hud.wrongWay(false);
    }
    const throttle = (this.inputs[me.slot].bits & 1) !== 0;
    sound.updateSpeed(me.speed, me.boostT > 0);
  }

  private drawSpeedLines(): void {
    const canvas = this.speedLines;
    if (!canvas) return;
    const focus = this.me ?? (this.mode.kind === "attract" ? null : this.world.order[0]);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Resizing a canvas reallocates its backing store, so only do it when the window changes.
    const scale = 0.5;
    const w = Math.round(innerWidth * scale);
    const h = Math.round(innerHeight * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const intensity = focus && !this.paused
      ? Math.max(0, Math.min(1, (focus.speed - 36) / 30)) + (focus.boostT > 0 ? 0.6 : 0) + (focus.nitroLit ? 0.3 : 0) + focus.draft * 0.25
      : 0;
    if (this.speedLinesDrawn) ctx.clearRect(0, 0, w, h);
    this.speedLinesDrawn = intensity > 0;
    if (!focus || intensity <= 0) return;
    const cx = w / 2;
    const cy = h * 0.46;
    const count = Math.floor(30 + intensity * 50);
    ctx.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = Math.max(w, h) * (0.32 + Math.random() * 0.25);
      const len = (40 + Math.random() * 160 * intensity) * scale;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.strokeStyle = focus.boostT > 0 ? `rgba(61,224,255,${0.12 + 0.25 * Math.random() * intensity})` : `rgba(255,255,255,${0.08 + 0.18 * Math.random() * intensity})`;
      ctx.lineWidth = (1 + Math.random() * 2.5) * scale;
      ctx.beginPath();
      ctx.moveTo(cx + cos * r0, cy + sin * r0);
      ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
      ctx.stroke();
    }
  }

  private updateCamera(): void {
    const world = this.world;
    const camera = this.stage.camera;
    let target = this.setup.you;
    if (target < 0 || this.mode.kind === "attract") {
      if (this.time > this.attractTarget + 9) {
        this.attractTarget = this.time;
      }
      const order = world.order;
      target = this.mode.kind === "attract" ? order[Math.floor(this.attractTarget / 9) % Math.min(3, order.length)].slot : order[0].slot;
    }
    const r = this.render[target];
    const kart = world.karts[target];
    const track = world.track;
    const attract = this.mode.kind === "attract";
    const pullTarget = attract ? 0 : kart.nitroLit ? 1.8 : kart.boostT > 0 ? 1.1 : 0;
    this.camPull += (pullTarget - this.camPull) * (pullTarget > this.camPull ? 0.06 : 0.03);
    const back = attract ? 11 : 7.2 + this.camPull;
    const height = attract ? 4.2 : 3.1 - this.camPull * 0.3;
    const sideways = attract ? Math.sin(this.time * 0.15) * 7 : 0;
    const heading = r.heading - (attract ? 0 : r.slip * 0.4);
    const desired = trackPoint(track, r.dist - Math.cos(heading) * back, r.d - Math.sin(heading) * back + sideways, r.z + height, this.camDesired);
    const look = trackPoint(track, r.dist + Math.cos(heading) * 6, r.d + Math.sin(heading) * 6, r.z + 1.2, this.camTarget);
    if (!this.camReady || this.camPos.distanceTo(desired) > 60) {
      this.camPos.copy(desired);
      this.camLook.copy(look);
      this.camReady = true;
    }
    const k = 1 - Math.exp(-(attract ? 3 : 9) / 60);
    this.camPos.lerp(desired, k);
    this.camLook.lerp(look, Math.min(1, k * 1.6));
    const frame = trackPose(track, r.dist, r.d, r.z);
    this.camUp.lerp(this.camDesired.set(frame.ux, frame.uy, frame.uz), 1 - Math.exp(-6 / 60)).normalize();
    camera.position.copy(this.camPos);
    if (this.shake > 0.01) {
      const amp = this.shake * 0.35;
      camera.position.x += (Math.random() - 0.5) * amp;
      camera.position.y += (Math.random() - 0.5) * amp;
      camera.position.z += (Math.random() - 0.5) * amp;
    }
    this.shake *= Math.exp(-6 / 60);
    // Near top speed the camera hums: a fast, small, smooth shudder rather than random jitter.
    const hum = attract || reducedMotion.matches ? 0 : Math.max(0, Math.min(1, (kart.speed - kart.maxSpeed * 0.8) / (kart.maxSpeed * 0.5)));
    if (hum > 0) {
      camera.position.y += Math.sin(this.time * 41) * 0.035 * hum;
      camera.position.x += Math.sin(this.time * 29 + 1.3) * 0.025 * hum;
    }
    camera.up.copy(this.camUp);
    camera.lookAt(this.camLook);
    this.fovKick *= Math.exp(-3 / 60);
    const fov = 64 + Math.min(32, Math.max(0, kart.speed) * 0.36) + (kart.boostT > 0 ? 7 : 0) + (kart.nitroLit ? 4 : 0) + this.fovKick;
    const nextFov = camera.fov + (fov - camera.fov) * 0.08;
    if (Math.abs(nextFov - camera.fov) > 0.01) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  }

  private updateHud(): void {
    const hud = this.hud;
    if (!hud || this.mode.kind === "attract") return;
    const world = this.world;
    const me = this.me;
    const order = world.order;
    // Rank by where karts are drawn, so the place you see matches who's ahead on screen.
    const shown = this.render;
    if (this.mode.kind === "online") order.sort((a, b) => (a.finished && b.finished ? a.finishTick - b.finishTick : a.finished ? -1 : b.finished ? 1 : shown[b.slot].dist - shown[a.slot].dist));
    const focus = me ?? order[0];
    const place = order.indexOf(focus) + 1;
    const racingSeconds = (world.tick - COUNTDOWN_TICKS) / TICK_RATE;
    let status = "";
    let bad = false;
    if (this.time < this.statusUntil) {
      status = this.statusText;
      bad = this.statusBad;
    }
    const state: HudState = {
      place,
      total: world.karts.length,
      lap: world.lapOf(focus),
      laps: world.laps,
      raceSeconds: world.phase === Phase.Countdown ? 0 : focus.finished ? (focus.finishTick - COUNTDOWN_TICKS) / TICK_RATE : racingSeconds,
      speed: focus.speed,
      boosting: focus.boostT > 0,
      item: focus.item,
      itemCount: focus.itemCount,
      item2: focus.item2,
      item2Count: focus.item2Count,
      twin: focus.perk === "twin-engine",
      countdown: world.phase === Phase.Countdown ? world.phaseTicks / TICK_RATE : 0,
      racing: world.phase !== Phase.Countdown,
      status,
      statusBad: bad,
      finishedPlace: focus.finished ? place : 0,
      spectating: !me,
      drifting: focus.drifting > 0,
      driftCharge: focus.driftCharge,
      boostKind: focus.boostKind,
      slowFlags: focus.slowFlags,
      gpus: focus.gpus,
      draft: focus.draft,
      nitro: focus.nitro,
      nitroLit: focus.nitroLit > 0,
      nitroHeld: !!me && (this.inputs[me.slot].bits & InputBit.Nitro) !== 0,
      driftChain: focus.driftChain,
      passes: focus.passes,
    };
    const dots: MapDot[] = this.render.map((r, i) => ({ dist: r.dist, d: r.d, me: i === this.setup.you }));
    hud.update(state, dots);
  }

  dispose(): void {
    this.trackScene.dispose();
    this.stage.scene.remove(this.sparks.points, this.confetti.points);
    this.sparks.dispose();
    this.confetti.dispose();
    if (this.mode.kind !== "attract") {

      sound.stopMusic();
    }
    if (this.speedLines) this.speedLines.getContext("2d")?.clearRect(0, 0, this.speedLines.width, this.speedLines.height);
    for (const v of this.visuals) {
      this.stage.scene.remove(v.root);
      v.dispose();
    }
    for (const m of this.missiles) {
      this.stage.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    // Only unhook our own handler: on a reconnect the replacement view is already attached.
    if (this.mode.kind === "online" && this.mode.net.onSnapshot === this.snapshotHandler) this.mode.net.onSnapshot = () => {};
    if (this.controls) this.controls.enabled = false;
  }
}
