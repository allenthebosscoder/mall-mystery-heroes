/**
 * Layer 1b — the identity-verified chat-message submission Cloud
 * Function, against the real Functions, Firestore, and Auth emulators
 * together. Same approach as submitKillPhoto.integration.test.js and
 * executeKill.integration.test.js.
 */
import { httpsCallable } from 'firebase/functions';
import { terminate, getDocs, Timestamp } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from './firebase_calls/dbCalls';
import {
    callableAsNonHost,
    clearFirestore,
    createIndependentIdentity,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('submitChatMessage', () => {
    it("writes the message with the caller's own real name as sender, never a client-supplied one", async () => {
        const alice = await createIndependentIdentity();
        try {
            // Seeded via the default (host) db, not alice.db: alice is a
            // player here, not the room's host, and firestore.rules' room
            // `allow create` requires hostId == the writer's own
            // request.auth.uid (test/emulatorHelpers.js's
            // createIndependentIdentity comment documents this same
            // constraint for a from-scratch room). Only alice's `uid` field
            // on her own player doc — not who writes the room — is what
            // submitChatMessage's identity derivation actually depends on.
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await call({ roomId: ROOM, text: 'hey where are you' });

            const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(1);
            expect(snapshot.docs[0].data()).toMatchObject({
                type: 'chat',
                recipient: null,
                text: 'hey where are you',
                standings: null,
                mission: null,
                sender: 'alice',
            });
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a caller who is not a player of the room', async () => {
        await seedRoom(ROOM, []);
        const call = callableAsNonHost('submitChatMessage');

        await expect(call({ roomId: ROOM, text: 'hi' })).rejects.toThrow(
            'You are not a player of this room.'
        );
    });

    it('rejects once the game has ended', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { isGameActive: false });
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'hi' })).rejects.toThrow(
                'This game has ended.'
            );
        } finally {
            await terminate(alice.db);
        }
    });

    it('allows up to 20 messages in a window and rejects the 21st', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            for (let i = 0; i < 20; i += 1) {
                await expect(call({ roomId: ROOM, text: `msg-${i}` })).resolves.toBeDefined();
            }

            await expect(call({ roomId: ROOM, text: 'msg-20' })).rejects.toThrow(
                'Too many submissions'
            );
        } finally {
            await terminate(alice.db);
        }
    }, 30000);

    it('allows a message again once the window has elapsed, even if the cap was reached', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [
                {
                    name: 'alice',
                    uid: alice.uid,
                    rateLimits: {
                        chat: {
                            windowStart: Timestamp.fromMillis(Date.now() - 61000),
                            count: 20,
                        },
                    },
                },
            ]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'hi again' })).resolves.toBeDefined();
        } finally {
            await terminate(alice.db);
        }
    });
});
