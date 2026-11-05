# Review guide

Start the summary with a count of findings ("2 important, 1 nit"). If there is nothing to fix, say "Nothing to fix." plainly.

## What failure looks like here

- **Desync.** Server and client disagree: `step` vs `predictOne`, snapshot fields encoded but not decoded (or vice versa), a protocol change without a `PROTOCOL_VERSION` bump.
- **Nondeterminism in the sim.** `Math.random`, `Date.now`, `performance.now`, iteration over unordered state, or float behavior that depends on frame rate inside `packages/sim`.
- **A stuck lobby.** Race room state machine bugs in `apps/server/src/room.ts`: players locked out, races that never end, kicks or rejoins that leave a ghost slot. Check against `specs/RaceLobby.tla`.
- **Frame-rate gameplay.** Logic in `apps/web` that should live in the sim, or that runs per render frame instead of per tick.
- **Docs that lie.** README controls and mechanics that no longer match the code.

## Rules

- Every finding needs a file and line as evidence, not a guess from a name.
- Tag each finding **Important**, **Nit** or **Pre-existing**. At most 3 nits per review.
- Flag the class of bug and list every instance, not just one line.
- On re-review, look only at the new diff and don't repeat findings already posted.
- Skip: `bun.lock`, `specs/*.cfg`, generated assets.
