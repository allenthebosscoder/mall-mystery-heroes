const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { normalizePlayerName } = require('../../src/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Lets a player join a room from their own device — the player-facing
 * counterpart to dbCalls.addPlayerForRoom, callable by anyone signed in
 * (Google or anonymous/guest), not just the room's host
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely —
 * unlike killPlayer, there is deliberately no host-only check: any
 * signed-in caller may join any room still in its Lobby phase.
 */
exports.joinRoom = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, playerName } = data;
    if (!roomId || !playerName) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and playerName are both required.'
        );
    }

    const roomRef = db.collection('rooms').doc(roomId);
    const trimmedLowercaseName = normalizePlayerName(playerName);
    const playerRef = roomRef.collection('players').doc(trimmedLowercaseName);

    return db.runTransaction(async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().gameStarted) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This game has already started.'
            );
        }

        const existing = await transaction.get(playerRef);
        if (existing.exists) {
            throw new functions.https.HttpsError(
                'already-exists',
                `${playerName} is already taken in this room.`
            );
        }

        transaction.set(playerRef, {
            name: playerName,
            trimmedNameLowerCase: trimmedLowercaseName,
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            openSeason: false,
        });
    });
});
