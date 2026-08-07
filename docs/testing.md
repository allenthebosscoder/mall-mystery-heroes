# Testing strategy

**Status: phases 0–3 are implemented; phase 4 is still proposal.** This
document reviews why the architecture resisted testing, records the refactors
that unlocked it, and lays out what remains.

Companion reading: [architecture.md](./architecture.md) for the layer map,
[improvements.md](./improvements.md) for the bug backlog this plan is designed to
catch.

## What exists today

```
$ npm test
PASS unit src/game/commands.test.js
PASS unit src/game/commandCompletion.test.js
PASS unit src/utils/firebaseEnv.test.js
PASS unit src/utils/playerSession.test.js
PASS unit src/game/remapPlan.test.js
PASS unit src/game/targetGraph.test.js
PASS unit src/game/photoJudgments.test.js
PASS unit src/game/playerNames.test.js
PASS unit src/game/leaderboard.test.js
PASS unit functions/scheduledFunctions/selectExpiredRooms.test.js
PASS dom src/components/RequireAuth.test.jsx
PASS dom src/components/lobby_components/PlayerAddition.test.jsx
PASS dom src/components/logs_components/ChatInput.test.jsx
PASS dom src/components/photos_display_component/PhotosDisplay.test.jsx
PASS dom src/components/player_listing/PlayersList.test.jsx
PASS dom src/pages/GameMasterView.test.jsx
PASS dom src/pages/Homepage.test.jsx
PASS dom src/pages/Host.test.jsx
PASS dom src/pages/JoinGame.test.jsx
PASS dom src/pages/PlayerWaiting.test.jsx
PASS dom src/components/auth.test.jsx
PASS dom src/pages/NotFound.test.jsx
PASS dom src/components/header_components/Endgamebutton.test.jsx
PASS dom src/components/task_components/TaskCreation.test.jsx
PASS dom src/components/task_components/TaskList.test.jsx
PASS dom src/components/task_components/TaskCreationModal.test.jsx
PASS dom src/components/task_components/TaskListModal.test.jsx
PASS dom src/components/TargetGenerator.test.jsx

Test Suites: 28 passed, 28 total
Tests:       233 passed, 233 total
```

`npm run test:emulator` runs four further suites against the real Firestore,
Auth, and Functions emulators together — `dbCalls.integration.test.js` (27
tests), `executeKill.integration.test.js` (7 tests), `joinRoom.integration.test.js`
(7 tests), and `functions/scheduledFunctions/cleanupEndedRooms.integration.test.js`
(4 tests), 45 tests total.
`npm run test:rules` runs `test/firestore.rules.test.js` (34 tests) against
Firestore alone.

