import type { ThemeId } from "./content.ts";
import type { Input } from "./input.ts";
import type { NetReport } from "./stats.ts";
import { KART_NET_FIELDS, type Kart, type World } from "./world.ts";

/** Lobby/control traffic is JSON text; race traffic is binary. */

/**
 * Bumped whenever the wire format, kart physics or track generation changes:
 * the client predicts its kart and builds the track from the seed itself, so
 * it must run the same sim as the lobby. A tab from before a deploy (or a new
 * tab reaching a lobby still on old code) is told to reload instead.
 */
export const PROTOCOL_VERSION = 5;

/** Kart paint: primary body color and secondary accent/livery color. */
export interface Paint {
  readonly primary: number;
  readonly secondary: number;
}

export interface LobbyPlayer extends Paint {
  readonly id: string;
  /** This connection. Unlike `id`, it's unique even when one player has two tabs open. */
  readonly key: string;
  readonly name: string;
  readonly character: string;
  readonly kart: string;
  readonly host: boolean;
}

export interface RaceSlot extends Paint {
  readonly id: string;
  readonly name: string;
  readonly character: string;
  readonly kart: string;
  readonly bot: boolean;
}

export interface RaceResult {
  readonly slot: number;
  readonly name: string;
  readonly kart: string;
  readonly character: string;
  readonly bot: boolean;
  /** Seconds, or null if they didn't finish. */
  readonly time: number | null;
}

export type ClientMessage =
  | { readonly t: "hello"; readonly v: number; readonly id: string; readonly name: string; readonly character: string; readonly kart: string; readonly primary: number; readonly secondary: number }
  /** `name` is optional so a client can talk to a server from before renames. */
  | { readonly t: "pick"; readonly name?: string; readonly character: string; readonly kart: string; readonly primary: number; readonly secondary: number }
  | { readonly t: "settings"; readonly track: ThemeId; readonly bots: number }
  | { readonly t: "start" }
  /** Remove a lobby entry by `key`. The host can remove anyone, anyone can remove their own other tabs. */
  | { readonly t: "kick"; readonly key: string }
  | { readonly t: "ping"; readonly at: number }
  | { readonly t: "leave" }
  | { readonly t: "emote"; readonly n: number }
  | { readonly t: "clientError"; readonly message: string; readonly stack?: string; readonly context?: string }
  /** Connection quality so far this race; `final` once the race is over. */
  | { readonly t: "netStats"; readonly seed: number; readonly final: boolean; readonly report: NetReport };

export type ServerMessage =
  | { readonly t: "lobby"; readonly v: number; readonly code: string; readonly players: ReadonlyArray<LobbyPlayer>; readonly track: ThemeId; readonly bots: number; readonly racing: boolean; readonly you: string }
  | { readonly t: "race"; readonly seed: number; readonly track: ThemeId; readonly laps: number; readonly slots: ReadonlyArray<RaceSlot>; readonly you: number }
  | { readonly t: "results"; readonly results: ReadonlyArray<RaceResult> }
  | { readonly t: "event"; readonly text: string }
  | { readonly t: "emote"; readonly slot: number; readonly n: number }
  | { readonly t: "pong"; readonly at: number }
  | { readonly t: "error"; readonly message: string };

/** Close code for a player removed from the lobby; the client doesn't reconnect. */
export const KICKED = 4002;

