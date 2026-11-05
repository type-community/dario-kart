# Dario Kart

A browser kart racer for big lobbies. Ten AI lab CEOs, seven AI-model karts, five cities, and a track that grows with the number of racers.

## Run it locally

```sh
bun install
bun run dev        # alchemy dev: game Worker + Durable Objects in workerd, Vite client with HMR
```

`alchemy dev` prints two URLs: `game` (the Worker) and `web` (the client). Open `web`.

- **Start a lobby** creates a lobby code. Share the invite link and others go straight into the lobby (the same Durable Object). Anyone without a name joins as `Racer 123` and can rename themselves at the top of the lobby. Whoever joined first is the host: they pick the track and bots, start the race, and can kick anyone. Anyone can kick their own other tabs.
- **Practice against bots** runs the whole simulation in your browser, with no server.
- Handy URL flags: `?practice&track=nyc`, `?practice&autopilot` (bot drives you), `?race=CODE&name=You`.

Controls: `W A S D` or arrow keys to drive, `Space` to drift (sparks go blue, then pink; release for a boost), `Shift` or `F` to burn your Compute meter, `E` to fire a missile, `Q` (or hold `S`) to fire backward, `Esc` to pause or leave. Gamepads work too (`A` is nitro, `RT` is gas).

## What makes it fun

- **Rocket start:** press `W` just before "Go" for a boost. Holding it the whole countdown is just a normal start.
- **Compute meter (the nitro):** driving with style fills it: drifting, slipstreaming and close passes (overtaking within a few meters without touching). Landing a trick adds a bit too. Hold `Shift` to burn it as a boost; a full meter lasts 2.2 seconds.
- **Drift tiers:** sparks go white, blue, pink, purple. Release for a mini, super or ULTRA boost.
- **Drift chains:** start your next drift within 2 seconds of a drift boost and the chain grows, up to ×4. Each link makes the boost 12% longer and fills the meter faster. A hard wall hit, a missile or waiting too long breaks it. A drift too short to pay out doesn't count either way.
- **Tricks:** tap `Space` in the air off any ramp, crest or bumper, then land it for a boost.
- **Items:** item boxes give an Outage Missile (`E` fires ahead, `Q` behind). Boosts come from your meter, not from boxes.
- **Slipstream:** tuck in behind a rival and you get towed along (up to +5% top speed) while your meter fills.
- **GPUs:** green chips on risky lines (loops, ramp arcs, banked walls). Each adds 1% top speed, up to 10; hits make you drop 3.
- **Gentle catch-up:** far behind the leader you get up to +5% top speed, and slipstream naturally helps whoever is behind.
- **Forgiving handling:** let go of the steering and the kart settles back in line with the road. Drifts mostly follow the road by themselves: the nose swings in, and steering tightens or widens the line. Wall scrapes cost almost nothing.
- **Missiles:** a hit spins you out for about a second but you keep about half your speed. Missiles fly for 2.5 seconds and bounce off walls up to 3 times.
- **Feel:** synthesized engine, screech, stingers and synthwave music (faster on the final lap), speed lines, a camera that pulls back and hums at top speed, wind streaks while drafting or on nitro, field-of-view kicks, particles.
- **Moments:** final lap and lap-split banners, overtake pops, wrong-way warning, podium and confetti.
- **Trash talk:** `1`–`4` throw your driver's lines at the lobby. `M` mutes.

## Checks

```sh
bun test                                 # track generation, headless bot races on every theme, determinism, protocol
bun run typecheck
bun run report shenzhen 30               # headless race report: lap times, wall/stun time per kart
bun run smoke http://localhost:1337 20   # two headless clients play a real race against the dev server
bun scripts/predict-check.ts http://localhost:1337   # client prediction error vs server
bun scripts/keyboard-driver.ts hold      # a headless keyboard player: race time, wall time, drift chains
bun scripts/balance.ts 240 8             # Monte-Carlo kart balance: win rate and average finish per kart
```

## Logs

