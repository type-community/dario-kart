------------------------------ MODULE RaceLobby ------------------------------
(***************************************************************************)
(* The lobby/race lifecycle shared by apps/server/src/room.ts (one Durable  *)
(* Object per lobby) and apps/web/src/main.ts + game.ts (each browser).    *)
(*                                                                         *)
(* Server: phase, members (sockets that said hello), join order (host =    *)
(* first), the current race number, and the per-player input queue's last *)
(* accepted sequence number.                                               *)
(* Clients: socket open?, which screen they show, the "racing" flag from   *)
(* the last lobby message, whether the results timer has fired, and the    *)
(* race view they are driving (its race number and input sequence).       *)
(* Channels: FIFO server->client messages and client->server inputs, as   *)
(* WebSockets guarantee.                                                   *)
(*                                                                         *)
(* Evict models Cloudflare resetting the Durable Object (eviction, runtime *)
(* update, deploy past maxDelay): in-memory state is lost, sockets survive *)
(* and are restored from their attachments.                                *)
(*                                                                         *)
(* FIX = FALSE describes the code as first written; FIX = TRUE the fixes.  *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Clients, MaxRaces, MaxSeq, MaxEvictions, FIX

VARIABLES
  phase,        \* server: "lobby" | "racing" | "results"
  joinOrder,    \* server: Seq of members in join order; Head = host
  race,         \* server: number of the current/last race
  racers,       \* server: members holding a slot in the current race
  seats,        \* server: everyone who started the current race, connected or not
  lastSeq,      \* server: last input seq accepted per player
  evictions,    \* bound on how often the object resets
  conn,         \* client: socket open
  screen,       \* client: "landing" | "lobby" | "race" | "results"
  lobbyRacing,  \* client: racing flag from the last lobby message
  timerDone,    \* client: results screen timer fired
  viewRace,     \* client: race number of the race view, 0 = none
  viewSeq,      \* client: last input seq the race view sent
  toClient,     \* FIFO server -> client
  toServer      \* FIFO client -> server (inputs only)

vars == <<phase, joinOrder, race, racers, seats, lastSeq, evictions, conn, screen,
          lobbyRacing, timerDone, viewRace, viewSeq, toClient, toServer>>
serverVars == <<phase, joinOrder, race, racers, seats, lastSeq, evictions>>
clientVars == <<conn, screen, lobbyRacing, timerDone, viewRace, viewSeq>>

Members == {joinOrder[i] : i \in 1..Len(joinOrder)}
Host == IF joinOrder = <<>> THEN "none" ELSE Head(joinOrder)
Lobby(r) == [type |-> "lobby", racing |-> r]
RaceMsg(n, slot) == [type |-> "race", race |-> n, slot |-> slot]
Results == [type |-> "results"]
Broadcast(qs, m, to) == [c \in Clients |-> IF c \in to THEN Append(qs[c], m) ELSE qs[c]]

Init ==
  /\ phase = "lobby" /\ joinOrder = <<>> /\ race = 0 /\ racers = {} /\ seats = {}
  /\ lastSeq = [c \in Clients |-> 0] /\ evictions = 0
  /\ conn = [c \in Clients |-> FALSE]
  /\ screen = [c \in Clients |-> "landing"]
  /\ lobbyRacing = [c \in Clients |-> FALSE]
  /\ timerDone = [c \in Clients |-> FALSE]
  /\ viewRace = [c \in Clients |-> 0]
  /\ viewSeq = [c \in Clients |-> 0]
  /\ toClient = [c \in Clients |-> <<>>]
  /\ toServer = [c \in Clients |-> <<>>]

(* --------------------------- server actions ---------------------------- *)

\* Socket opens (a first visit or a reconnect) and the server handles "hello":
\* lobby to everyone, and a race message if a race is running. Someone who
\* started this race gets their seat back with a fresh input queue; anyone
\* else spectates.
Join(c) ==
  /\ ~conn[c]
  /\ conn' = [conn EXCEPT ![c] = TRUE]
  /\ joinOrder' = Append(joinOrder, c)
  /\ LET rejoin == phase = "racing" /\ c \in seats
         q == Broadcast(toClient, Lobby(phase = "racing"), Members \cup {c})
     IN /\ toClient' = IF phase = "racing" THEN [q EXCEPT ![c] = Append(@, RaceMsg(race, rejoin))] ELSE q
        /\ racers' = IF rejoin THEN racers \cup {c} ELSE racers
        /\ lastSeq' = IF rejoin THEN [lastSeq EXCEPT ![c] = 0] ELSE lastSeq
  /\ UNCHANGED <<phase, race, seats, evictions, screen, lobbyRacing, timerDone, viewRace, viewSeq, toServer>>

\* Host presses Start: new race, queues cleared, race + lobby(racing) to all.
Start(c) ==
  /\ phase = "lobby" /\ Host = c /\ race < MaxRaces
  /\ phase' = "racing" /\ race' = race + 1 /\ racers' = Members /\ seats' = Members
  /\ lastSeq' = [x \in Clients |-> IF x \in Members THEN 0 ELSE lastSeq[x]]
  /\ toClient' = [x \in Clients |->
        IF x \in Members THEN toClient[x] \o <<RaceMsg(race + 1, TRUE), Lobby(TRUE)>> ELSE toClient[x]]
  /\ UNCHANGED <<joinOrder, evictions, clientVars, toServer>>

Finish ==
  /\ phase = "racing"
  /\ phase' = "results" /\ racers' = {} /\ seats' = {}
  /\ toClient' = Broadcast(toClient, Results, Members)
  /\ UNCHANGED <<joinOrder, race, lastSeq, evictions, clientVars, toServer>>

\* The 9 s results timer on the server.
ResultsOver ==
  /\ phase = "results"
  /\ phase' = "lobby"
  /\ toClient' = Broadcast(toClient, Lobby(FALSE), Members)
  /\ UNCHANGED <<joinOrder, race, racers, seats, lastSeq, evictions, clientVars, toServer>>

\* An input packet arrives. Without the fix the queue keeps any seq higher
\* than the last one it took; with the fix packets carry their race number
\* and stale races are dropped.
ServerInput(c) ==
  /\ toServer[c] # <<>>
  /\ LET p == Head(toServer[c]) IN
       /\ toServer' = [toServer EXCEPT ![c] = Tail(@)]
       /\ IF phase = "racing" /\ c \in racers /\ p.seq > lastSeq[c] /\ (~FIX \/ p.race = race)
            THEN lastSeq' = [lastSeq EXCEPT ![c] = p.seq]
            ELSE UNCHANGED lastSeq
       \* Fix: someone still driving a race the server no longer has gets told so.
       /\ IF FIX /\ phase # "racing" /\ c \in Members
            THEN toClient' = [toClient EXCEPT ![c] = Append(@, Lobby(FALSE))]
            ELSE UNCHANGED toClient
  /\ UNCHANGED <<phase, joinOrder, race, racers, seats, evictions, clientVars>>

\* Durable Object reset: memory gone, sockets restored from attachments.
Evict ==
  /\ evictions < MaxEvictions
  /\ evictions' = evictions + 1
  /\ phase' = "lobby" /\ racers' = {} /\ seats' = {}
  /\ lastSeq' = [c \in Clients |-> 0]
  \* Fix: the restored object tells every restored socket where things stand.
  /\ toClient' = IF FIX THEN Broadcast(toClient, Lobby(FALSE), Members) ELSE toClient
  /\ UNCHANGED <<joinOrder, race, clientVars, toServer>>

(* --------------------------- client actions ---------------------------- *)

ClientRecv(c) ==
  /\ conn[c] /\ toClient[c] # <<>>
  /\ LET m == Head(toClient[c]) IN
       /\ toClient' = [toClient EXCEPT ![c] = Tail(@)]
       /\ CASE m.type = "lobby" ->
                 /\ lobbyRacing' = [lobbyRacing EXCEPT ![c] = m.racing]
                 /\ LET s == screen[c] IN
                      screen' = [screen EXCEPT ![c] =
                        IF s \in {"landing", "lobby"} THEN "lobby"
                        ELSE IF s = "results" /\ timerDone[c] /\ ~m.racing THEN "lobby"
                        ELSE IF FIX /\ s = "race" /\ ~m.racing THEN "lobby"
                        ELSE s]
                 /\ viewRace' = [viewRace EXCEPT ![c] =
                      IF FIX /\ screen[c] = "race" /\ ~m.racing THEN 0 ELSE @]
                 /\ UNCHANGED <<timerDone, viewSeq>>
            [] m.type = "race" ->
                 /\ screen' = [screen EXCEPT ![c] = "race"]
                 /\ timerDone' = [timerDone EXCEPT ![c] = FALSE]
                 /\ viewRace' = [viewRace EXCEPT ![c] = IF m.slot THEN m.race ELSE 0]
                 /\ viewSeq' = [viewSeq EXCEPT ![c] = 0]
                 /\ UNCHANGED lobbyRacing
            [] m.type = "results" ->
                 /\ screen' = [screen EXCEPT ![c] = "results"]
                 /\ timerDone' = [timerDone EXCEPT ![c] = FALSE]
                 /\ viewRace' = [viewRace EXCEPT ![c] = 0]
                 /\ UNCHANGED <<lobbyRacing, viewSeq>>
  /\ UNCHANGED <<serverVars, conn, toServer>>

