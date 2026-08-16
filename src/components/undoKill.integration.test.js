/**
 * Layer 1b — the atomic kill-undo Cloud Function, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `undoKill` is a thin wrapper around
 * `httpsCallable(functions, 'undoKillPlayer')` — these tests call it
 * exactly the way the real app does, then assert on what actually landed
 * in Firestore, rather than asserting against the function's internals
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md). Each test
 * builds a real approved kill photo first (via the real `executeKill` +
 * `addPhotoForRoom` + `approvePhotoForRoom`), matching exactly what
 * `PhotosDisplay.js`'s Accept flow does, so the snapshot being undone is
 * genuine, not hand-constructed.
 */
import { getDocs } from 'firebase/firestore';
import { undoKill } from './undoKill';
import { executeKill } from './executeKill';
import {
    addPhotoForRoom,
    approvePhotoForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
} from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

const latestPhotoId = async () => {
    const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
    return snapshot.docs[0].id;
};

describe('undoKill', () => {
    it('reverts a simple kill: killer and target both restored, photo back to pending', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        await undoKill(ROOM, photoId);

        const alice = (await fetchPlayerForRoom('alice', ROOM)).data();
        expect(alice.score).toBe(10);
        expect(alice.targets).toEqual(['bob']);
        expect(alice.assassins).toEqual([]);

        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(true);
        expect(bob.score).toBe(5);
        expect(bob.targets).toEqual([]);
        expect(bob.assassins).toEqual(['alice']);

        const photoSnapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(photoSnapshot.docs[0].data().status).toBe('pending');
    });

    it('reverts a kill whose remap touched a third player, restoring their targets/assassins too', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
            { name: 'carol', targets: [], assassins: [] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        // Confirm the remap actually touched carol before undoing, so this
        // test is proven non-vacuous.
        expect((await fetchPlayerForRoom('carol', ROOM)).data().assassins).toEqual(['alice']);

        await undoKill(ROOM, photoId);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(10);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().targets).toEqual(['bob']);
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);

        const carol = (await fetchPlayerForRoom('carol', ROOM)).data();
        expect(carol.targets).toEqual([]);
        expect(carol.assassins).toEqual([]);
    });

    it('rejects undo of a photo that is not approved', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();
        // Photo is still 'pending' — never approved.

        await expect(undoKill(ROOM, photoId)).rejects.toThrow(/not approved|nothing to undo/i);

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();
        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        const undoAsNonHost = callableAsNonHost('undoKillPlayer');
        await expect(undoAsNonHost({ roomId: ROOM, photoId })).rejects.toThrow(
            /permission-denied|host/i
        );

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    });
});