The race server writes one JSON line per event to Cloudflare Workers Logs: `join` (with `rejoinedSlot` when a dropped player gets their kart back), `leave` (with the WebSocket `closeCode` and `reason`), `race_start`, `race_finish`, `race_abandoned`, `restored` (the Durable Object woke from hibernation or was reset), and `client_error` (browser errors reported by the client). Per-message invocation logs are off, since every 30 Hz input is an invocation.

`net_stats` is one line per player per race (logged when the race ends, or when they drop): `down` is the gaps between snapshots reaching the browser (the server sends one every 50 ms), `up` is the gaps between that player's inputs reaching the server (sent every 33 ms), plus round-trip time, long frames, reconnects and time spent in a background tab. `race_finish` carries `serverSnapshotGaps`, the server's own sending rhythm, so a stall there is the Durable Object, not the network. Each gap summary has `p50`/`p95`/`p99`/`max` in ms and counts `over150` (a visible hitch) and `over300` (a freeze, then a jump).

```sh
bun scripts/logs.ts 60                            # last hour of events, with their fields
bun scripts/logs.ts 180 leave                     # only one event type
bun scripts/logs.ts 1440 net_stats                # a day of connection quality
bun alchemy logs --stage prod --tail              # stream live (names only)
```

Or open the Game Worker in the Cloudflare dashboard, under Observability, and filter on `event`.

Close codes worth knowing: `1000` the player left, `1001` the browser went away (tab closed, reloaded, or the browser dropped it), `1006` the network died, `4000` replaced by a newer connection from the same player (the old one stops retrying; player ids are per tab, so this means a half-open socket was replaced), `4001` the client gave up after no pong for 7 s. Clients reconnect automatically (5 tries over about 15 s) and get their seat back mid-race; a race with nobody connected keeps running for 30 s before it's abandoned.

## Formal verification

`specs/RaceLobby.tla` models the lobby/race lifecycle, including Cloudflare resetting a Durable Object mid-race. TLC found two real bugs (a stranded race screen after a reset, and stale inputs locking a player out of the next race); both are fixed and the fixed model checks clean across 10.5M states. See [specs/README.md](specs/README.md).

## How it fits together

```
packages/sim      deterministic simulation shared by client, server and bots
  track.ts        procedural tracks (seed + theme + player count), in track space (s, d)
  world.ts        60 Hz fixed-step kart physics, items, collisions
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
- Each city drives and looks different. The sim side is `mix` in `THEMES` (`content.ts`): SF is all jumps over big hills, NYC is flat with hard 90s, slow zones and boost lanes, The Fab is boost pads and pinball bumpers, Shenzhen is neon switchbacks with two loops, and Beijing is a wide, smooth ring road with almost no gimmicks, so it's about slipstreaming. The look (time of day, how buildings crowd the road, landmarks like the SF bridge, Broadway billboards, the Fab's ceiling and wafers, Shenzhen's supertall, Beijing's gates and pagodas) is in `apps/web/src/landmarks.ts`.
- Item boxes only hold Outage Missiles. Speed comes from the Compute meter, which you earn by driving well, so boosts reward skill rather than luck.
- Accounts are ephemeral: a random id and your picks live in `localStorage`.

## Deploying

Merging to `main` deploys: `.github/workflows/deploy.yml` runs after CI passes and ships the `prod` stage to [dariokart.type.com](https://dariokart.type.com). It needs two repo secrets, `CLOUDFLARE_API_TOKEN` (the "dario-kart GitHub Actions deploy" account token: Workers Scripts, Secrets Store and Account Settings on the account; Workers Routes, DNS and Zone on `type.com`) and `CLOUDFLARE_ACCOUNT_ID`. Pull requests also run `alchemy plan --stage prod`, so you can see what a merge would ship.

To deploy by hand:

```sh
bun alchemy profile edit --add Cloudflare   # one-time login
bun run deploy
```

Races in progress keep running the code they started with for up to 20 minutes after a deploy (`codeUpdateStrategy` in `apps/server/src/worker.ts`). Deploy state lives in the Cloudflare account (`Cloudflare.state()`), so CI and laptops see the same record of what's deployed.
