# Testing strategy

**Status: proposal.** Nothing here is implemented. This document reviews why the
current architecture resists testing, proposes the refactors that unlock it, and
lays out a phased plan.

Companion reading: [architecture.md](./architecture.md) for the layer map,
[improvements.md](./improvements.md) for the bug backlog this plan is designed to
catch.

---

## Where things stand

`jest.config.js`, `jest.setup.js`, `jest.polyfills.js`, and `babel.config.js`
configure Jest, Testing Library, jsdom, and `collectCoverage: true`. There are
zero test files, and the config is not wired to anything:

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

### Bonus: three sources of truth make component assertions meaningless

Per [architecture.md](./architecture.md#state-management), `GameMasterView`'s
player arrays are fetched once on mount and thereafter mutated optimistically,
`PlayersList`/`PhotosDisplay` use live `onSnapshot`, and the header count comes
from router state. A component test asserting "after `/kill alice`, the roster
shows 6" is asserting against local state that Firestore may already disagree
with. Until item 13 in the backlog is fixed, high-level component tests will
encode the bug rather than catch it.

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

### R5 — Fix the `dbCalls` return contract

Every function currently wraps its body in `try/catch`, logs, and returns
`undefined` (backlog item 10). Callers never check, so failures surface as
`TypeError` on `.docs[0]` somewhere unrelated. This is also untestable: you
cannot assert "this call failed" when success and failure both return
`undefined`.

Let them throw. Handle at the call site with the existing `CreateAlert` toast.

### R6 — Unify the two kill paths

Backlog item 5: `PhotosDisplay.handlePass` (`PhotosDisplay.js:44`) kills without
validating the target is on the assassin's list and without remapping, while
`/kill` does both. Extract one `executeKill(target, assassin, roomID, deps)` used
by both. Right now there is no single function to point a test at — which is
exactly why the two paths were allowed to diverge.

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

### Layer 2 — Security rules

Blocked on backlog item 2: there is no `firestore.rules` file at all, and
`storage.rules` is `allow read, write: if true` on every path. Once rules exist,
`@firebase/rules-unit-testing` gives you the highest security-per-line-of-test
ratio available:

- unauthenticated read of `rooms/{id}/players` → denied
- authenticated non-host write to another room's player → denied
- host write to own room → allowed
- client write to `points` → denied (once scoring moves server-side)

### Layer 3 — Component tests (jsdom, Testing Library)

Keep these few and shallow. Good candidates:

- `ChatInput` — Enter on an empty box does not throw; unknown command toasts
- `PhotosDisplay` — approve/deny/undo call the injected handlers with the right
  arguments, given a fake snapshot
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

| Phase | Work                                                                                  | Effort   |
| ----- | ------------------------------------------------------------------------------------- | -------- |
| **0** | R1 (emulator safety + lazy init), harness cleanup, one trivial passing test, CI green | ½ day    |
| **1** | R2 + R3 extractions; Layer 0 tests for target graph and parser                        | 1 day    |
| **2** | Layer 1 emulator tests for `dbCalls`; `test:emulator` script                          | 1–2 days |
| **3** | Write `firestore.rules`; Layer 2 rules tests                                          | 1 day    |
| **4** | R4 + R5 + R6; Layer 4 flow tests; a handful of Layer 3 component tests                | 2–3 days |

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
- **`src/components/old-components/`** (8 files, ~600 lines). Its imports are
  already broken. Delete it (backlog item 14) rather than test it.
- **Coverage thresholds on day one.** Set them after Phase 2, and only on
  `src/game/`, where 90%+ is both achievable and meaningful.
- **End-to-end browser tests.** Not until state management is consolidated;
  before that they will be flaky for real reasons.
