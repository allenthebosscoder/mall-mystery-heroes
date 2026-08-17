/**
 * Layer 1 — the data layer against the Firestore emulator.
 *
 * Run with `npm run test:emulator`, which starts the emulator around them.
 * These exercise the real `dbCalls` through the real client SDK, so they are
 * the only place the Firestore document shape is actually asserted — see
 * docs/data-model.md, which is otherwise reconstructed from call sites.
 */
import {
    addChatMessageForRoom,
    addLogForRoom,
    addPhotoForRoom,
    addPlayerMessageForRoom,
    endGame,
    fetchAliveRosterForRoom,
    fetchActiveRoomForHost,
    fetchAllPlayersForRoom,
    fetchAssassinsForPlayer,
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
    fetchPlayerMessagesQueryForRoom,
    fetchTaskIndexThenIncrement,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
} from './dbCalls';
import { doc, getDoc, getDocs, terminate, Timestamp } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from '../../utils/firebase';
import {
    clearFirestore,
    createIndependentIdentity,
    seedRoom,
    shutdown,
} from '../../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('fetchAliveRosterForRoom', () => {
    it('returns name, targets and assassins for each living player', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], assassins: ['carol'] },
            { name: 'bob', targets: ['carol'], assassins: ['alice'] },
        ]);

        const roster = await fetchAliveRosterForRoom(ROOM);

        expect(roster).toHaveLength(2);
        expect(roster.find((p) => p.name === 'alice')).toEqual({
            name: 'alice',
            targets: ['bob'],
            assassins: ['carol'],
        });
    });

    it('excludes dead players', async () => {
        await seedRoom(ROOM, [{ name: 'alive' }, { name: 'dead', isAlive: false }]);

        const roster = await fetchAliveRosterForRoom(ROOM);

        expect(roster.map((p) => p.name)).toEqual(['alive']);
    });

    it('defaults missing target and assassin arrays rather than returning undefined', async () => {
        // planRemap spreads these immediately; undefined would throw there.
        await seedRoom(ROOM, [{ name: 'fresh', targets: undefined, assassins: undefined }]);

        const [player] = await fetchAliveRosterForRoom(ROOM);

        expect(player.targets).toEqual([]);
        expect(player.assassins).toEqual([]);
    });

    it('returns an empty roster for a room with no players', async () => {
        await seedRoom(ROOM, []);

        expect(await fetchAliveRosterForRoom(ROOM)).toEqual([]);
    });
});
describe('fetchActiveRoomForHost', () => {
    it('returns the most recently created active room when a host has more than one (race-condition safety net)', async () => {
        await seedRoom('room-old', [], {
            createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
        });
        await seedRoom('room-new', [], {
            createdAt: Timestamp.fromDate(new Date('2026-01-02T00:00:00Z')),
        });

        const result = await fetchActiveRoomForHost(auth.currentUser.uid);

        expect(result.id).toBe('room-new');
    });

    it('returns null when the host has no active room', async () => {
        // firestore.rules' `allow list` only authorizes a query for the
        // signed-in user's own hostId (see fetchActiveRoomForHost's
        // comment), and `allow create` only lets a room be written with
        // hostId == the writer's own uid — so "someone else's" room has to
        // be seeded by a genuinely independent identity, not a hand-typed
        // literal hostId under the shared identity's write. Querying as the
        // signed-in identity itself, which owns no room here, proves a
        // room that isn't this host's own doesn't leak into the result.
        const independentHost = await createIndependentIdentity();
        try {
            await seedRoom(
                'someone-elses-room',
                [],
                { hostId: independentHost.uid },
                independentHost.db
            );

            const result = await fetchActiveRoomForHost(auth.currentUser.uid);

            expect(result).toBeNull();
        } finally {
            await terminate(independentHost.db);
        }
    });
});

describe('player lookups are case- and whitespace-insensitive (improvements item 1)', () => {
    it('fetchPlayerForRoom finds a player by a differently-cased name', async () => {
        // Commands lowercase their arguments, but every lookup used to query
        // the case-preserved `name` field, so a player entered as "Alice"
        // could not be referenced from the command bar. Every lookup in
        // dbCalls.js now queries trimmedNameLowerCase instead.
        await seedRoom(ROOM, [{ name: 'Alice' }]);

        const doc = await fetchPlayerForRoom('alice', ROOM);

        expect(doc.data().name).toBe('Alice');
    });

    it('updatePointsForPlayer finds the player regardless of case', async () => {
        await seedRoom(ROOM, [{ name: 'Alice', score: 10 }]);

        await updatePointsForPlayer('alice', 5, ROOM);

        expect((await fetchPlayerForRoom('Alice', ROOM)).data().score).toBe(15);
    });
});

describe('updatePointsForPlayer', () => {
    it('adds to the existing score rather than replacing it', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 10 }]);

        await updatePointsForPlayer('alice', 5, ROOM);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15);
    });

    it('applies two updates cumulatively', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);

        await updatePointsForPlayer('alice', 3, ROOM);
        await updatePointsForPlayer('alice', 4, ROOM);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(7);
    });

    it('does not drop an increment when two calls race (improvements item 7)', async () => {
        // The old read-then-write shape let two concurrent calls both read
        // the same base score and only one increment would stick.
        // increment() is atomic server-side regardless of timing.
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);

        await Promise.all([
            updatePointsForPlayer('alice', 3, ROOM),
            updatePointsForPlayer('alice', 4, ROOM),
        ]);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(7);
    });
});

