import {
  CHARACTERS, type ClientMessage, GapStats, type Input, InputBit, KARTS, type LobbyPlayer, Phase,
  type RaceResult, type RaceSlot, SNAPSHOT_ACK_OFFSET, type ServerMessage, THEMES, TICK_RATE,
  type ThemeId, World, botInput, characterIndex, decodeInputs, encodeSnapshot, kartIndex,
  INPUTS_PER_PACKET, KICKED, LOBBY_FULL, PROTOCOL_VERSION, inputsPerPacket, type NetReport, cleanName, cleanNetReport, kartById, makeInput, snapshotSize, validColor,
} from "@dario-kart/sim";

/**
 * One race lobby: who's here, the current race, and the 60 Hz loop. Plain
 * TypeScript with no Cloudflare or Effect imports, so it can be tested
 * headlessly or moved to another host without changes.
 */

export interface Conn {
  send(data: string | ArrayBuffer): void;
  close(code: number, reason: string): void;
}

export interface PlayerInfo {
  readonly id: string;
  name: string;
  character: string;
  kart: string;
  primary: number;
  secondary: number;
}

/** What survives a hibernation, stored on the socket. */
export interface Saved {
  readonly info: PlayerInfo;
  /** This connection, as other players see it (two tabs can share a player id). */
  readonly key: string;
  /** Join order; the earliest connection is the host. */
  readonly joinedAt: number;
}

const MAX_RACERS = 100;
const MAX_BOTS = 60;
const SNAPSHOT_EVERY = 3;
const RESULTS_MS = 9000;
const MAX_RACE_TICKS = 15 * 60 * TICK_RATE;
/** How long a race with nobody connected keeps running, waiting for a reconnect. */
const ABANDON_MS = 30_000;
const QUEUE_SIZE = 64;
/** Hard cap on buffered inputs, in packets; anything older is already late. */
const QUEUE_MAX_PACKETS = 3;
const QUEUE_WINDOW = 30;
/** Taps that must survive an input being skipped. */
const EDGE_BITS = InputBit.Item | InputBit.Drift;

export class InputQueue {
  private readonly ring: Input[] = Array.from({ length: QUEUE_SIZE }, makeInput);
  private head = 0;
  private size = 0;
  private low = QUEUE_SIZE;
  private taken = 0;
  private max = QUEUE_MAX_PACKETS * INPUTS_PER_PACKET;
  /**
   * Inputs arrive a packet at a time, so a queue that never drains below one
   * packet over a window is pure added lag (usually left over from a burst after a stall).
   */
  private slack = INPUTS_PER_PACKET;
  readonly last: Input = makeInput();

  push(seq: number, steer: number, bits: number): void {
    if (seq <= this.last.seq && this.size === 0) return;
    if (this.size === QUEUE_SIZE) this.skip();
    const slot = this.ring[(this.head + this.size) % QUEUE_SIZE];
    slot.seq = seq;
    slot.steer = steer;
    slot.bits = bits;
    this.size++;
  }

  /** Drop the oldest input, carrying its button taps into the next one. */
  private skip(): void {
    const dropped = this.ring[this.head];
    this.head = (this.head + 1) % QUEUE_SIZE;
    this.size--;
    if (this.size > 0) this.ring[this.head].bits |= dropped.bits & EDGE_BITS;
  }

  /**
   * Next input for this tick. Holds the last input when the client is late,
   * skips ahead when it's far behind, and sheds standing lag a tick at a time.
   */
  take(): Input {
    while (this.size > this.max) this.skip();
    this.low = Math.min(this.low, this.size);
    if (++this.taken >= QUEUE_WINDOW) {
      if (this.low > this.slack) this.skip();
      this.low = QUEUE_SIZE;
      this.taken = 0;
    }
    if (this.size > 0) {
      const next = this.ring[this.head];
      this.head = (this.head + 1) % QUEUE_SIZE;
      this.size--;
      this.last.seq = next.seq;
      this.last.steer = next.steer;
      this.last.bits = next.bits;
    }
    return this.last;
  }

