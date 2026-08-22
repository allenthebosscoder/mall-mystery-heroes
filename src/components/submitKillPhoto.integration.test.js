/**
 * Layer 1b — the identity-verified kill-photo submission Cloud Function,
 * against the real Functions, Firestore, and Auth emulators together.
 * The client wrapper (./submitKillPhoto.js) is a two-line pass-through of
 * httpsCallable(functions, 'submitKillPhoto') bound to the process-wide
 * singleton `functions` instance, so it can't be called as a specific,
 * independently-seeded identity the way these tests need — each test calls
 * httpsCallable directly against its own identity's own `functions`
 * instance instead (`alice.functions`, or `callableAsNonHost`'s), then
 * asserts on what actually landed in Firestore, matching
 * executeKill.integration.test.js's approach
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 */
import { httpsCallable } from 'firebase/functions';
import { terminate, getDocs, Timestamp } from 'firebase/firestore';
import { fetchPhotosQueryByAscendingTimestampForRoom } from './firebase_calls/dbCalls';
import {
    callableAsNonHost,
    clearFirestore,
    createIndependentIdentity,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';
const REALISTIC_URL =
    'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Ftest-room%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('submitKillPhoto', () => {
    it("writes the photo with the caller's own real name as assassin, never a client-supplied one", async () => {
        const alice = await createIndependentIdentity();
        try {
            // Seeded via the default (host) db, not alice.db: alice is a
            // player here, not the room's host, and firestore.rules' room
            // `allow create` requires hostId == the writer's own
            // request.auth.uid (test/emulatorHelpers.js's
            // createIndependentIdentity comment documents this same
            // constraint for a from-scratch room). Only alice's `uid` field
            // on her own player doc — not who writes the room — is what
            // submitKillPhoto's identity derivation actually depends on.
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL });

            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(1);
            expect(snapshot.docs[0].data()).toMatchObject({
                assassin: 'alice',
                target: 'bob',
                url: REALISTIC_URL,
                status: 'pending',
                originalPlayerData: null,
            });
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a url that does not point at this room’s own Storage path', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, target: 'bob', url: 'https://evil.example.com/x.jpg' })
            ).rejects.toThrow("url does not point at this room's own Storage path.");
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a caller who is not a player of the room', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const call = callableAsNonHost('submitKillPhoto');

        await expect(call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })).rejects.toThrow(
            'You are not a player of this room.'
        );
    });

    it('rejects once the game has ended', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }], {
                isGameActive: false,
            });
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })).rejects.toThrow(
                'This game has ended.'
            );
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects an unknown target', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, target: 'nobody', url: REALISTIC_URL })
            ).rejects.toThrow('Player not found: nobody');
        } finally {
            await terminate(alice.db);
        }
    });

    it('allows up to 10 submissions in a window and rejects the 11th', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            for (let i = 0; i < 10; i += 1) {
                await expect(
                    call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })
                ).resolves.toBeDefined();
            }

            await expect(call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })).rejects.toThrow(
                'Too many submissions'
            );
        } finally {
            await terminate(alice.db);
        }
    }, 30000);

    it('allows a submission again once the window has elapsed, even if the cap was reached', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [
                {
                    name: 'alice',
                    uid: alice.uid,
                    rateLimits: {
                        photo: {
                            windowStart: Timestamp.fromMillis(Date.now() - 61000),
                            count: 10,
                        },
                    },
                },
                { name: 'bob' },
            ]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })
            ).resolves.toBeDefined();
        } finally {
            await terminate(alice.db);
        }
    });
});
