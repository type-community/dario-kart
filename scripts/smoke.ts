// Headless end-to-end check against a running server: two clients join a lobby,
// the host starts a race with bots, and both drive with the bot AI for a while.
import {
  DT, KART_NET_FIELDS, Phase, World, applyKartFields, botInput, characterIndex, decodeSnapshot,
  PROTOCOL_VERSION, encodeInputs, kartIndex, makeInput, type ServerMessage,
} from "@dario-kart/sim";

const base = (process.argv[2] ?? "http://localhost:1337").replace(/^http/, "ws");
const seconds = Number(process.argv[3] ?? 20);
const code = `T${Math.floor(Math.random() * 1e5)}`.slice(0, 6).toUpperCase();

interface Client {
  ws: WebSocket;
  name: string;
  snapshots: number;
  lastTick: number;
  slot: number;
  world: World | null;
  messages: ServerMessage[];
  maxDist: number;
}

const connect = (name: string) =>
  new Promise<Client>((resolve, reject) => {
    const ws = new WebSocket(`${base}/api/race/${code}?code=${code}`);
    ws.binaryType = "arraybuffer";
    const client: Client = { ws, name, snapshots: 0, lastTick: 0, slot: -1, world: null, messages: [], maxDist: -1e9 };
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, id: crypto.randomUUID(), name, character: "dario", kart: "claude", primary: 0xff0000, secondary: 0xffffff }));
      resolve(client);
    };
    ws.onerror = (e) => reject(e);
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data) as ServerMessage;
        client.messages.push(msg);
        if (msg.t === "race") {
          client.slot = msg.you;
          client.world = new World({
            theme: msg.track, seed: msg.seed, laps: msg.laps, predict: true,
            racers: msg.slots.map((s) => ({ kart: kartIndex(s.kart), character: characterIndex(s.character), bot: s.bot })),
          });
        }
        return;
      }
      const snap = decodeSnapshot(new DataView(event.data as ArrayBuffer));
      if (!snap || !client.world) return;
      client.snapshots++;
      client.lastTick = snap.header.tick;
      client.world.tick = snap.header.tick;
      client.world.phase = snap.header.phase as Phase;
      client.world.karts.forEach((k, i) => applyKartFields(snap.karts, i, k));
      if (client.slot >= 0) client.maxDist = Math.max(client.maxDist, client.world.karts[client.slot].dist);
    };
  });

const host = await connect("Host");
const guest = await connect("Guest");
await Bun.sleep(300);
host.ws.send(JSON.stringify({ t: "settings", track: "nyc", bots: 6 }));
await Bun.sleep(200);
host.ws.send(JSON.stringify({ t: "start" }));

const buf = new DataView(new ArrayBuffer(64));
let seq = 0;
const start = performance.now();
const drive = setInterval(() => {
  for (const c of [host, guest]) {
    if (!c.world || c.slot < 0) continue;
    const kart = c.world.karts[c.slot];
    const a = botInput(c.world, kart, makeInput());
    const b = { ...a };
    a.seq = ++seq;
    b.seq = ++seq;
    c.ws.send(new Uint8Array(buf.buffer, 0, encodeInputs([a, b], buf, c.world.seed)).slice());
  }
}, DT * 2000);

await Bun.sleep(seconds * 1000);
clearInterval(drive);
const elapsed = (performance.now() - start) / 1000;
for (const c of [host, guest]) {
  const lobby = c.messages.filter((m) => m.t === "lobby").at(-1);
  const events = c.messages.filter((m) => m.t === "event").length;
  console.log(
    `${c.name}: slot=${c.slot} snapshots=${c.snapshots} (${(c.snapshots / elapsed).toFixed(1)}/s) serverTick=${c.lastTick} ` +
      `(${(c.lastTick / elapsed).toFixed(1)} ticks/s) myDist=${c.maxDist.toFixed(0)}m events=${events} players=${lobby && "players" in lobby ? lobby.players.length : "?"}`,
  );
}
console.log("fields per kart:", KART_NET_FIELDS.length);
const types: Record<string, number> = {};
for (const m of host.messages) types[m.t] = (types[m.t] ?? 0) + 1;
console.log("host messages:", types);
const results = host.messages.find((m) => m.t === "results");
if (results && results.t === "results") console.log("results:", results.results.map((r) => `${r.name}:${r.time ?? "DNF"}`).join(", "));
host.ws.close();
guest.ws.close();
process.exit(0);
