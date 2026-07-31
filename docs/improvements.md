# Improvement backlog

Findings from a full read of the codebase (July 2026), ordered by severity
within each tier.

Effort estimates are rough: **S** = under an hour, **M** = half a day,
**L** = multi-day.

## Resolved

Closed by the testing-foundation work described in [testing.md](./testing.md):

| Item                           | How                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 — algorithm in three copies | Extracted to `src/game/targetGraph.js`; `TargetGenerator` and `ResetTargetsButton` now share it, `RemapPlayers` uses `src/game/remapPlan.js` |
| 12 — broken shuffle            | Replaced with Durstenfeld Fisher–Yates, covered by a distribution test                                                                       |
| 17 — round trips in loops      | `RemapPlayers` fetches the roster once via `fetchAliveRosterForRoom` and plans in memory                                                     |
| 18 — zero tests                | 62 tests across four pure modules; harness rebuilt, CI runs it                                                                               |
| 19 — empty command throws      | Guarded in `parseCommand`, with a regression test                                                                                            |

Partially addressed:

| Item                            | Remaining                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25 — no environment separation  | Emulator targeting is now an explicit `REACT_APP_USE_EMULATORS` flag rather than `NODE_ENV`, and Jest can no longer reach a live project. `.firebaserc` still maps `dev` and `prod` to the same project — unchanged.   |
| 9 — denormalized counters drift | `planRemap` derives counts from the arrays it returns, so remaps no longer read stale values. `targetsLength`/`assassinsLength` are still written only by the two `update…For…` helpers and can still drift elsewhere. |

---

## Tier 1 — Correctness and security

### 1. Player names must be all-lowercase or commands silently fail

**Impact: high · Effort: S**

`ChatInput` lowercases command arguments, but every lookup in `dbCalls` queries
the raw `name` field:

```js
// ChatInput.js — validation uses a lowercased roster
const arrayOfPlayerNames = (await fetchAllPlayersForRoom(roomID)).map((n) => n.toLowerCase());
const targetName = args[0].toLowerCase();

// dbCalls.js — but the lookup queries the stored, case-preserved name
query(playerCollectionRef, where('name', '==', playerName));
```

A player added as `Alice`:

- `/kill alice bob` → passes validation, then `fetchTargetsForPlayer('bob')`
  returns `[]`, and the GM sees _"alice is not a valid taret for bob"_.
- `/add Alice 5` → fails validation outright (`Alice` is not in the lowercased
  roster).
- `/add alice 5` → passes validation, then `playerSnapshot.docs[0]` is
  `undefined`, throws, is swallowed by the `try/catch`, and **nothing appears on
  screen at all**.

The fix is already half-built: `addPlayerForRoom` writes a
`trimmedNameLowerCase` field that is currently only used for duplicate
detection. Switching every lookup to query that field — or dropping the
lowercasing in `ChatInput` — resolves the whole class. The first is preferable;
it also makes GM input case-insensitive, which is what the lowercasing was
clearly reaching for.

Affects `/kill`, `/revive`, `/openseason`, `/mission done`, and `/add`.

### 1b. `addPlayerForRoom` does not await its write

**Impact: medium · Effort: S**

```js
addDoc(playerCollectionRef, { ... })   // not awaited, not returned
    .then((docRef) => console.log(...))
    .catch((error) => console.error(...));
```

The function resolves before the document is written, and any failure is
swallowed into `console.error` where no caller can see it.

Found while writing the emulator tests: with the write still in flight when the
test ended, the next test's emulator reset contended with it and stalled for the
full 20-second timeout. `test/emulatorHelpers.js` has a `waitUntil` poll to work
around it, with a pointer back here.

Await the `addDoc` and let it throw, in line with item 10.

### 2. No Firestore security rules exist in the repository

**Impact: high · Effort: M**

There is no `firestore.rules` file, and `firebase.json` does not declare one.
Whatever rules are live in the Firebase project are unversioned and unreviewable.
`storage.rules` is `allow read, write: if true` on every path.

