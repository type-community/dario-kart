# Formal specs

`RaceLobby.tla` models the lobby and race lifecycle across the server (`apps/server/src/room.ts`, one Durable Object per lobby) and each browser (`apps/web/src/main.ts`, `game.ts`): joins and leaves, host start, results timers, client screens, FIFO WebSocket channels in both directions, race-tagged inputs with sequence numbers, and Cloudflare resetting the object (in-memory state lost, sockets restored).

`FIX = FALSE` describes the code before the fixes; `FIX = TRUE` describes the code now.

## Run it

```sh
brew install openjdk
curl -sSLo specs/tla2tools.jar https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
cd specs
JAVA=/opt/homebrew/opt/openjdk/bin/java
$JAVA -cp tla2tools.jar tlc2.TLC -deadlock -workers auto -config RaceLobby.cfg RaceLobby.tla               # finds the bugs
$JAVA -cp tla2tools.jar tlc2.TLC -deadlock -workers auto -config RaceLobbyFixed.cfg RaceLobby.tla          # 1.4M states, no errors
$JAVA -cp tla2tools.jar tlc2.TLC -deadlock -workers auto -config RaceLobbyThreePlayers.cfg RaceLobby.tla   # 10.5M states, no errors
```

## What TLC found

1. **Stranded on a dead race** (`NoStrandedScreen`, 7 steps). A race is running, Cloudflare resets the object, the restored object knows nothing about the race and says nothing. Every player sits on a frozen race screen forever, and the host can't start another. Same for the results screen when the reset lands during results: the client's timer only left results if its last lobby message said "not racing", and the last one it got said "racing".
   - Fix: the restored object broadcasts the lobby (`announceRestart`), the server answers inputs for a race it doesn't have with a lobby update, the client leaves a race screen when told nothing is racing, and the results timer always returns to the lobby.
2. **Locked out by a late packet** (`InputsNotLockedOut`, no reset needed). An input packet from race N arrives after race N+1 has started. The server's queue keeps any sequence number higher than the last one, so it takes the stale packet's high number, then drops every new input until the new race's numbers catch up: after a long race, more than a minute of not being able to steer.
   - Fix: input packets carry their race id (the race seed) and the server drops packets from any other race.

Both are covered by regression tests in `apps/server/test/room.test.ts`.
