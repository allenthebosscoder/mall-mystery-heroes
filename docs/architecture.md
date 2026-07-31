# Architecture

## What this system is

Mall Mystery Heroes is a **Game Master (GM) console** for running a live-action
"assassin" game. Players are assigned targets, hunt each other in the real world,
submit photo proof of kills, and earn points. The GM sits at a laptop and drives
the whole game from a single screen.

The web app in this repository is *only* the GM console. It is a Create React App
single-page application that talks **directly to Firebase**. There is effectively
no backend of our own — see [Cloud Functions](#cloud-functions) below.

## System context

```
┌─────────────────────┐         ┌──────────────────────────────┐
│  GM console         │────────▶│  Firebase                    │
│  (this repo)        │         │                              │
│  React SPA          │◀────────│  · Auth (email/password)     │
└─────────────────────┘         │  · Firestore  (game state)   │
                                │  · Storage    (kill photos)  │
┌─────────────────────┐         │  · Functions  (stub only)    │
│  Player mobile app  │────────▶│                              │
│  (NOT in this repo) │         └──────────────────────────────┘
└─────────────────────┘
```

Two collaborators exist outside this repository:

- **A player-facing mobile app.** It is never referenced in code, but its
  existence is implied: `dbCalls.js` has a helper explicitly commented
  `// adds photo for testing without mobile app`, and the `photos` collection is
  read but only ever written by that test helper. The mobile app is what uploads
  kill-proof photos.
- **Something Discord-related.** `.env` carries a `DISCORD_TOKEN` that no code in
  this repository reads. Presumably a bot that broadcasts game events; the
  unimplemented `/broadcast`, `/leaderboard`, and `/whisper` commands are the
  likely intended integration point.

Neither is versioned here, so neither is documented further. Treat both as
unknowns when changing the `photos` schema or the room document shape.

## Layers

```
src/index.js
  └─ App.js ......................... ChakraProvider(theme) + BrowserRouter, 7 routes
       ├─ pages/ ................... one component per route
       ├─ components/ .............. feature-grouped UI, some non-UI "hook-alikes"
       │    └─ firebase_calls/
       │         ├─ dbCalls.js ..... THE data-access layer (~40 exported functions)
       │         └─ storageCalls.js  (currently unused)
       ├─ utils/firebase.js ........ SDK init, emulator wiring
       ├─ theme.js ................. Chakra theme extension
       └─ Contexts.js .............. four bare createContext() objects
```

### Routes

Defined in `src/App.js`. All are public — see
[Authentication](#authentication-and-authorization).

| Path | Page | Purpose |
|---|---|---|
| `/` | `Homepage` | Log in / sign up landing |
| `/login` | `Login` | Email + password sign-in |
| `/login/password-reset` | `PasswordReset` | Sends Firebase reset email |
| `/signup` | `SignUp` | Account creation |
| `/dashboard` | `DashBoard` | Host a new room, log out |
| `/rooms/:roomID/lobby` | `Lobby` | Roster management, target generation |
| `/rooms/:roomID/GameMasterView` | `GameMasterView` | The live game console |

There is no catch-all `*` route, so an unknown URL renders a blank page.

### The `dbCalls.js` seam

`src/components/firebase_calls/dbCalls.js` is the single most important file in
the codebase. Every Firestore read and write goes through it (with two
exceptions noted below), which means it doubles as the **de facto schema
definition** — there is no other place where the shape of a player, task, or
room document is written down. See [data-model.md](./data-model.md).

Its naming convention is consistent and worth preserving:

- `fetch…ForRoom` / `fetch…ForPlayer` — reads that `await` and return data
- `fetch…QueryFor…` — returns an unexecuted Firestore `Query`, for the caller to
  hand to `onSnapshot`
- `update…For…` — writes

Two components bypass the seam and use the Firestore SDK directly:
`UnmapPlayers.js` and `DashBoard.js` (room creation). `old-components/OpenSeason.js`
does too, but that file is dead code.

Every function in `dbCalls.js` wraps its body in `try/catch` and reports failures
via `console.error`, then returns `undefined`. Callers do not check for this, so
a failed read commonly surfaces later as a `TypeError` on `.docs[0]` or
`.data()`. This is a systemic pattern, not an oversight in one place — see
[improvements.md](./improvements.md).

### Components that are not components

Several files under `src/components/` export a factory that returns a function
rather than JSX. They are used like hooks but are not named like them:

| File | Returns |
|---|---|
| `CreateAlert.js` | `showToast(status, title, description, duration)` |
| `UnmapPlayers.js` | `handleUnmapping(playerName, roomID)` |
| `RemapPlayers.js` | `handleRegeneration(needTargets, needAssassins, alive, roomID)` |

They are invoked as `const createAlert = CreateAlert();` at the top of a
component body. `CreateAlert` and `UnmapPlayers` genuinely depend on hooks or
module state; `RemapPlayers` does not, and could be a plain module function.

Note that `dbCalls.killPlayerForRoom` calls `UnmapPlayers()` at module-function
scope — a data-layer function reaching back into the component layer.

## State management

There is no state library. State lives in three separate places that do not
agree with each other, which is the single most important thing to understand
before changing `GameMasterView`.

**1. Live Firestore subscriptions.** `PlayersList` and `PhotosDisplay` each call
a `fetch…QueryFor…` helper and subscribe with `onSnapshot`. These are always
current and update across browser tabs.

**2. Local React state in `GameMasterView`.** `arrayOfAlivePlayers`,
`arrayOfDeadPlayers`, `arrayOfTasks`, `completedTasks`, and `logList` are fetched
**once** on mount and thereafter mutated optimistically by handler functions
(`handleKillPlayer`, `handlePlayerRevive`, …). They do not re-sync with
Firestore, so a second GM's actions are invisible until reload.

**3. React Router location state.** The roster count in the console header comes
from `useLocation().state.arrayOfPlayers`, passed by `Lobby` at navigation time.
Refreshing `GameMasterView` discards it and the header reads `Players (0)`.

The consequence: `PlayersList` (subscription) and the header count (router
state) can and do disagree on screen at the same time.

### Contexts

`src/components/Contexts.js` declares four contexts with no default value and no
provider components — providers are inlined in `GameMasterView`'s JSX.

| Context | Provided value | Consumers |
|---|---|---|
| `gameContext` | `{ roomID }` | `PlayersList`, `ChatInput`, `PhotosDisplay`, `HeaderExecution`, `Endgamebutton`, `ResetTargetsButton`, `TaskList`, `TaskCreation` |
| `executionContext` | 12 handler functions | `ChatInput`, `PhotosDisplay` |
| `taskContext` | `{ handleNewTaskAdded }` | `TaskCreation` — currently unreachable, see below |
| `deadPlayerListContext` | never provided | only `old-components/` (dead) |

`executionContext` is provided **twice** in `GameMasterView`'s tree with the same
object — once wrapping `ChatInput`, once wrapping the right-hand stack — because
the two consumers sit in different branches of the layout.

## Authentication and authorization

Firebase Auth, email/password only, handled entirely by `src/components/auth.js`
(shared by both `Login` and `SignUp` via an `isLoginPage` prop). Password reset
goes through `sendPasswordResetEmail`. Google sign-in is initialized in
`utils/firebase.js` (`googleProvider`) but never used.

**There is no authorization anywhere.** Specifically:

- No route guards. `/dashboard` and `/rooms/:roomID/*` render for signed-out
  visitors. `DashBoard` checks `auth.currentUser` only to decide whether to
  create a room, and logs to console if absent.
- No `firestore.rules` file exists in this repository, and `firebase.json` does
  not register one. Whatever rules are live in the Firebase project are unknown
  and unversioned.
- `storage.rules` is `allow read, write: if true` for all paths.
- `rooms/{roomID}.hostId` is written at creation and never read again, so room
  ownership is recorded but not enforced.

## Cloud Functions

`functions/` contains one callable, `targetFunction`, which checks
`context.auth` and echoes its input back. Nothing in the game depends on it; the
only caller is `src/components/cloudFunction.js`, a debug button component that
is not mounted anywhere.

`functions/index.js` additionally constructs an Express app with CORS and then
never exports or uses it.

The practical consequence: **all game logic runs on the client.** Target
assignment, kill validation, scoring, and revival all execute in the browser and
write directly to Firestore. Combined with the absence of Firestore rules, the
game state is fully writable by anyone holding the (necessarily public) Firebase
web config.

## Configuration and environments

`src/utils/firebase.js` reads six `REACT_APP_*` variables from `.env` and, when
`process.env.NODE_ENV === 'development'`, connects all four SDKs to local
emulators:

| Emulator | Port (`firebase.json`) | Client (`utils/firebase.js`) |
|---|---|---|
| Auth | 9099 | 9099 |
| Functions | 5001 | 5001 |
| Firestore | 8081 | 8081 |
| Storage | 9199 | 9199 |

`NODE_ENV` is set to `development` by `react-scripts start`, so **`npm start`
always targets emulators** and `npm run build` always targets production. There
is no way to run the dev server against the real project without editing code.

`.firebaserc` maps `default`, `dev`, and `prod` aliases all to the same project
ID, `mall-mystery-heroes`. There is no environment separation.

`firebase.json` configures functions, emulators, and storage rules. It has **no
`hosting` block**, so how the built SPA is deployed is not captured in this
repository.

## Build and test tooling

Create React App 5 (`react-scripts`), Chakra UI 2 for all styling (no CSS
modules; `App.css`/`index.css` are near-empty), React Router 6.

`jest.config.js`, `jest.setup.js`, `jest.polyfills.js`, and `babel.config.js`
configure a full Jest + Testing Library + jsdom stack with `collectCoverage: true`.
**There are no test files.** `npm test` runs `react-scripts test`, which does not
read `jest.config.js` at all — the standalone config is unused by any script.

## Related documents

- [data-model.md](./data-model.md) — Firestore collections, field by field
- [game-flows.md](./game-flows.md) — sequence diagrams for the core flows
- [commands.md](./commands.md) — the GM command bar reference
- [improvements.md](./improvements.md) — prioritized backlog of known issues