Because the Firebase web config is necessarily public (it ships in the JS
bundle) and all game logic is client-side, anyone who loads the app can read and
write every room's data — set their own score, kill anyone, read other games.

Minimum viable rules: require `request.auth != null`; scope room writes to
`resource.data.hostId == request.auth.uid`; make `photos` writable only by the
mobile app's identity. `hostId` is already stored for exactly this purpose and
is currently never read.

### 3. No route guards

**Impact: medium · Effort: S**

Every route in `App.js` is public. `/dashboard` and `/rooms/:roomID/*` render for
signed-out visitors; `DashBoard` only checks `auth.currentUser` when deciding
whether to create a room, and logs to the console when it is absent.

A `<RequireAuth>` wrapper using `onAuthStateChanged` around the four
authenticated routes. Note this is defense-in-depth only — it is not a
substitute for item 2.

### 4. Kills are non-atomic across ~15 writes

**Impact: high · Effort: L**

A single `/kill` performs roughly fifteen sequential, independent Firestore
operations: score transfer, unmapping the victim from each neighbour, the
victim's own reset, then per-player remap writes. There is no `writeBatch` and no
transaction.

A network failure or a closed tab partway through leaves the game in a state no
code can detect or repair: points transferred but the victim still alive, or the
victim dead with `targets`/`assassins` arrays that disagree with their
neighbours'.

Proper fix is to move the kill into a Cloud Function running inside a
`runTransaction`. That also addresses item 2's root cause — the client would no
longer need write access to scores at all. Interim mitigation: group the writes
into a `writeBatch` so at least the graph updates land together.

### 5. Photo approval skips validation and remapping

**Impact: high · Effort: M**

`PhotosDisplay.handlePass` kills the target but, unlike `/kill`:

- does **not** check that the target is on the assassin's target list, so an
  approved photo can kill someone the assassin was never hunting;
- does **not** call `RemapPlayers`, so every player who was hunting the victim is
  left with a dead target and no replacement.

The same in-game event produces a different graph depending on which UI the GM
used. Extracting the `/kill` body into a shared `executeKill(target, assassin,
roomID)` used by both paths is the right shape.

### 6. Photo undo history is memory-only

**Impact: medium · Effort: M**

`judgedPhotos` — including the `originalPlayerData` snapshot required to restore
a victim's score, targets, and assassins — lives only in React state. Reloading
the console loses every prior judgment permanently, while the photo documents
remain `approved`/`denied` in Firestore. The undo button then appears functional
but does nothing.

Persist the pre-kill snapshot onto the photo document (or a `judgments`
subcollection) at approval time.

### 7. Read-modify-write races on counters

**Impact: medium · Effort: S**

Three counters are read and rewritten instead of updated atomically:

| Function                      | Should use                                                                |
| ----------------------------- | ------------------------------------------------------------------------- |
| `updatePointsForPlayer`       | `increment(points)`                                                       |
| `fetchTaskIndexThenIncrement` | `increment(1)` in a transaction                                           |
| `updateLogsForRoom`           | already uses `arrayUnion`, but reads the array first for its return value |

Concurrent GMs — or a GM plus the mobile app — can silently drop an update.
`fetchTaskIndexThenIncrement` in particular can hand the same `taskIndex` to two
missions, which then makes `/mission done <index>` ambiguous.

### 8. `open season` flag is read from the wrong player

**Impact: medium · Effort: S**

In `/kill`, `checkOpenSzn(roomID, assassinName)` reads the **assassin's** flag —
correct for "this assassin may kill anyone". But the resulting boolean is passed
to `handleKillPlayer`, which logs _"open season has ended for {victim}"_, and
`killPlayerForRoom` clears `openSeason` on the **victim** unconditionally. The
log can therefore announce the end of an open season the victim never had, while
a genuinely open-season victim's end goes unlogged when the assassin was not
themselves flagged.

Decide which semantics are intended and make the read, the log, and the write
agree.

### 9. Denormalized length counters drift

**Impact: medium · Effort: S**

