/**
 * Load test: N remote players in one race, each a real WebSocket client that
 * talks the same protocol as a browser tab. They join a few seconds apart,
 * send inputs in packets sized by the server (driven by the bot AI on a world
 * rebuilt from snapshots), ping every 2 s, and come back after a drop like the real client.
 * Whoever the server makes host picks no bots and starts once everyone is in.
 *
 *   bun scripts/load.ts [server=wss://…] [players=50] [track=sf] [code=random]
 *
 * Several processes can share one race: pass the same code, and HOST=0 on all but one.
 */
import {
  type DecodedSnapshot, DT, Phase, PROTOCOL_VERSION, type ServerMessage, World, applyKartFields, botInput,
  characterIndex, CHARACTERS, decodeSnapshot, encodeInputs, KARTS, kartIndex, makeInput,
} from "@dario-kart/sim";

const PROD = "wss://dariokart-game-prod-ahep3csthvpgpd4a.type-cloudflare-ci.workers.dev";
const base = (process.argv[2] || PROD).replace(/^http/, "ws").replace(/\/$/, "");
const count = Number(process.argv[3] ?? 50);
const track = process.argv[4] ?? "sf";
const code = (process.argv[5] || `LD${Math.floor(Math.random() * 1e4)}`).toUpperCase();
const hosting = process.env.HOST !== "0";
const offset = Number(process.env.OFFSET ?? 0);
const JOIN_SPREAD_MS = Number(process.env.SPREAD_MS ?? 6000);
const TIMEOUT_S = Number(process.env.TIMEOUT_S ?? 420);
const RETRY_MS = [300, 1000, 2000, 4000, 8000];