\* The race view sends an input (it has a slot and is still racing).
ClientInput(c) ==
  /\ conn[c] /\ screen[c] = "race" /\ viewRace[c] > 0 /\ viewSeq[c] < MaxSeq
  /\ viewSeq' = [viewSeq EXCEPT ![c] = @ + 1]
  /\ toServer' = [toServer EXCEPT ![c] = Append(@, [race |-> viewRace[c], seq |-> viewSeq[c] + 1])]
  /\ UNCHANGED <<serverVars, conn, screen, lobbyRacing, timerDone, viewRace, toClient>>

\* The client's results timer (main.ts: after ~9 s on results).
ClientTimer(c) ==
  /\ conn[c] /\ screen[c] = "results" /\ ~timerDone[c]
  /\ timerDone' = [timerDone EXCEPT ![c] = TRUE]
  /\ screen' = [screen EXCEPT ![c] = IF FIX \/ ~lobbyRacing[c] THEN "lobby" ELSE @]
  /\ UNCHANGED <<serverVars, conn, lobbyRacing, viewRace, viewSeq, toClient, toServer>>

\* Tab closed or Leave pressed: socket closes, the server forgets the player.
Leave(c) ==
  /\ conn[c]
  /\ conn' = [conn EXCEPT ![c] = FALSE]
  /\ screen' = [screen EXCEPT ![c] = "landing"]
  /\ viewRace' = [viewRace EXCEPT ![c] = 0]
  /\ viewSeq' = [viewSeq EXCEPT ![c] = 0]
  /\ timerDone' = [timerDone EXCEPT ![c] = FALSE]
  /\ joinOrder' = SelectSeq(joinOrder, LAMBDA x : x # c)
  /\ racers' = racers \ {c}
  /\ LET left == {joinOrder[i] : i \in 1..Len(joinOrder)} \ {c}
         cleared == [toClient EXCEPT ![c] = <<>>]
     IN /\ phase' = phase
        /\ seats' = seats
        /\ toClient' = Broadcast(cleared, Lobby(phase = "racing"), left)
  /\ toServer' = [toServer EXCEPT ![c] = <<>>]
  /\ UNCHANGED <<race, lastSeq, evictions, lobbyRacing>>

