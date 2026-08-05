# GM command bar reference

The command bar at the bottom of the log panel is the primary way a Game Master
drives the game. It is implemented entirely in
`src/components/logs_components/ChatInput.js`.

---

## How input is parsed

```js
const parts = value.match(/\/\S+|(\[[^\]]+\]|\S+)/g).map((s) => s.replace(/[\[\]]/g, ''));
const commandLine = parts[0].toLowerCase();
const args = parts.slice(1);
```

- The first token is lowercased and matched against a whitelist
  (`sanityCheckCommandInputs`); anything else produces an "not legal" toast.
- Remaining tokens are split on whitespace, **except** that a bracketed group
  like `[player name]` is captured whole. Brackets are then stripped, so
  `/whisper [Jane Doe] hello` yields `args = ["Jane Doe", "hello"]`. This is the
  only way to pass an argument containing a space.
- Arguments are **not** trimmed or normalized beyond what each command does
  individually.

Two parser caveats:

- Pressing Enter on an **empty input** throws. `.match()` returns `null` and
  `.map()` is called on it before the `if (!parts) return null` guard runs.
- The autosuggest inserts the literal help text, brackets included. Accepting the
  suggestion for `/kill [player] [assassin]` and pressing Enter runs
  `/kill player assassin` — the placeholders become the arguments. Suggestions
  are a reference, not a template to submit.

## Argument case sensitivity

Most commands lowercase their arguments before use, but every Firestore lookup
queries the raw `name` field. **Commands therefore only work for players whose
names were entered in all lowercase.** This affects `/kill`, `/revive`,
`/openseason`, and `/mission done`. `/add` is broken in the opposite direction —
it does _not_ lowercase `args[0]` before validating it against a lowercased
roster, so a capitalized name fails validation instead of failing the lookup.

See [improvements.md](./improvements.md#1-player-names-must-be-all-lowercase-or-commands-silently-fail).

---

## Implemented commands

### `/add <player> <points>`

Adds points to a player's score. Points may be negative.

| Check                                                         | Failure                     |
| ------------------------------------------------------------- | --------------------------- |
| `args[0]` is in the roster (compared **without** lowercasing) | `Player {name} is invalid`  |
| `args[1]` parses as a number                                  | `Please input valid points` |

Writes via `updatePointsForPlayer`, which is a read-modify-write, not an atomic
`increment()`. Two GMs adding points at once can lose one of the updates.

### `/kill <target> <assassin>`

Records a kill. See [game-flows.md](./game-flows.md#2-killing-a-player-kill-target-assassin)
for the full sequence.

| Check                                                                         | Failure                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| At least 2 arguments                                                          | `Missing Arguments`                                                      |
| Both names in roster                                                          | `Invalid players: …`                                                     |
| Target is on the assassin's target list **or** the assassin is in open season | `{target} is not a valid taret for {assassin}` _(typo is in the source)_ |

Effects: assassin gains the target's full score (floored at 0); target's score
is zeroed, `isAlive` set false, `openSeason` cleared; target is unmapped from the
graph; affected neighbours are remapped; a modal shows the new assignments.

### `/revive <player>`

Brings a dead player back and remaps them into the target graph.

Requires the player to be in the dead list. If they are not, **nothing happens
and no error is shown** — the `if` has no `else` branch.

The revived player keeps the score of `0` assigned at death.

### `/openseason <player> start|end`

Toggles the `openSeason` flag. While set, the player is a valid target for
everyone and may kill anyone.

| Check                               | Failure                        |
| ----------------------------------- | ------------------------------ |
| Player in roster                    | `{name} is not a valid player` |
| Second argument is `start` or `end` | `{arg} is not a valid input`   |

The command does not check the current state first — a `TO DO` comment in the
source acknowledges this — so `start` on an already-open-season player re-logs
the event.

### `/mission done <player> <index>`

Marks a player as having completed mission `<index>` (the `taskIndex`, i.e. the
number shown in the mission list — not a document ID).

| Check                               | Failure                                           |
| ----------------------------------- | ------------------------------------------------- |
| `Number(args[2])` is not `-1`       | `{arg} is not a valid index`                      |
| Player in roster                    | `Player {name} is invalid`                        |
| Mission with that index exists      | `Invalid task index`                              |
| Player not already in `completedBy` | `Player {name} has already completed the mission` |

Effect depends on `taskType`:

- **`Task`** — awards `parseInt(pointValue)` points.
- **`Revival Mission`** — requires the player to be dead (`Player {name} is not
dead` otherwise), revives them, and remaps them into the graph.

Either way the player is appended to `completedBy`.

Note the index validation only rejects the literal value `-1`; any other
non-numeric argument becomes `NaN`, passes the check, and fails later as
"Invalid task index".

### `/mission end <index>`

Closes a mission for everyone by setting `isComplete: true`.

The index is validated and the mission is looked up and written **before**
the success toast ("Task has been saved as completed") fires, mirroring
`/mission done`'s guard — a bad index now fails with "Invalid task index"
instead of toasting success and then throwing on `task.title` (improvements
item 20).

### `/mission start`

Opens a popup (`TaskCreationModal`) with the mission creation form —
title, description, task type, points — the same form `TaskCreation`
always had. Ignores any extra arguments. Closes automatically once a
mission is created successfully; stays open on a validation error or a
duplicate title so the GM can fix the form without retyping.

### `/mission view`

Opens a read-only popup (`TaskListModal`) listing missions split into
Active/Completed tabs. Marking a mission done or closing it out is still
only done via `/mission done`/`/mission end` — this popup has no actions
of its own (docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md).

---

## Declared but not implemented

These appear in the autosuggest list and pass the whitelist check, so they
consume the input and clear the box, but their `case` bodies are empty `// TO DO`
stubs. **They fail silently.**

| Command        | Suggested syntax              |
| -------------- | ----------------------------- |
| `/broadcast`   | `/broadcast [message]`        |
| `/leaderboard` | `/leaderboard send`           |
| `/whisper`     | `/whisper [player] [message]` |

All three imply an out-of-band delivery channel to players — most likely the
Discord bot hinted at by the unused `DISCORD_TOKEN` in `.env`.

---

## Implementation note

The `commands` array that backs the autosuggest is declared as:

```js
const commands = [
    { text: '/add [player] points' },
    …
];
```

It's effectively a list of help strings — only `text` is ever read
(`getSuggestions`/`getSuggestionValue`/`renderSuggestion`); dispatch happens
through the `switch` on `commandLine`, parsed separately. Each entry used to
also carry a `command: console.log('running')` field — evaluated at module
load, not stored as a callback, so importing `ChatInput` printed nine
`running` lines to the console for a property nothing read. Removed
(`improvements.md` item 29).
