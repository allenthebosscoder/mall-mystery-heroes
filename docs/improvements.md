# Improvement backlog

Findings from a full read of the codebase (July 2026), ordered by severity
within each tier.

Effort estimates are rough: **S** = under an hour, **M** = half a day,
**L** = multi-day.

## Status at a glance

Each resolved item is also marked ✅ (or ⚠️ if partial) on its own heading
further down, so scanning the tiers below shows status inline without
jumping back up here.

### ✅ Fully resolved

Closed by the testing-foundation work described in [testing.md](./testing.md),
plus the auth and add-player work below:

| Item                                                                   | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 — algorithm in three copies                                         | Extracted to `src/game/targetGraph.js`; `TargetGenerator` and `ResetTargetsButton` now share it, `RemapPlayers` uses `src/game/remapPlan.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 12 — broken shuffle                                                    | Replaced with Durstenfeld Fisher–Yates, covered by a distribution test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 17 — round trips in loops                                              | `RemapPlayers` fetches the roster once via `fetchAliveRosterForRoom` and plans in memory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 18 — zero tests                                                        | 72 tests across six pure modules; harness rebuilt, CI runs it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 19 — empty command throws                                              | Guarded in `parseCommand`, with a regression test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1b — `addPlayerForRoom` did not await its write                        | Now returns the `addDoc` promise, so it resolves only once the write is durable and failures reject instead of being swallowed. Two emulator tests pin it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1 — case-sensitive player names                                        | Every `dbCalls.js` lookup by name now queries `trimmedNameLowerCase`. `ChatInput.js` also needed four targeted fixes (`/add`, `/kill`, `/mission done`, `/revive`) to normalize comparisons against case-preserved arrays the query fix alone didn't touch — see the full writeup at item 1 below. Covered by `dbCalls.integration.test.js` and the new `ChatInput.test.jsx`. Surfaced item 35 (multi-word names) as a related but distinct follow-up, not fixed here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2 — no Firestore security rules                                        | `firestore.rules` added and registered in `firebase.json`, scoped to the room's `hostId` per the minimum-viable design below. 14 rules tests (`test/firestore.rules.test.js`, `npm run test:rules`) cover it — see [testing.md](./testing.md#layer-2--security-rules-). `storage.rules` is unchanged; kill-related scoring now runs server-side (item 4), but every other player write (task-completion scoring, manual target reset, open-season toggling) is still client-writable. `photos` is scoped to the host rather than "the mobile app's identity" as originally proposed, since that app doesn't exist yet (item 33) — revisit when it does.                                                                                                                                                                                                                                                                                            |
| 4 — kills are non-atomic across ~15 writes                             | Moved the entire kill (validation, scoring, unmapping, remap) into one Firestore transaction inside a new Cloud Function, `functions/callableFunctions/killPlayer.js` — the full fix, not the interim `writeBatch` mitigation this item also proposed. `executeKill.js` is now a thin `httpsCallable` wrapper. See the full writeup at item 4 below and the design spec, `docs/superpowers/specs/2026-08-01-atomic-kill-cloud-function-design.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3 — no route guards                                                    | `src/components/RequireAuth.js` wraps the three authenticated routes in `App.js`, redirecting signed-out visitors to `/`. Defense-in-depth only, per this item's own note — `firestore.rules` (item 2) is the actual enforcement. 3 tests in `RequireAuth.test.jsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7 — read-modify-write races on counters                                | `updatePointsForPlayer` uses `increment()`; `fetchTaskIndexThenIncrement` uses a transaction (needs the assigned index back, not just an atomic bump); `updateLogsForRoom` dropped an unneeded read and now returns just the new entry, which `GameMasterView.addLog` appends locally. 5 new regression tests, two of them genuinely concurrent (`Promise.all`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8 — open-season flag read from the wrong player                        | No judgment call needed once traced — `ChatInput.js`'s `/kill` already fetches the victim's doc, so it now reads `targetDoc.data().openSeason` for `handleKillPlayer` instead of reusing the assassin's `isOpenSzn`. 1 new regression test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6 — photo undo history is memory-only                                  | `dbCalls.approvePhotoForRoom` persists the pre-kill snapshot onto the photo doc; `PhotosDisplay`'s `onSnapshot` now derives both `unjudgedPhotos` and `judgedPhotos` from Firestore every time (via the new pure `src/game/photoJudgments.js`), instead of `judgedPhotos` being a local-only session accumulator. 8 new tests (5 pure, 3 component) — the key one proves undo works for a photo judged in an earlier session, reconstructed purely from a mocked snapshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 34 — `addPlayerForRoom` race creates duplicate players                 | Reported live: pressing Enter twice while the UI was laggy created two players with the same name. Root cause was a check-then-act race — the duplicate-name query and the `addDoc` write were not atomic, so two concurrent calls could both pass the check before either write landed. Fixed by keying the player document ID on `trimmedNameLowerCase` and running the check + write as one Firestore transaction; see the comment on `addPlayerForRoom` in `dbCalls.js` and [data-model.md](./data-model.md#roomsroomidplayerstrimmednamelowercase). A regression test fires two concurrent `addPlayerForRoom` calls with the same name and asserts exactly one succeeds. `PlayerAddition.js` also got a UI-level in-flight guard (disables the input while a submit is pending) as defense-in-depth, but that is not the fix — the transaction is. The guard has its own coverage: `PlayerAddition.test.jsx`, the `dom` project's first test. |
| 5 — photo approval skips validation and remapping                      | Extracted `/kill`'s validate → transfer points → kill body into `src/components/executeKill.js`, exactly as this item proposed. `ChatInput.js`'s `/kill` case and `PhotosDisplay.handlePass` both call it now, so an approved photo can no longer kill a player the assassin wasn't hunting, and both paths get the same remap afterward (folded into `executeKill` itself since item 4). `executeKill`'s `preKillSnapshot` return value doubled as the undo snapshot item 6 already needed, replacing a redundant `fetchPlayerForRoom` call in `PhotosDisplay`. Original coverage: 4 emulator-backed tests plus 2 each in `ChatInput.test.jsx`/`PhotosDisplay.test.jsx`; see item 4 for how this coverage evolved once `executeKill` moved server-side.                                                                                                                                                                                           |
| 20 — `/mission end` toasts success before doing anything               | Fetch/write now happen before the toast, and the missing `if (!task)` guard `/mission done` already had was added, so a bad index alerts instead of throwing after a false success toast. 2 new tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 21 — silent no-ops                                                     | `/revive` gained the missing `else` branch. `/broadcast`, `/leaderboard`, `/whisper` now toast "not implemented", driven by `src/game/commands.js`'s `UNIMPLEMENTED_COMMANDS` — already exported but unused before this. 5 new tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 14 — dead code                                                         | Deleted `old-components/`, `cloudFunction.js`, `storageCalls.js`, `deadPlayerListContext`, and 7 unused `dbCalls.js` exports — all re-verified to have zero live callers immediately before removal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 24 — room creation paths disagree                                      | Resolved as a side effect of item 14 — the unused `createRoomWithDefaults` alternative was deleted, leaving `DashBoard.handleHostRoom` as the only path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 13 — game state tracked in three disagreeing places                    | `GameMasterView` now subscribes to the same live player query `PlayersList` used to own independently, and to a new `logs` subcollection (item 22); manual optimistic state mutation is gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 22 — `logs` array will hit the document size limit                     | Moved to a `rooms/{roomID}/logs/{autoId}` subcollection (`addLogForRoom` + a live subscription), resolved together with item 13.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 16 — `dbCalls` reaches back into the component layer                   | Moved `UnmapPlayers.js` to `src/utils/UnmapPlayers.js` as a plain exported function, not a factory — it never used hooks, so the factory shape it copied from `CreateAlert` was never necessary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 27 — debug logs in the working tree                                    | `.gitignore` now has one `*-debug.log*` pattern; deleted the stray files, including `ui-debug.log`, which turned out to be actually committed to git.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 28 — `toSpliced` requires a recent runtime                             | Replaced with a single `.filter()` — no ES2023 dependency, behaviorally identical. 1 new regression test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 30 — no `404` route                                                    | Added `src/pages/NotFound.js` and a catch-all `<Route path="*">` in `App.js`. 1 new test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 32 — confirm-password field has no show/hide toggle                    | Mirrored the password field's existing toggle pattern onto the confirm-password field. 1 new test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 33 — architecture docs describe a mobile app that doesn't exist yet    | Added "does not currently exist" caveats everywhere this repo claims the mobile app as a live collaborator (`architecture.md`, `README.md`, `data-model.md`, `game-flows.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 35 — multi-word player names aren't normalized consistently            | Extracted `normalizePlayerName` into `src/game/playerNames.js`; `dbCalls.js`, `ChatInput.js`, and `executeKill.js` all import the same function now instead of some using a whitespace-preserving `.toLowerCase()`. 5 new tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 36 — `handleUnmapping` silently failed to unmap almost any real player | Found while investigating item 4. Query and filter both fixed to use `trimmedNameLowerCase`/`normalizePlayerName`, matching every other lookup. 4 new emulator tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9 — denormalized length counters drift                                 | Deleted `targetsLength`/`assassinsLength` outright rather than routing every writer through the two `update…For…` helpers this item originally proposed — nothing read them anymore (the `RemapPlayers` fallback that used to query by them was already replaced by in-memory matching under item 17), so the two functions that queried `orderBy(…Length)` were confirmed-dead code. See the full writeup at item 9 below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10 — swallowed errors                                                  | Finished the remaining 15 swallowing functions (of an original ~40) beyond the first pass's 12, plus fixed 3 more that already threw but with a malformed rethrow that discarded the real error message. Every call site checked; most already had error handling from other items' fixes. `dbCalls.js` now has zero catch-log-swallow functions. See the full writeup at item 10 below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 37 — mission panel boundary extends past its neighbors                 | `rightHandStack`'s height now matches its siblings (`95%`, not `100%`). One-line style fix, no test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 38 — a failed mission submission burns a task index                    | `fetchTaskIndexThenIncrement` now runs last in `handleAddTask`, after every validation and the dupe check, instead of first. 3 new tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 39 — an ended mission can still be completed                           | `/mission done` now checks `task.isComplete` before awarding, matching what `/mission end` already sets. 1 new test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 40 — mission completions never show up in the chat log                 | `/mission done` now calls `addLog` on a successful completion — it never had before. 1 new test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 41 — missions have no completion cap                                   | Optional `maxCompletions` field on task creation; `/mission done` auto-ends and announces the mission once it's reached. Unset/blank stays unlimited. 4 new tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 42 — chat autosuggest is stale and has no Tab-to-complete              | `onSuggestionsFetchRequested` now reads the value `react-autosuggest` actually passes it instead of a stale closure (was one keystroke behind); Tab now accepts the highlighted or first suggestion. 1 new test, which caught the staleness bug before the Tab fix was even in scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### ⚠️ Partially addressed