`targetsLength` and `assassinsLength` exist so Firestore can `orderBy` array
size. They are maintained by `updateTargetsForPlayer` and
`updateAssassinsForPlayer` — but `UnmapPlayers` and `remapPlayerAsTarget` write
`targets`/`assassins` directly and leave the counters untouched.

`RemapPlayers`' fallback path orders candidates by exactly these counters, so
after any unmap it is choosing based on stale data.

Route all array writes through the two `update…For…` helpers.

### 10. Errors are swallowed throughout the data layer

**Impact: medium · Effort: M**

Every function in `dbCalls.js` wraps its body in `try/catch`, calls
`console.error`, and returns `undefined`. Callers never check, so failures
resurface as `TypeError: Cannot read properties of undefined` on `.docs[0]` or
`.data()` — usually somewhere unrelated to the actual fault, and always without
UI feedback.

`CreateAlert` already exists as the toast mechanism. Either let `dbCalls` throw
and handle it at the call site, or return a discriminated result. Silently
returning `undefined` is the worst of the three options.

---

## Tier 2 — Structure and duplication

### 11. The target-generation algorithm exists in three copies

**Impact: medium · Effort: M**

`TargetGenerator.js` and `ResetTargetsButton.js` contain **near-identical**
~120-line implementations of `randomizeArray`, `InitializeTargets`, and
`UpdateDatabase` — the two files differ only in button styling, the confirmation
copy, and whether logs are written afterwards. `RemapPlayers.js` holds a third,
differently-shaped variant of the same matching logic.

Any change to how targets are assigned has to be made in three places, and one
of the three already diverges: `TargetGenerator`'s `randomizeArray` loops to
`length - 1` while `ResetTargetsButton`'s loops to `length`.

Extract to `src/utils/targetGraph.js` as pure functions (`buildTargetGraph`,
`remapPlayers`), which also makes them the first thing in this codebase that is
straightforward to unit test.

### 12. `randomizeArray` stops one index short in two of three copies

**Impact: medium · Effort: S**

`RemapPlayers`' copy is a **correct** uniform shuffle:

```js
for (let i = 0; i < array.length; i++) {
    // RemapPlayers.js:16 — correct
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
}
```

`TargetGenerator.js:34` and `ResetTargetsButton.js:36` are identical **except**
that they loop to `array.length - 1`. Dropping the final iteration means the last
element is never swapped out of the last position. Measured over 600,000 runs on
a 3-element array:

```
i < array.length - 1  →  {"BAC": 299932, "ABC": 300068}          2 of 6 permutations
i < array.length      →  all 6, ~100k each
```

So it is not a mild bias — the broken variant is the one used for **initial
target assignment**, and it reaches only a fraction of the possible orderings.
Adopt the `RemapPlayers` form during the extraction in item 11.

