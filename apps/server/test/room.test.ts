import { describe, expect, spyOn, test } from "bun:test";
import { KICKED, type ServerMessage, decodeSnapshot, encodeInputs, kartField } from "@dario-kart/sim";
import { type Conn, RaceRoom, type Saved } from "../src/room.ts";

/** Regression tests for the bugs TLC found in specs/RaceLobby.tla. */

const client = () => {
  const messages: ServerMessage[] = [];
  let snapshot: ReturnType<typeof decodeSnapshot> = null;
  const conn: Conn = {
    send: (data) => {
      if (typeof data === "string") messages.push(JSON.parse(data));
      else snapshot = decodeSnapshot(new DataView(data));
    },
    close: () => {},
  };
  return { conn, messages, get snapshot() { return snapshot; } };
};

const hello = (room: RaceRoom, conn: Conn, name: string) =>
  room.message(conn, JSON.stringify({ t: "hello", id: name, name, character: "lisa", kart: "astra", primary: 0, secondary: 0 }));

describe("race lifecycle", () => {
  test("a reset object tells stranded racers the race is gone", async () => {
    const persisted = new Map<Conn, Saved>();
    const room = new RaceRoom((conn, saved) => saved && persisted.set(conn, { ...saved, info: { ...saved.info } }));
    const a = client();
    room.connect(a.conn, "TLA1");
    hello(room, a.conn, "Ada");
    room.message(a.conn, JSON.stringify({ t: "start" }));
    expect(a.messages.some((m) => m.t === "race")).toBe(true);

    // Cloudflare resets the object: a fresh room is rebuilt from surviving sockets.
    const restored = new RaceRoom(() => {});
    restored.restore(a.conn, persisted.get(a.conn)!, "TLA1");
    const before = a.messages.length;
    restored.announceRestart();
    const lobby = a.messages.slice(before).find((m) => m.t === "lobby");
    expect(lobby && lobby.t === "lobby" && lobby.racing).toBe(false);

    // Inputs for the lost race also get a nudge back instead of silence.
    const buf = new DataView(new ArrayBuffer(64));
    const len = encodeInputs([{ seq: 900, steer: 0, bits: 1 }], buf, 1234);
    const mark = a.messages.length;
    restored.message(a.conn, buf.buffer.slice(0, len));
    expect(a.messages.slice(mark).some((m) => m.t === "lobby")).toBe(true);
  });

  test("inputs from an old race can't lock a player out of the next one", async () => {
    const room = new RaceRoom(() => {});
    const a = client();
    room.connect(a.conn, "TLA2");
    hello(room, a.conn, "Ada");
    room.message(a.conn, JSON.stringify({ t: "settings", track: "sf", bots: 0 }));
    room.message(a.conn, JSON.stringify({ t: "start" }));
    const race = a.messages.find((m) => m.t === "race");
    if (!race || race.t !== "race") throw new Error("no race");

    // A packet from some earlier race with a huge seq number arrives late.
    const buf = new DataView(new ArrayBuffer(64));
    let len = encodeInputs([{ seq: 5000, steer: 0, bits: 0 }], buf, (race.seed + 1) >>> 0);
    room.message(a.conn, buf.buffer.slice(0, len));
    // Then the real driver holds the throttle with fresh, low sequence numbers.
    let seq = 0;
    const timer = setInterval(() => {
      len = encodeInputs([{ seq: ++seq, steer: 0, bits: 1 }, { seq: ++seq, steer: 0, bits: 1 }], buf, race.seed);
      room.message(a.conn, buf.buffer.slice(0, len));
    }, 33);
    await Bun.sleep(4500);
    clearInterval(timer);
    const snap = a.snapshot!;
    expect(snap.header.ack).toBeGreaterThan(100);
    expect(snap.header.ack).toBeLessThan(5000);
    expect(kartField(snap.karts, 0, "speed")).toBeGreaterThan(10);
    room.disconnect(a.conn);
  });

  test("a player who drops mid-race gets their kart back on reconnect", () => {
    const room = new RaceRoom(() => {});
    const first = client();
    room.connect(first.conn, "TLA3");
    hello(room, first.conn, "Ada");
    room.message(first.conn, JSON.stringify({ t: "start" }));
    const race = first.messages.find((m) => m.t === "race");
    expect(race && race.t === "race" && race.you).toBe(0);

    room.disconnect(first.conn, 1006, "network");
    const second = client();
    room.connect(second.conn, "TLA3");
    hello(room, second.conn, "Ada");
    const again = second.messages.find((m) => m.t === "race");
    expect(again && again.t === "race" && again.you).toBe(0);
    room.disconnect(second.conn);
  });

  test("a newer connection takes the seat from a half-open old one", () => {
    const room = new RaceRoom(() => {});
    let oldClosed = 0;
    const old = client();
    old.conn.close = (code) => { oldClosed = code; };
    room.connect(old.conn, "TLA4");
    hello(room, old.conn, "Ada");
    room.message(old.conn, JSON.stringify({ t: "start" }));
    const fresh = client();
    room.connect(fresh.conn, "TLA4");
    hello(room, fresh.conn, "Ada");
    const race = fresh.messages.find((m) => m.t === "race");
    expect(race && race.t === "race" && race.you).toBe(0);
    expect(oldClosed).toBe(4000);
    room.disconnect(fresh.conn);
    room.disconnect(old.conn);
  });

  test("two tabs with one id don't steal each other's kart on reconnect", () => {
    const room = new RaceRoom(() => {});
    let firstClosed = 0;
    const first = client();
    first.conn.close = (code) => { firstClosed = code; };
    const second = client();
    room.connect(first.conn, "TLA5");
    room.connect(second.conn, "TLA5");
    hello(room, first.conn, "Ada");
    hello(room, second.conn, "Ada");
    room.message(first.conn, JSON.stringify({ t: "start" }));
    const seat = (c: ReturnType<typeof client>) => {
      const race = c.messages.findLast((m) => m.t === "race");
      return race && race.t === "race" ? race.you : -2;
    };
    expect([seat(first), seat(second)].sort()).toEqual([0, 1]);
    const secondSeat = seat(second);

    room.disconnect(second.conn, 1006, "network");
    const back = client();
    room.connect(back.conn, "TLA5");
    hello(room, back.conn, "Ada");
    expect(seat(back)).toBe(secondSeat);
    expect(firstClosed).toBe(0);
    room.disconnect(back.conn);
    room.disconnect(first.conn);
  });

  test("each racer's connection report is logged once, with server-side input gaps", () => {
    const lines: Array<Record<string, unknown>> = [];
    const spy = spyOn(console, "log").mockImplementation((line: string) => { lines.push(JSON.parse(line)); });
    try {
      const room = new RaceRoom(() => {});
      const a = client();
      room.connect(a.conn, "TLA6");
      hello(room, a.conn, "Ada");
      room.message(a.conn, JSON.stringify({ t: "start" }));
      const race = a.messages.find((m) => m.t === "race");
      const seed = race && race.t === "race" ? race.seed : 0;
      const buf = new DataView(new ArrayBuffer(64));
      for (let seq = 1; seq <= 3; seq++) {
        const len = encodeInputs([{ seq, steer: 0, bits: 1 }], buf, seed);
        room.message(a.conn, buf.buffer.slice(0, len));
      }
      const report = { down: { n: 900, p50: 50, p95: 60, p99: 210, max: 480, over150: 4, over300: 1 }, rttP50: 40, rttP95: 90, rttMax: 300,
        longFrames: 2, frames: 3300, reconnects: 0, hiddenMs: 0, connection: "4g" };
      room.message(a.conn, JSON.stringify({ t: "netStats", seed, final: false, report }));
      expect(lines.filter((l) => l.event === "net_stats")).toHaveLength(0);
      // Dropping mid-race still logs the last running report.
      room.disconnect(a.conn, 1006, "network");
      const logged = lines.filter((l) => l.event === "net_stats");
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ seed, why: "left", down: { p99: 210 }, up: { n: 2 } });
    } finally {
      spy.mockRestore();
    }
  });
});

