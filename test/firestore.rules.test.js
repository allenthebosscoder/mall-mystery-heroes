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
 */
const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, setDoc, updateDoc, collection, addDoc } = require('firebase/firestore');

const PROJECT_ID = 'demo-mall-mystery-heroes';
const HOST_UID = 'host-uid';
const OTHER_UID = 'other-uid';

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
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), {
            name: 'alice',
            score: 10,
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

    it('allows any signed-in user to read', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows the host to update their own room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(updateDoc(doc(db, 'rooms', 'room-a'), { isGameActive: false }));
    });

    it('denies a non-host update to another room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
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

describe('rooms/{roomId}/players/{playerId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
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

describe('rooms/{roomId}/photos/{photoId} (interim: host-only, see firestore.rules comment)', () => {
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
