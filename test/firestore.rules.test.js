/**
 * Layer 2 — Firestore security rules, against the emulator.
 *
 * Run with `npm run test:rules`, which starts the Firestore emulator around
 * them. @firebase/rules-unit-testing mints synthetic authenticated /
 * unauthenticated contexts directly, so unlike the integration project this
 * does not touch the Auth emulator or the real client SDK in
 * src/utils/firebase.js.
 *
 * See docs/improvements.md item 2 for the design and docs/testing.md's
 * "Layer 2" section for the four baseline assertions these are built from.
 * Reads are additionally scoped to "host or player of this room" as of
 * docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md
 * — PLAYER_UID below is a player who has joined room-a (present in its
 * joinedUids array); OTHER_UID is a signed-in stranger who has not.
 *
 * A separate `allow list` grant (docs/superpowers/specs/2026-08-08-
 * dashboard-removal-design.md) lets a host query `rooms` filtered to their
 * own hostId, so DashBoard.js can find a room they're already running
 * instead of always creating a new one. Firestore only allows a `list`
 * query when the rule is provably true for every possible result of that
 * exact query shape — a `get()`-based check like isHostOfExistingRoom
 * can't be proven that way, so this grant checks `resource.data` directly.
 */
const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    collection,
    addDoc,
    query,
    where,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-mall-mystery-heroes';
const HOST_UID = 'host-uid';
const OTHER_UID = 'other-uid';
const PLAYER_UID = 'player-uid';

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
            host: 'localhost',
            port: 8081,
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seeding bypasses rules entirely, same reason emulatorHelpers.seedRoom
    // does not go through dbCalls: the rules under test should not gate setup.
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'rooms', 'room-a'), {
            hostId: HOST_UID,
            isGameActive: true,
            taskIndex: 1,
            joinedUids: [PLAYER_UID],
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), {
            name: 'alice',
            score: 10,
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'players', 'bob'), {
            name: 'bob',
            score: 10,
            uid: PLAYER_UID,
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), {
            title: 'Find the fountain',
            isComplete: false,
        });
    });
});

describe('rooms/{roomId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows a player who has joined this room to read it', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows the host to read their own room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows a signed-in user to read a room ID that does not exist yet (checkForRoomIDDupes)', async () => {
        // handleHostRoom / checkForRoomIDDupes reads a candidate room ID
        // specifically expecting it not to exist yet. Nobody can be the
        // host or a joined player of a room that was never created, so
        // this must succeed (with an exists()===false snapshot) for any
        // signed-in user, not error out or come back permission-denied.
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'totally-nonexistent-room-id')));
    });

    it('allows the host to list rooms filtered to their own hostId (DashBoard resume-room lookup)', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        const roomsQuery = query(collection(db, 'rooms'), where('hostId', '==', HOST_UID));
        const snapshot = await assertSucceeds(getDocs(roomsQuery));
        expect(snapshot.docs.map((d) => d.id)).toEqual(['room-a']);
    });

    it('denies listing rooms filtered to someone elses hostId', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        const roomsQuery = query(collection(db, 'rooms'), where('hostId', '==', HOST_UID));
        await assertFails(getDocs(roomsQuery));
    });

    it('allows the host to update their own room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(updateDoc(doc(db, 'rooms', 'room-a'), { isGameActive: false }));
    });

    it('denies a non-host update to another room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(updateDoc(doc(db, 'rooms', 'room-a'), { isGameActive: false }));
    });

    it('denies a joined player from updating a room they did not host', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(updateDoc(doc(db, 'rooms', 'room-a'), { isGameActive: false }));
    });

    it('allows a signed-in user to create a room they claim as their own', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertSucceeds(
            setDoc(doc(db, 'rooms', 'room-b'), {
                hostId: OTHER_UID,
                isGameActive: true,
                taskIndex: 1,
            })
        );
    });

    it('denies creating a room claimed as hosted by someone else', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            setDoc(doc(db, 'rooms', 'room-c'), {
                hostId: HOST_UID,
                isGameActive: true,
                taskIndex: 1,
            })
        );
    });
});

describe('subcollections of a room ID that does not exist yet (regression: previous fix round made isHostOfExistingRoom/isPlayerOfRoom return true for a nonexistent room, which — since those two functions are shared by the subcollection rules below — opened a public read/write hole under any made-up room ID)', () => {
    it('denies a signed-in stranger writing into players/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            setDoc(doc(db, 'rooms', 'totally-nonexistent-room-id', 'players', 'evil'), {
                name: 'evil',
                score: 0,
            })
        );
    });

    it('denies a signed-in stranger reading players/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            getDoc(doc(db, 'rooms', 'totally-nonexistent-room-id', 'players', 'anything'))
        );
    });

    it('denies a signed-in stranger writing into tasks/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            setDoc(doc(db, 'rooms', 'totally-nonexistent-room-id', 'tasks', 'evil'), {
                title: 'evil',
                isComplete: false,
            })
        );
    });

    it('denies a signed-in stranger reading tasks/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            getDoc(doc(db, 'rooms', 'totally-nonexistent-room-id', 'tasks', 'anything'))
        );
    });

    it('denies a signed-in stranger writing into logs/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'totally-nonexistent-room-id', 'logs'), {
                log: 'evil',
                color: 'gray',
            })
        );
    });

    it('denies a signed-in stranger reading logs/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'totally-nonexistent-room-id', 'logs')));
    });

    it('denies a signed-in stranger writing into photos/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'totally-nonexistent-room-id', 'photos'), {
                url: 'evil',
                status: 'pending',
            })
        );
    });

    it('denies a signed-in stranger writing into playerMessages/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'totally-nonexistent-room-id', 'playerMessages'), {
                type: 'broadcast',
                recipient: null,
                text: 'evil',
                standings: null,
            })
        );
    });
});

describe('rooms/{roomId}/players/{playerId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('allows a player who has joined this room to read the roster', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            updateDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), { score: 999 })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            updateDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), { score: 15 })
        );
    });
});

describe('rooms/{roomId}/tasks/{taskId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('allows a player who has joined this room to read tasks', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            updateDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), { isComplete: true })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            updateDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), { isComplete: true })
        );
    });
});

describe('rooms/{roomId}/logs/{logId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('allows a player who has joined this room to read logs', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'logs'), { log: 'x', color: 'gray' })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'logs'), { log: 'x', color: 'gray' })
        );
    });
});

describe('rooms/{roomId}/photos/{photoId} (interim: host-only write, see firestore.rules comment)', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('allows a player who has joined this room to read photos', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
        );
    });
});

describe('rooms/{roomId}/playerMessages/{messageId} (interim: host-only write, see firestore.rules comment)', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

    it('allows a player who has joined this room to read player messages', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
                type: 'broadcast',
                recipient: null,
                text: 'x',
                standings: null,
            })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
                type: 'broadcast',
                recipient: null,
                text: 'x',
                standings: null,
            })
        );
    });
});