const lastLobby = (c: ReturnType<typeof client>) => {
  const lobby = c.messages.findLast((m) => m.t === "lobby");
  if (!lobby || lobby.t !== "lobby") throw new Error("no lobby");
  return lobby;
};
const amHost = (c: ReturnType<typeof client>) => {
  const lobby = lastLobby(c);
  return lobby.players.find((p) => p.host)?.key === lobby.you;
};

describe("lobby", () => {
  test("only the first of two tabs with one id is shown as host", () => {
    const room = new RaceRoom(() => {});
    const first = client();
    const second = client();
    room.connect(first.conn, "KICK1");
    room.connect(second.conn, "KICK1");
    hello(room, first.conn, "Ada");
    hello(room, second.conn, "Ada");
    expect(amHost(first)).toBe(true);
    // Before, the second tab matched the host by id, showed Start, and the server ignored it.
    expect(amHost(second)).toBe(false);
  });

  test("the host can kick anyone; others can only close their own tabs", () => {
    const room = new RaceRoom(() => {});
    const closed = new Map<Conn, number>();
    const join = (name: string) => {
      const c = client();
      c.conn.close = (code) => { closed.set(c.conn, code); };
      room.connect(c.conn, "KICK2");
      hello(room, c.conn, name);
      return c;
    };
    const host = join("Ada");
    const bob = join("Bob");
    const bobTab = join("Bob");
    const cy = join("Cy");
    const key = (c: ReturnType<typeof client>) => lastLobby(c).you;
    const names = () => lastLobby(host).players.map((p) => p.name);

    // Bob can't kick Cy or the host.
    room.message(bob.conn, JSON.stringify({ t: "kick", key: key(cy) }));
    room.message(bob.conn, JSON.stringify({ t: "kick", key: key(host) }));
    expect(names()).toEqual(["Ada", "Bob", "Bob", "Cy"]);

    // Bob can close his own other tab.
    room.message(bob.conn, JSON.stringify({ t: "kick", key: key(bobTab) }));
    expect(closed.get(bobTab.conn)).toBe(KICKED);
    expect(names()).toEqual(["Ada", "Bob", "Cy"]);

    // The host can kick anyone, even a socket that never answers.
    room.message(host.conn, JSON.stringify({ t: "kick", key: key(cy) }));
    expect(closed.get(cy.conn)).toBe(KICKED);
    expect(names()).toEqual(["Ada", "Bob"]);
    // A kicked socket's messages are ignored.
    room.message(cy.conn, JSON.stringify({ t: "start" }));
    expect(room.racing).toBe(false);
  });

  test("the host is still the host after the object hibernates", () => {
    const persisted = new Map<Conn, Saved>();
    const room = new RaceRoom((conn, saved) => saved ? persisted.set(conn, saved) : persisted.delete(conn));
    const a = client();
    const b = client();
    room.connect(a.conn, "KICK3");
    room.connect(b.conn, "KICK3");
    hello(room, a.conn, "Ada");
    hello(room, b.conn, "Bob");
    const keyA = lastLobby(a).you;

    // Cloudflare hands back the sockets in any order.
    const restored = new RaceRoom(() => {});
    restored.restore(b.conn, persisted.get(b.conn)!, "KICK3");
    restored.restore(a.conn, persisted.get(a.conn)!, "KICK3");
    restored.announceRestart();
    expect(amHost(a)).toBe(true);
    expect(amHost(b)).toBe(false);
    expect(lastLobby(a).you).toBe(keyA);
  });
});
