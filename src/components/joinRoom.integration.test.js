/**
 * Layer 1b — the player self-registration Cloud Function, against the
 * real Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `joinRoom` is a thin wrapper around
 * `httpsCallable(functions, 'joinRoom')` — these tests call it exactly
 * the way a real player's device would, then assert on what actually
 * landed in Firestore, matching executeKill.integration.test.js's own
 * stance (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 */
import { joinRoom } from './joinRoom';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('joinRoom', () => {
    it('adds a new player to a room still in its Lobby phase', async () => {
        await seedRoom(ROOM, []);

        await joinRoom(ROOM, 'Alice');

        const player = await fetchPlayerForRoom('alice', ROOM);
        expect(player.data()).toMatchObject({
            name: 'Alice',
            trimmedNameLowerCase: 'alice',
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
        });
    });

    it('rejects joining a room that does not exist', async () => {
        // seedRoom (for an unrelated room) is what actually signs in the
        // shared auth singleton the first time — calling it here keeps
        // this test self-contained rather than relying on an earlier test
        // in the file to have done so first, matching every test in
        // executeKill.integration.test.js.
        await seedRoom('some-other-room', []);

        await expect(joinRoom('nonexistent-room', 'Alice')).rejects.toThrow(
            'Room not found: nonexistent-room'
        );
    });

    it('rejects joining a room whose game has already started', async () => {
        await seedRoom(ROOM, [], { gameStarted: true });

        await expect(joinRoom(ROOM, 'Alice')).rejects.toThrow('This game has already started.');
    });

    it('rejects a duplicate name, case- and whitespace-insensitively', async () => {
        await seedRoom(ROOM, ['Alice']);

        await expect(joinRoom(ROOM, '  alice  ')).rejects.toThrow(/already taken/);
    });
});
