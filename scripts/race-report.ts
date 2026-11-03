import { KARTS, Phase, World, botInput, makeInput } from "@dario-kart/sim";

const theme = (process.argv[2] ?? "sf") as "sf";
const players = Number(process.argv[3] ?? 8);
const seed = Number(process.argv[4] ?? 1234);

const world = new World({
  theme, seed,
  racers: Array.from({ length: players }, (_, i) => ({ kart: i % KARTS.length, character: i % 10, bot: true })),
});
const inputs = world.karts.map(() => makeInput());
const stats = world.karts.map(() => ({ wall: 0, stun: 0, slow: 0, maxSpeed: 0, speedSum: 0, n: 0, backwards: 0, air: 0 }));
const limit = world.track.halfWidth - 1.01;
while (world.phase !== Phase.Finished && world.tick < 60 * 400) {
  world.karts.forEach((k, i) => botInput(world, k, inputs[i]));
  world.step(inputs);
  if (world.phase !== Phase.Racing) continue;
  world.karts.forEach((k, i) => {
    const s = stats[i];
    if (Math.abs(k.d) > limit) s.wall++;
    if (k.stunT > 0) s.stun++;
    if (k.slowZone) s.slow++;
    if (k.z > 0.3) s.air++;
    if (Math.abs(k.heading) > Math.PI / 2) s.backwards++;
    s.maxSpeed = Math.max(s.maxSpeed, k.speed);
    s.speedSum += k.speed;
    s.n++;
  });
}
console.log(`track ${theme} players=${players} length=${world.track.length.toFixed(0)}m halfWidth=${world.track.halfWidth.toFixed(1)} features=${world.track.features.length} boxes=${world.track.itemBoxes.length} loops=${world.track.loops.length} climb=${(Math.max(...world.track.py) - Math.min(...world.track.py)).toFixed(0)}m`);
console.log(`ended at ${(world.tick / 60).toFixed(1)}s phase=${world.phase}`);
world.karts.forEach((k, i) => {
  const s = stats[i];
  const t = k.finished ? (k.finishTick / 60).toFixed(1) + "s" : "DNF";
  console.log(`${KARTS[k.kartModel].name.padEnd(8)} ${t.padStart(7)} lap=${world.lapOf(k)} dist=${k.dist.toFixed(0)} avg=${(s.speedSum / s.n).toFixed(1)} max=${s.maxSpeed.toFixed(1)} wall=${(s.wall / 60).toFixed(1)}s stun=${(s.stun / 60).toFixed(1)}s slow=${(s.slow / 60).toFixed(1)}s air=${(s.air / 60).toFixed(1)}s back=${(s.backwards / 60).toFixed(1)}s`);
});
const counts: Record<string, number> = {};
for (const e of world.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log(counts);