| Module                                                               | What it holds                                                                                                                                                                                | Tests |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `src/game/targetGraph.js`                                            | `maxTargetsFor`, `shuffle`, `buildTargetGraph`                                                                                                                                               | 19    |
| `src/game/remapPlan.js`                                              | `planRemap` — post-kill/revive matching, as a plan                                                                                                                                           | 16    |
| `src/game/commands.js`                                               | `parseCommand` for the GM command bar                                                                                                                                                        | 19    |
| `src/game/leaderboard.js`                                            | `buildLeaderboardStandings` — sorts and shapes standings for `/leaderboard` (item 21)                                                                                                        | 4     |
| `functions/scheduledFunctions/selectExpiredRooms.js`                 | `selectExpiredRooms` — pure room-retention selection, given `now` injected rather than read internally (item: player access/room lifecycle)                                                  | 6     |
| `src/utils/firebaseEnv.js`                                           | Config reading, emulator flag, production guard                                                                                                                                              | 9     |
| `src/game/photoJudgments.js`                                         | `splitPhotosByStatus` (item 6)                                                                                                                                                               | 5     |
| `dbCalls.integration.test.js`                                        | The data layer against the Firestore emulator                                                                                                                                                | 27    |
| `executeKill.integration.test.js`                                    | The `killPlayer` Cloud Function via `httpsCallable` (item 4): validation, both open-season directions, case-insensitivity, unmapping, remap, host-only auth                                  | 7     |
| `joinRoom.integration.test.js`                                       | The `joinRoom` Cloud Function via `httpsCallable` (player access/room lifecycle): self-registration, duplicate name rejection, Lobby-phase gating, argument validation, ended-room rejection | 7     |
| `functions/scheduledFunctions/cleanupEndedRooms.integration.test.js` | The `cleanupEndedRooms` scheduled function via `firebase-functions-test` `wrap()`: room selection decision and actual deletion via the Admin SDK                                             | 4     |
| `test/firestore.rules.test.js`                                       | Security rules against the Firestore emulator                                                                                                                                                | 34    |
| `src/utils/playerSession.test.js`                                    | `savePlayerSession`/`loadPlayerSession`/`clearPlayerSession` — localStorage round-trip, malformed JSON, missing fields (item: join-flow UI and room scoping)                                 | 5     |
| `src/pages/Homepage.test.jsx`                                        | "Host Game"/"Join Game" landing, redirecting straight to `/rooms/:roomID/waiting` when a player session is already stored (item: join-flow UI and room scoping)                              | 4     |
| `src/pages/Host.test.jsx`                                            | Today's old `Homepage` (Log In / Sign Up choice), renamed and moved to `/host` (item: join-flow UI and room scoping)                                                                         | 2     |
| `src/pages/JoinGame.test.jsx`                                        | Player self-registration form: success, whitespace trimming, and the room-not-found/already-started/inactive/name-taken error paths (item: join-flow UI and room scoping)                    | 6     |
| `src/pages/PlayerWaiting.test.jsx`                                   | Post-join waiting screen: live status once `gameStarted` flips, redirect home if the room disappears, Leave clears the session (item: join-flow UI and room scoping)                         | 4     |
| `PlayerAddition.test.jsx`                                            | The `dom` project's first test — see below                                                                                                                                                   | 3     |
| `ChatInput.test.jsx`                                                 | `/kill`, `/add` case-insensitivity (item 1); items 4, 5, 8, 10, 20, 21, 35; `/mission start`/`/mission view` opening the mission modals                                                      | 16    |
| `RequireAuth.test.jsx`                                               | Route guard spinner/redirect/render states (item 3)                                                                                                                                          | 3     |
| `PhotosDisplay.test.jsx`                                             | Reload-recovery for photo undo (item 6); validation and Cloud Function response routing (items 4, 5)                                                                                         | 5     |
| `PlayersList.test.jsx`                                               | Presentational rendering, now that it takes `players` as a prop (item 13)                                                                                                                    | 4     |
| `GameMasterView.test.jsx`                                            | Live header count and alive-only roster derivation (item 13)                                                                                                                                 | 3     |
| `src/game/playerNames.js`                                            | `normalizePlayerName` (item 35)                                                                                                                                                              | 4     |
| `auth.test.jsx`                                                      | Confirm-password show/hide toggle (item 32)                                                                                                                                                  | 1     |
| `NotFound.test.jsx`                                                  | 404 route content (item 30)                                                                                                                                                                  | 1     |
| `Endgamebutton.test.jsx`                                             | Only navigates away once `endGame` resolves; alerts instead of navigating on failure (item 10)                                                                                               | 2     |
| `TaskCreation.test.jsx`                                              | Mission panel restored (item 15): create end to end, duplicate rejection, validation, failure toast                                                                                          | 4     |
| `TaskList.test.jsx`                                                  | Mission panel restored (item 15): active/completed split, doesn't crash when the fetch rejects                                                                                               | 2     |
| `TaskCreationModal.test.jsx`                                         | Item 15's mission modal follow-up: renders `TaskCreation` when open, renders nothing when closed, closes on the Close button, forwards a successful creation to `handleNewTaskAdded`         | 4     |
| `TaskListModal.test.jsx`                                             | Item 15's mission modal follow-up: renders `TaskList` when open, renders nothing when closed, closes on the Close button                                                                     | 3     |

The first six modules are pure and run in Jest's `node` project with no
mocks and no Firebase; the rest need the emulator (`integration`, `rules`) or
jsdom (`dom`). The components now call into the pure modules rather than
carrying their own copies:

- `TargetGenerator.js` and `ResetTargetsButton.js` both call `buildTargetGraph`;
  their two ~120-line duplicate implementations are gone.
- `RemapPlayers.js` is now a thin I/O shell — fetch the roster once via the new
  `fetchAliveRosterForRoom`, call `planRemap`, apply the writes.
- `ChatInput.js` calls `parseCommand`; its inline regex, its private
  `sanityCheckCommandInputs` whitelist, and the redundant `if/else` wrapper
  around the whole switch are gone.

