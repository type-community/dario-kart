import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import { type Conn, type PlayerInfo, RaceRoom } from "./room.ts";

interface Attachment {
  readonly code: string;
  readonly info: PlayerInfo | null;
}

/**
 * One Durable Object per race lobby, addressed by its room code. Every player
 * in the lobby connects to the same instance, which runs the authoritative
 * simulation in memory.
 */
export default class Race extends Cloudflare.DurableObject<Race>()(
  "Race",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      const conns = new WeakMap<Cloudflare.RawWebSocket, Conn>();
      const connFor = (ws: Cloudflare.RawWebSocket): Conn => {
        let conn = conns.get(ws);
        if (!conn) {
          conn = {
            send: (data) => ws.send(data),
            close: (code, reason) => ws.close(code, reason),
          };
          conns.set(ws, conn);
        }
        return conn;
      };
      const sockets = new WeakMap<Conn, Cloudflare.RawWebSocket>();
      const room = new RaceRoom((conn, info) => {
        const ws = sockets.get(conn);
        if (!ws) return;
        const prev = ws.deserializeAttachment() as Attachment | null;
        ws.serializeAttachment({ code: prev?.code ?? "", info } satisfies Attachment);
      });

      for (const socket of yield* state.getWebSockets()) {
        const conn = connFor(socket.ws);
        sockets.set(conn, socket.ws);
        const attachment = socket.ws.deserializeAttachment() as Attachment | null;
        room.restore(conn, attachment?.info ?? null, attachment?.code ?? "");
      }
      room.announceRestart();

      return {
        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest;
          const code = new URL(request.url, "http://local").searchParams.get("code") ?? "";
          const [response, socket] = yield* Cloudflare.upgrade();
          socket.ws.serializeAttachment({ code, info: null } satisfies Attachment);
          const conn = connFor(socket.ws);
          sockets.set(conn, socket.ws);
          room.connect(conn, code);
          return response;
        }),
        webSocketMessage: Effect.fn(function* (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) {
          room.message(connFor(socket.ws), message);
        }),
        webSocketClose: Effect.fn(function* (socket: Cloudflare.WebSocket, code: number, reason: string) {
          room.disconnect(connFor(socket.ws), code, reason);
          yield* socket.close(code, reason);
        }),
        webSocketError: Effect.fn(function* (socket: Cloudflare.WebSocket, error: unknown) {
          room.disconnect(connFor(socket.ws), 1006, `socket error: ${String(error).slice(0, 200)}`);
        }),
      };
    });
  }),
) {}
