# Dario Kart

A browser kart racer for big lobbies. Ten AI lab CEOs, seven AI-model karts, five cities, and a track that grows with the number of racers.

## Run it locally

```sh
bun install
bun run dev        # alchemy dev: game Worker + Durable Objects in workerd, Vite client with HMR
```

`alchemy dev` prints two URLs: `game` (the Worker) and `web` (the client). Open `web`.

- **Start a lobby** creates a lobby code. Share the invite link and others land in the same Durable Object.
- **Practice against bots** runs the whole simulation in your browser, with no server.
- Handy URL flags: `?practice&track=nyc`, `?practice&autopilot` (bot drives you), `?race=CODE&name=You`.

Controls: `W A S D` or arrow keys to drive, `Space` to drift (sparks go blue, then pink; release for a boost), `E` to use your item, `Q` (or hold `S`) to fire backward, `Esc` to pause or leave. Gamepads work too.

## What makes it fun

- **Rocket start:** press `W` just before "Go" for a boost; hold it too early and the engine floods.
- **Drift tiers:** sparks go white, blue, pink, purple. Release for a mini, super or ULTRA boost.
- **Tricks:** tap `Space` in the air off any ramp, crest or bumper, then land it for a boost.
- **Slipstream:** tuck in behind a rival and a charge builds into a boost.
- **GPUs:** green chips on risky lines (loops, ramp arcs, banked walls). Each adds 1% top speed, up to 10; hits make you drop 3.
- **Gentle catch-up:** far behind the leader you get up to +5% top speed, on top of position-weighted items.
- **Feel:** synthesized engine, screech, stingers and synthwave music (faster on the final lap), speed lines, camera shake, field-of-view kicks, particles.
- **Moments:** final lap and lap-split banners, overtake pops, wrong-way warning, podium and confetti.
- **Trash talk:** `1`–`4` throw your driver's lines at the lobby. `M` mutes.

## Checks

```sh
bun test                                 # track generation, headless bot races on every theme, determinism, protocol
bun run typecheck
bun run report shenzhen 30               # headless race report: lap times, wall/stun time per kart
bun run smoke http://localhost:1337 20   # two headless clients play a real race against the dev server
bun scripts/predict-check.ts http://localhost:1337   # client prediction error vs server
bun scripts/balance.ts 240 8             # Monte-Carlo kart balance: win rate and average finish per kart
```

## Formal verification

`specs/RaceLobby.tla` models the lobby/race lifecycle, including Cloudflare resetting a Durable Object mid-race. TLC found two real bugs (a stranded race screen after a reset, and stale inputs locking a player out of the next race); both are fixed and the fixed model checks clean across 10.5M states. See [specs/README.md](specs/README.md).

## How it fits together

```
packages/sim      deterministic simulation shared by client, server and bots
  track.ts        procedural tracks (seed + theme + player count), in track space (s, d)
  world.ts        60 Hz fixed-step kart physics, items, collisions, the Reset
  bot.ts          track-following AI (bots, finished players, headless tests)
  protocol.ts     JSON lobby messages, binary inputs and snapshots
apps/server       Cloudflare Worker + one Durable Object per lobby (Alchemy, Effect)
  room.ts         lobby + authoritative race loop, no platform imports
  race.ts         Durable Object adapter (WebSockets, hibernation restore)
  worker.ts       routes /api/race/:code to the lobby's Durable Object
apps/web          three.js client (Vite)
  game.ts         prediction, reconciliation, interpolation, camera
  scene.ts        track, props and kart meshes
alchemy.run.ts    the whole stack: game Worker + Vite site
```

- The sim runs in track space: `s` is distance along the centerline and `d` is the lateral offset. Walls are `|d| > halfWidth`, so there are no nearest-point searches. A 100-kart tick costs about 0.14 ms.
- Every track sample carries a full 3D frame, so roads climb, crest, bank into corners and loop. The physics only needs yaw curvature, pitch curvature, slope and a loop flag; crests launch you when you're fast enough, loops hold you on.
- Kart stats are tuned with `scripts/balance.ts` (constants in `STAT` in `world.ts`): every kart's average finish is within about 0.05 of even across hundreds of bot races.
- The server is authoritative. Clients predict their own kart, replay unacknowledged inputs on each snapshot, and render other karts about 115 ms in the past.
- Races are 2 laps and about 50 seconds. Tracks get a little longer and wider with more racers (about 1.3 km for 8 players, 1.6 km for 30, 2.1 km for 100).
- Item odds depend on race position. The Nerf Bullet only goes to the back 15% of a 4+ kart race when they're more than 250 m behind the leader.
- Accounts are ephemeral: a random id and your picks live in `localStorage`.

## Deploying

Merging to `main` deploys: `.github/workflows/deploy.yml` runs after CI passes and ships the `prod` stage to [dariokart.type.com](https://dariokart.type.com). It needs two repo secrets, `CLOUDFLARE_API_TOKEN` (the "dario-kart GitHub Actions deploy" account token: Workers Scripts, Secrets Store and Account Settings on the account; Workers Routes, DNS and Zone on `type.com`) and `CLOUDFLARE_ACCOUNT_ID`. Pull requests also run `alchemy plan --stage prod`, so you can see what a merge would ship.

To deploy by hand:

```sh
bun alchemy profile edit --add Cloudflare   # one-time login
bun run deploy
```

Races in progress keep running the code they started with for up to 20 minutes after a deploy (`codeUpdateStrategy` in `apps/server/src/worker.ts`). Deploy state lives in the Cloudflare account (`Cloudflare.state()`), so CI and laptops see the same record of what's deployed.