Two behaviour changes came with this, both intended:

1. **Pressing Enter on an empty command box no longer throws** (backlog item 19).
2. **`npm start` and `npm run build` no longer decide emulator targeting from
   `NODE_ENV`.** It is now the explicit `REACT_APP_USE_EMULATORS` flag, set in
   the new `.env.development` (loaded by the dev server only). Verified in both
   directions: the dev config resolves the flag to `true`, and the production
   bundle contains no literal bake of it.

## Running the tests

```bash
npm test              # unit + dom projects. No emulator, no network.
npm run test:emulator # integration project, against firestore+auth+functions emulators, started and torn down around it
```

`npm test` deliberately excludes the integration project so the default loop
needs nothing running. Both are separate CI jobs.

The filename suffix routes a test to its project: `*.test.js` under `src/game/`
or `src/utils/` is a pure unit test, `*.test.jsx` is a jsdom component test, and
`*.integration.test.js` needs the emulator.

Integration tests run against project id `demo-mall-mystery-heroes`. The
Firebase tooling treats a `demo-` prefix as emulator-only and refuses to reach a
real backend with it, which is a second independent guard alongside the
`NODE_ENV=test` check in `firebaseEnv.js`.

---

## Where things stood (the starting point)

Everything from here to the end of Part 5 describes the codebase as found. It is
kept because the reasoning still explains why the current structure is shaped the
way it is; the ✅ markers in Part 5 note what has since been done.

`jest.config.js`, `jest.setup.js`, `jest.polyfills.js`, and `babel.config.js`
configured Jest, Testing Library, jsdom, and `collectCoverage: true`. There were
zero test files, and the config was not wired to anything:

```
$ CI=true npx react-scripts test --watchAll=false
No tests found, exiting with code 1
  47 files checked.
  testMatch: .../src/**/__tests__/**/*.{js,jsx,ts,tsx}, .../src/**/*.{spec,test}.{js,jsx,ts,tsx} - 0 matches
```

Note the `testMatch` — those are Create React App's built-in defaults, not
anything from `jest.config.js`. `npm test` runs `react-scripts test`, which uses
its own embedded Jest config and never reads the standalone one. Three of the
four config files in the repository root are dead.

Three concrete defects in the harness itself:

| Problem                  | Detail                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner version conflict  | Root `devDependencies` pin `jest@^27.5.1` (27.5.1 installed) while `jest-environment-jsdom@^29.7.0` and `jest-fixed-jsdom` sit in `dependencies`. A Jest 29 environment cannot run under a Jest 27 runner.                 |
| Undeclared dependency    | `jest.polyfills.js` does `require("undici")`. `undici` is not in `package.json` — it resolves only transitively today.                                                                                                     |
| Unreferenced setup files | `jest.config.js` declares no `setupFiles` or `setupFilesAfterEach`, so `jest.setup.js` and `jest.polyfills.js` would not load even if the config were used. Only `src/setupTests.js` is live (CRA loads it by convention). |

So the first task is not "write tests" — it is "make one test able to run at
all."

---

## Part 1 — Why this codebase is hard to test

Five structural obstacles, in the order they will bite you.

### 1. Importing anything data-related boots a real Firebase app

`src/utils/firebase.js:17-30` calls `initializeApp()` at module scope and wires
emulators only when `process.env.NODE_ENV === 'development'`.

```js
const app = initializeApp(firebaseConfig);   // module scope — runs on import
...
if (process.env.NODE_ENV === 'development') {
    connectFirestoreEmulator(db, "localhost", 8081);
    ...
}
```

Jest sets `NODE_ENV=test`. Not `development`. So **any test that transitively
imports `dbCalls.js` initializes a Firebase client pointed at the real
`mall-mystery-heroes` project**, using whatever is in `.env`. A test that
accidentally performs a write writes to production — and per `.firebaserc`, the
`dev` and `prod` aliases point at that same project, so there is no safe target
to fall back to.

This is the single most urgent item in the document, and it is a hazard whether
or not you ever write a test.

### 2. The game rules live inside React component closures

The target-assignment algorithm — the most rule-dense, most regression-prone code
in the repository — is not callable without rendering a component:

| Location                                    | Shape                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `TargetGenerator.js:68` `InitializeTargets` | Closure over `useState` setters, not exported, no return value — it writes to `setPlayerData` / `setTargetMap` |
| `ResetTargetsButton.js:35`                  | A near-identical ~120-line copy, same problem                                                                  |
| `RemapPlayers.js:23-173`                    | A factory returning an async function that interleaves Firestore reads and writes into the matching loop       |

