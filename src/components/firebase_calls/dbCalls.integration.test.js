/**
 * Layer 1 — the data layer against the Firestore emulator.
 *
 * Run with `npm run test:emulator`, which starts the emulator around them.
 * These exercise the real `dbCalls` through the real client SDK, so they are
 * the only place the Firestore document shape is actually asserted — see
 * docs/data-model.md, which is otherwise reconstructed from call sites.
 */
import {
    addPlayerForRoom,
    fetchAliveRosterForRoom,
    fetchAllPlayersForRoom,
    fetchPlayerForRoom,
    fetchPlayersByStatusForRoom,
    killPlayerForRoom,
    updatePointsForPlayer,
    updateTargetsForPlayer,
} from './dbCalls';
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
});

describe('player lookups are case-sensitive', () => {
    it.failing('finds a player by a differently-cased name (improvements item 1)', async () => {
        // Commands lowercase their arguments, but every lookup queries the
        // case-preserved `name` field, so a player entered as "Alice" cannot be
        // referenced from the command bar. The fix is to query
        // trimmedNameLowerCase, which addPlayerForRoom already writes.
        // When that lands, this stops failing and the marker comes off.
        await seedRoom(ROOM, [{ name: 'Alice' }]);

        const doc = await fetchPlayerForRoom('alice', ROOM);

        expect(doc).toBeDefined();
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
});

describe('updateTargetsForPlayer', () => {
    it('keeps targetsLength in step with the array', async () => {
        // targetsLength exists so Firestore can orderBy array size; the remap
        // fallback path orders candidates by it.
        await seedRoom(ROOM, [{ name: 'alice' }]);

        await updateTargetsForPlayer('alice', ['bob', 'carol'], ROOM);

        const data = (await fetchPlayerForRoom('alice', ROOM)).data();
        expect(data.targets).toEqual(['bob', 'carol']);
        expect(data.targetsLength).toBe(2);
    });
});

describe('killPlayerForRoom', () => {
    it('marks the target dead and zeroes their score', async () => {
        await seedRoom(ROOM, [{ name: 'victim', score: 40 }, { name: 'other' }]);

        await killPlayerForRoom('victim', ROOM);

        const data = (await fetchPlayerForRoom('victim', ROOM)).data();
        expect(data.isAlive).toBe(false);
        expect(data.score).toBe(0);
        expect(data.openSeason).toBe(false);
    });

    it('removes the victim from their assassins target lists', async () => {
        await seedRoom(ROOM, [
            { name: 'victim', assassins: ['hunter'], targets: ['prey'] },
            { name: 'hunter', targets: ['victim'] },
            { name: 'prey', assassins: ['victim'] },
        ]);

        await killPlayerForRoom('victim', ROOM);

        expect((await fetchPlayerForRoom('hunter', ROOM)).data().targets).not.toContain('victim');
        expect((await fetchPlayerForRoom('prey', ROOM)).data().assassins).not.toContain('victim');
    });

    it('moves the player from the alive list to the dead list', async () => {
        await seedRoom(ROOM, [{ name: 'victim' }, { name: 'survivor' }]);

        await killPlayerForRoom('victim', ROOM);

        expect(await fetchPlayersByStatusForRoom(true, ROOM)).toEqual(['survivor']);
        expect(await fetchPlayersByStatusForRoom(false, ROOM)).toEqual(['victim']);
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
