const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.Timestamp /
// admin.firestore.FieldValue: the Functions emulator wraps the top-level
// admin.firestore property in a Function.prototype.bind() (see
// firebase-tools' functionsEmulatorRuntime.js Proxied.getOriginal), and a
// bound function carries none of the original's static properties —
// admin.firestore.Timestamp/FieldValue are undefined under `npm run
// test:emulator` even though they resolve fine outside the emulator (see
// joinRoom.js's identical comment on FieldValue, and submitKillPhoto.js's
// identical fix). This subpath import isn't proxied the same way.
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
// Vendored copy, not '../../src/game/rateLimit' — Cloud Functions deploy
// uploads only the functions/ directory in isolation, so a require()
// reaching outside it cannot resolve in the deployed bundle even though it
// works locally and under the emulator. Kept in sync by
// functions/scripts/sync-shared-game-logic.js (predeploy hook + local test
// setup) — src/game/ remains the single source of truth.
const { nextRateLimitWindow } = require('../vendor/game/rateLimit');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

const CHAT_RATE_LIMIT = { max: 20, windowMs: 60000 };

/**
 * Writes a player chat message on the caller's behalf, deriving who the
 * caller actually is from context.auth.uid rather than trusting a
 * client-supplied `sender` field — closing the identity-spoofing gap
 * addChatMessageForRoom (src/components/firebase_calls/dbCalls.js,
 * deleted in Task 5 of this plan) had. Also enforces the room being
 * active and a per-player rate limit
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely.
 * firestore.rules's `playerMessages` `allow write: if
 * isHostOfExistingRoom` clause for GM broadcasts/whispers/leaderboard/
 * mission messages is untouched and unaffected by this function — those
 * write a different set of `type` values (never `'chat'`) through a
 * separate, still-existing dbCalls.addPlayerMessageForRoom path.
 */
exports.submitChatMessage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, text } = data;
    if (!roomId || !text) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and text are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }

        const senderSnapshot = await transaction.get(
            playersRef.where('uid', '==', context.auth.uid)
        );
        if (senderSnapshot.empty) {
            throw new functions.https.HttpsError(
                'not-found',
                'You are not a player of this room.'
            );
        }
        const senderDoc = senderSnapshot.docs[0];
        const senderData = senderDoc.data();

        if (!roomSnapshot.data().isGameActive) {
            throw new functions.https.HttpsError('failed-precondition', 'This game has ended.');
        }

        const rateLimits = senderData.rateLimits || {};
        const currentWindow = rateLimits.chat
            ? {
                  windowStartMs: rateLimits.chat.windowStart.toMillis(),
                  count: rateLimits.chat.count,
              }
            : null;
        const nextWindow = nextRateLimitWindow(currentWindow, Date.now(), CHAT_RATE_LIMIT);
        if (!nextWindow) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many submissions — slow down and try again in a moment.'
            );
        }

        transaction.update(senderDoc.ref, {
            rateLimits: {
                ...rateLimits,
                chat: {
                    windowStart: Timestamp.fromMillis(nextWindow.windowStartMs),
                    count: nextWindow.count,
                },
            },
        });

        transaction.create(roomRef.collection('playerMessages').doc(), {
            type: 'chat',
            recipient: null,
            text,
            standings: null,
            mission: null,
            sender: senderData.name,
            timestamp: FieldValue.serverTimestamp(),
        });
    });
});
