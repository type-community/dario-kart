import { describe, expect, test } from "bun:test";
import { type ServerMessage, decodeSnapshot, encodeInputs, kartField } from "@dario-kart/sim";
import { type Conn, type PlayerInfo, RaceRoom } from "../src/room.ts";

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
    const persisted = new Map<Conn, PlayerInfo>();
    const room = new RaceRoom((conn, info) => persisted.set(conn, { ...info }));
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
});
