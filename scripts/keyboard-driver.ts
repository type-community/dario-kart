// Headless "keyboard human": digital keys, the client's steering ramp, a reaction delay.
// Usage: bun scripts/keyboard-driver.ts [hold|smart|nodrift]
// hold: keeps the turn key down through every drift (what most keyboard players do).
// smart: steers the drift line. nodrift: never drifts. Reports race time and where the wall time comes from.
import { InputBit, Phase, THEMES, World, curvatureAt, makeInput } from "@dario-kart/sim";

const style = process.argv[2] ?? "hold";
const DELAY = 7; // ticks of reaction time
const out: Record<string, number> = { time: 0, wall: 0, slowZone: 0, drifts: 0, boosts: 0, maxChain: 0, chainSum: 0, overRot: 0 };
let races = 0;
for (const theme of THEMES) for (const seed of [11, 22, 33]) {
  const world = new World({ theme: theme.id, seed, racers: [{ kart: Number(process.env.KART ?? 2), character: 0, bot: false }] });
  const k = world.karts[0];
  const t = world.track;
  const input = makeInput();
  const queue: Array<{ dir: number; bits: number }> = [];
  let steer = 0, driftHeldT = 0, lastChain = 0;
  while (world.phase !== Phase.Finished && world.tick < 60 * 200) {
    // Decide from what's ahead (with delay).
    const speed = Math.max(10, k.speed);
    let kAhead = 0;
    for (let o = 8; o <= 8 + speed * 0.5; o += 3) { const c = curvatureAt(t, k.dist + o); if (Math.abs(c) > Math.abs(kAhead)) kAhead = c; }
    const kNow = curvatureAt(t, k.dist + 4);
    let bits: number = InputBit.Throttle;
    let dir = 0;
    const travel = k.heading - k.slip;
    const want = Math.atan2(-k.d * 0.6, 20);
    if (style !== "nodrift" && (k.drifting || (Math.abs(kNow) > 0.012 && Math.abs(kAhead) > 0.014 && k.speed > 30))) {
      const turn = k.drifting ? k.driftDir : Math.sign(kNow);
      bits |= InputBit.Drift;
      if (!k.drifting) dir = turn;
      else if (style === "hold") dir = turn;
      else {
        // Smart: press in when sliding wide (travel angle points outward), out when pointing at the inside wall.
        const err = (want - travel) * turn;
        dir = err > 0.12 ? turn : err < -0.12 ? -turn : 0;
      }
      if (k.drifting && Math.abs(kNow) < 0.006 && Math.abs(kAhead) < 0.01) bits &= ~InputBit.Drift;
    } else {
      const ff = -kNow * speed * 0.9 / 1.9;
      const err = (want - k.heading) * 2.6 - ff;
      dir = err > 0.25 ? 1 : err < -0.25 ? -1 : 0;
    }
    if (k.nitro > 0.6 && Math.abs(kAhead) < 0.008) bits |= InputBit.Nitro;
    queue.push({ dir, bits });
    const act = queue.length > DELAY ? queue.shift()! : { dir: 0, bits: world.phase === Phase.Countdown ? 0 : InputBit.Throttle };
    const rate = act.dir === 0 || Math.sign(act.dir) !== Math.sign(steer) ? 9 : 4;
    steer += Math.sign(act.dir - steer) * Math.min(Math.abs(act.dir - steer), rate / 60);
    input.steer = steer;
    input.bits = world.phase === Phase.Countdown ? (world.phaseTicks < 20 ? InputBit.Throttle : 0) : act.bits;
    const wasDrift = k.drifting;
    world.step([input]);
    if (world.phase !== Phase.Racing) continue;
    if (k.slowFlags & 1) out.wall += 1 / 60;
    if (Math.abs(k.d) > t.halfWidth - 1.1) {
      const inside = Math.sign(k.d) === Math.sign(kNow) ? 1 : 0;
      const key = (k.drifting ? "drift" : "grip") + (Math.abs(kNow) < 0.004 ? "Straight" : inside ? "Inside" : "Outside");
      out[key] = (out[key] ?? 0) + 1 / 60;
    }
    if (k.slowFlags & 2) out.slowZone += 1 / 60;
    if (k.drifting && Math.abs(travel) > 0.6) out.overRot += 1 / 60;
    if (!wasDrift && k.drifting) out.drifts++;
    if (k.driftChain > lastChain) { out.boosts++; out.chainSum += k.driftChain; }
    out.maxChain = Math.max(out.maxChain, k.driftChain);
    lastChain = k.driftChain;
    world.events.length = 0;
  }
  out.time += k.finished ? (k.finishTick / 60 - 3) : 200;
  races++;
}
const r = (x: number) => +(x / races).toFixed(2);
const sides = Object.fromEntries(Object.entries(out).filter(([k]) => /^(drift|grip)[A-Z]/.test(k)).map(([k, v]) => [k, r(v)]));
console.log(style, sides, { raceSec: r(out.time), wallSec: r(out.wall), slowZoneSec: r(out.slowZone), overRotSec: r(out.overRot), drifts: r(out.drifts), driftBoosts: r(out.boosts), avgChain: +(out.chainSum / Math.max(1, out.boosts)).toFixed(2), maxChain: out.maxChain });
