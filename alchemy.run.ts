import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { localState } from "alchemy/State";
import * as Effect from "effect/Effect";
import Game from "./apps/server/src/worker.ts";

export default Alchemy.Stack(
  "DarioKart",
  {
    providers: Cloudflare.providers(),
    state: localState(),
  },
  Effect.gen(function* () {
    const game = yield* Game;
    const web = yield* Cloudflare.Website.Vite("Web", {
      rootDir: "./apps/web",
      domain: "dariokart.type.com",
      assets: { notFoundHandling: "single-page-application" },
      env: { VITE_GAME_URL: game.url.as<string>() },
    });
    return { game: game.url, web: web.url };
  }),
);
