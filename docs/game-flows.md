# Game flows

Sequence diagrams for the four flows that matter. Killing a player (flow 2),
completing a mission and its undo (flows 3 and 4), and kill-undo (flow 3) all
run server-side, inside a Cloud Function (`improvements.md` item 4,
docs/superpowers/specs/2026-08-29-mission-undo-design.md); everything else
shown still runs in the browser.

---

## 1. Hosting a room and starting a game

```mermaid
sequenceDiagram
    actor GM
    participant DB as DashBoard
    participant Lobby
    participant TG as TargetGenerator
    participant FS as Firestore

    GM->>DB: sign in
    DB->>FS: fetchActiveRoomForHost(uid)
    alt active room already exists, gameStarted
        DB->>DB: navigate(/rooms/{roomID}/GameMasterView)
    else active room exists, not yet started
        DB->>Lobby: navigate(/rooms/{roomID}/lobby)
    else no active room for this host
        loop until unique, max 300 tries
            DB->>DB: uniqueNamesGenerator() → "Fluffy42317"
            DB->>FS: checkForRoomIDDupes(roomID)
        end
        DB->>FS: setDoc(rooms/{roomID}, {hostId, isGameActive, gameStarted, joinedUids:[], taskIndex:1, storageReference:[], createdAt})
        DB->>Lobby: navigate(/rooms/{roomID}/lobby)
    end

    Note over Lobby: players arrive via the separate self-service joinRoom flow, live via onSnapshot — not shown in this loop
    loop roster management
        GM->>Lobby: remove player
        Lobby->>FS: removePlayerForRoom
    end

    GM->>TG: "Begin Game"
    TG->>TG: buildTargetGraph(players) — pure client-side graph build
    TG-->>GM: preview dialog of every player's targets
    GM->>TG: "Confirm and Begin Game"
    TG->>FS: markGameAsStarted(roomID) — gameStarted: true
    loop per player
        TG->>FS: updateTargetsForPlayer(player, targets)
        TG->>FS: updateAssassinsForPlayer(player, assassins)
    end
    TG->>Lobby: handleLobbyRoom()
    Lobby->>Lobby: navigate(/rooms/{roomID}/GameMasterView)
```

Two things to note:

- The guard is `arrayOfPlayers.length <= 1`, so a game can start with two
  players — `maxTargetsFor` (below) clamps each player's target count down
  for a small roster rather than refusing to start.
- `GameMasterView` no longer receives the roster via router state — it
  subscribes live via `onSnapshot` (`docs/improvements.md` item 13), so a
  reload no longer loses it.

### The target assignment algorithm

`buildTargetGraph` (`src/game/targetGraph.js`) builds the graph like this:

```
maxTargetsFor(playerCount) = clamp(playerCount > 15 ? 3 : playerCount > 5 ? 2 : 1, 0, playerCount - 1)

shuffle the roster (Fisher–Yates/Durstenfeld, on a copy)
lay the shuffled roster out in a ring
for each player P at ring position i:
    for step in 1..maxTargets:
        P hunts the player at ring position (i + step) % count
```

This is a true ring construction, not a search: every player gets exactly
`maxTargets` targets and `maxTargets` assassins, by construction, with no
self-targeting and (whenever `2 * maxTargets < playerCount`) no mutual
pairs. `TargetGenerator.js` and `ResetTargetsButton.js` both call this
same shared function — it replaced two ~120-line duplicate
implementations, plus a differently-shaped third copy in `RemapPlayers.js`
(`docs/improvements.md` item 11).

It replaced `TargetGenerator.InitializeTargets`, a randomized ring-walk
that could abandon a slot when its search wrapped all the way around,
leaving players with fewer than `MAXTARGETS` targets and a graph that
could fracture into disjoint sub-games — and `randomizeArray`, a subtly
incorrect Fisher–Yates that iterated forward while drawing `j` from
`[0, i]`, which does not produce a uniform permutation
(`docs/improvements.md` item 12).

`functions/callableFunctions/killPlayer.js` and `joinRoom.js` also depend
on this file, via a vendored copy — see "Keeping the Cloud Functions
self-contained" below.

---

## 2. Killing a player (`/kill target assassin`)

Resolved by `improvements.md` item 4. What used to be ~15 sequential,
unbatched Firestore round trips from the browser is now a single
`httpsCallable` request to a Cloud Function, `killPlayer`, which does
everything inside one Firestore transaction.

