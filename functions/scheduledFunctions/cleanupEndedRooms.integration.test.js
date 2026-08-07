/**
 * Layer 1b — the scheduled room-cleanup function, against the real
 * Firestore emulator. Run with `npm run test:emulator`.
 *
 * Unlike killPlayer/joinRoom, there is no client-facing httpsCallable to
 * go through — a scheduled function's only real caller is Cloud
 * Scheduler. firebase-functions-test's wrap() invokes the .onRun()
 * handler directly instead, which is as close to "the real interface" as
 * a cron job has
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 */
const admin = require('firebase-admin');
// cleanupEndedRooms must be required before firebase-functions-test() runs:
// calling firebase-functions-test() with no config overwrites
// process.env.GCLOUD_PROJECT with a mock "not-a-project" value (see
// node_modules/firebase-functions-test/lib/lifecycle.js). cleanupEndedRooms.js
// calls admin.initializeApp() at module load with no explicit config, so it
// picks up GCLOUD_PROJECT at require-time — if firebase-functions-test() ran
// first, the Admin SDK would initialize against "not-a-project" instead of
// this suite's actual demo project, and every read/write would silently miss
// the data seedRoom (client SDK, correctly targeted) just wrote.
const { cleanupEndedRooms, setRetentionDaysForTesting } = require('./cleanupEndedRooms');
const functionsTest = require('firebase-functions-test')();
const { clearFirestore, seedRoom, shutdown } = require('../../test/emulatorHelpers');

beforeEach(clearFirestore);
afterAll(async () => {
    functionsTest.cleanup();
    await shutdown();
});

const db = admin.firestore();

describe('cleanupEndedRooms', () => {
    it('does nothing when the retention window is unset (feature off)', async () => {
        setRetentionDaysForTesting(null);
        await seedRoom('old-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('old-room').get();
        expect(room.exists).toBe(true);
    });

    it('deletes a room and its player subcollection once past the retention window', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('old-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('old-room').get();
        expect(room.exists).toBe(false);
        const players = await db.collection('rooms').doc('old-room').collection('players').get();
        expect(players.empty).toBe(true);
    });

    it('leaves a recently-ended room alone', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('recent-room', ['Alice'], {
            endedAt: new Date(),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('recent-room').get();
        expect(room.exists).toBe(true);
    });

    it('leaves a room that never ended alone', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('lobby-room', ['Alice']); // no endedAt override — never ended

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('lobby-room').get();
        expect(room.exists).toBe(true);
    });
});
