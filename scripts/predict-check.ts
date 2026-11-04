// Drives one client with real client-side prediction and reports how far the
// prediction drifts from the server's authoritative state at each snapshot.
import {
  DT, Phase, World, applyKartFields, botInput, characterIndex, copyInput, decodeSnapshot,
  PROTOCOL_VERSION, encodeInputs, type Input, kartIndex, makeInput, type ServerMessage,
} from "@dario-kart/sim";

const base = (process.argv[2] ?? "http://localhost:1337").replace(/^http/, "ws");
const code = `P${Math.floor(Math.random() * 1e5)}`.slice(0, 6);
const ws = new WebSocket(`${base}/api/race/${code}?code=${code}`);
ws.binaryType = "arraybuffer";
let world: World | null = null;
let you = -1;
let seq = 0;
const pending: Input[] = [];
const errors: number[] = [];
ws.onopen = () => {
  ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, id: "p1", name: "Pred", character: "sam", kart: "fable", primary: 0x00ff00, secondary: 0x000000 }));
  setTimeout(() => ws.send(JSON.stringify({ t: "settings", track: "sf", bots: 3 })), 200);
  setTimeout(() => ws.send(JSON.stringify({ t: "start" })), 400);
};
ws.onmessage = (e) => {
  if (typeof e.data === "string") {
    const msg = JSON.parse(e.data) as ServerMessage;
    if (msg.t === "race") {
      you = msg.you;
      world = new World({ theme: msg.track, seed: msg.seed, laps: msg.laps, predict: true,
        racers: msg.slots.map((s) => ({ kart: kartIndex(s.kart), character: characterIndex(s.character), bot: s.bot })) });
    }
    return;
  }
  const snap = decodeSnapshot(new DataView(e.data as ArrayBuffer));
  if (!snap || !world) return;
  world.tick = snap.header.tick;
  world.phase = snap.header.phase as Phase;
  for (let i = 0; i < world.karts.length; i++) if (i !== you) applyKartFields(snap.karts, i, world.karts[i]);
  const me = world.karts[you];
  // Where did prediction think we were at the acked input?
  const ack = snap.header.ack;
  while (pending.length && pending[0].seq <= ack) pending.shift();
  const predicted = { dist: me.dist, d: me.d };
  applyKartFields(snap.karts, you, me);
  for (const input of pending) world.stepOne(me, input);
  if (world.phase === Phase.Racing && ack > 0) errors.push(Math.hypot(predicted.dist - me.dist, predicted.d - me.d));
};
const buf = new DataView(new ArrayBuffer(64));
const outbox: Input[] = [];
setInterval(() => {
  if (!world || you < 0 || world.phase !== Phase.Racing) return;
  const me = world.karts[you];
  const input = botInput(world, me, makeInput());
  input.seq = ++seq;
  const stored = copyInput(input, makeInput());
  pending.push(stored);
  outbox.push(stored);
  world.stepOne(me, input);
  if (outbox.length >= 2) {
    ws.send(new Uint8Array(buf.buffer, 0, encodeInputs(outbox, buf, world.seed)).slice());
    outbox.length = 0;
  }
}, DT * 1000);
await Bun.sleep(25000);
errors.sort((a, b) => a - b);
const pct = (p: number) => errors[Math.floor(errors.length * p)]?.toFixed(3);
console.log(`snapshots=${errors.length} predictionError p50=${pct(0.5)}m p90=${pct(0.9)}m p99=${pct(0.99)}m max=${errors.at(-1)?.toFixed(3)}m`);
process.exit(0);
