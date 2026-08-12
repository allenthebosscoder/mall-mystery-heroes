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
    addPlayerForRoom,
    addPlayerMessageForRoom,
    endGame,
    fetchAliveRosterForRoom,
    fetchAllPlayersForRoom,
    fetchAssassinsForPlayer,
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
    fetchPlayerMessagesQueryForRoom,
    fetchTaskIndexThenIncrement,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
} from './dbCalls';
import { doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../utils/firebase';
import { clearFirestore, seedRoom, shutdown } from '../../../test/emulatorHelpers';

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

describe('addPlayerForRoom', () => {
    it('writes the trimmedNameLowerCase field the duplicate check depends on', async () => {
        await seedRoom(ROOM, []);

        await addPlayerForRoom('Alice Smith', ROOM);

        const doc = await fetchPlayerForRoom('Alice Smith', ROOM);
        expect(doc.data().trimmedNameLowerCase).toBe('alicesmith');
    });

    it('resolves with a reference to the document it created', async () => {
        await seedRoom(ROOM, []);

        const ref = await addPlayerForRoom('dana', ROOM);

        expect(ref).toBeDefined();
        expect(ref.id).toEqual(expect.any(String));
    });

    it('leaves no write in flight once it resolves', async () => {
        // A write still pending here contends with the next test's emulator
        // reset and stalls it for the full timeout.
        await seedRoom(ROOM, []);

        await addPlayerForRoom('erin', ROOM);
        await clearFirestore();
        // Reads are now room-scoped (isHostOrPlayerOfRoom in firestore.rules),
        // so clearFirestore also wiped away this caller's proof of being the
        // room's host — re-seed the room itself (not its players) so the
        // query below is authorized. If addPlayerForRoom's write were still
        // in flight, it would land here as a stray 'erin' doc.
        await seedRoom(ROOM, []);

        expect(await fetchAllPlayersForRoom(ROOM)).toEqual([]);
    });

    it('rejects a duplicate that differs only by case and spacing', async () => {
        await seedRoom(ROOM, [{ name: 'Alice Smith', trimmedNameLowerCase: 'alicesmith' }]);

        await expect(addPlayerForRoom('alicesmith', ROOM)).rejects.toThrow('Player already exists');
    });

    it('starts a new player on 10 points and alive', async () => {
        await seedRoom(ROOM, []);

        await addPlayerForRoom('bob', ROOM);

        const data = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(data.score).toBe(10);
        expect(data.isAlive).toBe(true);
    });

    it('does not create two players when two calls race on the same name', async () => {
        // Reproduces the double-Enter-while-laggy bug: addPlayerForRoom's
        // duplicate check and its write were not atomic, so two concurrent
        // calls could both see "no duplicate" before either write landed.
        await seedRoom(ROOM, []);

        const results = await Promise.allSettled([
            addPlayerForRoom('123', ROOM),
            addPlayerForRoom('123', ROOM),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason.message).toBe('Player already exists');
        expect(await fetchAllPlayersForRoom(ROOM)).toEqual(['123']);
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