> An earlier revision of this document described this backwards, calling the
> correct variant biased. See [testing.md](./testing.md#part-6--a-finding-that-motivates-phase-1)
> for the measurement.

### 13. Game state is tracked in three disagreeing places

**Impact: medium · Effort: L**

As documented in [architecture.md](./architecture.md#state-management):
`PlayersList` and `PhotosDisplay` use live `onSnapshot`; `GameMasterView` keeps
alive/dead/task/log arrays fetched once and mutated optimistically; the header's
roster count comes from router state.

Observable consequences: the header reads `Players (0)` after a reload; the log
panel shows only the current session; a second GM's actions are invisible;
`/revive`'s "is this player dead" check consults a stale local array.

Moving `GameMasterView`'s arrays onto the existing `onSnapshot` subscription
would collapse the three sources into one. The optimistic handlers become
unnecessary at that point.

### 14. Dead code

**Impact: low · Effort: S**

| Path                                                   | Status                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/old-components/` (8 files, ~600 lines) | Imported by nothing. Its own imports are already broken — it references `./dbCalls`, `./Contexts`, `./TaskButton`, and `./assets/…`, none of which exist at those paths. It survives only because CRA never bundles unreachable modules. |
| `src/components/cloudFunction.js`                      | Debug button for the `targetFunction` stub. Not mounted.                                                                                                                                                                                 |
| `src/components/firebase_calls/storageCalls.js`        | Sole export has no callers, and calls `ref(storage, roomID, photoName)` — a signature error; `ref()` takes `(storage, path)`.                                                                                                            |
| `deadPlayerListContext` in `Contexts.js`               | Never provided; only `old-components/` consumes it.                                                                                                                                                                                      |
| `rooms/{id}.storageReference`                          | Written as `[]` at creation, never read.                                                                                                                                                                                                 |
| `rooms/{id}.hostId`, `.isGameActive`                   | Written, never read. Both should become _used_ rather than deleted — see items 2 and 15.                                                                                                                                                 |
| Seven unused exports in `dbCalls.js`                   | Listed in [data-model.md](./data-model.md#unused-data-layer-surface).                                                                                                                                                                    |

`old-components/` is the significant one: it is large enough to mislead a reader
into thinking those flows are live.

### 15. The mission feature is half-disconnected

**Impact: medium · Effort: S**

`TaskExecution` — the entire mission creation and listing UI — is **commented
out** in `GameMasterView`, while `/mission done` and `/mission end` still read
and write the `tasks` collection. Missions can be completed but no longer
created, and `taskContext` has no provider, so `TaskCreation` would crash if
remounted as-is.

Either restore the panel or remove the commands; the current half-state is worse
than either.

Relatedly, `endGame` sets `isGameActive: false` and nothing ever reads it — a
finished room still opens and accepts commands.

### 16. `dbCalls` reaches back into the component layer

**Impact: low · Effort: S**

`killPlayerForRoom` calls `UnmapPlayers()` — a data-access function invoking a
component-directory factory. It works only because `UnmapPlayers` happens not to
use hooks. Move it to `src/utils/`.

### 17. Repeated Firestore round trips in loops

**Impact: medium · Effort: M**

`RemapPlayers` calls `fetchPlayerForRoom` once per candidate inside a nested
loop; `UnmapPlayers` issues a separate query per neighbour. On a 20-player game a
single kill can issue dozens of reads that one collection fetch would cover.

Fetch the alive roster once per operation and work in memory. This also reduces
the window during which item 4's non-atomicity can bite.

---

## Tier 3 — Hygiene, tooling, and correctness details

### 18. Zero tests despite a full test harness

**Impact: medium · Effort: L**

`jest.config.js` (170 lines), `jest.setup.js`, `jest.polyfills.js`, and
`babel.config.js` configure Jest, Testing Library, jsdom, and
`collectCoverage: true`. There are **no test files**.

Worse, `npm test` runs `react-scripts test`, which uses its own embedded Jest
config and ignores `jest.config.js` entirely — so the standalone config is not
wired to any script.

The target-graph functions from item 11 are pure, deterministic (given a seeded
shuffle), and encode the rules most likely to regress. They are the obvious place
to start.

Additionally, `NODE_ENV` under Jest is `test`, not `development`, so
`utils/firebase.js` skips its emulator wiring — any test importing `dbCalls.js`
today points at the **production** project. See
[testing.md](./testing.md) for the full plan.

### 19. Empty command input throws

**Impact: low · Effort: S**

`value.match(...)` returns `null` for an empty or whitespace-only input, and
`.map()` is called on it before the `if (!parts) return null` guard. Pressing
Enter on an empty box throws a `TypeError`. Move the guard above the `.map()`.

### 20. `/mission end` toasts success before doing anything

**Impact: low · Effort: S**

The "Task has been saved as completed" toast fires before the task is fetched or
written. With a bad index the GM sees success, then `task.title` throws on
`undefined`.

### 21. Silent no-ops

**Impact: low · Effort: S**

- `/revive <name>` where the player is not dead: the `if` has no `else`, so there
  is no feedback whatsoever.
- `/broadcast`, `/leaderboard`, `/whisper` pass the whitelist, clear the input,
  and do nothing. They should at minimum toast "not implemented".

### 22. `logs` array will hit the document size limit

**Impact: low · Effort: M**

Logs live in an array on the room document. Firestore caps documents at 1 MiB,
and every message rewrites the entire document. A long game with an active GM
will eventually fail to log.

`arrayUnion` also deduplicates by deep equality, so two identical messages within
the same second (same `time`, `log`, `color`) silently collapse into one.

A `logs` subcollection with a `Timestamp` field fixes both, and would let the log
panel use `onSnapshot` — which resolves the log half of item 13.

### 23. `Log.js` hardcodes a phantom first entry

**Impact: low · Effort: S**

`Log.js` renders a literal `<ListItem>Game has begun!</ListItem>` above the
mapped logs. `createRoomWithDefaults` _also_ seeds a real log with that text — so
a room created through that path would show the message twice. `DashBoard`
currently creates rooms with `logs: []`, so it shows once, from the hardcoded
element. The two mechanisms need reconciling.

### 24. Room creation paths disagree

**Impact: low · Effort: S**

`DashBoard.handleHostRoom` writes `taskIndex: 1`, `logs: []`, plus `hostId` and
`storageReference`. The unused `dbCalls.createRoomWithDefaults` writes
`taskIndex: 0`, a seeded log, and no `hostId`. Whichever is canonical, there
should be one.

### 25. No environment separation

**Impact: medium · Effort: M**

`.firebaserc` maps `default`, `dev`, and `prod` **all to the same project ID**,
`mall-mystery-heroes`. There is no staging environment; testing against "dev"
writes to production data.

Additionally, emulator connection is keyed on `NODE_ENV === 'development'`, which
`react-scripts start` always sets — so `npm start` can never be pointed at the
real project without editing `utils/firebase.js`. A dedicated
`REACT_APP_USE_EMULATORS` flag would decouple the two.

### 26. Deployment is not captured in the repository

**Impact: medium · Effort: S**

`firebase.json` configures functions, emulators, and storage rules but has **no
`hosting` block**, and there is no CI configuration (`.github/` does not exist).
How the built SPA reaches users is undocumented and unreproducible.

### 27. Debug logs in the working tree

**Impact: low · Effort: S**

`firestore-debug.log`, `ui-debug.log`, and `functions/ui-debug.log` are present;
`.gitignore` covers `firestore-debug.log*` but not `ui-debug.log`. Add
`*-debug.log` and delete the strays.

### 28. `toSpliced` requires a recent runtime

**Impact: low · Effort: S**

`fetchTargetsForPlayer` uses `Array.prototype.toSpliced`, which is ES2023 —
Chrome 110+, Safari 16.4+, Node 20+. The `browserslist` production target
(`>0.2%, not dead`) is broader than that, and CRA does not polyfill it. On an
older browser, open-season target resolution throws.

### 29. Dead `console.log` calls at module load

**Impact: low · Effort: S**

`ChatInput`'s `commands` array stores `command: console.log('running')` — which
evaluates at import time, printing nine `running` lines and storing `undefined`.
`utils/firebase.js` logs `"Firebase apped:"` with the app object on every load.
The codebase carries roughly 40 `console.log` calls in game paths generally; a
logging helper that no-ops in production would be a cheap cleanup.

### 30. No `404` route

**Impact: low · Effort: S**

`App.js` has no catch-all `*` route, so an unrecognized URL renders a blank page
with no navigation.

---

## Suggested sequencing

If this backlog gets picked up, the dependencies run roughly:

1. **Items 1, 19, 20, 21** — small, self-contained bug fixes with immediate GM-facing benefit.
2. **Item 14** — delete dead code first, so later refactors aren't navigating around it.
3. **Item 11 + 12** — extract the target graph to `src/utils/`, fixing the shuffle on the way.
4. **Item 18** — unit-test the extracted graph functions; this is the first point where tests are cheap to write.
5. **Items 2 + 3** — write and deploy Firestore rules, add route guards.
6. **Items 4 + 5 + 17** — consolidate kill handling into one transactional path, ideally server-side.
7. **Items 13 + 22** — move logs to a subcollection and collapse the three state sources into subscriptions.

Items 25 and 26 are independent of the rest and can happen at any point.