To test "does a 7-player room give everyone exactly 2 targets and nobody
themselves?" today, you must render `<TargetGenerator>`, click through a Chakra
`AlertDialog`, and mock `updateTargetsForPlayer`. To assert the resulting graph
you would have to scrape it out of a rendered `<Table>`. That is a
five-times-more-expensive test than the logic warrants, and it is why no such
test exists.

### 3. The command interpreter is a 250-line private async switch

`ChatInput.js:108` `handleCommandExecution` is module-private and does parsing,
validation, roster fetching, ~10 distinct Firestore call sequences, toast
notifications, and optimistic state updates in one function body.

There is no way to ask "what does `/kill alice bob` parse to?" or "does `/add
alice notanumber` reject?" without rendering `<ChatInput>` inside two context
providers and mocking every import on line 6 (there are 18 of them).

### 4. Decisions are interleaved with I/O

`RemapPlayers.js:37-52` issues a `fetchPlayerForRoom` **per candidate, inside a
nested loop**, and evaluates the eligibility rules against the freshly-fetched
document:

```js
for (const possibleTarget of randomizedAlivePlayers) {
    const possibleTargetDoc = await fetchPlayerForRoom(possibleTarget, roomID);
    ...
    if (possibleTargetData.assassins.length >= MAXTARGETS || ...) continue;
    newTargetArray.push(possibleTarget);
    await updateAssassinsForPlayer(...);   // write, mid-decision
}
```

The eligibility rules are the thing worth testing. They are inseparable from the
round trips. Any test of them is really a test of a Firestore mock.

### 5. Non-determinism has no seam

`Math.random()` is called directly in all three shuffle copies;
`serverTimestamp()` is called directly in `dbCalls.js`. Neither can be pinned, so
even after extraction the target-graph functions would produce unrepeatable
output.

### Bonus: three sources of truth make component assertions meaningless ✅ done

Per [architecture.md](./architecture.md#state-management), `GameMasterView`'s
player arrays are fetched once on mount and thereafter mutated optimistically,
`PlayersList`/`PhotosDisplay` use live `onSnapshot`, and the header count comes
from router state. A component test asserting "after `/kill alice`, the roster
shows 6" is asserting against local state that Firestore may already disagree
with. Until item 13 in the backlog is fixed, high-level component tests will
encode the bug rather than catch it.

Item 13 is fixed now — `GameMasterView` subscribes live, the same as
`PlayersList`/`PhotosDisplay` already did. See its resolution in
[improvements.md](./improvements.md) and the design doc it links to. This
section is kept for the historical reasoning; `GameMasterView.test.jsx` and
`PlayersList.test.jsx` are the component tests this section says were
meaningless to write before.

---

## Part 2 — Refactors that unlock testing

Each of these is small and independently valuable. They are ordered so that each
one makes the next cheaper.

### R1 — Make Firebase init lazy and emulator-targeting explicit

Split `utils/firebase.js` into config and instance:

- Key emulator connection on an explicit `REACT_APP_USE_EMULATORS` flag, not on
  `NODE_ENV`. This also fixes backlog item 25 (you currently cannot point `npm
start` at a real project without editing source).
- Export a `getDb()` accessor rather than a module-scope `db`, or guard
  initialization behind `getApps().length ? getApp() : initializeApp(...)`.
- Have `dbCalls.js` take its `db` from that accessor, so a test can point it at
  an emulator instance before the first call.

Non-negotiable acceptance criterion: **importing `dbCalls.js` under `NODE_ENV=test`
must not be able to reach production.** Simplest enforcement is a hard throw in
`utils/firebase.js` when `NODE_ENV === 'test'` and no emulator host is set.

### R2 — Extract the target graph to `src/game/targetGraph.js`

Pure functions, no Firestore, no React, injectable randomness:

```js
export const maxTargetsFor = (playerCount) =>
    playerCount > 15 ? 3 : (playerCount > 5 ? 2 : 1);

export const shuffle = (array, rng = Math.random) => { ... };

// players: string[]  ->  { targets: Map<string,string[]>, assassins: Map<...> }
export const buildTargetGraph = (players, { rng = Math.random } = {}) => { ... };