\* Nobody came back within 30 s of the last player dropping: the race is thrown away.
Abandon ==
  /\ phase = "racing" /\ Members = {}
  /\ phase' = "lobby" /\ racers' = {} /\ seats' = {}
  /\ UNCHANGED <<joinOrder, race, lastSeq, evictions, clientVars, toClient, toServer>>

Next ==
  \/ \E c \in Clients : Join(c) \/ Start(c) \/ ServerInput(c) \/ ClientRecv(c) \/ ClientInput(c) \/ ClientTimer(c) \/ Leave(c)
  \/ Finish \/ ResultsOver \/ Evict \/ Abandon

Spec == Init /\ [][Next]_vars

\* Keep the model finite.
Bounded == \A c \in Clients : Len(toClient[c]) <= 6 /\ Len(toServer[c]) <= 3

(* ------------------------------ properties ----------------------------- *)

\* Once nothing is in flight to a client, its screen agrees with the server:
\* nobody sits on a race (or a finished results screen) the server has dropped.
NoStrandedScreen ==
  \A c \in Clients :
    (conn[c] /\ toClient[c] = <<>> /\ toServer[c] = <<>>) =>
      /\ (screen[c] = "race" => phase = "racing")
      /\ (screen[c] = "results" /\ timerDone[c] => phase = "results")

\* A racer driving the current race is never locked out: the server's last
\* accepted seq never runs ahead of what this race view has sent.
InputsNotLockedOut ==
  \A c \in Clients :
    (phase = "racing" /\ c \in racers /\ viewRace[c] = race /\ screen[c] = "race") =>
      lastSeq[c] <= viewSeq[c]

\* Exactly one host whenever anyone is in the lobby.
OneHost == (Members # {}) => (Host \in Members)
=============================================================================
