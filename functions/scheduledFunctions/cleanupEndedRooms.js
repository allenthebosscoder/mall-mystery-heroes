const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { selectExpiredRooms } = require('./selectExpiredRooms');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// null = deliberate no-op. The mechanism is fully built; only the actual
// duration is undecided (docs/superpowers/specs/2026-08-06-player-access-
// and-room-lifecycle-design.md). Flip this to a number to turn it on.
let RETENTION_DAYS = null;

// Test-only seam — the alternative (injecting retentionDays as a
// parameter to cleanupEndedRooms) would change this function's signature
// away from what functions.pubsub.schedule(...).onRun(handler) expects
// (no arguments), so the emulator test flips this module-level value
// directly instead.
const setRetentionDaysForTesting = (days) => {
    RETENTION_DAYS = days;
};

const cleanupEndedRooms = functions.pubsub.schedule('every 24 hours').onRun(async () => {
    if (RETENTION_DAYS === null) return null;

    const now = new Date();
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const roomsSnapshot = await db.collection('rooms').where('endedAt', '<=', cutoff).get();
    const rooms = roomsSnapshot.docs.map((doc) => ({
        id: doc.id,
        endedAt: doc.data().endedAt ? doc.data().endedAt.toDate() : null,
    }));

    const expiredRoomIds = selectExpiredRooms(rooms, now, RETENTION_DAYS);

    for (const roomId of expiredRoomIds) {
        await db.recursiveDelete(db.collection('rooms').doc(roomId));
    }

    return null;
});

module.exports = { cleanupEndedRooms, setRetentionDaysForTesting };