| Item                                         | Remaining                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25 — no environment separation               | Emulator targeting is now an explicit `REACT_APP_USE_EMULATORS` flag rather than `NODE_ENV`, and Jest can no longer reach a live project. `.firebaserc` still maps `dev` and `prod` to the same project — unchanged.                                                                                                                                                                                                                                     |
| 29 — dead `console.log` calls at module load | Both concrete instances this item named are gone. The broader "~40 calls, logging helper" aside is unaddressed — always an aside, not a scoped requirement.                                                                                                                                                                                                                                                                                              |
| 15 — mission feature half-disconnected       | Restored (not removed) — creation and listing are reachable again, as `TaskCreationModal`/`TaskListModal` popups opened via `/mission start`/`/mission view`, not a permanent panel (`TaskExecution`, the panel that combined them, was tried first, then deleted — see the item's full writeup). `TaskCreation`/`TaskList` both have test coverage, as do the two modals. The separate `isGameActive` gating gap this item also flagged is unaddressed. |

---

## Tier 1 — Correctness and security

### 1. Player names must be all-lowercase or commands silently fail ✅ Resolved

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

**Resolution:** every `where('name', '==', …)` lookup in `dbCalls.js` was
switched to `where('trimmedNameLowerCase', '==', normalizePlayerName(…))`,
covering all twelve functions that queried by name (not just the ones in the
examples above). Regression tests:
`dbCalls.integration.test.js`'s "player lookups are case- and
whitespace-insensitive" block (replacing the old `it.failing` marker for this
exact item), and `ChatInput.test.jsx`'s new `/kill` and `/add` suites.

Switching the query was **not sufficient on its own**, contrary to what this
item originally assumed. `fetchTargetsForPlayer` returns names as actually
stored — case-preserved, since they come from `targets`/`assassins` arrays
and `openSeason` player docs, not a lowercased roster — so `/kill`'s
`arrayOfTargetsOfAssassin.includes(targetName)` was comparing a lowercased
arg against original-case values and still failed even after the query fix.
Same issue for `/mission done` and `/revive`'s `arrayOfDeadPlayers.includes(…)`
(from `fetchPlayersByStatusForRoom`, also case-preserved), and `/add`, which
turned out not to lowercase its argument at all before the roster check —
the only command that didn't. All four got matching normalization fixes in
`ChatInput.js`, each pinned by a test that fails without it (verified by
temporarily reverting each fix and confirming red).

**Found but not fixed here — see item 35:** `trimmedNameLowerCase` strips
_all_ whitespace, but `ChatInput`'s `.toLowerCase()` calls don't strip any.
For single-word names (every example above) this doesn't matter. For a
multi-word bracketed name like `[Alice Smith]`, it does.

### 2. No Firestore security rules exist in the repository ✅ Resolved

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

### 3. No route guards ✅ Resolved

**Impact: medium · Effort: S**

Every route in `App.js` is public. `/dashboard` and `/rooms/:roomID/*` render for
signed-out visitors; `DashBoard` only checks `auth.currentUser` when deciding
whether to create a room, and logs to the console when it is absent.

A `<RequireAuth>` wrapper using `onAuthStateChanged` around the four
authenticated routes. Note this is defense-in-depth only — it is not a
substitute for item 2.

**Resolution:** `src/components/RequireAuth.js` wraps `/dashboard`,
`/rooms/:roomID/lobby`, and `/rooms/:roomID/GameMasterView` in `App.js` (three
routes, not four — the other authenticated-sounding candidate,
`/login/password-reset`, is intentionally public, since it's part of the
signed-out recovery flow). Shows a spinner while `onAuthStateChanged`'s first
callback is pending, then either renders the route or `<Navigate to="/" />`.
Covered by `RequireAuth.test.jsx` (3 tests, mocking `firebase/auth` and
`utils/firebase` — verified to fail without the redirect). As noted above,
this is defense-in-depth only: it stops a signed-out visitor from seeing the
page, but `firestore.rules` (item 2) is what actually enforces data access.

### 4. Kills are non-atomic across ~15 writes ✅ Resolved

**Impact: high · Effort: L**

A single `/kill` performs roughly fifteen sequential, independent Firestore
operations: score transfer, unmapping the victim from each neighbour, the
victim's own reset, then per-player remap writes. There is no `writeBatch` and no
transaction.

A network failure or a closed tab partway through leaves the game in a state no
code can detect or repair: points transferred but the victim still alive, or the
victim dead with `targets`/`assassins` arrays that disagree with their
neighbours'.