```mermaid
sequenceDiagram
    actor GM
    participant CI as ChatInput
    participant EK as executeKill (client)
    participant KP as killPlayer (Cloud Function)
    participant FS as Firestore

    GM->>CI: /kill alice bob
    CI->>CI: fetchAllPlayersForRoom → validate both names locally
    CI->>EK: executeKill(target, assassin, roomID)
    EK->>KP: httpsCallable('killPlayer', {target, assassin, roomId})

    KP->>FS: runTransaction: read room (host check), assassin, target, neighbors, alive roster
    alt target not in assassin's list AND neither has open season
        KP-->>EK: HttpsError('failed-precondition', ...)
        EK-->>CI: rejected promise
        CI-->>GM: error toast, stop
    end
    Note over KP: decide phase — transfer score,<br/>mark target dead, scrub target from<br/>every neighbour's targets/assassins,<br/>plan replacement targets/assassins (planRemap)
    KP->>FS: one transaction.update() per affected player doc
    KP-->>EK: {targetWasOpenSzn, preKillSnapshot, addedTargets, addedAssassins, remapLogs}

    EK-->>CI: same response
    CI->>CI: handleKillPlayer(...) → local state + log
    CI->>CI: handleRemapping(log) for each remapLogs entry
    CI->>CI: handleAddNewTargets / handleAddNewAssassins
```

**Scoring.** The assassin receives the victim's _entire_ score (floored at 0),
and the victim's score is zeroed. Since everyone starts at 10, points concentrate
as the game progresses. Unchanged by item 4 — only where it runs changed.