/** What the server keeps of a player's name; the client cleans names the same way. */
export const cleanName = (name: unknown, fallback = "Racer"): string =>
  (typeof name === "string" ? name : "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16) || fallback;

export const validColor = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : fallback;

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

/** Inputs per packet: the client batches two 60 Hz ticks into each 30 Hz send. */
export const INPUTS_PER_PACKET = 2;

/**
 * Input packets carry the race they belong to (the race seed). A packet that
 * arrives after its race is over must never feed the next race's queue: its
 * high sequence number would lock the player out (found with TLA+, see
 * specs/RaceLobby.tla).
 */
export const encodeInputs = (inputs: ReadonlyArray<Input>, out: DataView, race: number): number => {
  out.setUint8(0, MSG_INPUT);
  out.setUint32(1, race >>> 0);
  out.setUint8(5, inputs.length);
  let o = 6;
  for (const input of inputs) {
    out.setUint32(o, input.seq);
    out.setInt8(o + 4, Math.round(Math.max(-1, Math.min(1, input.steer)) * 127));
    out.setUint8(o + 5, input.bits);
    o += 6;
  }
  return o;
};

/** Returns the packet's race id, or -1 if it isn't an input packet. */
export const decodeInputs = (view: DataView, race: number, onInput: (seq: number, steer: number, bits: number) => void): number => {
  if (view.byteLength < 6 || view.getUint8(0) !== MSG_INPUT) return -1;
  const packetRace = view.getUint32(1);
  if (packetRace !== race >>> 0) return packetRace;
  const n = view.getUint8(5);
  let o = 6;
  for (let i = 0; i < n && o + 6 <= view.byteLength; i++) {
    onInput(view.getUint32(o), view.getInt8(o + 4) / 127, view.getUint8(o + 5));
    o += 6;
  }
  return packetRace;
};

const FIELDS = KART_NET_FIELDS.length;

const HEADER_BYTES = 14;

export const snapshotSize = (world: World): number => {
  let missiles = 0;
  for (const m of world.missiles) if (m.active) missiles++;
  return HEADER_BYTES + world.karts.length * FIELDS * 4 + 2 + missiles * 12 + 2 + Math.ceil(world.boxReadyTick.length / 8)
    + 2 + Math.ceil(world.coinReadyTick.length / 8);
};

/** Byte offset of the per-recipient ack field, patched before each send. */
export const SNAPSHOT_ACK_OFFSET = 5;

export const encodeSnapshot = (world: World, out: DataView): number => {
  let o = 0;
  out.setUint8(o, MSG_SNAPSHOT); o += 1;
  out.setUint32(o, world.tick); o += 4;
  out.setUint32(o, 0); o += 4;
  out.setUint8(o, world.phase); o += 1;
  out.setUint16(o, world.phaseTicks); o += 2;
  out.setUint16(o, world.karts.length); o += 2;
  for (const kart of world.karts) {
    for (let f = 0; f < FIELDS; f++) {
      out.setFloat32(o, kart[KART_NET_FIELDS[f]] as number);
      o += 4;
    }
  }
  const countAt = o;
  let count = 0;
  o += 2;
  for (const m of world.missiles) {
    if (!m.active) continue;
    out.setFloat32(o, m.dist);
    out.setFloat32(o + 4, m.d);
    out.setFloat32(o + 8, m.heading);
    o += 12;
    count++;
  }
  out.setUint16(countAt, count);
  for (const ready of [world.boxReadyTick, world.coinReadyTick]) {
    out.setUint16(o, ready.length); o += 2;
    for (let b = 0; b < ready.length; b += 8) {
      let byte = 0;
      for (let i = 0; i < 8 && b + i < ready.length; i++) if (ready[b + i] <= world.tick) byte |= 1 << i;
      out.setUint8(o, byte);
      o += 1;
    }
  }
  return o;
};

export interface SnapshotHeader {
  tick: number;
  ack: number;
  phase: number;
  phaseTicks: number;
  kartCount: number;
}

export interface NetMissile {
  dist: number;
  d: number;
  heading: number;
}

export interface DecodedSnapshot {
  readonly header: SnapshotHeader;
  /** kartCount × KART_NET_FIELDS.length floats */
  readonly karts: Float32Array;
  readonly missiles: NetMissile[];
  readonly boxesReady: Uint8Array;
  readonly coinsReady: Uint8Array;
}

export const decodeSnapshot = (view: DataView): DecodedSnapshot | null => {
  if (view.getUint8(0) !== MSG_SNAPSHOT) return null;
  const header: SnapshotHeader = {
    tick: view.getUint32(1),
    ack: view.getUint32(5),
    phase: view.getUint8(9),
    phaseTicks: view.getUint16(10),
    kartCount: view.getUint16(12),
  };
  let o = HEADER_BYTES;
  const karts = new Float32Array(header.kartCount * FIELDS);
  for (let i = 0; i < karts.length; i++, o += 4) karts[i] = view.getFloat32(o);
  const missiles: NetMissile[] = [];
  const n = view.getUint16(o); o += 2;
  for (let i = 0; i < n; i++, o += 12) {
    missiles.push({ dist: view.getFloat32(o), d: view.getFloat32(o + 4), heading: view.getFloat32(o + 8) });
  }
  const readBits = () => {
    const count = view.getUint16(o); o += 2;
    const bits = new Uint8Array(count);
    for (let b = 0; b < count; b++) bits[b] = (view.getUint8(o + (b >> 3)) >> (b & 7)) & 1;
    o += Math.ceil(count / 8);
    return bits;
  };
  const boxesReady = readBits();
  const coinsReady = readBits();
  return { header, karts, missiles, boxesReady, coinsReady };
};

export const applyKartFields = (fields: Float32Array, index: number, kart: Kart): void => {
  const base = index * FIELDS;
  const target = kart as unknown as Record<string, number>;
  for (let f = 0; f < FIELDS; f++) target[KART_NET_FIELDS[f]] = fields[base + f];
};

export const kartField = (fields: Float32Array, index: number, field: (typeof KART_NET_FIELDS)[number]): number =>
  fields[index * FIELDS + KART_NET_FIELDS.indexOf(field)];
