/**
 * Layer 1b — the reconnect-request Cloud Functions, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `requestReconnect`,
 * `approveReconnectRequest`, and `denyReconnectRequest` are thin wrappers
 * around `httpsCallable(functions, ...)` — these tests call them exactly
 * the way the real app does, then assert on what actually landed in
 * Firestore (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 */
import { requestReconnect } from './requestReconnect';
import { approveReconnectRequest } from './approveReconnectRequest';
import { denyReconnectRequest } from './denyReconnectRequest';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { auth, db } from '../utils/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

// requestReconnect resolves the caller purely from context.auth.uid — it
// never needs to already own a player doc (that's the entire premise:
// the caller has just lost the identity that used to). The shared
// singleton `auth`/`db` from utils/firebase, signed in as host by
// seedRoom's own first call, doubles as "some other signed-in device"
// for these tests, matching this codebase's own established shortcut
// (see removePlayerCallable.integration.test.js's identical reasoning)
// rather than always reaching for createIndependentIdentity.
describe('requestReconnect', () => {
    it('creates a pending request for an existing player name', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });

        const result = await requestReconnect(ROOM, 'alice');

        expect(result.requestId).toBeDefined();
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', result.requestId)
        );
        expect(requestSnapshot.data()).toMatchObject({
            playerName: 'alice',
            trimmedNameLowerCase: 'alice',
            requestingUid: auth.currentUser.uid,
            status: 'pending',
        });
    });

    it('rejects a name with no matching player, writing nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });

        await expect(requestReconnect(ROOM, 'nobody')).rejects.toThrow(
            'No player named nobody in this room.'
        );
        const requestsSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'reconnectRequests'));
        expect(requestsSnapshot.docs).toHaveLength(0);
    });

    it('rejects a room where the game has not started yet', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: false });

        await expect(requestReconnect(ROOM, 'alice')).rejects.toThrow(
            'This room has not started a game yet — just join normally.'
        );
    });

    it('rejects a room that has already ended', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], {
            gameStarted: true,
            isGameActive: false,
            endedAt: new Date(),
        });

        await expect(requestReconnect(ROOM, 'alice')).rejects.toThrow(
            'This room is no longer active.'
        );
    });

    it('rejects a room that does not exist', async () => {
        await seedRoom('some-other-room', []);

        await expect(requestReconnect('nonexistent-room', 'alice')).rejects.toThrow(
            'Room not found: nonexistent-room'
        );
    });
});

describe('approveReconnectRequest', () => {
    it("re-links the player document's uid and adds the requester to joinedUids", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await approveReconnectRequest(ROOM, requestId);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBe(auth.currentUser.uid);
        const roomSnapshot = await getDoc(doc(db, 'rooms', ROOM));
        expect(roomSnapshot.data().joinedUids).toContain(auth.currentUser.uid);
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('approved');
    });

    it('requires the caller to be host', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const approveAsNonHost = callableAsNonHost('approveReconnectRequest');

        await expect(approveAsNonHost({ roomId: ROOM, requestId })).rejects.toThrow(
            /permission-denied|host/i
        );
        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBeUndefined();
    });

    it('rejects a request that has already been resolved', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        await approveReconnectRequest(ROOM, requestId);

        await expect(approveReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'This request has already been approved.'
        );
    });

    it('rejects a request naming a player who no longer exists, mutating nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const { removePlayer } = await import('./removePlayer');
        await removePlayer('alice', ROOM);

        await expect(approveReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'The player this request was for no longer exists.'
        );
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('pending');
    });
});

describe('denyReconnectRequest', () => {
    it('marks the request denied and writes nothing else', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await denyReconnectRequest(ROOM, requestId);

        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('denied');
        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBeUndefined();
    });

    it('requires the caller to be host', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const denyAsNonHost = callableAsNonHost('denyReconnectRequest');

        await expect(denyAsNonHost({ roomId: ROOM, requestId })).rejects.toThrow(
            /permission-denied|host/i
        );
    });

    it('rejects a request that has already been resolved', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        await denyReconnectRequest(ROOM, requestId);

        await expect(denyReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'This request has already been denied.'
        );
    });
});
