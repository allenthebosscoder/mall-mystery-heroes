# Mall Mystery Heroes

A Game Master console for running a live-action "assassin" game. Players are
assigned targets, hunt each other in the real world, submit photo proof of their
kills, and earn points. This app is what the Game Master (GM) runs on a laptop to
drive the whole game.

It is a Create React App single-page application backed entirely by Firebase —
Auth, Firestore, and Storage. There is no backend of our own.

> **Companion apps.** A player-facing mobile app (which uploads the kill photos)
> and something Discord-related both interact with this system but live outside
> this repository. See [docs/architecture.md](docs/architecture.md#system-context).

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Layers, routing, state management, auth, configuration |
| [docs/data-model.md](docs/data-model.md) | Firestore collections field by field — the only schema record that exists |
| [docs/game-flows.md](docs/game-flows.md) | Sequence diagrams for hosting, killing, photo moderation, reviving |
| [docs/commands.md](docs/commands.md) | The GM command bar reference |
| [docs/improvements.md](docs/improvements.md) | Known issues and prioritized backlog |
| [docs/testing.md](docs/testing.md) | Proposed testing strategy and the refactors it depends on |

New to the codebase? Read `architecture.md`, then `data-model.md`. The data
model is reconstructed from call sites and is not declared anywhere in code, so
it is the piece least recoverable by reading source.

## Prerequisites

- Node.js 18 (matches the `engines` field in `functions/package.json`)
- [Firebase CLI](https://firebase.google.com/docs/cli) — `npm install -g firebase-tools`
- Java runtime (required by the Firestore emulator)

## Setup

```bash
npm install
(cd functions && npm install)
```

Create a `.env` in the repository root with the Firebase web config for your
project (Firebase console → Project settings → Your apps → SDK setup):

```
REACT_APP_APIKEY=
REACT_APP_AUTHDOMAIN=
REACT_APP_PROJECTID=
REACT_APP_STORAGEBUCKET=
REACT_APP_MESSAGINGSENDERID=
REACT_APP_APPID=
```

`.env` is gitignored. Note the existing file also carries a `DISCORD_TOKEN`,
which no code in this repository reads — it belongs to the out-of-repo bot.

## Running locally

Two terminals:

```bash
npm run firebase:emulate   # terminal 1 — emulator suite
npm start                  # terminal 2 — dev server on :3000
```

**`npm start` always targets the emulators.** `src/utils/firebase.js` connects to
local emulators whenever `NODE_ENV === 'development'`, and `react-scripts start`
always sets that. There is no flag to point the dev server at the real project
without editing that file.

| Emulator | Port |
|---|---|
| Auth | 9099 |
| Functions | 5001 |
| Firestore | 8081 |
| Storage | 9199 |
| Emulator UI | 4000 (default) |

Since the emulator starts empty, a local run needs an account created through
`/signup` before you can host a room.

### Walking through a game locally

1. Sign up at `/signup`, which lands on `/dashboard`.
2. **Host Room** — generates an ID like `Fluffy42317` and opens the lobby.
3. Add at least two players. **Enter names in all lowercase** — see the caveat
   below.
4. **Begin Game** — review the generated target assignments, confirm, and you
   land on the GM console.
5. Drive the game from the command bar: `/kill <target> <assassin>`,
   `/add <player> <points>`, `/revive <player>`,
   `/openseason <player> start|end`. Full reference in
   [docs/commands.md](docs/commands.md).

> **Caveat: player names must be lowercase.** Commands lowercase their arguments
> but Firestore lookups query the case-preserved `name` field, so any player
> entered with a capital letter cannot be referenced from the command bar —
> usually failing with a misleading "not a valid target" message, or with no
> feedback at all. This is a known bug, documented as
> [improvements item 1](docs/improvements.md#1-player-names-must-be-all-lowercase-or-commands-silently-fail).

## Scripts

| Command | Description |
|---|---|
| `npm start` | Dev server on port 3000, wired to emulators |
| `npm run build` | Production bundle to `build/`, wired to the real project |
| `npm test` | `react-scripts test` — **no test files exist**, see below |
| `npm run firebase:emulate` | Selects the `default` project alias and starts the emulator suite |

Inside `functions/`: `npm run serve`, `npm run deploy`, `npm run logs`.

## Project layout

```
src/
  pages/                        one component per route
  components/
    firebase_calls/dbCalls.js   the data-access layer — all Firestore reads/writes
    lobby_components/           roster management
    header_components/          console header, reset-targets, end-game
    logs_components/            log panel and the GM command bar
    photos_display_component/   kill-photo moderation queue
    player_listing/             live player list
    task_components/            missions (currently unmounted)
    old-components/             DEAD CODE — unreferenced, imports already broken
  utils/firebase.js             SDK init and emulator wiring
  Contexts.js, theme.js
functions/                      one callable stub; no game logic runs here
docs/                           architecture documentation
```

## Known gaps

Worth knowing before you start changing things — all detailed in
[docs/improvements.md](docs/improvements.md):

- **No Firestore security rules are versioned here**, and `storage.rules` allows
  unauthenticated read/write on every path.
- **No route guards** — every route renders for signed-out visitors.
- **All game logic is client-side.** Cloud Functions contains one echo stub.
  Scoring, kill validation, and target assignment all run in the browser.
- **No tests**, despite a fully configured Jest + Testing Library harness. Note
  that `npm test` does not even read the standalone `jest.config.js`.
- **`.firebaserc` maps `dev` and `prod` to the same project.** There is no
  staging environment.
- **Deployment is not captured here** — `firebase.json` has no `hosting` block
  and there is no CI configuration.