**Open season.** The three-way rule is: the target is on the assassin's list,
OR the target has open season on themself, OR the assassin has open season
(blanket rights). `killPlayer` reads both `assassinData.openSeason` and
`targetData.openSeason` directly inside the transaction — the confusing
assassin/victim mixup the old client code had (checking the assassin's flag
but logging as if it were the victim's) is gone along with the code that had
it, since `targetWasOpenSzn` returned to the client is always read from the
target's own document.

**Atomicity.** No longer independent writes — either the whole transaction
lands (score transfer, victim marked dead, every neighbour unmapped, every
orphaned player remapped) or none of it does. A network failure partway
through can no longer leave the target graph half-repaired.

### Remapping

Folded into the same transaction as the kill itself, not a separate
client-driven step. `killPlayer` calls the same pure `planRemap`
(`src/game/remapPlan.js`) the old `RemapPlayers.handleRegeneration` used,
but against an in-memory roster read once in the transaction's read phase
(with the about-to-die target filtered out and scrubbed from every
neighbour's arrays, since a transaction's writes haven't landed yet when the
roster is read) rather than one Firestore document fetched per candidate.

`RemapPlayers.js` itself still exists and is still used for `/revive` — see
flow 4 — where the same one-write-at-a-time caveat described in
`improvements.md` item 17 still applies.

### Keeping the Cloud Functions self-contained

`killPlayer.js` requires `../vendor/game/remapPlan` and
`../vendor/game/playerNames`; `joinRoom.js` requires
`../vendor/game/playerNames`. Neither requires `../vendor/game/targetGraph`
directly — `remapPlan.js` itself requires it, so it's vendored
transitively for `killPlayer.js`'s sake. All three are vendored rather
than reaching into `src/game/` directly. Firebase's functions deploy uploads
only the `functions/` directory in isolation, so a `require()` reaching
outside it resolves fine locally and under the emulator (both run from
the full repo checkout) but cannot resolve in the actual deployed bundle.
`functions/scripts/sync-shared-game-logic.js` copies the specific
`src/game/` modules these two functions depend on into the gitignored
`functions/vendor/game/` — run automatically before every deploy
(`firebase.json`'s `functions[0].predeploy`) and before
`npm run test:emulator`, which exercises the same require paths the real
deploy uses. `src/game/` stays the single source of truth;
`functions/vendor/` is a regenerated build artifact, never hand-edited or
committed.

---

## 3. Photo moderation

The mobile app writes a `pending` photo; the GM judges it from the console.
**Aspirational** — no such app exists yet (`improvements.md` item 33), so
this flow has no way to start today except manual/emulator seeding of a
`photos` document.

```mermaid
sequenceDiagram
    participant App as Mobile app (aspirational — does not exist)
    participant FS as Firestore
    participant PD as PhotosDisplay
    participant EK as executeKill (client)
    participant CM as completeMission (client)
    participant CMF as completeMission (Cloud Function)
    participant UK as undoKill (client)
    participant UKP as undoKillPlayer (Cloud Function)
    participant UMPA as undoMissionPhotoApproval (client)
    participant UMPACF as undoMissionPhotoApproval (Cloud Function)
    actor GM

    App->>FS: addDoc(photos, {url, assassin, target, timestamp, status:"pending"})
    FS-->>PD: onSnapshot (all photos, ordered by timestamp asc)
    PD->>PD: filter status === "pending" client-side
    PD-->>GM: render oldest pending photo, with a combined target/mission dropdown

    alt Approve as kill
        GM->>PD: ✓ (target selected)
        PD->>EK: executeKill(target, assassin, roomID)
        Note over EK: same Cloud Function call as /kill — see flow 2
        EK-->>PD: {preKillSnapshot, addedTargets, addedAssassins, remapLogs, ...}
        PD->>FS: approvePhotoForRoom(roomID, photoId, target, preKillSnapshot)
        PD->>FS: addLog("target was killed by assassin")
    else Approve as mission
        GM->>PD: ✓ (mission selected)
        PD->>CM: completeMission(missionIndex, assassin, roomID)
        CM->>CMF: httpsCallable('completeMission', {missionIndex, playerName, roomId})
        Note over CMF: one transaction — same planMissionCompletion decision, and the same completedBy/points-or-revival/auto-end writes, /mission done uses — see flow 4
        CMF-->>CM: {reversalSnapshot, addedTargets, addedAssassins, remapLogs, taskTitle, maxCompletions, revivesPlayer}
        CM-->>PD: same response
        PD->>FS: approvePhotoAsMissionForRoom(roomID, photoId, missionIndex, reversalSnapshot)
        PD->>FS: addLog("assassin completed mission: title") + broadcast
        opt revivesPlayer
            PD->>PD: handlePlayerRevive(displayName)
        end
        opt wasAutoEnded
            PD->>FS: addLog("Mission \"title\" auto-ended — reached its N-completion cap") + broadcast
        end
    else Deny
        GM->>PD: ✗
        PD->>FS: updatePhotoStatusForRoom("denied")
        PD->>FS: addLog("assassin's photo submission was denied")
    else Undo last judgment, previous action was Approve as kill
        GM->>PD: ←
        PD->>UK: undoKill(roomID, photoId)
        UK->>UKP: httpsCallable('undoKillPlayer', {roomId, photoId})
        Note over UKP: one transaction: for every player in the photo's<br/>originalPlayerData, restore score/targets/assassins/<br/>isAlive/openSeason verbatim, then set photo status<br/>back to "pending"
        UKP-->>UK: (void)
        UK-->>PD: resolved promise
        PD->>FS: addLog("Undo: target's death by assassin was reverted")
    else Undo — mission completion
        GM->>PD: ←
        PD->>UMPA: undoMissionPhotoApproval(roomID, photoId)
        UMPA->>UMPACF: httpsCallable('undoMissionPhotoApproval', {roomId, photoId})
        Note over UMPACF: one transaction: verifies the photo is an approved<br/>mission completion with a missionUndoSnapshot (rejects a<br/>pre-mission-undo photo that predates that field), restores<br/>every snapshotted player verbatim, removes the player from<br/>completedBy (un-sets isComplete if auto-ended), then resets<br/>the photo's status/mission/missionUndoSnapshot
        UMPACF-->>UMPA: (void)
        UMPA-->>PD: resolved promise
        PD->>FS: addLog("Undo: the last mission completion was reverted")
    else Undo last judgment, previous action was Deny
        GM->>PD: ←
        PD->>FS: updatePhotoStatusForRoom("pending")
        PD->>FS: addLog("Undo: denial of assassin's claim on target was reverted.")
    end
```

`PhotosDisplay` calls the exact same `executeKill` (and therefore the same
`killPlayer` Cloud Function) `/kill` does — resolved by `improvements.md`
item 5, then item 4 moved what `executeKill` does server-side. This closed
what used to be two real gaps between the photo-approval path and `/kill`:
approving a photo now validates the target the same way `/kill` does, and now
remaps orphaned players the same way `/kill` does, since both call the same
function. `preKillSnapshot` — a map keyed by normalized player name, each
value `{score, targets, assassins, isAlive, openSeason}`, one entry per
player `killPlayer`'s transaction touched (target, killer, and anyone the
remap reassigned) — is persisted onto the photo document itself
(`approvePhotoForRoom`) rather than kept only in React state, which is what
makes Undo survive a reload (`improvements.md` item 6).

Approving a photo as a mission instead of a kill calls the exact same
server-side `completeMission` Cloud Function (and, underneath it, the same
`planMissionCompletion` decision logic) that `/mission done` calls — see flow
4 — so a mission completion behaves identically no matter which of the two
paths triggered it, and each caller persists its own `reversalSnapshot` for
later undo (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md,
docs/superpowers/specs/2026-08-29-mission-undo-design.md). Undoing a
mission-approved photo is likewise a single atomic Cloud Function call —
`undoMissionPhotoApproval` — mirroring how `undoKillPlayer` already undoes
an approved kill; it is a photo-anchored undo stack, entirely independent
of `/mission undo`'s own stack (flow 4).

**Undoing an approval no longer replays individual client writes.** The
2026-08-16 full-kill-undo redesign
(`docs/superpowers/specs/2026-08-16-full-kill-undo-design.md`) replaced the
old five-write sequence (`updatePhotoStatusForRoom` + `handlePlayerRevive` +
`remapPlayerAsTarget`, run one at a time from the browser, which only ever
reverted the target's own side of the kill) with a single atomic
`undoKillPlayer` Cloud Function call: it resets the photo's status and
restores every snapshotted player inside one Firestore transaction. Denying
an undo (reverting a Deny back to pending) is unchanged — it was always just
`updatePhotoStatusForRoom("pending")`, with no player data to restore.

---

## 4. Reviving a player

Two routes reach the same outcome, with different side effects.

```mermaid
sequenceDiagram
    actor GM
    participant CI as ChatInput
    participant CM as completeMission (client)
    participant CMF as completeMission (Cloud Function)
    participant UMC as undoMissionCommand (client)
    participant UMCCF as undoMissionCommand (Cloud Function)
    participant FS as Firestore
    participant RP as RemapPlayers

    alt /revive <player>
        GM->>CI: /revive alice
        CI->>FS: fetchPlayersByStatusForRoom(false) → must contain player
        CI->>FS: updateIsAliveForPlayer(player, true)
        CI->>FS: fetchAlivePlayerNamesForRoom
        CI->>RP: handleRegeneration([player], [player], alive)
        RP-->>CI: [newTargets, newAssassins]
        CI-->>GM: RemapPlayerModal, handlePlayerRevive
    else /mission done <player> <index>, taskType = "Revival Mission"
        GM->>CI: /mission done alice 3
        CI->>CM: completeMission(index, player, roomID)
        CM->>CMF: httpsCallable('completeMission', {missionIndex, playerName, roomId})
        Note over CMF: one transaction — reads the task and whether the<br/>player is dead, decides via planMissionCompletion, revives<br/>the player, and runs the same planRemap regeneration<br/>RemapPlayers.js runs client-side for /revive, but inside<br/>this same transaction — see flow 3
        CMF-->>CM: {reversalSnapshot, addedTargets, addedAssassins, remapLogs, taskTitle, maxCompletions, revivesPlayer:true}
        CM-->>CI: same response
        CI->>FS: recordLastMissionCommandCompletion(roomID, reversalSnapshot)
        CI-->>GM: RemapPlayerModal, handlePlayerRevive
    else /mission undo
        GM->>CI: /mission undo
        CI->>UMC: undoMissionCommand(roomID)
        UMC->>UMCCF: httpsCallable('undoMissionCommand', {roomId})
        Note over UMCCF: one transaction: reads the room's<br/>lastMissionCommandCompletion (errors "Nothing to undo." if<br/>absent), restores every snapshotted player verbatim,<br/>removes the player from completedBy (un-sets isComplete if<br/>auto-ended), clears lastMissionCommandCompletion to null —<br/>a command-anchored undo stack, independent of the<br/>photo-approval one (flow 3)
        UMCCF-->>UMC: (void)
        UMC-->>CI: resolved promise
        CI->>FS: addLog/broadcast("Undo: the last mission completion was reverted")
    end
```

A revived player keeps the score of `0` set at death — revival restores life but
not points. The third route back to life, undoing a photo approval, _does_
restore the score, so the two paths are inconsistent.

`/revive` alerts the GM (`"<name>" is not dead`) when the named player is
not in the dead list — previously the `if` had no `else`, so a typo
produced no feedback at all; fixed by `docs/improvements.md` item 21.

---

## Where each flow updates the screen

Because [state lives in three places](./architecture.md#state-management), each
flow updates the UI differently:

| Surface                                        | Mechanism                                                                       | Stale after reload?    |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| Player list with scores and targets            | `onSnapshot`                                                                    | No — always live       |
| Photo queue                                    | `onSnapshot`                                                                    | No — always live       |
| Log panel                                      | `onSnapshot` (`docs/improvements.md` item 22)                                   | No — always live       |
| `Players (n)` header count                     | derived from the same live `onSnapshot` roster (item 13)                        | No — always live       |
| Alive/dead arrays driving `/revive` validation | refetched via `fetchPlayersByStatusForRoom` on every command                    | No — always current    |
| Photo undo history                             | persisted on the photo doc itself (`preKillSnapshot`), not React state (item 6) | No — survives a reload |
