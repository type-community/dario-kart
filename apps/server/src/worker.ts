import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import Race from "./race.ts";

const ROOM_CODE = /^[A-Z0-9]{4,8}$/;

export default Cloudflare.Worker(
  "Game",
  {
    main: import.meta.url,
    // Races in progress keep running the code they started with; new races pick up the deploy.
    codeUpdateStrategy: { mode: "deferred", maxDelay: "20 minutes" },
    // Every 30 Hz input message is an invocation, so invocation logs would bury the
    // JSON events (and the quota). Keep console logs and exceptions only.
    observability: { enabled: true, logs: { enabled: true, invocationLogs: false } },
  },
  Effect.gen(function* () {
    const races = yield* Race;

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://local");

        if (url.pathname === "/api/health") return HttpServerResponse.text("ok");

        const match = url.pathname.match(/^\/api\/race\/([^/]+)$/);
        if (match) {
          const code = match[1].toUpperCase();
          if (!ROOM_CODE.test(code)) return HttpServerResponse.text("Bad room code", { status: 400 });
          if (request.headers.upgrade !== "websocket") {
            return HttpServerResponse.text("Expected Upgrade: websocket", { status: 426 });
          }
          return yield* races.getByName(code).fetch(request);
        }

        return HttpServerResponse.text("Not found", { status: 404 });
      }),
    };
  }),
);