describe('fetchTaskIndexThenIncrement', () => {
    it('returns sequential indices for sequential calls', async () => {
        await seedRoom(ROOM, []);

        expect(await fetchTaskIndexThenIncrement(ROOM)).toBe(1);
        expect(await fetchTaskIndexThenIncrement(ROOM)).toBe(2);
        expect(await fetchTaskIndexThenIncrement(ROOM)).toBe(3);
    });

    it('never hands out the same index twice under concurrency (improvements item 7)', async () => {
        // The old read-then-write shape let two concurrent calls both read
        // taskIndex=1 and both hand it out, making /mission done <index>
        // ambiguous. The transaction serializes them instead.
        await seedRoom(ROOM, []);

        const indices = await Promise.all([
            fetchTaskIndexThenIncrement(ROOM),
            fetchTaskIndexThenIncrement(ROOM),
            fetchTaskIndexThenIncrement(ROOM),
        ]);

        expect(new Set(indices).size).toBe(3);
    });
});

describe('addLogForRoom and fetchLogsQueryByAscendingTimestampForRoom (improvements item 22)', () => {
    it('writes a doc with time/log/color, readable via the ascending-timestamp query', async () => {
        await seedRoom(ROOM, []);

        await addLogForRoom('game started', 'gray.400', ROOM);

        const snapshot = await getDocs(fetchLogsQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(1);
        expect(snapshot.docs[0].data()).toEqual({
            time: expect.any(String),
            log: 'game started',
            color: 'gray.400',
            timestamp: expect.anything(),
        });
    });

    it('returns entries in the order they were written, not deduplicated', async () => {
        await seedRoom(ROOM, []);

        // Two identical entries — the old arrayUnion-based implementation
        // silently dropped this pair (deep-equality dedup); a subcollection
        // has no such behavior.
        await addLogForRoom('first', 'gray.400', ROOM);
        await addLogForRoom('first', 'gray.400', ROOM);
        await addLogForRoom('second', 'red.400', ROOM);

        const snapshot = await getDocs(fetchLogsQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs.map((docSnapshot) => docSnapshot.data().log)).toEqual([
            'first',
            'first',
            'second',
        ]);
    });

    it('does not write a logs field on the room document itself', async () => {
        await seedRoom(ROOM, []);

        await addLogForRoom('game started', 'gray.400', ROOM);

        const roomSnapshot = await getDoc(doc(db, 'rooms', ROOM));
        expect(roomSnapshot.data().logs).toBeUndefined();
    });
});

describe('addPlayerMessageForRoom and fetchPlayerMessagesQueryForRoom', () => {
    it('returns messages in the order they were written', async () => {
        await seedRoom(ROOM, []);

        await addPlayerMessageForRoom(
            { type: 'broadcast', recipient: null, text: 'first', standings: null },
            ROOM
        );
        await addPlayerMessageForRoom(
            { type: 'broadcast', recipient: null, text: 'second', standings: null },
            ROOM
        );

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs.map((docSnapshot) => docSnapshot.data().text)).toEqual([
            'first',
            'second',
        ]);
    });

    it('includes the timestamp field written by addPlayerMessageForRoom', async () => {
        await seedRoom(ROOM, []);

        await addPlayerMessageForRoom(
            { type: 'whisper', recipient: 'Alice', text: 'psst', standings: null },
            ROOM
        );

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs[0].data()).toEqual({
            type: 'whisper',
            recipient: 'Alice',
            text: 'psst',
            standings: null,
            timestamp: expect.anything(),
        });
    });
});

describe('addChatMessageForRoom and the limitToLast(50) bound', () => {
    it('writes a chat message with the correct shape', async () => {
        await seedRoom(ROOM, []);

        await addChatMessageForRoom('hey where are you', 'Alice', ROOM);

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(1);
        expect(snapshot.docs[0].data()).toEqual({
            type: 'chat',
            recipient: null,
            text: 'hey where are you',
            standings: null,
            mission: null,
            sender: 'Alice',
            timestamp: expect.anything(),
        });
    });

    it('bounds fetchPlayerMessagesQueryForRoom to the newest 50 messages when more than 50 exist', async () => {
        await seedRoom(ROOM, []);

        for (let i = 0; i < 51; i++) {
            await addChatMessageForRoom(`msg-${i}`, 'Alice', ROOM);
        }

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(50);
        const texts = snapshot.docs.map((docSnapshot) => docSnapshot.data().text);
        expect(texts).not.toContain('msg-0');
        expect(texts[texts.length - 1]).toBe('msg-50');
    });
});

describe('addPhotoForRoom', () => {
    it('writes a pending photo with no originalPlayerData', async () => {
        await seedRoom(ROOM, []);

        await addPhotoForRoom(ROOM, 'bob', 'alice', 'https://example.com/photo.jpg');

        const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(1);
        expect(snapshot.docs[0].data()).toEqual({
            url: 'https://example.com/photo.jpg',
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: null,
            timestamp: expect.anything(),
        });
    });
});