  /** Empty the queue for a race whose clients send `batch` inputs per packet. */
  clear(batch = INPUTS_PER_PACKET): void {
    this.max = QUEUE_MAX_PACKETS * batch;
    this.slack = batch;
    this.head = 0;
    this.size = 0;
    this.low = QUEUE_SIZE;
    this.taken = 0;
    this.last.seq = 0;
    this.last.steer = 0;
    this.last.bits = 0;
  }
}

interface Player {
  readonly conn: Conn;
  readonly info: PlayerInfo;
  readonly key: string;
  readonly joinedAt: number;
  readonly queue: InputQueue;
  slot: number;
  lastEmote: number;
  lastNudge: number;
  errorsLogged: number;
  /** Gaps between this connection's input messages arriving (sent at 30 Hz). */
  readonly inputGaps: GapStats;
  /** The client's latest connection report for the race it's in, until logged. */
  net: { seed: number; report: NetReport; final: boolean } | null;
}

/** One JSON line per event; Cloudflare Workers Logs indexes the fields. */
const log = (event: string, fields: Record<string, unknown>): void => {
  console.log(JSON.stringify({ event, ...fields }));
};

const validCharacter = (id: unknown): string =>
  CHARACTERS.some((c) => c.id === id) ? (id as string) : CHARACTERS[0].id;

const validKart = (id: unknown): string => (KARTS.some((k) => k.id === id) ? (id as string) : KARTS[0].id);

export class RaceRoom {
  private code = "";
  private readonly players = new Map<Conn, Player>();
  private track: ThemeId = "sf";
  private bots = 5;
  private world: World | null = null;
  private slots: RaceSlot[] = [];
  private slotPlayers: Array<Player | null> = [];
  private inputs: Input[] = [];
  /** Inputs per packet this race's clients send. */
  private batch = INPUTS_PER_PACKET;
  private loop: ReturnType<typeof setInterval> | null = null;
  /** Gaps between snapshots leaving the server: a stalled object, not the network. */
  private readonly snapshotGaps = new GapStats();
  private lastFrame = 0;
  private accumulator = 0;
  private snapshotBuffer = new ArrayBuffer(64 * 1024);
  private resultsTimer: ReturnType<typeof setTimeout> | null = null;
  private abandonTimer: ReturnType<typeof setTimeout> | null = null;
  private joinCounter = 0;

  /** `null` clears the socket's saved state, so a restore skips it. */
  constructor(private readonly persist: (conn: Conn, saved: Saved | null) => void) {}

  get racing(): boolean {
    return this.world !== null;
  }

  /**
   * Re-attach sockets that survived a hibernation. The race itself is gone, so
   * everyone lands in the lobby. Join order is saved too, so the host stays the host.
   */
  restore(conn: Conn, saved: Saved | null, code: string): void {
    if (!saved) return;
    this.code ||= code;
    this.joinCounter = Math.max(this.joinCounter, saved.joinedAt + 1);
    const player = this.newPlayer(conn, saved.info, saved.key, saved.joinedAt);
    this.players.set(conn, player);
    this.save(player);
  }

  private newPlayer(conn: Conn, info: PlayerInfo, key: string, joinedAt: number): Player {
    return { conn, info, key, joinedAt, queue: new InputQueue(), slot: -1, lastEmote: 0, lastNudge: 0, errorsLogged: 0, inputGaps: new GapStats(), net: null };
  }

  private save(player: Player): void {
    this.persist(player.conn, { info: player.info, key: player.key, joinedAt: player.joinedAt });
  }

  connect(conn: Conn, code: string): void {
    this.code ||= code;
    if (this.players.size >= MAX_RACERS) {
      conn.close(LOBBY_FULL, "Lobby full");
    }
  }

