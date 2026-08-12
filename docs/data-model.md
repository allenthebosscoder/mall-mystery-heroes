# Firestore data model

There is no schema declaration anywhere in the codebase — no rules file, no
converters, no TypeScript types. This document is reconstructed from the call
sites in `src/components/firebase_calls/dbCalls.js` and is the only written
record of the shape of the data.

Everything is scoped under a single top-level collection:

```
rooms/{roomID}
  ├─ players/{trimmedNameLowerCase}
  ├─ tasks/{autoId}
  ├─ photos/{autoId}
  └─ logs/{autoId}
```

`roomID` is a human-readable document ID, not an auto-ID — see
[Room ID generation](#room-id-generation).

---

## `rooms/{roomID}`

The room document holds game-wide state. Chat logs live in a subcollection
(below), not on this document.

| Field              | Type                     | Written by                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hostId`           | `string`                 | `DashBoard.handleHostRoom`                                                                                           | The creating user's `auth.uid`. Read by `firestore.rules` to scope access — see [architecture.md](./architecture.md#authentication-and-authorization). Not read anywhere in application code.                                                                                                                                                                                                                                                                                              |
| `isGameActive`     | `boolean`                | `DashBoard.handleHostRoom` (`true`), `dbCalls.endGame` (`false`)                                                     | `GameMasterView` subscribes to this and disables `ChatInput` once it's `false` (docs/improvements.md item 15) — no longer write-only. Also read by `dbCalls.fetchActiveRoomForHost`, which `DashBoard.js` uses to find a room the signed-in GM is already running rather than always creating a new one (docs/superpowers/specs/2026-08-08-dashboard-removal-design.md).                                                                                                                   |
| `gameStarted`      | `boolean`                | `DashBoard.handleHostRoom` (`false`), `dbCalls.markGameAsStarted` (`true`, called from `TargetGenerator.onYesClose`) | Distinct from `isGameActive`: this answers "has the Lobby phase ended," not "does the room still exist." Read by `joinRoom` (`functions/callableFunctions/joinRoom.js`) via the Admin SDK to reject self-registration once targets have been generated (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md). Also read by `dbCalls.fetchActiveRoomForHost` to decide whether a returning GM's existing room routes to the lobby or straight to `GameMasterView`. |
| `endedAt`          | `Timestamp \| undefined` | `dbCalls.endGame`                                                                                                    | `serverTimestamp()`, set when "End Game" is clicked. Absent on a room that's never been ended. Read by the scheduled `cleanupEndedRooms` function to decide what's old enough to delete.                                                                                                                                                                                                                                                                                                   |
| `taskIndex`        | `number`                 | `DashBoard.handleHostRoom` (`1`), `dbCalls.fetchTaskIndexThenIncrement`                                              | Monotonic counter handing out human-facing mission numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `joinedUids`       | `array<string>`          | `DashBoard.handleHostRoom` (`[]`), `joinRoom` (`arrayUnion`)                                                         | Every `auth.uid` that has self-registered via `joinRoom`. Read by `firestore.rules`' `isPlayerOfRoom` to scope reads to "host or player of this room" — Firestore rules can't query "does any player doc have field X == Y," only fetch a known path, so this room-level list is what makes room-scoped reads checkable at all (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).                                                                                |
| `storageReference` | `array`                  | `DashBoard.handleHostRoom` (`[]`)                                                                                    | Written empty at creation, never read or appended. Vestigial.                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## `rooms/{roomID}/logs/{autoId}` ✅ Resolved (improvements item 22)

The chat/event log. One document per entry — until this item, `logs` was an
array field on the room document itself, appended with `arrayUnion`. Two
problems followed from that: Firestore's 1 MiB document limit capped a
game's total log history and every message rewrote the whole document, and
`arrayUnion` deduplicates by deep equality, so two identical messages in the
same second (same `time`/`log`/`color`) silently collapsed into one.

| Field       | Type        | Notes                                                                      |
| ----------- | ----------- | -------------------------------------------------------------------------- |
| `time`      | `string`    | e.g. `"3:42:07 PM"`, from `Date#toLocaleTimeString()`. Display only.       |
| `log`       | `string`    | The message text.                                                          |
| `color`     | `string`    | A Chakra color token (e.g. `"red.400"`) or a raw CSS color.                |
| `timestamp` | `Timestamp` | `serverTimestamp()`. Used only for `orderBy` — mirrors `photos.timestamp`. |

Written by `dbCalls.addLogForRoom` (an `addDoc`, replacing the old
`updateLogsForRoom`'s `updateDoc` + `arrayUnion`). Read by
`GameMasterView` via a live `onSnapshot` subscription on
`fetchLogsQueryByAscendingTimestampForRoom`, not a one-time fetch — see
[improvements.md item 13](./improvements.md) for why that matters (a second
GM's log entries are no longer invisible until reload).

The colors in use, by event type:

| Color        | Event                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `red.400`    | player killed                                                                                    |
| `blue.300`   | player revived                                                                                   |
| `blue.200`   | photo judgment undone                                                                            |
| `blue.400`   | new target assigned (target reset)                                                               |
| `blue.500`   | remapping after a kill                                                                           |
| `lightblue`  | open season started                                                                              |
| `pink.400`   | open season ended                                                                                |
| `green.400`  | mission completed (by `/mission end`, or by a player via `/mission done` — improvements item 40) |
| `purple.400` | mission auto-ended by reaching its completion cap (improvements item 41)                         |
| `yellow.400` | mission created                                                                                  |
| `gray`       | revive undone, photo denied                                                                      |

---

## `rooms/{roomID}/players/{trimmedNameLowerCase}`

One document per player. Created by `dbCalls.addPlayerForRoom`, which runs the
duplicate check and the write in a single transaction keyed on the document
ID — this is what makes two concurrent adds of the same name safe (one
succeeds, one rejects with `Player already exists`). `dbCalls.fetchPlayerReferenceForRoom`
(used by `PlayerGame.js` to live-subscribe to a player's own doc) also builds
this same ID directly from the player's name, so the ID scheme is now a
public contract, not just an implementation detail of `addPlayerForRoom`.
Player docs created before this change keep their old auto-generated IDs;
those are invisible to `fetchPlayerReferenceForRoom`'s by-ID lookup, so such
a player would not get a live player-doc subscription (everything that
queries by `trimmedNameLowerCase` is unaffected).

| Field                  | Type            | Initial                             | Notes                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                 | `string`        | as typed                            | Display value only. Not queried anywhere — see `trimmedNameLowerCase`.                                                                                                                                                                                                                                            |
| `trimmedNameLowerCase` | `string`        | `name` minus whitespace, lowercased | The actual lookup key — every function in `dbCalls.js` that finds a player by name queries this field, via `normalizePlayerName()`. Also the document ID for players created by the current `addPlayerForRoom`.                                                                                                   |
| `isAlive`              | `boolean`       | `true`                              |                                                                                                                                                                                                                                                                                                                   |
| `score`                | `number`        | `10`                                | Reset to `0` on death. Read back with `parseInt` in places, implying it is sometimes a string.                                                                                                                                                                                                                    |
| `targets`              | `array<string>` | `[]`                                | Names this player is hunting.                                                                                                                                                                                                                                                                                     |
| `assassins`            | `array<string>` | `[]`                                | Names hunting this player.                                                                                                                                                                                                                                                                                        |
| `openSeason`           | `boolean`       | `false`                             | When true, _anyone_ may kill this player, and this player may kill anyone.                                                                                                                                                                                                                                        |
| `uid`                  | `string`        | absent                              | The Firebase Auth uid that self-registered as this player, written only by `joinRoom` (`functions/callableFunctions/joinRoom.js`). Absent on GM-added players (`dbCalls.addPlayerForRoom`), which have no associated browser session (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md). |

### The target graph

`targets` and `assassins` are two directed adjacency lists that must stay
mutually consistent: if `A.targets` contains `B`, then `B.assassins` must
contain `A`. Nothing enforces this at the schema level. Three separate code
paths maintain it:

- `TargetGenerator` (initial assignment, in the lobby) — writes players one
  at a time, no batch or transaction.
- `ResetTargetsButton` (hard reset mid-game — a near-verbatim copy of the
  above) — same caveat.
- `RemapPlayers` (incremental repair after a revival; used to also run after
  a kill, before item 4) — same caveat.

Kills are the exception: `functions/callableFunctions/killPlayer.js`
(improvements item 4) does the removal-from-the-graph step that used to be
`UnmapPlayers` (deleted) and the post-kill remap step that used to be a
separate `RemapPlayers` call, both inside one Firestore transaction. A
partial write is no longer possible for a kill specifically — either the
whole graph update lands or none of it does. `TargetGenerator`,
`ResetTargetsButton`, and `RemapPlayers`'s remaining caller (`/revive`) are
still one-write-at-a-time and can still leave the two lists disagreeing if
interrupted.

`targetsLength`/`assassinsLength` used to exist here as a denormalized
`array.length`, so Firestore queries could `orderBy` array size — removed
entirely (improvements item 9). Nothing had read them since `RemapPlayers`
moved to in-memory matching via `planRemap` (item 17); the two
`fetchAlivePlayersByAscend…LengthForRoom` functions that queried by them
were confirmed-dead code, and `killPlayer` (item 4) never maintained them in
the first place, so every kill was already leaving them stale. Deleting the
fields removes the drift rather than chasing every writer.

### Name casing ✅ Resolved (improvements item 1)

Stored names preserve the GM's capitalization. Every lookup in `dbCalls.js`
now queries `trimmedNameLowerCase`, and `ChatInput.js`'s comparisons against
arrays that come back case-preserved (`fetchPlayersByStatusForRoom`)
normalize both sides before comparing — so a player named `Alice` can be
referenced from the command bar as `alice`. `killPlayer.js` (the Cloud
Function, `improvements.md` item 4) does the same normalization on the
server side for kills specifically.

Not covered: `trimmedNameLowerCase` strips all whitespace, but `ChatInput`'s
`.toLowerCase()` calls don't strip any, so a multi-word bracketed name like
`[Alice Smith]` can still mismatch. See
[improvements.md item 35](./improvements.md).

---

## `rooms/{roomID}/tasks/{autoId}`

Missions the GM sets for players. Created by `TaskCreation` via
`dbCalls.addTaskForRoom`.

| Field                   | Type                          | Notes                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`                 | `string`                      | Required, non-blank.                                                                                                                                                                                                                                   |
| `titleTrimmedLowerCase` | `string`                      | Used by `checkForTaskDupesForRoom` to reject duplicates.                                                                                                                                                                                               |
| `description`           | `string`                      | Defaults to `'No description provided'` if left blank.                                                                                                                                                                                                 |
| `pointValue`            | `string \| number`            | Stored as a **string** from the Chakra `NumberInput`, except for revival missions where it is coerced to the number `0`. Read back with `parseInt`.                                                                                                    |
| `taskType`              | `'Task' \| 'Revival Mission'` | Drives what completion does — points, or resurrection.                                                                                                                                                                                                 |
| `taskIndex`             | `number`                      | From `fetchTaskIndexThenIncrement`. The number GMs type in `/mission` commands.                                                                                                                                                                        |
| `dateCreated`           | `string`                      | `"HH:MM"` local time. No date component.                                                                                                                                                                                                               |
| `isComplete`            | `boolean`                     | Set true by `/mission end`, or automatically by `/mission done` once `maxCompletions` is reached (item 41). Also checked _by_ `/mission done` (item 39) — a mission that's already `isComplete` rejects further completions.                           |
| `completedBy`           | `array<string>`               | Player names, appended by `/mission done`.                                                                                                                                                                                                             |
| `maxCompletions`        | `number \| null`              | Optional (improvements item 41). `null`/unset means unlimited — every mission created before this field existed reads this way. When set, `/mission done` auto-sets `isComplete: true` once `completedBy.length` reaches it, and logs an announcement. |

`taskType` decides the completion effect:

- **`Task`** — awards `parseInt(pointValue)` to the player.
- **`Revival Mission`** — brings the player back to life and triggers a remap.
  `pointValue` is forced to `0` and the input is disabled in the UI.

Creation and listing are reachable from the GM console again as of
`improvements.md` item 15 — missions used to only be completable via the
command bar (`/mission done`/`/mission end`), with no way to create one
through the app at all. Both now open as on-demand popups,
`TaskCreationModal`/`TaskListModal`, via `/mission start`/`/mission view` —
not a permanently-visible panel.

---

## `rooms/{roomID}/photos/{autoId}`

Kill-proof photos. **Designed to be written by a player-facing mobile app**,
not by this codebase — nothing in `dbCalls.js` writes a photo document (the
test helper that once did, `addPhotoForRoom`, had no callers and was
deleted; `improvements.md` item 14). That app doesn't exist yet
(`improvements.md` item 33), so today this collection has no writer at all
except manual/emulator seeding.

| Field                | Type                                  | Notes                                                                                                                                      |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`                | `string`                              | Download URL. Rendered directly into an `<Image src>`.                                                                                     |
| `assassin`           | `string`                              | Claiming player's name.                                                                                                                    |
| `target`             | `string`                              | Claimed victim's name.                                                                                                                     |
| `timestamp`          | `Timestamp`                           | `serverTimestamp()`. The queue orders ascending by this field, so the GM judges oldest-first.                                              |
| `status`             | `'pending' \| 'approved' \| 'denied'` | See below.                                                                                                                                 |
| `originalPlayerData` | `{ score, targets, assassins }`       | Written by `dbCalls.approvePhotoForRoom` only when `status` becomes `'approved'`. The target's pre-kill snapshot, needed to undo the kill. |

`PhotosDisplay` reads every photo document in the room on every snapshot and
splits them client-side by `status` (`src/game/photoJudgments.js`,
`splitPhotosByStatus`) — `pending` into the judgment queue, `approved`/`denied`
into undo history. Neither split is part of the query. Because both are
derived fresh from Firestore on every snapshot rather than accumulated
locally, `originalPlayerData` is what makes undo survive a page reload
(docs/improvements.md item 6) — before it existed, the snapshot needed to
revert a kill lived only in React state and was lost on reload even though
the photo document itself was already durably `approved`.

---

## `rooms/{roomID}/playerMessages/{autoId}`

Player-facing messages from `/whisper`, `/broadcast`, and `/leaderboard`
(docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md).
**Designed to be read by a player-facing mobile app**, not by this
codebase — the mirror case of `photos` above, which is designed to be
_written_ by that same not-yet-existing app. `MessageFeed.js` now reads
`playerMessages` via `fetchPlayerMessagesQueryForRoom`, filtering to broadcasts/leaderboard sends
and whispers addressed to the subscribing player. `'broadcast'` writes also
now come from game-event handlers in `GameMasterView.js` and
`ChatInput.js` (kills, revives, open season, missions), not just the
explicit `/broadcast` command.

| Field       | Type                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`      | `'whisper' \| 'broadcast' \| 'leaderboard' \| 'mission'`             | Discriminates which of the other fields is populated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `recipient` | `string \| null`                                                     | The player's real (display) name, e.g. `"Alice Smith"` — populated only for `'whisper'`; `null` means "everyone." This is display-cased, **not** the `trimmedNameLowerCase` key player documents are keyed by (e.g. `"alicesmith"`). A reader matching `recipient` against a specific player must apply this repo's `normalizePlayerName` (`src/game/playerNames.js`, see docs/improvements.md item 35) to both sides before comparing — it strips _all_ whitespace, not just leading/trailing, so a plain `.toLowerCase()` will fail to match names with internal spaces. |
| `text`      | `string \| null`                                                     | Free-text body. Populated for `'whisper'`/`'broadcast'`; `null` for `'leaderboard'`/`'mission'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `standings` | `Array<{name, score, isAlive}> \| null`                              | Populated only for `'leaderboard'` — structured, not pre-rendered text, so a real client can render its own UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `mission`   | `{title, description, taskType, pointValue, maxCompletions} \| null` | Populated only for `type: 'mission'` — a new mission's full detail card, sent when the GM creates one. Absent (or `null`) for every other `type`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `timestamp` | `Timestamp`                                                          | `serverTimestamp()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## Room cleanup

`functions/scheduledFunctions/cleanupEndedRooms.js` runs once every 24
hours and deletes any room (and everything under it — players, logs,
tasks, photos, playerMessages, via the Admin SDK's `recursiveDelete()`)
whose `endedAt` is older than a retention window. The window is a
module-level constant, currently `null` — a deliberate no-op until a
duration is chosen
(docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
A room that's abandoned mid-lobby and never explicitly ended (`endedAt`
never set) is not covered by this and is never automatically deleted.

---

## Firebase Storage

`storage.rules` requires `request.auth != null` on `/{allPaths=**}` —
tightened from a previous `allow read, write: if true` (anyone,
unauthenticated). Not scoped further (no per-room/per-host restriction)
since there's no player-facing auth identity yet to scope a write to; see
the rules file's own header comment.

There is no Storage code in this repository anymore — `storageCalls.js`'s sole
export, `fetchPhotoURLFromStorageForRoom`, had no callers and called
`ref(storage, roomID, photoName)` with a wrong signature (`ref()` takes
`(storage, path)`; the third argument was ignored). It was deleted
(`improvements.md` item 14). Photo documents already carry a `url` field, so
nothing depended on it.

---

## Room ID generation

`DashBoard.handleHostRoom` builds an ID with `unique-names-generator`:

```js
uniqueNamesGenerator({
    dictionaries: [adjectives, [randomRoomNumber.toString()]], // 10000–99999
    separator: '',
    style: 'capital',
});
```

producing IDs like `Fluffy42317`. It retries on collision (checked with
`checkForRoomIDDupes`) up to 300 attempts before giving up with a toast. The
check-then-write is not atomic, so two simultaneous hosts can in principle claim
the same ID.

---

## Unused data-layer surface ✅ Resolved (improvements item 14)

`createRoomWithDefaults`, `addPhotoForRoom`, `updateCompletedByForTask`,
`fetchTaskForRoom`, `fetchReferenceForTask`, `updateIsCompleteToTrueForTask`,
and `fetchAlivePlayersQueryByDescendPointsForRoom` — the seven `dbCalls.js`
exports with no live callers this section used to list — have been deleted.
See [improvements.md item 14](./improvements.md) for what each was
superseded by, including the `createRoomWithDefaults` vs. `DashBoard`'s
inline `setDoc` disagreement over `taskIndex`'s starting value.