describe('errors propagate instead of being swallowed (improvements item 10)', () => {
    // A representative subset, not all ~40 functions — these are the ones
    // touched by this session's other Tier 1 fixes. Before this item, every
    // one of these silently resolved to `undefined` on failure.
    it('fetchPlayerForRoom rejects for a nonexistent player', async () => {
        await seedRoom(ROOM, []);

        await expect(fetchPlayerForRoom('nobody', ROOM)).rejects.toThrow('Player not found');
    });

    it('updatePointsForPlayer rejects for a nonexistent player', async () => {
        await seedRoom(ROOM, []);

        await expect(updatePointsForPlayer('nobody', 5, ROOM)).rejects.toThrow();
    });

    it('updateIsAliveForPlayer rejects for a nonexistent player', async () => {
        await seedRoom(ROOM, []);

        await expect(updateIsAliveForPlayer('nobody', true, ROOM)).rejects.toThrow();
    });

    it('fetchAssassinsForPlayer rejects for a nonexistent player', async () => {
        await seedRoom(ROOM, []);

        await expect(fetchAssassinsForPlayer('nobody', ROOM)).rejects.toThrow();
    });

    // The rest of the ~40 dbCalls.js functions, picked back up here rather
    // than as a new item — see improvements.md item 10 for the full list of
    // what changed and why.
    it('updateIsCompleteToTrueForTaskByIndex rejects for a nonexistent task index', async () => {
        await seedRoom(ROOM, []);

        await expect(updateIsCompleteToTrueForTaskByIndex(999, ROOM)).rejects.toThrow(
            'Task not found'
        );
    });

    it('endGame rejects for a nonexistent room', async () => {
        await expect(endGame('nonexistent-room')).rejects.toThrow();
    });
});

describe('rooms are isolated from each other', () => {
    it('does not leak players between rooms', async () => {
        await seedRoom('room-a', [{ name: 'alice' }]);
        await seedRoom('room-b', [{ name: 'bob' }]);

        expect(await fetchAllPlayersForRoom('room-a')).toEqual(['alice']);
        expect(await fetchAllPlayersForRoom('room-b')).toEqual(['bob']);
    });
});

// Every addChatMessageForRoom test above runs as this file's memoized
// hostUid() (via seedRoom), so it's authorized by the pre-existing
// `allow write: if isHostOfExistingRoom(roomId)` grant — not the new
// player-scoped `allow create` firestore.rules gained for this feature
// (final review, chat-send-and-efficiency). test/firestore.rules.test.js
// exercises that new grant, but only with a hand-typed literal object,
// never through addChatMessageForRoom itself, so a mismatch between the
// function's write shape and the rule's requirements could go undetected.
// This block closes that gap: it proves a real, non-host player can call
// the actual function and have it succeed against the real rules.
//
// Must run last in this file (hence appended at the very end, after every
// other describe block): it signs the shared `auth`/`db` singleton — the
// exact instance addChatMessageForRoom itself writes through — in as the
// player identity, and anonymous auth has no credential to sign back in
// as a previous identity afterward. See createIndependentIdentity's
// comment in test/emulatorHelpers.js for why the room itself is seeded by
// a separate, independent host identity instead of this file's memoized
// one — that's what makes this not depend on execution order for its own
// correctness, only on nothing *after* it needing the shared singleton to
// still be host.
describe('addChatMessageForRoom authorized by the player-scoped rule (final review item 2)', () => {
    it('lets a joined, non-host player send a chat message', async () => {
        const room = 'chat-player-auth-room';

        // Mint the player identity on the shared singleton first — this is
        // the identity addChatMessageForRoom will actually write as.
        const playerCredential = await signInAnonymously(auth);
        const playerUid = playerCredential.user.uid;

        // Seed the room as a completely independent host, not this file's
        // memoized one, and not authenticated on the shared singleton
        // (which is now the player).
        const independentHost = await createIndependentIdentity();
        try {
            await seedRoom(
                room,
                [{ name: 'PlayerOne' }],
                { hostId: independentHost.uid, joinedUids: [playerUid] },
                independentHost.db
            );

            // playerUid is in joinedUids but is not the room's hostId — a
            // real non-host player, not the file-wide memoized host.
            await expect(
                addChatMessageForRoom('hi from a real player', 'PlayerOne', room)
            ).resolves.toBeUndefined();

            const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(room));
            expect(snapshot.docs).toHaveLength(1);
            expect(snapshot.docs[0].data()).toMatchObject({
                type: 'chat',
                recipient: null,
                sender: 'PlayerOne',
                text: 'hi from a real player',
            });
        } finally {
            // createIndependentIdentity's Firestore instance is on its own,
            // separate Firebase app — nothing else terminates it. Left
            // open, it holds the Node process's event loop alive
            // indefinitely after Jest finishes, hanging the whole
            // `firebase emulators:exec` wrapper.
            await terminate(independentHost.db);
        }
    });
});
