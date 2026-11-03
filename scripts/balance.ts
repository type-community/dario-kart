// Monte-Carlo kart balance: many full bot races with shuffled kart assignments.
// Usage: bun scripts/balance.ts [races=240] [racers=8]
import { KARTS, Phase, THEMES, World, botInput, hash01, makeInput } from "@dario-kart/sim";

const races = Number(process.argv[2] ?? 240);
const racers = Number(process.argv[3] ?? 8);
const stats = KARTS.map((k) => ({ name: k.name, starts: 0, placeSum: 0, wins: 0, podiums: 0, dnf: 0 }));

for (let r = 0; r < races; r++) {
  const theme = THEMES[r % THEMES.length].id;
  const seed = Number(process.argv[4] ?? 1000) + r * 7919;
  const lineup = Array.from({ length: racers }, (_, i) => ({
    kart: Math.floor(hash01(seed, i, 3) * KARTS.length),
    character: i % 10,
    bot: true,
    order: hash01(seed, i, 9),
  })).sort((a, b) => a.order - b.order);
  const world = new World({ theme, seed, racers: lineup });
  const inputs = world.karts.map(() => makeInput());
  while (world.phase !== Phase.Finished && world.tick < 60 * 420) {
    for (let i = 0; i < world.karts.length; i++) botInput(world, world.karts[i], inputs[i]);
    world.step(inputs);
    world.events.length = 0;
  }
  world.order.forEach((kart, place) => {
    const s = stats[kart.kartModel];
    s.starts++;
    s.placeSum += place / (racers - 1);
    if (place === 0) s.wins++;
    if (place < 3) s.podiums++;
    if (!kart.finished) s.dnf++;
  });
}

console.log(`${races} races × ${racers} racers`);
console.log("kart      starts  avgPlace  win%   podium%  dnf");
for (const s of stats) {
  console.log(
    `${s.name.padEnd(9)} ${String(s.starts).padStart(6)}  ${(s.placeSum / s.starts).toFixed(3).padStart(8)}  ${((s.wins / s.starts) * 100).toFixed(1).padStart(5)}  ${((s.podiums / s.starts) * 100).toFixed(1).padStart(7)}  ${s.dnf}`,
  );
}
const avg = stats.map((s) => s.placeSum / s.starts);
console.log(`spread (max-min avgPlace): ${(Math.max(...avg) - Math.min(...avg)).toFixed(3)}  (0 = perfectly even; expected 0.5 each)`);
