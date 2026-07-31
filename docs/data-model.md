# Firestore data model

There is no schema declaration anywhere in the codebase — no rules file, no
converters, no TypeScript types. This document is reconstructed from the call
sites in `src/components/firebase_calls/dbCalls.js` and is the only written
record of the shape of the data.

Everything is scoped under a single top-level collection:

```
rooms/{roomID}
  ├─ players/{autoId}
  ├─ tasks/{autoId}
  └─ photos/{autoId}
```

`roomID` is a human-readable document ID, not an auto-ID — see
[Room ID generation](#room-id-generation).

---

## `rooms/{roomID}`

The room document holds game-wide state plus the entire chat log.

| Field | Type | Written by | Notes |
|---|---|---|---|
| `hostId` | `string` | `DashBoard.handleHostRoom` | The creating user's `auth.uid`. **Never read anywhere.** |
| `isGameActive` | `boolean` | `DashBoard.handleHostRoom` (`true`), `dbCalls.endGame` (`false`) | Written but never read — ending a game does not gate anything. |
| `logs` | `array<LogEntry>` | `dbCalls.updateLogsForRoom` | See below. Unbounded. |
| `taskIndex` | `number` | `DashBoard.handleHostRoom` (`1`), `dbCalls.fetchTaskIndexThenIncrement` | Monotonic counter handing out human-facing mission numbers. |
| `storageReference` | `array` | `DashBoard.handleHostRoom` (`[]`) | Written empty at creation, never read or appended. Vestigial. |

### `LogEntry`

```js
{ time: string,   // e.g. "3:42:07 PM", from Date#toLocaleTimeString()
  log:  string,   // the message text
  color: string } // a Chakra color token, e.g. "red.400", or a raw CSS color
```

Log entries are appended with `arrayUnion`. Two consequences follow from storing
them in the room document:

- Firestore's 1 MiB document limit caps a game's total log history, and every
  message rewrites the whole document.
- `arrayUnion` deduplicates by deep equality. Two identical messages in the same
  second (same `time`, `log`, and `color`) collapse into one entry.

`updateLogsForRoom` also returns a locally-assembled `[...currLogs, newAddition]`
array which `GameMasterView` stores in state, so the rendered list and the
persisted array are computed independently.

The colors in use, by event type:

| Color | Event |
|---|---|
| `red.400` | player killed |
| `blue.300` | player revived |
| `blue.200` | photo judgment undone |
| `blue.400` | new target assigned (target reset) |
| `blue.500` | remapping after a kill |
| `lightblue` | open season started |
| `pink.400` | open season ended |
| `green.400` | mission completed |
| `yellow.400` | mission created |
| `gray` | revive undone, photo denied |
| `gray.400` | seeded "Game has begun!" |

---

## `rooms/{roomID}/players/{autoId}`

One document per player. Created by `dbCalls.addPlayerForRoom`.

| Field | Type | Initial | Notes |
|---|---|---|---|
| `name` | `string` | as typed | The de facto primary key — every lookup is `where('name','==',…)`. Case-sensitive. |
| `trimmedNameLowerCase` | `string` | `name` minus whitespace, lowercased | Used **only** for the duplicate check at insert time. |
| `isAlive` | `boolean` | `true` | |
| `score` | `number` | `10` | Reset to `0` on death. Read back with `parseInt` in places, implying it is sometimes a string. |
| `targets` | `array<string>` | `[]` | Names this player is hunting. |
| `targetsLength` | `number` | `0` | Denormalized `targets.length`, maintained so Firestore can `orderBy` it. |
| `assassins` | `array<string>` | `[]` | Names hunting this player. |
| `assassinsLength` | `number` | `0` | Denormalized `assassins.length`. |
| `openSeason` | `boolean` | `false` | When true, *anyone* may kill this player, and this player may kill anyone. |

### The target graph

`targets` and `assassins` are two directed adjacency lists that must stay
mutually consistent: if `A.targets` contains `B`, then `B.assassins` must
contain `A`. Nothing enforces this. Four separate code paths maintain it:

- `TargetGenerator` (initial assignment, in the lobby)
- `ResetTargetsButton` (hard reset mid-game — a near-verbatim copy of the above)
- `RemapPlayers` (incremental repair after a death or revival)
- `UnmapPlayers` (removes a player from the graph entirely)

Each writes players one at a time with no batch or transaction, so an
interrupted kill leaves the two lists disagreeing.

`targetsLength` and `assassinsLength` exist because Firestore cannot order by
array length. They are updated by `updateTargetsForPlayer` and
`updateAssassinsForPlayer`, but **not** by `UnmapPlayers` or
`remapPlayerAsTarget`, both of which write `targets`/`assassins` directly. Those
two paths leave the denormalized counts stale, which in turn skews the
`orderBy(…Length)` queries that `RemapPlayers` relies on for its fallback
matching.

### Name casing

Stored names preserve the GM's capitalization, but `ChatInput` lowercases every
command argument before using it as a lookup key. Because lookups query `name`
(not `trimmedNameLowerCase`), any player whose name is not already all-lowercase
cannot be referenced from the command bar. See
[improvements.md](./improvements.md) for the full description.

---

## `rooms/{roomID}/tasks/{autoId}`

Missions the GM sets for players. Created by `TaskCreation` via
`dbCalls.addTaskForRoom`.

| Field | Type | Notes |
|---|---|---|
| `title` | `string` | Required, non-blank. |
| `titleTrimmedLowerCase` | `string` | Used by `checkForTaskDupesForRoom` to reject duplicates. |
| `description` | `string` | Defaults to `'No description provided'` if left blank. |
| `pointValue` | `string \| number` | Stored as a **string** from the Chakra `NumberInput`, except for revival missions where it is coerced to the number `0`. Read back with `parseInt`. |
| `taskType` | `'Task' \| 'Revival Mission'` | Drives what completion does — points, or resurrection. |
| `taskIndex` | `number` | From `fetchTaskIndexThenIncrement`. The number GMs type in `/mission` commands. |
| `dateCreated` | `string` | `"HH:MM"` local time. No date component. |
| `isComplete` | `boolean` | Set true by `/mission end`. Marks the mission closed for everyone. |
| `completedBy` | `array<string>` | Player names, appended by `/mission done`. |

`taskType` decides the completion effect:

- **`Task`** — awards `parseInt(pointValue)` to the player.
- **`Revival Mission`** — brings the player back to life and triggers a remap.
  `pointValue` is forced to `0` and the input is disabled in the UI.

Note the mission UI is currently **commented out** in `GameMasterView`
(`TaskExecution` is unreachable), so missions can no longer be created through
the app even though `/mission done` and `/mission end` still operate on them.

---

## `rooms/{roomID}/photos/{autoId}`

Kill-proof photos. **Written by the out-of-repo mobile app**, not by this
codebase — the only writer here is `dbCalls.addPhotoForRoom`, a test helper with
no callers.

| Field | Type | Notes |
|---|---|---|
| `url` | `string` | Download URL. Rendered directly into an `<Image src>`. |
| `assassin` | `string` | Claiming player's name. |
| `target` | `string` | Claimed victim's name. |
| `timestamp` | `Timestamp` | `serverTimestamp()`. The queue orders ascending by this field, so the GM judges oldest-first. |
| `status` | `'pending' \| 'approved' \| 'denied'` | `PhotosDisplay` subscribes to the whole collection and filters client-side for `pending`. |

`PhotosDisplay` reads every photo document in the room on every snapshot and
discards the non-pending ones in JavaScript. The filter is not part of the query.

---

## Firebase Storage

`storage.rules` grants `allow read, write: if true` on `/{allPaths=**}`.

The only Storage code in this repository is
`storageCalls.fetchPhotoURLFromStorageForRoom`, which has no callers — and which
calls `ref(storage, roomID, photoName)`. That signature is wrong: `ref()` takes
`(storage, path)`, so the third argument is ignored and the reference resolves to
the room directory rather than the photo. Since photo documents already carry a
`url`, nothing depends on this.

---

## Room ID generation

`DashBoard.handleHostRoom` builds an ID with `unique-names-generator`:

```js
uniqueNamesGenerator({
  dictionaries: [adjectives, [randomRoomNumber.toString()]],  // 10000–99999
  separator: '',
  style: 'capital'
})
```

producing IDs like `Fluffy42317`. It retries on collision (checked with
`checkForRoomIDDupes`) up to 300 attempts before giving up with a toast. The
check-then-write is not atomic, so two simultaneous hosts can in principle claim
the same ID.

---

## Unused data-layer surface

These exports in `dbCalls.js` have no live callers and describe behavior the app
does not currently have. They are listed here so their presence is not mistaken
for evidence of a feature.

| Function | Note |
|---|---|
| `createRoomWithDefaults` | An alternative room initializer seeding `taskIndex: 0` and a "Game has begun!" log. `DashBoard` uses inline `setDoc` with `taskIndex: 1` instead. The two disagree. |
| `addPhotoForRoom` | Test helper for injecting photos without the mobile app. |
| `updateCompletedByForTask` | Superseded by `addPlayerToCompletedByForTask`. |
| `fetchTaskForRoom`, `fetchReferenceForTask`, `updateIsCompleteToTrueForTask` | By-document-ID variants; the app uses the by-`taskIndex` variants throughout. |
| `fetchAlivePlayersQueryByDescendPointsForRoom` | Superseded by `fetchPlayersQueryByDescendPointsThenIsAliveForRoom`, which keeps dead players visible at the bottom. |