**Resolution:** did the full fix, not the interim `writeBatch` mitigation this
item originally suggested — the entire kill now runs inside a Firestore
`runTransaction` in a new Cloud Function, `functions/callableFunctions/
killPlayer.js`. One `httpsCallable` request now does everything the old
sequential flow did across ~15 round trips: validates the target is huntable
(on the assassin's list, or either player has open season — see below),
transfers the target's points to the assassin, marks the target dead and
clears their own `targets`/`assassins`, removes the target's name from every
neighbor's `targets`/`assassins` arrays, and reassigns targets/assassins to
whoever that unmapping leaves short (the remap step, previously a separate
client-driven follow-up via `RemapPlayers`/`planRemap` after the kill had
already landed). Either all of it lands, or none of it does — the previous
partial-failure states (points moved but victim still alive; victim dead but
neighbors still referencing them) are no longer reachable.

`src/components/executeKill.js` is now a thin wrapper around
`httpsCallable(functions, 'killPlayer')` — all the logic item 5 previously put
there moved server-side. `ChatInput.js`'s `/kill` case and
`PhotosDisplay.handlePass` both call it and route its response
(`targetWasOpenSzn`, `addedTargets`, `addedAssassins`, `remapLogs`,
`preKillSnapshot`) to the same handlers they always did; neither calls
`RemapPlayers` anymore, since the function already did the remap. A thrown
`HttpsError` surfaces to the caller as a rejected promise carrying `.message`,
so the existing `try/catch` → `createAlert` pattern (item 10) needed no
changes.

Two correctness subtleties, both caught during implementation, before any test
ran:

- **Roster staleness.** A Firestore transaction's reads all happen before any
  writes, so the roster query the remap step reads is a snapshot from
  _before_ the target's `isAlive: false` write would land — the about-to-die
  target would otherwise still appear in the roster handed to `planRemap`.
  Fixed by filtering the target out of the roster and scrubbing their name
  from every neighbor's `targets`/`assassins` arrays in the objects passed to
  `planRemap`, reproducing what the old sequential flow got for free by
  reading the roster only after the separate unmap write had already landed.
- **One write per document.** A transaction rejects a second `transaction
.update()` call against the same document reference, but the assassin (for
  example) commonly needs both a score update and a remap-assigned new
  target in the same kill. Writes are accumulated per-document in a map and
  merged before issuing exactly one `transaction.update()` per document.

Because the Admin SDK bypasses `firestore.rules` entirely, `killPlayer`
re-implements the host check itself (`rooms/{roomId}.hostId ==
context.auth.uid`) rather than relying on rules to enforce it — see the
`firestore.rules` header comment for the resulting scope: kills are
server-side now, but the host can still write any other player field
(score via task completion, `ResetTargetsButton`'s manual reset, open-season
toggling) directly from the client. Tightening that further was explicitly
scoped out of this item; see the design spec.

The function shares logic with the client rather than duplicating it:
`src/game/{remapPlan,targetGraph,playerNames}.js` were converted from ES
`export`/`import` to CommonJS `module.exports`/`require()` (webpack's
CommonJS interop keeps every existing client `import` of them working
unchanged) so `killPlayer.js` can `require()` them directly. `functions/` is
now an npm workspace of the root `package.json`, so a single `npm install`
at the repo root installs both packages' dependencies instead of two
separate installs.

Superseded and deleted outright, not left stranded: `src/utils/
UnmapPlayers.js` and its test (item 36's fix; `killPlayer.js` re-implements
unmapping from scratch inside the transaction), and four now-uncalled
`dbCalls.js` exports — `fetchTargetsForPlayer`, `fetchPointsForPlayerInRoom`,
`killPlayerForRoom`, `checkOpenSzn` — each confirmed to have zero remaining
callers before removal.

Deleting `fetchTargetsForPlayer` surfaced a genuine coverage gap: it used to
merge the assassin's own target list with every globally open-season
player's name before the old client-side validation compared against it —
the real rule is a three-way OR (target is on the assassin's list, OR the
target has open season on themself, OR the assassin has open season), not
the two-way version an initial pass at `killPlayer.js` implemented. Caught
by cross-referencing what was being deleted against what
`executeKill.integration.test.js` actually covered, fixed, and pinned with a
new regression test before it could ship as a silent behavior change.

7 tests in `executeKill.integration.test.js` (rewritten to call the real
function through `httpsCallable` against the Functions, Firestore, and Auth
emulators together, not just Firestore) cover: rejecting an invalid target,
a valid kill with its remap verified end-to-end, both open-season
conditions independently, case-insensitivity, unmapping a victim from
neighbors with normally-capitalized names (pinning item 36's fix at this new
call site), and rejecting a non-host caller. `ChatInput.test.jsx` and
`PhotosDisplay.test.jsx` were both updated to mock `executeKill` directly
instead of the individual `dbCalls` functions it used to call. See
[testing.md](./testing.md#layer-1b--cloud-functions-against-the-functions-firestore-and-auth-emulators-together)
and the design spec, `docs/superpowers/specs/2026-08-01-atomic-kill-cloud-function-design.md`.

### 5. Photo approval skips validation and remapping ✅ Resolved

**Impact: high · Effort: M**

`PhotosDisplay.handlePass` kills the target but, unlike `/kill`:

- does **not** check that the target is on the assassin's target list, so an
  approved photo can kill someone the assassin was never hunting;
- does **not** call `RemapPlayers`, so every player who was hunting the victim is
  left with a dead target and no replacement.

The same in-game event produces a different graph depending on which UI the GM
used. Extracting the `/kill` body into a shared `executeKill(target, assassin,
roomID)` used by both paths is the right shape.

**Resolution:** did exactly that. `src/components/executeKill.js` was
originally the shared core client-side — validates the target is on the
assassin's list (or the assassin has open season), transfers the target's
points to the assassin, kills the target, and returns what a remap needs.
Item 4 later moved that entire body server-side into a Cloud Function
(`functions/callableFunctions/killPlayer.js`); `executeKill.js` today is a
thin wrapper around calling it. The shape described below is what changed
at the time this item was resolved — see item 4 for the current end state
(a single transaction covering validation, scoring, unmapping, and remap
together, rather than the two-step "kill via executeKill, then a separate
`RemapPlayers` follow-up" this item introduced).

`ChatInput.js`'s `/kill` case now calls `executeKill` instead of duplicating
its body inline — a thrown "not a valid target" error propagates to the
switch's existing outer `try/catch` (item 10), producing the same alert the
old inline `else` branch used to raise directly. `PhotosDisplay.handlePass`
gained the validation and remap step it never had: it calls `executeKill`
and persists the returned `preKillSnapshot` via `approvePhotoForRoom`
(replacing a separate `fetchPlayerForRoom` call — the snapshot shapes are
identical). This required destructuring four more handlers
(`handleRemapping`, `handleAddNewAssassins`, `handleAddNewTargets`,
`handleSetShowMessageToTrue`) out of `executionContext` in `PhotosDisplay` —
they were already being passed down from `GameMasterView` (both components
share the same `executionContextProviderValues`), just never used there
before.

Fixing this also surfaced (and fixed) an unrelated test-infrastructure bug:
adding a second `*.integration.test.js` file exposed that Jest runs
integration test files in parallel workers against one shared emulator
backend, while `test/emulatorHelpers.js`'s `clearFirestore()` wipes the
_entire_ emulator rather than scoping to one room — two files both seeding
`'test-room'` in parallel could clobber each other mid-test. Fixed by adding
`--runInBand` to both `test:emulator` and `test:rules` (they already each
select a single Jest project, so serializing files within that one run has no
effect on the fast `unit`/`dom` suites, which are never part of this
invocation). See [testing.md](./testing.md#layer-1--data-layer-against-the-firestore-emulator-node-env)
for how this interacts with future integration test files.

### 6. Photo undo history is memory-only ✅ Resolved

**Impact: medium · Effort: M**

`judgedPhotos` — including the `originalPlayerData` snapshot required to restore
a victim's score, targets, and assassins — lives only in React state. Reloading
the console loses every prior judgment permanently, while the photo documents
remain `approved`/`denied` in Firestore. The undo button then appears functional
but does nothing.

Persist the pre-kill snapshot onto the photo document (or a `judgments`
subcollection) at approval time.

**Resolution:** went with the photo-document option (no new collection). Two
parts, both needed — persisting the snapshot alone wasn't sufficient, since
`judgedPhotos` was also never _read back_ from Firestore:

1. New `dbCalls.approvePhotoForRoom(roomID, photoID, originalPlayerData)`
   writes `status: 'approved'` and the snapshot in one call, replacing
   `updatePhotoStatusForRoom` for the approval path specifically (still used
   as-is for deny and for undo's revert-to-pending).
2. `PhotosDisplay`'s `onSnapshot` listener previously computed only
   `unjudgedPhotos`, filtering `pending` and silently discarding
   `approved`/`denied` docs — `judgedPhotos` was purely a local accumulator
   built up by `handlePass`/`handleDeny`/`handleUndo` during the current
   session. The listener now derives _both_ lists from every snapshot via a
   new pure function, `src/game/photoJudgments.js`'s `splitPhotosByStatus`
   (data in, `{unjudged, judged}` out — no Firestore, no React, matching
   this codebase's established `src/game/` convention). This is what
   actually fixes the bug: `judgedPhotos` now reflects Firestore, so a
   reload reconstructs it instead of starting empty. The manual
   `setJudgedPhotos`/`setUnjudgedPhotos` calls inside the three handlers
   became redundant once the subscription became the single source of
   truth for both lists, and were removed.

Also added `alt` text to the three photo-action buttons (`Deny`/`Undo`/
`Approve`) — they had none, which is both an accessibility gap and what
made this untestable via Testing Library's element queries.

Regression tests: `photoJudgments.test.js` (5 tests, pure/no mocks) plus
`PhotosDisplay.test.jsx` (3 tests) — the key one mounts the component with a
mocked `onSnapshot` reporting an already-`approved` photo with a persisted
snapshot, clicks Undo, and asserts the full revert sequence runs, without
ever clicking Approve in that test — i.e., proving the reload-recovery
scenario, not just that undo works within one session.

### 7. Read-modify-write races on counters ✅ Resolved

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

**Resolution:** `updatePointsForPlayer` now writes `increment(points)`
directly, no read. `fetchTaskIndexThenIncrement` needed a transaction rather
than bare `increment()`, since the caller has to know _which_ index it was
assigned, not just that the counter moved — `transaction.get` +
`transaction.update` inside `runTransaction` gives that atomically.
`updateLogsForRoom`'s write was already atomic (`arrayUnion`); the fix there
was dropping the extra `getDoc` that only existed to fabricate a "full array"
return value, and returning just the appended entry instead — `GameMasterView`'s
`addLog` now appends that entry to its local `logList` rather than replacing
it with a value that could already be stale by the time it arrived. Regression
tests fire genuinely concurrent calls (`Promise.all`, not sequential awaits)
for the first two and assert no increment/index is lost; `updateLogsForRoom`
has tests for both its new return shape and the persisted array.

### 8. `open season` flag is read from the wrong player ✅ Resolved

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

**Resolution:** turned out not to need a judgment call — `data-model.md`
already documents `openSeason` as meaning two different things depending on
whose flag you read: the assassin's flag grants "may kill anyone" (the
validation bypass, already correctly implemented), while the victim's own
flag means "anyone may kill this player" (what the log is actually
announcing the end of). `ChatInput.js`'s `/kill` handler already fetches the
victim's full doc (`targetDoc`, needed for remap data) before killing them,
so the fix reads `targetDoc.data().openSeason` for the `handleKillPlayer`
call instead of reusing `isOpenSzn` (the assassin's flag) — no extra query.
`killPlayerForRoom`'s unconditional `openSeason: false` write was already
correct either way (a no-op when the flag was already false). Regression
test in `ChatInput.test.jsx`: assassin has no blanket kill rights (kills via
target list instead), victim's own flag is `true` — asserts
`handleKillPlayer` receives `true`, not the assassin's `false`.

### 9. Denormalized length counters drift ✅ Resolved

**Impact: medium · Effort: S**

`targetsLength` and `assassinsLength` exist so Firestore can `orderBy` array
size. They are maintained by `updateTargetsForPlayer` and
`updateAssassinsForPlayer` — but `UnmapPlayers` and `remapPlayerAsTarget` write
`targets`/`assassins` directly and leave the counters untouched.

`RemapPlayers`' fallback path orders candidates by exactly these counters, so
after any unmap it is choosing based on stale data.

Route all array writes through the two `update…For…` helpers.

**Resolution:** didn't route the writes — deleted the fields instead, once
investigation showed nothing was actually reading them anymore. The
`RemapPlayers`' fallback path this item's own description points at doesn't
exist in the current code: `RemapPlayers.handleRegeneration` was rewritten
under item 17 to fetch the alive roster once and match in memory via the
pure `planRemap`, which never queries by `…Length` at all. That left
`fetchAlivePlayersByAscendAssassinsLengthForRoom` and
`fetchAlivePlayersByAscendTargetsLengthForRoom` — the only two functions
that ever queried `orderBy(…Length)` — as confirmed-dead code with zero
callers anywhere in the app or its tests. Separately, `killPlayer` (item 4)
never maintained these counters either, so every kill was already leaving
them stale regardless of what this item did.

With no live reader anywhere, "route every writer through the two
helpers" would have meant policing an invariant that serves nothing.
Removed instead: the `targetsLength`/`assassinsLength` writes in
`addPlayerForRoom`, `updateTargetsForPlayer`, `updateAssassinsForPlayer`,
and `remapPlayerAsTarget`; the two dead `fetchAlivePlayersByAscend…
LengthForRoom` functions (each also had a stray `console.log`, gone with
them); the fields themselves, from the schema (`data-model.md`) and from
`test/emulatorHelpers.js`'s `seedRoom` fixture. A test that only existed to
assert `targetsLength` tracked `targets.length` was removed along with the
field it was pinning. No new test was needed — this removes the possibility
of drift rather than adding a new behavior to cover, and the full suite
(including `dbCalls.integration.test.js`, which seeds and reads real player
documents) already confirms no code path expects these fields to exist.

### 10. Errors are swallowed throughout the data layer ✅ Resolved

**Impact: medium · Effort: M**

Every function in `dbCalls.js` wraps its body in `try/catch`, calls
`console.error`, and returns `undefined`. Callers never check, so failures
resurface as `TypeError: Cannot read properties of undefined` on `.docs[0]` or
`.data()` — usually somewhere unrelated to the actual fault, and always without
UI feedback.

`CreateAlert` already exists as the toast mechanism. Either let `dbCalls` throw
and handle it at the call site, or return a discriminated result. Silently
returning `undefined` is the worst of the three options.

**Resolution so far: strategy decided, scope deliberately partial.**
Chose "let it throw" — it's what `CONTRIBUTING.md` itself recommends, and
matches how `addPlayerForRoom` already worked after the item-34 fix. Given
the size (~40 functions, every one with call sites across most of `src/`),
did a representative subset rather than all of it in one pass: the 12
functions already touched by this session's other Tier 1 fixes
(`fetchPlayerForRoom`, `fetchTargetsForPlayer`, `updatePointsForPlayer`,
`fetchPointsForPlayerInRoom`, `updateIsAliveForPlayer`, `killPlayerForRoom`,
`removePlayerForRoom`, `updateAssassinsForPlayer`, `updateTargetsForPlayer`,
`fetchAssassinsForPlayer`, `updateLogsForRoom`, `fetchTaskIndexThenIncrement`)
had their `try/catch`-and-swallow removed.

Every call site of those 12 functions was updated too, not just the
functions themselves — leaving a function throwing without covering its
callers would trade "silently returns `undefined`" for "unhandled promise
rejection," which is not obviously better. Two error-handling shapes ended
up in use, chosen per call site:

- **Propagate to an existing/new outer boundary with user feedback.**
  `ChatInput.js`'s entire command switch is now one `try/catch` (not
  per-case — no single case is simple enough to wrap individually without
  hurting readability), showing `createAlert` with the thrown message.
  `PhotosDisplay.js`'s `handlePass`/`handleDeny` got their first-ever
  `try/catch`; `handleUndo`'s existing one gained a `createAlert` (it only
  logged before). `TargetGenerator.js` and `ResetTargetsButton.js`'s
  existing catches gained `createAlert` the same way. `TaskCreation.js`'s
  `handleAddTask` had no error handling around
  `fetchTaskIndexThenIncrement` at all; now it does.
- **Catch locally and degrade gracefully.** `GameMasterView.js`'s `addLog`
  catches its own errors rather than propagating — it's called from many
  places (kills, revives, open-season toggles, photo judgments), and a
  failed log write shouldn't block or appear to fail the primary action
  that triggered it. Shows a `warning`-level `createAlert`, not `error`.
  `RemapPlayers.js` needed no changes — it already had a proper
  `try/catch` + `createAlert` wrapping `updateTargetsForPlayer`/
  `updateAssassinsForPlayer`; it just never fired, since those functions
  used to swallow the errors before this fix let them reach it.

`old-components/KillButton.js` and `old-components/DeadPlayerReviveButton.js`
also called some of these 12 functions, but per `CONTRIBUTING.md`,
`old-components/` was dead code that should be deleted, not edited — left
untouched at the time, and deleted outright once item 14 got to it.

Regression tests (first pass): 5 new integration tests assert specific
functions reject instead of resolving to `undefined` for a nonexistent
player (`dbCalls.integration.test.js`); one new `ChatInput.test.jsx` test
asserts a mocked `dbCalls` rejection produces a visible toast, not silence.

**Second pass: the rest of `dbCalls.js`.** Picked back up later in the same
session. Re-auditing the file top to bottom found the "~29 remaining
functions" estimate above was high — some had already never had the
problem, and three (`fetchReferenceByIndexForTask`,
`fetchAlivePlayerNamesForRoom`, `fetchAliveRosterForRoom`) already threw,
just with a latent bug of their own (below). The actual remaining swallowers
were 15 functions: `fetchAllPlayersForRoom`, `fetchPlayersByStatusForRoom`,
`fetchAllTasksForRoom`, `fetchTasksByCompletionForRoom`,
`fetchTaskByIndexForRoom`, `updateIsCompleteToTrueForTaskByIndex`,
`addPlayerToCompletedByForTask`, `addTaskForRoom`, `checkForTaskDupesForRoom`,
`fetchPlayersQueryByDescendPointsThenIsAliveForRoom`,
`fetchPhotosQueryByAscendingTimestampForRoom`, `updatePhotoStatusForRoom`,
`fetchTasksQueryForRoom`, `endGame`, and `remapPlayerAsTarget`.

Three of those fifteen are synchronous query-builder functions
(`fetchPlayersQueryByDescendPointsThenIsAliveForRoom`,
`fetchPhotosQueryByAscendingTimestampForRoom`, `fetchTasksQueryForRoom`) —
their `try/catch` wrapped only `collection()`/`query()` calls, which build an
in-memory query object and touch no network; they cannot fail in normal
operation. The "let it throw" fix here was to delete the pointless wrapper
rather than route it anywhere, since there was nothing real to catch.

`updateIsCompleteToTrueForTaskByIndex` had a second, independent bug beyond
swallowing: it already had a manufactured `throw new Error('Task not
found')` for the not-found case, immediately caught and discarded by its
own enclosing `catch` — throwing and swallowing in the same function.
`endGame` had a related but different problem: it pre-checked
`roomSnapshot.exists()` before writing, but on failure just logged
`"No such document!"` and returned `undefined` either way, identical to the
success path from the caller's perspective. Simplified to call `updateDoc`
directly and let Firestore's own `NOT_FOUND` throw do the job — the
pre-check was redundant with what `updateDoc` already guarantees, matching
how every other write function in this file works.

Separately, the three already-throwing functions
(`fetchReferenceByIndexForTask`, `fetchAlivePlayerNamesForRoom`,
`fetchAliveRosterForRoom`) all rethrew as `throw new Error('some message: ',
error)` — `Error`'s constructor only accepts one positional argument, so the
second (the actual underlying error) was silently discarded every time; the
thrown message a caller's `catch` would see was always just the generic
wrapper text, e.g. `"Error fetching alive players: "`, with the real detail
gone. Fixed by removing the wrapper entirely and letting the original
Firestore error propagate unchanged, same treatment as the newly-fixed
functions — one throwing where before it always threw, but a caller's
`createAlert` now actually says something.

Every call site of the fifteen was checked, not just the functions: most
were already covered by an existing outer `try/catch` from the first pass
or from other items' fixes (`Lobby.js`'s player fetch, `PhotosDisplay.js`'s
`handleDeny`/`handleUndo`, `RemapPlayers.js`) and needed no change.
`ChatInput.js`'s roster fetch (`fetchAllPlayersForRoom`) ran _before_ the
function's one big `try`, not inside it — extended the `try` to start
above it instead of below. `Endgamebutton.js`'s "End Game" confirm handler
called `endGame` without `await` or a `catch` at all and navigated to
`/dashboard` immediately regardless — a failure was invisible and the GM
would land on the dashboard believing the game had ended when it hadn't;
now it awaits, only navigates on success, and shows an alert on failure,
new coverage in `Endgamebutton.test.jsx` (first test file for this
component). `TaskCreation.js`'s `handleAddTask` had `checkForTaskDupesForRoom`
and `addTaskForRoom` calls outside its one existing `try` (which only
covered `fetchTaskIndexThenIncrement`); extended to cover both.
`TaskList.js`'s task fetch got a minimal `console.error`-only catch at
first, on the reasoning that it fed the commented-out mission panel (item
15: `task_components/` was unmounted at the time), so a failure had no
visible effect on the GM — reasoning that stopped holding a few hours later
in the same session once item 15 remounted the panel, at which point the
catch gained a `createAlert` too (see item 15's own writeup). `GameMasterView.js`
had a matching one-off `fetchAllTasksForRoom` fetch and catch of its own,
but item 15's later restoration found that fetch's result was never actually
read by anything (`TaskList` runs its own independent subscription) and
deleted it outright, catch included — see item 15's own writeup.

Two stray `console.log` debug lines (`addPlayerToCompletedByForTask`
logging its own argument on every call; `remapPlayerAsTarget` logging a
success message) were removed while rewriting their functions — noise
adjacent to what item 29 catalogued, not itself scoped there, so not
claimed as part of that item.

Regression tests (second pass): `updateIsCompleteToTrueForTaskByIndex`
rejecting for a nonexistent task index, and `endGame` rejecting for a
nonexistent room, both added to the same `dbCalls.integration.test.js`
describe block as the first pass's five, each verified to fail against the
pre-fix swallow-and-return-`undefined` behavior before confirming green
against the fix. `Endgamebutton.test.jsx` is new — two tests, confirmed red
against the pre-fix fire-and-forget `onYesEnd` before confirming green.
The rest of the fifteen had no new test: either the removed `try/catch`
never protected against a producible failure (the three sync query
builders), or the only meaningful change was letting an existing Firestore
error through unmodified, which isn't independently reproducible in a
black-box emulator test any more than the first pass's untested functions
were (this codebase doesn't mock the Firestore SDK — see
[testing.md](./testing.md) Part 7).

`dbCalls.js` now has zero functions that catch, log, and swallow. Every
call site either propagates the error to a `createAlert` (directly, or via
an enclosing `try/catch`) or — `GameMasterView.addLog` is the one
deliberate exception — catches locally and degrades gracefully with a
`warning`-level `createAlert`, justified above, not silence.

---

## Tier 2 — Structure and duplication

### 11. The target-generation algorithm exists in three copies ✅ Resolved

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

### 12. `randomizeArray` stops one index short in two of three copies ✅ Resolved

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

### 13. Game state is tracked in three disagreeing places ✅ Resolved

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

**Resolution:** design written up first at
[docs/superpowers/specs/2026-08-01-state-consolidation-design.md](./superpowers/specs/2026-08-01-state-consolidation-design.md)
(Effort: L and a vague fix direction, unlike most items here, warranted an
actual design pass before touching code). Investigation there found the real
scope narrower than this item's own description: `arrayOfDeadPlayers`,
`arrayOfTasks`, and `completedTasks` turned out to be write-only in
`GameMasterView` — set but never read (the task ones fed the
mission panel, item 15's territory, unmounted at the time). Only
`arrayOfAlivePlayers` and `logList` were real, rendered state. `arrayOfTasks`
was deleted outright once item 15's later restoration confirmed it really
was dead — see that item's writeup; `completedTasks` remains, still
write-only, `TaskList` runs its own independent subscription rather than
reading it.

`GameMasterView` now subscribes via `onSnapshot` to the same query
`PlayersList` already used, holds the result as its only player state
(`players`), and derives the header count (`players.length`) and
`ResetTargetsButton`'s roster (`players.filter(p => p.isAlive).map(p =>
p.name)`) inline — no separate state, no manual mutation.
[PlayersList.js](../src/components/player_listing/PlayersList.js) stopped
subscribing itself and became presentational, taking `players` as a prop —
which also surfaced and fixed a latent bug: its mapped rows had no `key`
prop at all (invisible until something finally rendered it in a test).
`handleKillPlayer`, `handlePlayerRevive`, and `PhotosDisplay.handleUndo`
dropped their manual `setArrayOfAlivePlayers`/`setArrayOfDeadPlayers` calls —
the subscription re-renders once the underlying write lands. `handleUndoRevive`
was deleted outright rather than ported: it had zero live callers already
(`eslint-disable`d in the source as "never wired to any UI") and its entire
body manipulated state that no longer exists. `Lobby.js` stopped passing
`arrayOfPlayers` via router `navigate` state — nothing reads it anymore.

This also resolved the logs half of item 22 (see below) and is what
unblocks the `CLAUDE.md` warning against writing `GameMasterView` component
tests — new coverage: `PlayersList.test.jsx` (4 tests, no Firestore mocking
needed anymore) and `GameMasterView.test.jsx` (3 tests, mocking `onSnapshot`
the same way `PhotosDisplay.test.jsx` does).

### 14. Dead code ✅ Resolved

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

**Resolution:** deleted `src/components/old-components/` (all 8 files),
`cloudFunction.js`, `storageCalls.js`, and `deadPlayerListContext` from
`Contexts.js` — each re-verified immediately before deletion to have zero
importers and zero test coverage. Also removed the seven unused `dbCalls.js`
exports this item pointed at
([data-model.md](./data-model.md#unused-data-layer-surface)):
`createRoomWithDefaults`, `addPhotoForRoom`, `updateCompletedByForTask`,
`fetchTaskForRoom`, `fetchReferenceForTask`, `updateIsCompleteToTrueForTask`,
`fetchAlivePlayersQueryByDescendPointsForRoom` — along with the `setDoc` and
`serverTimestamp` imports that only they used. `.prettierignore`'s
now-pointless `old-components/` exclusion was removed too.

The `rooms/{id}.hostId`/`.isGameActive` row is now half-stale: item 2 (this
session, earlier) made `hostId` load-bearing — `firestore.rules` reads it on
every write to scope access to the room's host — so it's no longer "written,
never read." `isGameActive` and `storageReference` are still write-only;
left alone rather than deleted, per this item's own note, until items 2
(already partly done) and 15 give them a reason to be read.

The dbCalls exports weren't deleted purely for tidiness — `createRoomWithDefaults`
in particular wrote `taskIndex: 0` while the `DashBoard`'s actual room-creation
path writes `taskIndex: 1`; leaving a second, disagreeing, unreferenced
implementation of "create a room" in the same file most other Firestore
writes flow through was exactly the kind of trap this item warned about.

### 15. The mission feature is half-disconnected ✅ Resolved

**Impact: medium · Effort: S**

`TaskExecution` — the entire mission creation and listing UI — is **commented
out** in `GameMasterView`, while `/mission done` and `/mission end` still read
and write the `tasks` collection. Missions can be completed but no longer
created, and `taskContext` has no provider, so `TaskCreation` would crash if
remounted as-is.

Either restore the panel or remove the commands; the current half-state is worse
than either.

**Resolution: restored, not removed** — the user's explicit call between the
two options this item posed. `GameMasterView.js` now uncomments the
`<Box sx={styles.taskBox}><taskContext.Provider value={{handleNewTaskAdded}}>
<TaskExecution /></taskContext.Provider></Box>` block instead of deleting
the dead `/mission` commands, restoring `TaskCreation` (create) and
`TaskList` (list, active/completed tabs) as live, reachable UI again.

Two dead-code findings surfaced while restoring it, both fixed:

- `GameMasterView`'s own `arrayOfTasks` state (fed by a `fetchAllTasksForRoom`
  call and updated again by `handleNewTaskAdded`) was write-only — the
  `setArrayOfTasks` half of `const [, setArrayOfTasks] = useState([])` never
  had a read half to begin with, so nothing in the component ever consumed
  it, and `TaskList` runs its own independent live subscription rather than
  receiving this as a prop. Deleted the state, the effect, and
  `dbCalls.fetchAllTasksForRoom` itself (zero remaining callers). This also
  means a kill-related `fetchAllTasksForRoom` call this document's item 10
  writeup mentioned catching-and-logging (rather than alerting, since it fed
  nothing visible) no longer exists to need that treatment — superseded, not
  contradicted.
- The two boxes sharing `rightHandStack` (`photosBox`, `taskBox`) had fixed
  percentage heights, `95%` and `60%`, that together exceed the parent's
  `100%` — never exercised before, since `taskBox` was always commented out.
  Switched both to `flex` ratios (`3`/`2`) instead of fixed percentages, so
  they'd share the available height regardless of exact numbers. Superseded
  by the same-session follow-up below: once `taskBox` was removed in favor of
  the two modals, `photosBox` went back to a plain `h: '100%'` — `PhotosDisplay`
  is its only child again, so there's nothing left to share height with.

New test coverage: `TaskCreation.test.jsx` (create end to end and clears the
form, duplicate rejected, validation, a rejected write shows an error toast
rather than the silent unhandled-rejection risk this same item's own text
flagged) and `TaskList.test.jsx` (active/completed split by count and
content, doesn't crash when the fetch rejects). Neither component had any
test before this — they were unreachable dead code.

**Follow-up, same session:** the panel form above never actually worked as
a layout — see `docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md`.
`TaskCreation`/`TaskList` stayed exactly as described above; `TaskExecution`
(the component that combined them into one panel) was deleted, replaced by
`TaskCreationModal`/`TaskListModal` — two on-demand popups triggered by new
`/mission start`/`/mission view` commands, following the existing
`RemapPlayerModal` pattern. The restore-vs-remove decision itself didn't
change; only how the restored feature is presented did.

**Follow-up, later session:** the "relatedly" gap below — `isGameActive`
written but never read — picked up and closed. `GameMasterView` now
subscribes to the room document itself (`fetchRoomReferenceForRoom`, a new
`onSnapshot` alongside the existing players/logs ones) and threads
`isGameActive` through `gameContext`. `ChatInput` disables its input and
swaps its placeholder to "This game has ended" once it reads `false` —
guarding both the text input (its own `disabled` attribute blocks Enter/Tab
natively) and the separate send-icon click, which isn't a native `<input>`
and needed its own check in `submitCommand`. This closes the gap for every
tab still open on the room, not just the one that clicked "End Game" itself
(which already navigated away separately, via `Endgamebutton`'s existing
`navigate('/dashboard')`). New tests: `ChatInput.test.jsx` (disabled +
placeholder + send-icon guard, all three confirmed failing against the
pre-fix code before the fix), `GameMasterView.test.jsx` (isGameActive
reaches context, both the default-true and reported-false cases). Verified
live in two browser tabs against the running dev server, not just the test
suite — ending the game in one tab visibly disables the input in the other,
without a reload.

Relatedly, `endGame` sets `isGameActive: false` and nothing ever reads it — a
finished room still opens and accepts commands.

### 16. `dbCalls` reaches back into the component layer ✅ Resolved

**Impact: low · Effort: S**

`killPlayerForRoom` calls `UnmapPlayers()` — a data-access function invoking a
component-directory factory. It works only because `UnmapPlayers` happens not to
use hooks. Move it to `src/utils/`.

**Resolution:** moved to `src/utils/UnmapPlayers.js` and converted from a
factory returning a function (`UnmapPlayers()` → `handleUnmapping`) to a
plain exported `handleUnmapping` function — it never used hooks, so the
factory shape (mimicking `CreateAlert`, which genuinely needs one for
`useToast()`) was never necessary; `architecture.md`'s "Components that are
not components" table had this as a documented fact ("genuinely depends on
hooks") that was simply incorrect. `dbCalls.killPlayerForRoom` now imports
`handleUnmapping` directly, the same way it imports everything else it
needs. Also dropped three `console.log` debug lines from the function body
while rewriting it (`playerAssassins`/`assassinData`/`assassinTargets`) —
noise in every test run that exercises `killPlayerForRoom`, no signal.
Covered indirectly by the existing emulator tests that exercise
`killPlayerForRoom` (`dbCalls.integration.test.js`,
`executeKill.integration.test.js`) — no behavior changed, so no new test
was needed, just confirmation the existing 35 still pass.

Since superseded by item 4: `killPlayerForRoom` and `src/utils/
UnmapPlayers.js` were both deleted outright once the Cloud Function
re-implemented unmapping from scratch inside its own transaction. This
item's move-out-of-the-component-layer fix is no longer live code, but the
underlying judgment — a plain exported function doesn't need a factory
shape unless it uses hooks — held up.

### 17. Repeated Firestore round trips in loops ✅ Resolved

**Impact: medium · Effort: M**

`RemapPlayers` calls `fetchPlayerForRoom` once per candidate inside a nested
loop; `UnmapPlayers` issues a separate query per neighbour. On a 20-player game a
single kill can issue dozens of reads that one collection fetch would cover.

Fetch the alive roster once per operation and work in memory. This also reduces
the window during which item 4's non-atomicity can bite — item 4 has since
closed that window entirely for kills, by moving the whole operation into one
transaction.

---

## Tier 3 — Hygiene, tooling, and correctness details

### 18. Zero tests despite a full test harness ✅ Resolved

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

### 19. Empty command input throws ✅ Resolved

**Impact: low · Effort: S**

`value.match(...)` returns `null` for an empty or whitespace-only input, and
`.map()` is called on it before the `if (!parts) return null` guard. Pressing
Enter on an empty box throws a `TypeError`. Move the guard above the `.map()`.

### 20. `/mission end` toasts success before doing anything ✅ Resolved

**Impact: low · Effort: S**

The "Task has been saved as completed" toast fires before the task is fetched or
written. With a bad index the GM sees success, then `task.title` throws on
`undefined`.

**Resolution:** reordered so the fetch and write happen first, added the
missing `if (!task)` guard `/mission done` already had (so a bad index shows
"Invalid task index" instead of throwing), and moved the success toast after
`updateIsCompleteToTrueForTaskByIndex` resolves. 2 new tests in
`ChatInput.test.jsx` — one pins the bad-index path (no success toast, no
crash), one pins that `handleTaskCompleted` and the toast both fire only
after the write succeeds.

### 21. Silent no-ops ✅ Resolved

**Impact: low · Effort: S**

- `/revive <name>` where the player is not dead: the `if` has no `else`, so there
  is no feedback whatsoever.
- `/broadcast`, `/leaderboard`, `/whisper` pass the whitelist, clear the input,
  and do nothing. They should at minimum toast "not implemented".

**Resolution:** `/revive` gained the missing `else` branch, alerting
"`<name>` is not dead". `/whisper`, `/broadcast`, and `/leaderboard` are
now fully implemented as a data-layer feature prepared for future mobile-app
integration. They write to a new `rooms/{roomID}/playerMessages` Firestore
subcollection, validated and confirmed in the chat log like every other
command. See the design spec, `docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md`.
Tests added across `src/game/leaderboard.js`, `ChatInput.test.jsx`, `commandCompletion.test.js`,
and Firestore rules validation.

### 22. `logs` array will hit the document size limit ✅ Resolved

**Impact: low · Effort: M**

Logs live in an array on the room document. Firestore caps documents at 1 MiB,
and every message rewrites the entire document. A long game with an active GM
will eventually fail to log.

`arrayUnion` also deduplicates by deep equality, so two identical messages within
the same second (same `time`, `log`, `color`) silently collapse into one.

A `logs` subcollection with a `Timestamp` field fixes both, and would let the log
panel use `onSnapshot` — which resolves the log half of item 13.

**Resolution:** did exactly that, alongside item 13 (see
[the design doc](./superpowers/specs/2026-08-01-state-consolidation-design.md)
and item 13's resolution above). `logs` now lives at
`rooms/{roomID}/logs/{autoId}`, mirroring `photos`'s existing shape —
`time`/`log`/`color` fields unchanged (`Log.js` needed zero changes), plus a
`timestamp: serverTimestamp()` field used only for `orderBy`.
`dbCalls.updateLogsForRoom` (an `updateDoc` + `arrayUnion`) was replaced by
`addLogForRoom` (an `addDoc`) and `fetchLogsQueryByAscendingTimestampForRoom`
— renamed, not just reimplemented, since `add…For…` is this file's
convention for "creates a new document" (matching `addPlayerForRoom`/
`addTaskForRoom`), and an `addDoc` into a subcollection isn't an update to
an existing one. `GameMasterView` subscribes to the new query instead of
one-time-fetching and locally appending. No migration path for the old
array field — a "room" here is a fresh per-game object (hosting always
creates a new room ID), so there's no long-lived room whose log history
needed preserving across the schema change; the now-pointless `logs: []`
write was dropped from `DashBoard.js`'s room creation. `firestore.rules`
gained a `logs/{logId}` block identical to the existing `tasks`/`players`
ones — without it every read/write would have been denied by default. New
tests: 3 emulator-backed (`dbCalls.integration.test.js`, including one
proving two identical messages are no longer deduplicated) and 3 rules
tests (`test/firestore.rules.test.js`).

### 23. `Log.js` hardcodes a phantom first entry ✅ Resolved

**Impact: low · Effort: S**

`Log.js` renders a literal `<ListItem>Game has begun!</ListItem>` above the
mapped logs. `DashBoard` creates rooms with `logs: []`, so nothing in
Firestore ever actually contains that text — it's always the hardcoded
element, never real data. (Until item 14 deleted it, `dbCalls.createRoomWithDefaults`
was a second, unused room-creation path that _also_ seeded a real log with
this exact text; a room created through that path would have shown the
message twice. That specific double-render can no longer happen, since the
function is gone — but the hardcoded `<ListItem>` itself, standing in for
data that doesn't exist, is still the underlying issue.) Fix shape: either
seed a real first log entry when a room is created and delete the hardcoded
element, or accept it as permanent decoration and stop treating it as a log.

**Resolution:** seeded a real entry, not left as decoration — but at "Begin
Game" time (`TargetGenerator.js`'s `onYesClose`, via `addLogForRoom`), not
at room creation. Room creation happens before any players exist yet; "Begin
Game" is the moment the game actually starts, matching the message's own
wording. Deleted the hardcoded `<ListItem>` from `Log.js` — every entry
shown is now real subcollection data, no phantom exceptions. New test file
`TargetGenerator.test.jsx` (none existed before): covers the confirmation
dialog, that targets/assassins get written per player, the new log call,
the handoff to the lobby callback, and — since this was untested before and
the file already had its own error-catching per item 10 — that a rejected
write surfaces a toast. Verified live against the running dev server: the
log panel shows a real timestamped `[h:mm:ss AM/PM]: Game has begun!` entry
after confirming target generation.

### 24. Room creation paths disagree ✅ Resolved

**Impact: low · Effort: S**

`DashBoard.handleHostRoom` writes `taskIndex: 1`, `logs: []`, plus `hostId` and
`storageReference`. The unused `dbCalls.createRoomWithDefaults` writes
`taskIndex: 0`, a seeded log, and no `hostId`. Whichever is canonical, there
should be one.

**Resolution:** resolved as a side effect of item 14 — `createRoomWithDefaults`
had zero callers and was deleted along with the rest of that item's dead-code
sweep. `DashBoard.handleHostRoom` is now the only room-creation path, so there
is nothing left to disagree.

### 25. No environment separation 🚫 Not pursuing

**Impact: medium · Effort: M**

`.firebaserc` maps `default`, `dev`, and `prod` **all to the same project ID**,
`mall-mystery-heroes`. There is no staging environment; testing against "dev"
writes to production data.

Additionally, emulator connection is keyed on `NODE_ENV === 'development'`, which
`react-scripts start` always sets — so `npm start` can never be pointed at the
real project without editing `utils/firebase.js`. A dedicated
`REACT_APP_USE_EMULATORS` flag would decouple the two.

**Resolved in part, the rest deliberately not pursued:** the emulator-flag
half is fixed — `REACT_APP_USE_EMULATORS=true` now lives in
`.env.development`, decoupled from `NODE_ENV` (see `src/utils/firebaseEnv.js`).

The `.firebaserc` aliasing half — a real second Firebase project for `dev`,
distinct from `prod` — was traced through and deliberately not pursued
after discussion. Checked every place a `.firebaserc` alias actually gets
used in this repo:

- `npm start` always talks to the local emulators regardless of any alias
  (`REACT_APP_USE_EMULATORS=true`).
- `test:emulator`/`test:rules` use a hardcoded `demo-mall-mystery-heroes`
  project ID, not a `.firebaserc` alias — Firebase treats any `demo-`-prefixed
  ID as permanently emulator-only, incapable of reaching a real backend no
  matter what.
- `firebase:emulate` starts local emulators too — no real data touched
  regardless of aliasing.
- The only command that would touch the real project is a manual
  `firebase deploy` — and since every alias already points at the same
  project, there is no "wrong" alias to accidentally deploy to.

So the risk this item describes — running a command against "dev" while
believing it's a sandbox, and having it silently hit real data — has no
actual moment where it could happen in this project's current workflow.
It's real advice for a team environment with multiple contributors or
scripted bulk/destructive testing against a "sandbox," neither of which
applies here today. Revisit if either changes (a second contributor joins,
or a need arises to run something destructive against non-production data)
— at that point, provisioning an actual second Firebase project and
pointing `dev` at it is the fix, not just renaming labels (the alias names
are already distinct; only the underlying project IDs need to differ).

### 26. Deployment is not captured in the repository ⚠️ Partially addressed

**Impact: medium · Effort: S**

`firebase.json` configures functions, emulators, and storage rules but has **no
`hosting` block**, and there is no CI configuration (`.github/` does not exist).
How the built SPA reaches users is undocumented and unreproducible.

**Correction:** the "no CI" half of this was already stale by the time it was
picked up — `.github/workflows/ci.yml` exists and runs format-check, lint,
tests, and a build on every push/PR to `main`. It just doesn't deploy
anything; see below.

**Resolution, hosting half:** the app had never been deployed anywhere —
this was a first-time setup, not a documentation gap. Added a `hosting`
block to `firebase.json` (`public: "build"`, plus a catch-all rewrite to
`index.html` so this SPA's client-side routes like `/rooms/:roomID/lobby`
don't 404 on a direct link or refresh) and ran `firebase deploy --only
hosting`. Live at `https://mall-mystery-heroes.web.app` (and the equivalent
`.firebaseapp.com`), verified both the root and a deep route resolve.

**Deliberately not addressed:** automating this deploy through CI. There
are no real users yet, so there's no pipeline worth automating — deploying
is a manual `firebase deploy --only hosting` for now, run whenever there's
something worth shipping. Automating it would mean storing a deploy
credential as a GitHub secret, a real security decision better made once
there's an actual launch to justify it. Revisit then.

### 27. Debug logs in the working tree ✅ Resolved

**Impact: low · Effort: S**

`firestore-debug.log`, `ui-debug.log`, and `functions/ui-debug.log` are present;
`.gitignore` covers `firestore-debug.log*` but not `ui-debug.log`. Add
`*-debug.log` and delete the strays.

**Resolution:** `.gitignore` now has a single `*-debug.log*` pattern
(replacing the narrower `firestore-debug.log*`, and the never-matching
absence of anything for `ui-debug.log`) — turned out `ui-debug.log` wasn't
just un-ignored, it was actually **committed to git**, worse than this item
described. Deleted `ui-debug.log`, `firestore-debug.log`, and
`pglite-debug.log` (a fourth stray this item didn't name, same category)
from the working tree. `ui-debug.log`'s removal from git tracking is left
as an unstaged pending deletion rather than something this session commits
on its own initiative.

### 28. `toSpliced` requires a recent runtime ✅ Resolved

**Impact: low · Effort: S**

`fetchTargetsForPlayer` uses `Array.prototype.toSpliced`, which is ES2023 —
Chrome 110+, Safari 16.4+, Node 20+. The `browserslist` production target
(`>0.2%, not dead`) is broader than that, and CRA does not polyfill it. On an
older browser, open-season target resolution throws.

**Resolution:** replaced the manual find-index-then-`toSpliced` dance with a
single `.filter()` excluding the querying player's own (normalized) name
from the open-season list — behaviorally identical (normalized names are
unique per player, so at most one entry could ever match) and needs no
ES2023 support. 1 new regression test pins the case this was actually
protecting: a player who is themselves in open season must not see their
own name in their own target list.

### 29. Dead `console.log` calls at module load ⚠️ Partially addressed

**Impact: low · Effort: S**

`ChatInput`'s `commands` array stores `command: console.log('running')` — which
evaluates at import time, printing nine `running` lines and storing `undefined`.
`utils/firebase.js` logs `"Firebase apped:"` with the app object on every load.
The codebase carries roughly 40 `console.log` calls in game paths generally; a
logging helper that no-ops in production would be a cheap cleanup.

**Resolution:** both concrete instances this item named are gone —
`ChatInput`'s `commands` array dropped the dead `command:` field entirely
(it was never read; only `text` is), and `utils/firebase.js`'s
`"Firebase apped:"` log had already been removed by an earlier refactor
(the lazy/explicit emulator-init work under item 25) before this item was
picked up. The broader "~40 `console.log` calls generally, a logging
helper that no-ops in production" suggestion is **not** addressed — it was
always an aside in this item's own text, not a scoped requirement, and
"which of ~40 call sites are worth keeping as real diagnostics vs. cutting"
is a judgment call across the whole codebase, not a single fix. Left as a
genuine follow-up if picked up again.

### 30. No `404` route ✅ Resolved

**Impact: low · Effort: S**

`App.js` has no catch-all `*` route, so an unrecognized URL renders a blank page
with no navigation.

**Resolution:** added `src/pages/NotFound.js` (plain presentational — a
"404" heading and a link back to `/`) and a `<Route path="*" ...>` in
`App.js`, matching react-router's catch-all convention. 1 new test
(`NotFound.test.jsx`); no route-matching test on `App.js` itself, since
that would require mocking every page it transitively imports (Firebase
auth, `dbCalls`, …) to verify library routing behavior that isn't this
codebase's to test.

### 31. Post-signup dashboard shows leftover debug placeholder text ✅ Resolved

**Impact: low · Effort: S**

`DashBoard.js:74` renders a literal `<div>OLD LOBBY DATA maybe?</div>`. It's the
first thing a new account sees after signing up, and reads as unfinished
scaffolding rather than an intentional "create/host a room" step. `Dashboard`
can't be skipped outright — a brand-new account has no room yet, so
`Dashboard → Lobby → GameMasterView` is structurally required — but the
placeholder copy and layout should be replaced with real UI.

**Resolution:** replaced with a one-line `<Text>` explaining the single
action available on the page ("Host a new room below to start a game as its
Game Master"). No new test file — `DashBoard.js` is CLAUDE.md's one
legacy exception that touches the Firestore SDK directly rather than going
through `dbCalls.js`, and this change is copy-only, not logic; testing it
would mean standing up Firebase SDK mocks solely to assert on static text.
Verified live against the running dev server instead.

### 32. Confirm-password field has no show/hide toggle ✅ Resolved

**Impact: low · Effort: S**

The password field has a show/hide toggle (`show` state + `InputRightElement` +
`Button`, `auth.js:26, 32, 119-141`); the confirm-password field lacks the
equivalent. Trivial mirror of the existing pattern onto the second field.

**Resolution:** did exactly that — a second `show2` state and its own
`handleClick2`/`InputRightElement`/`Button`, independent of the password
field's toggle. 1 new test (`auth.test.jsx`) asserting both toggles exist
and act independently.

### 33. Architecture docs describe a mobile app that doesn't exist yet ✅ Resolved

**Impact: low · Effort: S**

`architecture.md`'s system-context diagram and `README.md`'s "Companion apps"
note both describe a player-facing mobile app as an existing external system
that uploads kill photos. No such app currently exists — these docs describe an
aspirational/future architecture, not current reality. Worth a caveat in both
docs (or removing the claim until the app exists) so a new contributor doesn't
assume there's a live integration to build or test against.

**Resolution:** added explicit "does not currently exist" / "aspirational"
caveats to every place this repo claims the mobile app as a live
collaborator: `architecture.md`'s system-context diagram and prose,
`README.md`'s "Companion apps" note, `data-model.md`'s `photos` collection
description, and `game-flows.md`'s photo-moderation flow (including its
sequence diagram's participant label). The Discord-related env var got a
narrower caveat — "unconfirmed", not "doesn't exist", since unlike the
mobile app there's no positive evidence either way, just an unread
`.env` value.

### 35. Multi-word player names aren't normalized consistently ✅ Resolved

**Impact: low · Effort: S**

Found while fixing item 1, deliberately not fixed there — it's a distinct
edge case, not part of what that item's examples covered.

`trimmedNameLowerCase` (`dbCalls.js`'s `normalizePlayerName`) strips **all**
whitespace: `"Alice Smith"` → `"alicesmith"`. `ChatInput`'s `.toLowerCase()`
calls strip none. For a single-word name these produce the same key, which is
why item 1's fix is sufficient for every example in that item. For a
multi-word name entered via the command bar's bracket syntax —
`/kill [Alice Smith] bob` — `parseCommand` preserves the internal space
(`args[0]` = `"Alice Smith"`), so `.toLowerCase()` produces `"alice smith"`
(space preserved), which does not match the stored `"alicesmith"`. The same
class of silent failure as item 1, scoped to multi-word names specifically.

Fix shape: replace `ChatInput`'s scattered `.toLowerCase()` calls with the
same `normalizePlayerName` (or an equivalent shared helper) so both sides of
every comparison strip whitespace identically. Worth doing together with
`src/game/commands.js`, since that's where bracket syntax is parsed.

**Resolution:** extracted `normalizePlayerName` out of `dbCalls.js`'s
private scope into `src/game/playerNames.js` — a pure module, no Firebase,
matching this codebase's convention for shared logic. `dbCalls.js`,
`ChatInput.js` (every player-name-specific `.toLowerCase()`, not the
command/subcommand-token ones like `/mission done`/`end` or
`/openseason start`/`end`, which aren't names), and `executeKill.js` (the
target/assassin-list comparison) all import the same function now.
`src/game/commands.js` itself needed no change — `parseCommand` already
correctly preserves a multi-word name's internal space and leaves
normalization to the caller, per its own existing test comment. 4 new pure
unit tests (`playerNames.test.js`) and 1 new end-to-end regression test
(`ChatInput.test.jsx`, using real bracket syntax through the real
`handleCommandExecution`) — confirmed to fail against the pre-fix code
before confirming it passes against the fix.

### 36. `handleUnmapping` silently failed to unmap almost any real player ✅ Resolved

**Impact: high · Effort: S**

Found while investigating item 4 (kill atomicity) — a materially more
urgent bug in the same code path, not the one that investigation set out to
look for.

`handleUnmapping` (`src/utils/UnmapPlayers.js`, called by
`dbCalls.killPlayerForRoom` on every kill — both since deleted, superseded
by item 4's Cloud Function, which re-implements unmapping from scratch
inside its own transaction) looked its player up with
`where('name', '==', selectedPlayerName)` — the case-preserved `name`
field. Every caller passes an already-normalized name (lowercased,
whitespace-stripped, per items 1/35), so this query only ever matched a
player whose stored name happened to already be all-lowercase. For any
normally-capitalized name — which is to say, nearly every real player, typed
normally by a GM — the query came back empty, an error was logged, and the
function returned **before unmapping anything**: the victim's own
`targets`/`assassins` were never cleared, and every neighbor kept a stale
reference to a player who was actually dead. The kill itself still
succeeded (`isAlive: false`, score reset), so this was invisible to the GM.
Confirmed live against the emulator, not theoretical — every seeded test
fixture all session happened to use lowercase names, which is why this
never surfaced in the suite despite exercising `killPlayerForRoom`
extensively.

A second, independent bug in the same function: even once the right
document was found, the two array-filter comparisons
(`assassinTargets.filter((name) => name !== selectedPlayerName)`) compared
a case-preserved array entry (`"Bob"`) against the normalized input
(`"bob"`) directly — always unequal, so the stale reference was never
actually removed even when the lookup succeeded.

**Resolution:** both queries now use `where('trimmedNameLowerCase', '==',
normalizePlayerName(...))`, matching every other lookup in the codebase;
both filters now compare `normalizePlayerName(name)` on both sides. 4 new
emulator-backed tests (`src/utils/UnmapPlayers.integration.test.js`,
exercising `handleUnmapping` directly rather than only indirectly through
`killPlayerForRoom`), each independently verified to fail against the
pre-fix query and the pre-fix filter before confirming green against the
fix. `UnmapPlayers.js` and this test file were both later deleted as part
of item 4, once the Cloud Function re-implemented unmapping from scratch —
the fix is repinned there, in `executeKill.integration.test.js`'s
capitalized-name regression test.

### 37. Mission panel boundary extends past its neighbors ✅ Resolved

**Impact: low · Effort: S**

Found live-testing the mission modals (item 15's follow-up). `rightHandStack`
(the column holding `PhotosDisplay`) used `h: '100%'`, while
`playersListWrapper` and `logsWrapper` — its siblings in the same row — both
use `h: '95%'`. The mismatch made the photos box's border extend visibly
below the players/logs boxes next to it.

**Resolution:** `rightHandStack` now uses `h: '95%'`, matching its siblings
(`src/pages/GameMasterView.js`). No test — this codebase has no visual
regression coverage, and the fix is a one-line style value.

### 38. A failed mission submission burns a task index ✅ Resolved

**Impact: medium · Effort: S**

Live-reported: creating two missions produced indices 1 and 3, skipping 2.
`TaskCreation.js`'s `handleAddTask` called `fetchTaskIndexThenIncrement`
first, before any validation — task type selected, title non-blank, etc.
`fetchTaskIndexThenIncrement` atomically consumes the room's next index the
moment it's called, whether or not a task ends up created with it. A failed
first attempt (wrong task type, blank title, a duplicate title) still
consumed an index with no task ever using it, so the next successful
creation skipped a number.

**Resolution:** the index fetch moved to the last step in `handleAddTask` —
after every validation check and the dupe check have both passed, right
before `addTaskForRoom`. 3 new tests (`TaskCreation.test.jsx`) assert
`fetchTaskIndexThenIncrement` is not called when validation fails or a
duplicate is found, and is called exactly once on a successful submission —
each verified to fail against the pre-fix ordering before confirming green.

### 39. A mission that has already ended can still be completed ✅ Resolved

**Impact: medium · Effort: S**

Live-reported. `/mission end <index>` sets `isComplete: true`, but
`/mission done <player> <index>` never checked that flag — only whether
_that specific player_ had already completed the mission. A GM could run
`/mission done` against a mission they'd already closed, and it would still
award points or revive the player.

**Resolution:** `/mission done` now checks `task.isComplete` first and
rejects with `Mission {index} has already ended` if set
(`ChatInput.js`'s `/mission` case). 1 new regression test
(`ChatInput.test.jsx`), verified to fail against the pre-fix code (award
happens regardless) before confirming green.

### 40. Mission completions never show up in the chat log ✅ Resolved

**Impact: low · Effort: S**

Live-reported: `/mission end` logs "Completed task: {title}" when a mission
closes, but `/mission done` — an individual player completing it — logged
nothing at all, giving the GM no chat-visible confirmation that a
completion actually went through.

**Resolution:** `/mission done` now calls `addLog` with
`"{player} completed mission: {title}"` right after
`addPlayerToCompletedByForTask` succeeds. `addLog` is destructured from
`executionContext` in `ChatInput.js` alongside the switch's other handlers
— it wasn't imported there before. 1 new regression test, verified to fail
against the pre-fix code (no `addLog` call at all) before confirming green.

### 41. Missions have no way to cap how many players can complete them ✅ Resolved

**Impact: medium · Effort: M**

Feature request, live session: some missions should only be completable by
a fixed number of players (e.g. "first 5 to find this item") — once that
many have completed it, the mission should close itself automatically and
say so in the chat, with no way to complete it afterward.

**Resolution:** `TaskCreation.js` gained an optional `maxCompletions` field
— a `NumberInput` alongside the existing points field, blank/`null` by
default (unlimited, matching every mission created before this existed).
`/mission done` (`ChatInput.js`) checks
`task.completedBy.length + 1 >= task.maxCompletions` after a successful
completion; if reached, it calls the same `updateIsCompleteToTrueForTaskByIndex`
`/mission end` uses and logs
`Mission "{title}" auto-ended — reached its {N}-completion cap`. Once
closed this way, item 39's `isComplete` check already blocks any further
`/mission done` against it — no separate enforcement needed.
`TaskAccordion.js` now shows `Completions: {count}` (and `/ {max}` when
capped) so the GM can see progress toward the cap without doing the math
themselves. 4 new tests across `TaskCreation.test.jsx` (the field is
included/defaults to `null` correctly) and `ChatInput.test.jsx` (auto-ends
and announces at the cap, does not before it) — each verified to fail
against the pre-fix code before confirming green.

### 42. Chat autosuggest is stale by one keystroke, and has no Tab-to-complete ✅ Resolved

**Impact: low · Effort: S**

Feature request, live session: typing full commands in the GM chat bar is
slow; some way to accept a suggestion instead of typing it all out was
requested. Investigating surfaced a second, independent bug in the same
code: `onSuggestionsFetchRequested` (`ChatInput.js`) ignored the current
value `react-autosuggest` passes it as an argument and read the component's
own `value` state from its enclosing closure instead — which, because both
that callback and the `onChange` that updates `value` fire from the same
pre-re-render closure, was always one keystroke behind what was actually
typed. The suggestion list a GM saw never quite matched what they'd typed.

**Resolution (interim):** `onSuggestionsFetchRequested` now destructures
`value` from its argument instead of closing over stale state, and Tab
accepts the arrow-key-highlighted suggestion (or the first match) from a
whole-line autosuggest list matched against static command-help strings
like `/kill [player] [assassin]`.

**Resolution (final):** using it revealed the interim version still guessed
the _entire_ command in one Tab press, which wasn't what was wanted — a
follow-up request asked for real shell-style behavior: complete one
argument at a time, sourced from live data (actual player names, actual
mission indices) rather than static placeholder text. Replaced the
whole-line autosuggest matching with a pure per-argument completion engine,
`complete()` in `src/game/commandCompletion.js` (unit tested independently
in `commandCompletion.test.js`), per
`docs/superpowers/specs/2026-08-05-shell-style-command-completion-design.md`.
It tokenizes the input the same way `parseCommand` does, resolves only the
argument slot currently being typed, and completes to the longest prefix
shared by the remaining candidates — a unique match appends a trailing
space so typing continues straight into the next argument; an ambiguous
match stops at the shared prefix. Candidates come from `gameContext`'s live
player roster and, for `/mission …` slots, active mission indices fetched
on demand and cached for the typing session. See `docs/commands.md`'s
"Parser caveats" and "Implementation note" sections for the mechanism, and
`ChatInput.test.jsx`'s "Tab completion" block for the wiring-level
regression tests (including one for a bug this rewrite fixed along the
way: the old code blanket-trimmed the reconstructed input after every
accepted completion, which silently stripped that trailing space).

---

## Suggested sequencing

If this backlog gets picked up, the dependencies run roughly:

1. **Items 1 ✅, 19 ✅, 20, 21** — small, self-contained bug fixes with immediate GM-facing benefit.
2. **Item 14** — delete dead code first, so later refactors aren't navigating around it.
3. **Item 11 + 12** — extract the target graph to `src/utils/`, fixing the shuffle on the way.
4. **Item 18** — unit-test the extracted graph functions; this is the first point where tests are cheap to write.
5. **Items 2 ✅ + 3 ✅** — Firestore rules and route guards are both in place.
6. **Items 4 ✅ + 5 ✅ + 17 ✅** — consolidate kill handling into one transactional path, ideally server-side.
7. **Items 13 + 22** — move logs to a subcollection and collapse the three state sources into subscriptions.

Items 25 and 26 are independent of the rest and can happen at any point.