const pct = (values: number[], p: number) => {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

class Player {
  ws: WebSocket | null = null;
  readonly id = crypto.randomUUID();
  slot = -1;
  world: World | null = null;
  seq = 0;
  sentAt = 0;
  lastSnapAt = 0;
  readonly gaps: number[] = [];
  readonly rtts: number[] = [];
  /** Inputs sent but not yet applied by the server, sampled per snapshot. */
  readonly backlog: number[] = [];
  readonly tickRate: number[] = [];
  snapshots = 0;
  bytes = 0;
  closes: string[] = [];
  errors: string[] = [];
  results: ServerMessage | null = null;
  lobbySize = 0;
  /** Whoever's hello reached the server first hosts, not necessarily player 0. */
  host = false;
  batch = 2;
  attempt = 0;
  done = false;
  firstSnap: { tick: number; at: number } | null = null;
  lastTick = 0;
  private readonly buf = new DataView(new ArrayBuffer(256));

  constructor(readonly n: number, readonly name = `Load ${n}`) {}

  open(): void {
    const ws = new WebSocket(`${base}/api/race/${code}?code=${code}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      const character = CHARACTERS[this.n % CHARACTERS.length].id;
      const kart = KARTS[this.n % KARTS.length];
      ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, id: this.id, name: this.name, character, kart: kart.id, primary: kart.color, secondary: kart.accent }));
    };
    ws.onmessage = (event) => (typeof event.data === "string" ? this.text(JSON.parse(event.data)) : this.binary(event.data as ArrayBuffer));
    ws.onerror = () => this.errors.push("socket error");
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.closes.push(`${event.code} ${event.reason}`);
      if (this.done || [1000, 4000, 4002, 4003].includes(event.code) || this.attempt >= RETRY_MS.length) return;
      setTimeout(() => this.open(), RETRY_MS[this.attempt++]);
    };
  }

  private text(msg: ServerMessage): void {
    switch (msg.t) {
      case "lobby":
        this.lobbySize = msg.players.length;
        this.host = msg.players.some((p) => p.host && p.key === msg.you);
        break;
      case "race":
        this.slot = msg.you;
        this.batch = msg.batch ?? 2;
        this.seq = 0;
        this.world = new World({
          theme: msg.track, seed: msg.seed, laps: msg.laps, predict: true,
          racers: msg.slots.map((s) => ({ kart: kartIndex(s.kart), character: characterIndex(s.character), bot: s.bot })),
        });
        this.sentAt = performance.now();
        break;
      case "pong":
        this.rtts.push(performance.now() - msg.at);
        break;
      case "results":
        this.results = msg;
        break;
      case "error":
        this.errors.push(msg.message);
        break;
    }
  }

  private binary(data: ArrayBuffer): void {
    const now = performance.now();
    const snap = decodeSnapshot(new DataView(data));
    if (!snap || !this.world) return;
    this.bytes += data.byteLength;
    this.snapshots++;
    if (this.lastSnapAt && snap.header.phase === Phase.Racing) this.gaps.push(now - this.lastSnapAt);
    this.lastSnapAt = now;
    this.firstSnap ??= { tick: snap.header.tick, at: now };
    this.lastTick = snap.header.tick;
    this.apply(snap);
    if (this.slot >= 0 && snap.header.phase === Phase.Racing && !this.world.karts[this.slot].finished) this.backlog.push(this.seq - snap.header.ack);
  }

  private apply(snap: DecodedSnapshot): void {
    const world = this.world!;
    world.tick = snap.header.tick;
    world.phase = snap.header.phase as Phase;
    world.phaseTicks = snap.header.phase === Phase.Countdown ? snap.header.phaseTicks : world.phaseTicks;
    world.karts.forEach((k, i) => applyKartFields(snap.karts, i, k));
  }

  /** Called every few ms; sends however many 60 Hz inputs are due, `batch` per packet like the browser. */
  drive(now: number): void {
    const world = this.world;
    const ws = this.ws;
    if (!world || this.slot < 0 || !ws || ws.readyState !== WebSocket.OPEN || this.results || world.karts[this.slot].finished) return;
    const every = DT * 1000 * this.batch;
    while (now - this.sentAt >= every) {
      this.sentAt += every;
      const kart = world.karts[this.slot];
      const input = botInput(world, kart, makeInput());
      input.bits |= kart.nitro > 0.5 ? 32 : 0;
      const batch = Array.from({ length: this.batch }, () => ({ ...input, seq: ++this.seq }));
      ws.send(new Uint8Array(this.buf.buffer, 0, encodeInputs(batch, this.buf, world.seed)).slice());
    }
  }

  ping(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "ping", at: performance.now() }));
  }
}

console.log(`race ${code} on ${base}: ${count} players${hosting ? " (hosting)" : ""}`);
const players = Array.from({ length: count }, (_, i) => new Player(offset + i));
const started = performance.now();
for (const [i, p] of players.entries()) {
  setTimeout(() => p.open(), (i / Math.max(1, count)) * JOIN_SPREAD_MS);
}

// Watch our own event loop: if this process stalls, its numbers are its own fault.
const loopLag: number[] = [];
let lastLoop = performance.now();
setInterval(() => {
  const now = performance.now();
  loopLag.push(now - lastLoop - 5);
  lastLoop = now;
  for (const p of players) p.drive(now);
}, 5);
setInterval(() => players.forEach((p) => p.ping()), 2000);

let host = players[0];
if (hosting) {
  await Bun.sleep(JOIN_SPREAD_MS + 500);
  const want = Number(process.env.EXPECT ?? count);
  for (let i = 0; i < 60 && host.lobbySize < want; i++) await Bun.sleep(500);
  host = players.find((p) => p.host) ?? host;
  console.log(`lobby has ${host.lobbySize} players; ${host.name} is host, starting`);
  host.ws?.send(JSON.stringify({ t: "settings", track, bots: 0 }));
  await Bun.sleep(300);
  host.ws?.send(JSON.stringify({ t: "start" }));
}

const report = () => {
  const all = (f: (p: Player) => number[]) => players.flatMap(f);
  const gaps = all((p) => p.gaps);
  const raced = players.filter((p) => p.slot >= 0);
  const elapsed = raced.map((p) => (p.firstSnap ? (p.lastTick - p.firstSnap.tick) / ((p.lastSnapAt - p.firstSnap.at) / 1000) : NaN)).filter(Number.isFinite);
  const finished = players.filter((p) => p.results).length;
  const f = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : "-");
  const line = (label: string, v: number[]) => `${label} p50 ${f(pct(v, 0.5))} p95 ${f(pct(v, 0.95))} p99 ${f(pct(v, 0.99))} max ${f(pct(v, 1))}`;
  console.log(`--- ${Math.round((performance.now() - started) / 1000)} s`);
  console.log(`players ${players.length}, in race ${raced.length}, got results ${finished}, connected ${players.filter((p) => p.ws?.readyState === WebSocket.OPEN).length}`);
  console.log(line("snapshot gap ms", gaps), ` >150ms: ${gaps.filter((g) => g > 150).length}/${gaps.length}`);
  console.log(line("server ticks/s seen", elapsed));
  console.log(line("input backlog ticks", all((p) => p.backlog)));
  console.log(line("rtt ms", all((p) => p.rtts)));
  console.log(line("this process loop lag ms", loopLag));
  const kb = players.reduce((s, p) => s + p.bytes, 0) / 1024;
  console.log(`snapshot bytes: ${Math.round(kb)} KB total, ${f(kb / Math.max(1, players.reduce((s, p) => s + p.snapshots, 0)) * 1024)} B each`);
  const closes = players.flatMap((p) => p.closes);
  if (closes.length) console.log("closes:", Object.entries(Object.groupBy(closes, (c) => c)).map(([k, v]) => `${k} ×${v!.length}`).join(", "));
  const errors = players.flatMap((p) => p.errors);
  if (errors.length) console.log("errors:", [...new Set(errors)].join(" | "));
};

const progress = setInterval(report, 20_000);
const deadline = performance.now() + TIMEOUT_S * 1000;
for (let i = 0; i < 120 && !players.some((p) => p.slot >= 0); i++) await Bun.sleep(500);
while (performance.now() < deadline && players.some((p) => p.slot >= 0 && !p.results)) await Bun.sleep(1000);
clearInterval(progress);
const r = host.results;
if (r?.t === "results") {
  const times = r.results.filter((x) => x.time !== null);
  console.log(`results: ${times.length}/${r.results.length} finished, winner ${r.results[0]?.name} ${r.results[0]?.time}s, last ${times.at(-1)?.time}s`);
}
report();
for (const p of players) {
  p.done = true;
  p.ws?.close(1000, "Left");
}
process.exit(0);
