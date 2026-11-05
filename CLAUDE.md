# Dario Kart

Browser kart racer. Bun workspaces, TypeScript, deployed to Cloudflare with alchemy (`alchemy.run.ts`).

- `packages/sim`: the deterministic simulation (world, karts, bots, track gen, binary protocol). Shared by server and client.
- `apps/server`: Worker + Durable Object race rooms (`room.ts`). Authoritative sim at 60 Hz.
- `apps/web`: Vite client: rendering, HUD, audio, input, client prediction.
- `specs/`: TLA+ model of the lobby/race protocol (`RaceLobby.tla`).

## Checks (run them and show the output before saying you're done)

```sh
bun run typecheck
bun test
bun run report shenzhen 30            # headless race sanity check after sim changes
```

## Conventions

- The sim must stay deterministic: no `Math.random`, `Date.now` or wall-clock reads in `packages/sim`. Use `rng.ts` / seeded hashes.
- Anything that changes the wire format in `protocol.ts` bumps `PROTOCOL_VERSION`.
- Server and client step the same `World`; changes to `step` need the matching change in `predictOne`.
- Derive timings from constants (`TICK_RATE`, `COUNTDOWN_TICKS`, ...), never hard-code seconds or tick counts in tests.
- Gameplay changes update the README "What makes it fun" section.
- Keep PRs small. Fill in Testing / Risk / How to revert in the PR template.

Review guidance lives in `REVIEW.md`.
