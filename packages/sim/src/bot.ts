import { ItemKind } from "./content.ts";
import { type Input, InputBit } from "./input.ts";
import { hash01 } from "./rng.ts";
import { curvatureAt } from "./track.ts";
import { DT, type Kart, Phase, type World } from "./world.ts";

/**
 * Track-following AI. Used for bot racers, for humans after they finish, and
 * by the headless tests that check every generated track is drivable.
 */
export const botInput = (world: World, kart: Kart, out: Input, skillOverride?: number): Input => {
  let skill = skillOverride ?? kart.botSkill;
  let easing = false;
  // Bots well ahead of every human ease off, so races against bots stay winnable.
  if (skillOverride === undefined && kart.bot) {
    let bestHuman = -Infinity;
    for (const k of world.karts) if (!k.bot) bestHuman = Math.max(bestHuman, k.dist);
    if (bestHuman > -Infinity && kart.dist - bestHuman > 60) {
      skill *= 0.9;
      easing = true;
    }
  }
  const track = world.track;
  if (world.phase === Phase.Countdown) {
    out.steer = 0;
    out.bits = world.phaseTicks <= kart.botStartTick ? InputBit.Throttle : 0;
    out.seq = 0;
    return out;
  }
  const speed = Math.max(0, kart.speed);
  const lookahead = 12 + speed * 0.45;

  if (world.tick % 180 === kart.slot % 180) {
    const r = hash01(world.seed, world.tick, kart.slot);
    kart.botLane = (r * 2 - 1) * track.halfWidth * 0.55;
  }

  let maxK = 0;
  let signedK = 0;
  for (let o = 0; o <= lookahead; o += 4) {
    const k = curvatureAt(track, kart.dist + o);
    if (Math.abs(k) > Math.abs(maxK)) maxK = k;
    if (o <= 8) signedK = k;
  }

  const absSpeed = Math.max(4, speed);
  const speedFactor = Math.min(1, absSpeed / 10) * (1 - 0.3 * Math.min(1, absSpeed / 60));
  const wantHeading = Math.atan2(kart.botLane - kart.d, lookahead);
  const feedForward = (signedK * absSpeed * (1 - kart.cornerAssist)) / (kart.steerRate * speedFactor);
  let steer = (wantHeading - kart.heading) * 2.6 + feedForward;
  const backwards = kart.heading > 1.4 || kart.heading < -1.4;
  if (backwards) {
    // Turn the nose away from the nearest wall, never into it.
    steer = Math.abs(kart.d) > track.halfWidth * 0.3 ? Math.sign(kart.d) : kart.heading > 0 ? -1 : 1;
  }
  steer = Math.max(-1, Math.min(1, steer));

  if (kart.stunT <= 0 && speed < 3 && world.phase === Phase.Racing) kart.botStuckT += DT;
  else if (speed > 8) kart.botStuckT = 0;
  if (kart.botStuckT > 1) {
    out.steer = -steer;
    out.bits = InputBit.Brake;
    out.seq = 0;
    if (kart.botStuckT > 1.8) kart.botStuckT = 0;
    return out;
  }

  let bits: number = InputBit.Throttle;
  const cornerLimit = (kart.steerRate * 0.75) / Math.max(1e-3, Math.abs(maxK));
  const needsDrift = Math.abs(feedForward) > 0.85 && speed > 18;
  if (needsDrift || kart.drifting) {
    if (kart.drifting ? kart.driftDir * signedK > 0.004 : true) bits |= InputBit.Drift;
  }
  if (speed > cornerLimit * 1.2 && !kart.drifting && !backwards) bits = InputBit.Brake;
  if (speed > kart.maxSpeed * skill && kart.boostT <= 0) bits &= ~InputBit.Throttle;

  // Nitro on straights; keep burning once lit, and never sit on a full meter.
  if (!kart.finished && !easing && !backwards && !(bits & InputBit.Brake) && kart.nitro > 0) {
    const straight = cornerLimit > kart.maxSpeed * 1.35;
    if ((straight && (kart.nitroLit || kart.nitro > 0.5)) || kart.nitro > 0.97) bits |= InputBit.Nitro;
  }

  if (kart.item !== ItemKind.None && !kart.finished) {
    kart.botItemDelay -= DT;
    if (kart.botItemDelay <= 0 && !(kart.prevBits & InputBit.Item)) {
      bits |= InputBit.Item;
      if (kart.item === ItemKind.Missile && kart.rank === 0 && hash01(world.seed, world.tick, 5) < 0.5) {
        bits |= InputBit.Back;
      }
      kart.botItemDelay = 0.6 + hash01(world.seed, world.tick, kart.slot + 11) * 2.5;
    }
  }

  if (kart.z > 0.5 && kart.airT > 0.1 && !kart.trickPending && hash01(world.seed, world.tick, kart.slot + 41) < 0.08) bits |= InputBit.Drift;
  out.steer = steer;
  out.bits = bits;
  out.seq = 0;
  return out;
};