// Returns a PLAN, does not write. state is the in-memory roster.
// -> { targetWrites: [{player, targets}], assassinWrites: [...], logs: [...] }
export const planRemap = (state, { needTargets, needAssassins, rng }) => { ... };
```

The `planRemap` shape is the important idea: **separate deciding from writing.**
The caller takes the returned plan and hands it to `dbCalls` (ideally as one
`writeBatch`, which also addresses backlog item 4). The decision logic then tests
as data-in/data-out with no mocks at all, and the write path tests separately
against the emulator.

This collapses three divergent copies into one (backlog item 11) and makes the
shuffle bug below detectable.

### R3 — Extract command parsing to `src/game/commands.js`

```js
// '/kill Alice Bob' -> { ok: true, command: '/kill', args: ['Alice','Bob'] }
// ''                -> { ok: false, error: 'EMPTY' }
// '/nonsense'       -> { ok: false, error: 'UNKNOWN_COMMAND', command: '/nonsense' }
export const parseCommand = (input) => { ... };
```

Pure, synchronous, ~20 lines, and it immediately covers backlog items 19
(empty input throws a `TypeError` because `.map()` runs before the `!parts`
guard — `ChatInput.js:112-113`) and 21 (silent no-ops).

### R4 — Give the command executor an injected dependency object

Turn `handleCommandExecution` into an exported function whose Firestore and UI
collaborators arrive as a parameter:

```js
export const executeCommand = (parsed, { roomID, db, handlers, alert, rng, clock }) => ...
```

`ChatInput` becomes a thin component that parses, calls `executeCommand`, and
clears the input. Every command path then tests with a hand-written fake `db`
object — no `jest.mock` of 18 imports, no rendering.

### R5 — Fix the `dbCalls` return contract ✅ done

Every function currently wraps its body in `try/catch`, logs, and returns
`undefined` (backlog item 10). Callers never check, so failures surface as
`TypeError` on `.docs[0]` somewhere unrelated. This is also untestable: you
cannot assert "this call failed" when success and failure both return
`undefined`.

Let them throw. Handle at the call site with the existing `CreateAlert` toast.

Done in two passes — see [improvements.md item 10](./improvements.md) for
the full writeup of both. Every `dbCalls.js` function now either throws on
failure or, for the handful of synchronous query-builder functions that
never touched the network in the first place, never had a real failure mode
to catch.

### R6 — Unify the two kill paths ✅ done

Backlog item 5: `PhotosDisplay.handlePass` (`PhotosDisplay.js:44`) kills without
validating the target is on the assassin's list and without remapping, while
`/kill` does both. Extract one `executeKill(target, assassin, roomID, deps)` used
by both. Right now there is no single function to point a test at — which is
exactly why the two paths were allowed to diverge.

Landed as `src/components/executeKill.js`, with the dependency-object idea
from R4 narrowed to just what this function needs rather than the full
command executor. See [improvements.md item 5](./improvements.md) for the
full writeup and its test coverage across Layers 1 and 3.

---

## Part 3 — Fixing the harness

**Recommendation: move to standalone Jest with two projects, and delete the CRA
test path.**

CRA's runner cannot see `functions/`, cannot run node-environment tests, and is
unmaintained. Two `projects` in one config gets both environments from one `npm
test`:

```js
// jest.config.js
module.exports = {
    projects: [
        {
            displayName: 'unit',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/src/game/**/*.test.js', '<rootDir>/functions/**/*.test.js'],
        },
        {
            displayName: 'dom',
            testEnvironment: 'jsdom',
            setupFilesAfterEach: ['<rootDir>/src/setupTests.js'],
            testMatch: ['<rootDir>/src/**/*.test.jsx'],
        },
    ],
};
```

Required cleanup, all mechanical:

1. Align on `jest@^29` in `devDependencies` (matching the already-installed
   `jest-environment-jsdom@29`). Remove `jest`, `jest-environment-jsdom`, and
   `jest-fixed-jsdom` from `dependencies` — they are dev tools.
2. Add `undici` to `devDependencies` or drop `jest.polyfills.js`. You only need
   it if you adopt MSW; there is no HTTP layer in this app to mock, so **drop
   it**.
3. Delete `jest.setup.js` (its two lines are redundant with `jest.polyfills.js`
   and with Node 20 globals).
4. Turn off `collectCoverage: true` as a default. Coverage on every run, on a
   repo with three tests, produces a wall of 0% noise. Put it behind
   `npm run test:coverage`.
5. Scripts:
    ```json
    "test":           "jest",
    "test:watch":     "jest --watch",
    "test:coverage":  "jest --coverage",
    "test:emulator":  "firebase emulators:exec --only firestore,auth,storage 'jest --selectProjects integration'",
    "test:rules":     "firebase emulators:exec --only firestore 'jest --selectProjects rules'"
    ```

**Cheaper alternative** if the standalone move feels like too much up front: keep
`react-scripts test`, delete `jest.config.js` / `jest.setup.js` /
`jest.polyfills.js` outright, and put unit tests in `src/**/*.test.js`. This
works today with zero configuration. The cost is that `functions/` and
emulator-backed tests stay untestable, so you will make the move eventually.

---

## Part 4 — What gets tested, in what layer

### Layer 0 — Pure unit (node env, no mocks) · **highest value, start here**

Targets: `src/game/targetGraph.js`, `src/game/commands.js`, `maxTargetsFor`,
log-message formatting.

Properties worth asserting on the target graph, for rosters of 3, 6, 16, and 20:

- every alive player has exactly `maxTargetsFor(n)` targets (or the documented
  fallback count)
- nobody targets themselves
- the `targets` and `assassins` maps are mutually consistent — `b ∈ targets[a]`
  iff `a ∈ assassins[b]`
- no player accumulates more than `MAXTARGETS` assassins
- with a seeded `rng`, output is byte-identical across runs
- with `rng = Math.random`, a 3-player shuffle produces all 6 permutations at
  roughly equal frequency

That last one catches a live bug — see the finding below.

### Layer 1 — Data layer against the Firestore emulator (node env)

Target: `dbCalls.js`. Seed a room, call the function, read back, assert.

This is the layer that catches **schema drift**, which is the actual dominant bug
class here. Backlog item 1 — commands silently failing because `ChatInput`
lowercases names while `dbCalls` queries the case-preserved `name` field instead
of the `trimmedNameLowerCase` field that `addPlayerForRoom` already writes — is
precisely a test in this layer: `addPlayerForRoom('Alice')` then
`fetchPlayerForRoom('alice')` should not return `undefined`.

Since the data model is only recorded in `data-model.md` and reconstructed from
call sites, these tests double as the executable schema the repository lacks.

All `*.integration.test.js` files share one emulator backend process
(`firebase emulators:exec` starts it once for the whole `npm run
test:emulator` run), and `clearFirestore()` wipes the _entire_ emulator, not
just the calling file's room. Jest runs separate test files in parallel
workers by default, so two files clearing/seeding concurrently can clobber
each other mid-test — this surfaced as spurious `PERMISSION_DENIED` failures
once a second integration file (`executeKill.integration.test.js`) existed
alongside `dbCalls.integration.test.js`. Fixed by running both `test:emulator`
and `test:rules` with `--runInBand`, serializing test files within that one
project selection; since each script only ever selects its own single Jest
project, this doesn't slow down `npm test`'s `unit`/`dom` projects, which
never run in the same invocation.

### Layer 1b — Cloud Functions, against the Functions, Firestore, and Auth emulators together

Targets: `functions/callableFunctions/killPlayer.js` (backlog item 4),
`functions/callableFunctions/joinRoom.js`, and
`functions/scheduledFunctions/cleanupEndedRooms.js` (player access/room
lifecycle).

`executeKill.integration.test.js` and `joinRoom.integration.test.js` both
call their function exactly the way the real app does — through
`httpsCallable`, via a thin wrapper (`src/components/executeKill.js`,
`src/components/joinRoom.js`) — rather than importing the function's
internals and invoking them directly (the `firebase-functions-test`
shortcut this repo's devDependencies would otherwise support). That keeps
the same "test through the real interface" stance Layer 1 already takes
with `dbCalls.js`: assertions read back what actually landed in Firestore
after a real callable-function HTTP round trip, not what the function's
return value merely claims happened.

`cleanupEndedRooms.integration.test.js` is the one exception: a scheduled
function has no client-facing callable interface to go through — its only
real caller is Cloud Scheduler. It uses `firebase-functions-test`'s
`wrap()` to invoke the `.onRun()` handler directly instead, the first use
of that shortcut in this repo, reserved for exactly the case Layer 1's
"real interface" stance can't apply to.

This requires the `functions` emulator running alongside `firestore` and
`auth` — `test:emulator`'s `--only` flag lists all three. A second helper,
`callableAsNonHost` (`test/emulatorHelpers.js`), spins up a second, separate
Firebase app instance signed in as a different anonymous user, so
`killPlayer.js`'s host-only authorization check (re-implemented there,
since the Admin SDK it runs under bypasses `firestore.rules` entirely) has
something real to reject. `joinRoom` has no equivalent check to test this
way — any signed-in caller may call it, by design.

`functions/` has its own lint config and script (`functions/.eslintrc.json`,
`npm run lint` from inside `functions/`) but no separate unit-test runner —
`functions/**/*.test.js` rides the same `unit` Jest project as everything
else. The pure modules `functions/` imports or contains
(`src/game/{remapPlan,targetGraph,playerNames}.js`,
`functions/scheduledFunctions/selectExpiredRooms.js`) are covered there.
`killPlayer.js` and `joinRoom.js` themselves have no logic that isn't more
accurately exercised end-to-end at this layer; `cleanupEndedRooms.js`
splits the difference — its room-selection decision is pure and unit
tested, its actual Firestore reads/deletes are exercised here.

### Layer 2 — Security rules ✅

`firestore.rules` exists (`test/firestore.rules.test.js`, run via `npm run
test:rules`), scoped to the room's host via `hostId`. As anticipated, this
gives the highest security-per-line-of-test ratio in the suite:

- unauthenticated read of `rooms/{id}/players` → denied
- a signed-in stranger — neither the room's host nor a player who has
  joined it — reading `rooms/{id}` or any of its five subcollections →
  denied, as of docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-
  scoping-design.md. Previously this was "any signed-in user," full stop —
  the gap that let a guest from one room read another room's data just by
  knowing its ID.
- a player present in the room's `joinedUids` reading the same → allowed
- authenticated non-host write to another room's player → denied
- host write to own room → allowed
- client write to `points` → **still allowed**. Kills specifically no
  longer take this path — they run server-side via `killPlayer` (item 4,
  Layer 1b above), which the Admin SDK exempts from these rules entirely —
  but every other player write (task-completion scoring, manual target
  reset, open-season toggling) still goes through the client SDK, so a
  signed-in host can still write `points` directly outside a kill. This
  rules test still intentionally passes for that reason, not because it's
  stale.

`photos` and `playerMessages` are scoped to "host or player of this room"
for reads, host-only for writes — not to a distinct per-uploader identity,
since no photo-upload code exists in this repository yet (backlog item 33).

`storage.rules` requires `request.auth != null` but is not scoped per-room
or per-player the way `firestore.rules` now is — no photo-upload code exists
yet to scope a rule against; see backlog item 2 and docs/superpowers/specs/
2026-08-07-join-flow-ui-and-room-scoping-design.md.

Adding real rules broke the Layer 1 suite's assumption that `dbCalls` could
write unauthenticated: `test/emulatorHelpers.js` now signs in an anonymous
user once per run and uses that uid as every seeded room's `hostId`, and
`test:emulator` starts the `auth` emulator alongside `firestore` to make that
possible.

### Layer 3 — Component tests (jsdom, Testing Library)

Keep these few and shallow.

- `PlayerAddition` ✅ — `PlayerAddition.test.jsx` (`dom` project's first test,
  mocks `dbCalls`). Covers the in-flight submit guard added alongside backlog
  item 34, plus clearing/re-enabling on success and failure.
- `ChatInput` ✅ (partial) — `ChatInput.test.jsx` drives the real
  `handleCommandExecution` switch (mocking only `dbCalls` and `RemapPlayers`)
  for the `/kill` and `/add` case-insensitivity fixes from backlog item 1.
  `jest.mock('../firebase_calls/dbCalls')` must use an explicit factory, not
  auto-mock — auto-mocking still loads the real module, which pulls in
  `utils/firebase.js`'s real init and touches `fetch`, undefined in jsdom.
  Note: `getByPlaceholderText`/`findByPlaceholderText` did not reliably match
  `react-autosuggest`'s rendered `<input>` in this environment despite the
  attribute being present; `getByRole('textbox')` does.
- `RequireAuth` ✅ — `RequireAuth.test.jsx` (backlog item 3). Mocks
  `firebase/auth`'s `onAuthStateChanged` and `utils/firebase`'s `auth` export
  (same explicit-factory reason as `ChatInput.test.jsx`). Covers the loading
  spinner, rendering children when signed in, and redirecting to `/` when not.
- `PhotosDisplay` ✅ — `PhotosDisplay.test.jsx` (backlog item 6). Mocks
  `firebase/firestore`'s `onSnapshot` directly (not just `dbCalls`) to
  simulate what a snapshot reports on mount. The key test never clicks
  Approve — it mounts with an already-`approved` photo and proves Undo can
  still revert it, which is the actual reload-recovery scenario item 6 was
  about, not just "does the button work."

Other good candidates:

- `ChatInput` — the remaining commands (`/mission done`, `/revive`,
  `/openseason`) aren't covered yet; Enter on an empty box does not throw;
  unknown command toasts
- `PlayersList` — renders a supplied roster, alive and dead sections separated

Do **not** write component tests that assert game-state outcomes until backlog
item 13 (three disagreeing state sources) is fixed. They will encode the bug.

### Layer 4 — Flow tests (node env, emulator)

One test per flow in [game-flows.md](./game-flows.md), driving the extracted
handlers directly with no React in the picture: host room → add players →
generate targets → kill → assert the graph is still consistent → revive → assert
again.

The consistency assertion from Layer 0 is reused here as the oracle. This is the
layer that would have caught the `/kill`-vs-photo-approval divergence.

---

## Part 5 — Phasing

| Phase    | Work                                                                       | Effort   |
| -------- | -------------------------------------------------------------------------- | -------- |
| **0** ✅ | R1 (emulator safety + explicit flag), harness cleanup, CI green            | done     |
| **1** ✅ | R2 + R3 extractions; Layer 0 tests for target graph, remap planner, parser | done     |
| **2**    | Layer 1 emulator tests for `dbCalls`; `test:emulator` script               | 1–2 days |
| **3** ✅ | Write `firestore.rules`; Layer 2 rules tests                               | done     |
| **4**    | R4 + R5 + R6; Layer 4 flow tests; a handful of Layer 3 component tests     | 2–3 days |

Phase 4 is the natural next step. The `dom` Jest project and its asset stubs are
configured but still match no files, and `planRemap`'s output gives the phase 4
flow tests a ready-made oracle.

Phase 0 is worth doing on its own merits even if the rest is never picked up —
it closes the "tests can write to production" hole.

### CI

No `.github/` directory exists. A single workflow on push and PR:

- job `unit`: Node 20, `npm ci`, `npm test` — runs on every push, no external
  services
- job `integration`: adds `firebase-tools` and a JRE, runs `npm run test:emulator`
  and `npm run test:rules`

Keep them separate so a slow or flaky emulator never blocks the fast feedback
loop.

---

## Part 6 — A finding that motivates Phase 1

While reviewing the shuffle implementations for this proposal, I ran all three
variants 600,000 times each on a 3-element array:

```
TargetGenerator / ResetTargetsButton  (i < array.length - 1)
  {"BAC": 299932, "ABC": 300068}                                  ← 2 of 6 permutations