  disconnect(conn: Conn, code?: number, reason?: string): void {
    const player = this.players.get(conn);
    this.players.delete(conn);
    if (!player) return;
    this.logNet(player, "left");
    log("leave", {
      code: this.code, player: player.info.id, name: player.info.name, closeCode: code, reason,
      phase: this.world ? "racing" : this.resultsTimer ? "results" : "lobby", slot: player.slot,
      tick: this.world?.tick, remaining: this.players.size,
    });
    if (player.slot >= 0 && this.slotPlayers[player.slot] === player) this.slotPlayers[player.slot] = null;
    if (this.players.size > 0) {
      this.broadcastLobby();
    } else if (this.world && !this.abandonTimer) {
      // Everyone dropped: give them time to reconnect before throwing the race away.
      this.abandonTimer = setTimeout(() => {
        this.abandonTimer = null;
        if (this.players.size === 0 && this.world) {
          log("race_abandoned", { code: this.code, seed: this.world.seed });
          this.stopRace();
        }
      }, ABANDON_MS);
    }
  }

  message(conn: Conn, data: string | ArrayBuffer): void {
    if (typeof data !== "string") {
      const player = this.players.get(conn);
      if (!player) return;
      if (!this.world) {
        // They're still driving a race this object no longer has (it was reset). Tell them.
        const now = Date.now();
        if (now - player.lastNudge > 1000) {
          player.lastNudge = now;
          this.send(conn, this.lobbyMessage(player.key));
        }
        return;
      }
      if (player.slot < 0) return;
      player.inputGaps.arrive(Date.now());
      decodeInputs(new DataView(data), this.world.seed, (seq, steer, bits) => player.queue.push(seq, steer, bits));
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data) as ClientMessage;
    } catch {
      return;
    }
    switch (msg.t) {
      case "hello": {
        if (msg.v !== PROTOCOL_VERSION) {
          // A tab from before a deploy would misread this server's snapshots.
          this.send(conn, { t: "error", message: "Dario Kart was updated. Reload the page to keep playing." });
          conn.close(1000, "Outdated client");
          return;
        }
        const existing = this.players.get(conn);
        const info: PlayerInfo = existing?.info ?? {
          id: typeof msg.id === "string" ? msg.id.slice(0, 64) : crypto.randomUUID(),
          name: "",
          character: "",
          kart: "",
          primary: 0,
          secondary: 0,
        };
        info.name = cleanName(msg.name);
        info.character = validCharacter(msg.character);
        info.kart = validKart(msg.kart);
        info.primary = validColor(msg.primary, kartById(info.kart).color);
        info.secondary = validColor(msg.secondary, kartById(info.kart).accent);
        if (!existing) this.players.set(conn, this.newPlayer(conn, info, crypto.randomUUID().slice(0, 8), this.joinCounter++));
        const player = this.players.get(conn)!;
        this.save(player);
        if (this.abandonTimer) {
          clearTimeout(this.abandonTimer);
          this.abandonTimer = null;
        }
        const rejoined = !existing && this.world ? this.reattach(player) : -1;
        log(existing ? "hello" : "join", { code: this.code, player: info.id, name: info.name, racing: this.racing, rejoinedSlot: rejoined, players: this.players.size });
        this.broadcastLobby();
        if (this.world) {
          this.send(conn, { t: "race", seed: this.world.seed, track: this.world.track.theme, laps: this.world.laps, slots: this.slots, you: rejoined, batch: this.batch });
        }
        break;
      }
      case "pick": {
        const player = this.players.get(conn);
        if (!player) return;
        if (msg.name !== undefined) player.info.name = cleanName(msg.name);
        player.info.character = validCharacter(msg.character);
        player.info.kart = validKart(msg.kart);
        player.info.primary = validColor(msg.primary, player.info.primary);
        player.info.secondary = validColor(msg.secondary, player.info.secondary);
        this.save(player);
        this.broadcastLobby();
        break;
      }
      case "settings": {
        if (!this.isHost(conn) || this.world) return;
        this.track = THEMES.some((t) => t.id === msg.track) ? msg.track : this.track;
        this.bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(Number(msg.bots) || 0)));
        this.broadcastLobby();
        break;
      }
      case "start": {
        if (!this.isHost(conn) || this.world || this.resultsTimer) return;
        this.startRace();
        break;
      }
      case "kick": {
        const player = this.players.get(conn);
        const target = [...this.players.values()].find((p) => p.key === msg.key);
        // The host can remove anyone; anyone can close their own other tabs.
        if (!player || !target || target === player) return;
        const byHost = this.isHost(conn);
        if (!byHost && target.info.id !== player.info.id) return;
        const reason = byHost ? "The host removed you from the lobby." : "Closed from your other tab.";
        log("kick", { code: this.code, by: player.info.id, player: target.info.id, name: target.info.name, byHost });
        // The socket may be dead (a laptop that went to sleep), so don't wait for its close.
        this.persist(target.conn, null);
        this.disconnect(target.conn, KICKED, reason);
        try {
          target.conn.close(KICKED, reason);
        } catch {
          // already gone
        }
        break;
      }
      case "ping":
        this.send(conn, { t: "pong", at: msg.at });
        break;
      case "emote": {
        const player = this.players.get(conn);
        const now = Date.now();
        if (!player || player.slot < 0 || !this.world || now - player.lastEmote < 1500) return;
        player.lastEmote = now;
        this.broadcast({ t: "emote", slot: player.slot, n: Math.max(0, Math.min(3, Math.floor(Number(msg.n) || 0))) });
        break;
      }
      case "clientError": {
        const player = this.players.get(conn);
        if (!player || player.errorsLogged >= 20) return;
        player.errorsLogged++;
        log("client_error", {
          code: this.code, player: player.info.id, message: String(msg.message).slice(0, 500),
          stack: typeof msg.stack === "string" ? msg.stack.slice(0, 2000) : undefined,
          context: typeof msg.context === "string" ? msg.context.slice(0, 100) : undefined,
        });
        break;
      }
      case "netStats": {
        const player = this.players.get(conn);
        const report = cleanNetReport(msg.report);
        if (!player || !report || typeof msg.seed !== "number") return;
        player.net = { seed: msg.seed, report, final: msg.final === true };
        if (player.net.final) this.logNet(player, "finished");
        break;
      }
      case "leave":
        this.disconnect(conn);
        conn.close(1000, "Left the lobby");
        break;
    }
  }

  /**
   * A player who drops mid-race and comes back gets their kart back instead of
   * spectating. If their old socket is still half-open, the new one wins.
   */
  /** One `net_stats` line per connection per race. */
  private logNet(player: Player, why: string): void {
    const net = player.net;
    if (!net) return;
    player.net = null;
    log("net_stats", {
      code: this.code, seed: net.seed, player: player.info.id, name: player.info.name, why,
      ...net.report, up: player.inputGaps.summary(),
    });
    player.inputGaps.reset();
  }

  private reattach(player: Player): number {
    // Two tabs can share an id. Prefer a seat nobody holds so one tab's reconnect
    // doesn't take the other tab's kart.
    const mine = (i: number) => !this.slots[i].bot && this.slots[i].id === player.info.id && !this.world!.karts[i].finished;
    let slot = this.slots.findIndex((_, i) => mine(i) && !this.slotPlayers[i]);
    if (slot < 0) slot = this.slots.findIndex((_, i) => mine(i));
    if (slot < 0) return -1;
    const holder = this.slotPlayers[slot];
    if (holder && holder !== player) {
      holder.slot = -1;
      try {
        holder.conn.close(4000, "Replaced by a newer connection");
      } catch {
        // already gone
      }
    }
    player.slot = slot;
    player.queue.clear(this.batch);
    this.slotPlayers[slot] = player;
    return slot;
  }

  private isHost(conn: Conn): boolean {
    return this.host()?.conn === conn;
  }

  private host(): Player | undefined {
    let host: Player | undefined;
    for (const p of this.players.values()) if (!host || p.joinedAt < host.joinedAt) host = p;
    return host;
  }

  private lobbyPlayers(): LobbyPlayer[] {
    const host = this.host();
    return [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.info.id, key: p.key, name: p.info.name, character: p.info.character, kart: p.info.kart,
        primary: p.info.primary, secondary: p.info.secondary, host: p === host,
      }));
  }

  private lobbyMessage(you = ""): Extract<ServerMessage, { t: "lobby" }> {
    return { t: "lobby", v: PROTOCOL_VERSION, code: this.code, players: this.lobbyPlayers(), track: this.track, bots: this.bots, racing: this.racing, you };
  }

  /** Each socket is told which entry is its own: a player id can be in the lobby from several tabs. */
  private broadcastLobby(): void {
    const lobby = this.lobbyMessage();
    for (const p of this.players.values()) this.send(p.conn, { ...lobby, you: p.key });
  }

  /**
   * Called after the object is rebuilt from surviving sockets. Any race in
   * memory is gone, so tell everyone where things stand instead of leaving
   * them on a race screen that will never update.
   */
  announceRestart(): void {
    if (this.players.size === 0) return;
    log("restored", { code: this.code, players: this.players.size });
    this.broadcastLobby();
  }

  private startRace(): void {
    const humans = [...this.players.values()].filter((p) => p.info.name).sort((a, b) => a.joinedAt - b.joinedAt);
    const botCount = Math.min(this.bots, MAX_RACERS - humans.length);
    this.slots = [];
    this.slotPlayers = [];
    for (const p of this.players.values()) {
      this.logNet(p, "next_race");
      p.inputGaps.reset();
    }
    this.snapshotGaps.reset();
    this.batch = inputsPerPacket(humans.length);
    humans.forEach((p, i) => {
      p.slot = i;
      p.queue.clear(this.batch);
      this.slots.push({
        id: p.info.id, name: p.info.name, character: p.info.character, kart: p.info.kart,
        primary: p.info.primary, secondary: p.info.secondary, bot: false,
      });
      this.slotPlayers.push(p);
    });
    const taken = new Set(humans.map((p) => p.info.character));
    const pool = [...CHARACTERS].sort(() => Math.random() - 0.5).sort((a, b) => Number(taken.has(a.id)) - Number(taken.has(b.id)));
    for (let b = 0; b < botCount; b++) {
      const character = pool[b % pool.length];
      const round = Math.floor(b / pool.length);
      const kart = KARTS[Math.floor(Math.random() * KARTS.length)];
      const name = `${character.name} Bot${round > 0 ? ` ${round + 1}` : ""}`;
      this.slots.push({ id: `bot-${b}`, name, character: character.id, kart: kart.id, primary: kart.color, secondary: kart.accent, bot: true });
      this.slotPlayers.push(null);
    }
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.world = new World({
      theme: this.track,
      seed,
      racers: this.slots.map((s) => ({ kart: kartIndex(s.kart), character: characterIndex(s.character), bot: s.bot })),
    });
    this.inputs = this.slots.map(() => makeInput());
    const needed = snapshotSize(this.world) + 4096;
    if (this.snapshotBuffer.byteLength < needed) this.snapshotBuffer = new ArrayBuffer(needed * 2);

    for (const p of this.players.values()) {
      this.send(p.conn, { t: "race", seed, track: this.track, laps: this.world.laps, slots: this.slots, you: p.slot, batch: this.batch });
    }
    this.broadcastLobby();
    this.lastFrame = Date.now();
    this.accumulator = 0;
    this.loop = setInterval(() => this.frame(), 1000 / TICK_RATE);
    log("race_start", { code: this.code, seed, track: this.track, humans: humans.length, bots: botCount, batch: this.batch, length: Math.round(this.world.track.length) });
  }

  private stopRace(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.world = null;
    for (const p of this.players.values()) p.slot = -1;
  }

  private frame(): void {
    const world = this.world;
    if (!world) return;
    const now = Date.now();
    this.accumulator += now - this.lastFrame;
    this.lastFrame = now;
    const tickMs = 1000 / TICK_RATE;
    let steps = 0;
    while (this.accumulator >= tickMs && steps < 6) {
      this.accumulator -= tickMs;
      steps++;
      this.stepWorld(world);
      if (world.tick % SNAPSHOT_EVERY === 0) {
        this.snapshotGaps.arrive(now);
        this.sendSnapshot(world);
      }
      if (world.phase === Phase.Finished || world.tick > MAX_RACE_TICKS) {
        this.finishRace(world);
        return;
      }
    }
    if (steps === 6) this.accumulator = 0;
  }

  private stepWorld(world: World): void {
    for (let i = 0; i < world.karts.length; i++) {
      const kart = world.karts[i];
      const player = this.slotPlayers[i];
      if (player && !kart.finished) {
        const input = player.queue.take();
        const target = this.inputs[i];
        target.seq = input.seq;
        target.steer = input.steer;
        target.bits = input.bits;
      } else {
        botInput(world, kart, this.inputs[i]);
      }
    }
    world.step(this.inputs);
    if (world.events.length > 0) {
      for (const event of world.events) {
        const text = this.describe(event);
        if (text) this.broadcast({ t: "event", text });
        // Bots talk trash after landing a hit.
        if (event.type === "hit" && this.slots[event.by]?.bot && Math.random() < 0.35) {
          this.broadcast({ t: "emote", slot: event.by, n: Math.floor(Math.random() * 4) });
        }
      }
      world.events.length = 0;
    }
  }

  private describe(event: World["events"][number]): string | null {
    const name = (slot: number) => this.slots[slot]?.name ?? "Someone";
    switch (event.type) {
      case "hit":
        // Bots fighting each other is noise in the feed.
        if (event.by < 0 || event.by === event.victim || (this.slots[event.by]?.bot && this.slots[event.victim]?.bot)) return null;
        return `${name(event.by)} took down ${name(event.victim)} with an Outage Missile`;
      case "squash":
        if (this.slots[event.by]?.bot && this.slots[event.victim]?.bot) return null;
        return `${name(event.by)} squashed ${name(event.victim)} with Token Maxing`;
      case "finish":
        return `${name(event.slot)} finished ${ordinal(event.place)}`;
      case "item":
      case "use":
      case "gpu":
        return null;
    }
  }

  private sendSnapshot(world: World): void {
    const view = new DataView(this.snapshotBuffer);
    const length = encodeSnapshot(world, view);
    const bytes = new Uint8Array(this.snapshotBuffer, 0, length);
    for (const p of this.players.values()) {
      view.setUint32(SNAPSHOT_ACK_OFFSET, p.slot >= 0 ? p.queue.last.seq : 0);
      try {
        p.conn.send(bytes.slice().buffer);
      } catch {
        // Socket closed mid-race; webSocketClose cleans it up.
      }
    }
  }

  private finishRace(world: World): void {
    const results: RaceResult[] = world.order.map((kart) => {
      const slot = this.slots[kart.slot];
      return {
        slot: kart.slot,
        name: slot.name,
        kart: slot.kart,
        character: slot.character,
        bot: slot.bot,
        time: kart.finished ? Math.round((kart.finishTick / TICK_RATE) * 100) / 100 : null,
      };
    });
    this.sendSnapshot(world);
    log("race_finish", {
      code: this.code, seed: world.seed, seconds: Math.round(world.tick / TICK_RATE),
      finished: results.filter((r) => r.time !== null).length, racers: results.length,
      winner: results[0]?.name, players: this.players.size, serverSnapshotGaps: this.snapshotGaps.summary(),
    });
    this.stopRace();
    this.broadcast({ t: "results", results });
    this.resultsTimer = setTimeout(() => {
      this.resultsTimer = null;
      this.broadcastLobby();
    }, RESULTS_MS);
  }

  private send(conn: Conn, msg: ServerMessage): void {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      // ignore closed sockets
    }
  }

  private broadcast(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) {
      try {
        p.conn.send(text);
      } catch {
        // ignore closed sockets
      }
    }
  }
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