RemapPlayers                          (i < array.length)
  {"BAC":99941, "CAB":99968, "ABC":100662, "CBA":99443, "BCA":100163, "ACB":99823}
```

`RemapPlayers`' version is a correct uniform shuffle. The version used for
**initial target assignment** is not merely biased — with the loop stopping at
`length - 1`, the final player is never swapped out of the last position, and for
n=3 only two of six orderings are reachable at all. Initial target assignment is
substantially less random than intended, and predictably so.

This also corrects [improvements.md](./improvements.md) item 12, which had the
two variants backwards and described the correct one as biased. A ten-line
property test would have settled it in seconds, which is the argument for Phase 1
in miniature.

---

## Part 7 — Non-goals

Explicitly not worth the effort here:

- **Snapshot tests of JSX.** Chakra-heavy markup, high churn, near-zero signal.
- **Testing the Firebase SDK.** Mocking `getDocs` to assert `getDocs` was called
  proves nothing. Emulator or nothing.
- **`src/components/old-components/`** (8 files, ~600 lines, imports already
  broken). Deleted rather than tested (backlog item 14).
- **Coverage thresholds on day one.** Set them after Phase 2, and only on
  `src/game/`, where 90%+ is both achievable and meaningful.
- **End-to-end browser tests.** Not until state management is consolidated;
  before that they will be flaky for real reasons.
