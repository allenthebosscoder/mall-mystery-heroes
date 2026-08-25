const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.Timestamp /
// admin.firestore.FieldValue: the Functions emulator wraps the top-level
// admin.firestore property in a Function.prototype.bind() (see
// firebase-tools' functionsEmulatorRuntime.js Proxied.getOriginal), and a
// bound function carries none of the original's static properties —
// admin.firestore.Timestamp/FieldValue are undefined under `npm run
// test:emulator` even though they resolve fine outside the emulator (see
// joinRoom.js's identical comment on FieldValue). This subpath import
// isn't proxied the same way.
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
// Vendored copies, not '../../src/game/...' — Cloud Functions deploy
// uploads only the functions/ directory in isolation, so a require()
// reaching outside it cannot resolve in the deployed bundle even though it
// works locally and under the emulator. Kept in sync by
// functions/scripts/sync-shared-game-logic.js (predeploy hook + local test
// setup) — src/game/ remains the single source of truth.
const { normalizePlayerName } = require('../vendor/game/playerNames');
const { nextRateLimitWindow } = require('../vendor/game/rateLimit');
const { isValidKillPhotoUrl } = require('../vendor/game/killPhotoUrl');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

const PHOTO_RATE_LIMIT = { max: 10, windowMs: 60000 };

/**
 * Writes a kill-photo submission on the caller's behalf, deriving who the
 * caller actually is from context.auth.uid rather than trusting a
 * client-supplied `assassin` field — closing the identity-spoofing gap
 * addPhotoForRoom (src/components/firebase_calls/dbCalls.js, deleted in
 * Task 5 of this plan) had, where any signed-in room member could claim
 * to be any named player. Also enforces the room being active and a
 * per-player rate limit, and re-implements the url-origin validation
 * firestore.rules' now-deleted player-facing `photos` allow create clause
 * used to do (docs/improvements.md item 60) — rules don't apply to the
 * Admin SDK, so this is the actual enforcement for all of it now
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely.
 * firestore.rules's `photos` `allow write: if isHostOfExistingRoom`
 * clause for GM approve/deny/undo actions is untouched and unaffected by
 * this function.
 *
 * Also writes a `killPhoto` playerMessages doc in the same transaction, so
 * the submission shows up in every player's chat the moment it lands —
 * see MessageBubble.js for how it's rendered and PhotosDisplay.js for the
 * matching `killResult` message a moderator's decision posts later.
 */
exports.submitKillPhoto = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, target, url } = data;
    if (!roomId || !target || !url) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId, target, and url are all required.'
        );
    }
    if (!isValidKillPhotoUrl(url, roomId)) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            "url does not point at this room's own Storage path."
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        // --- read phase ---

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }

        const assassinSnapshot = await transaction.get(
            playersRef.where('uid', '==', context.auth.uid)
        );
        if (assassinSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', 'You are not a player of this room.');
        }
        // Nothing enforces one player doc per uid per room: joinRoom.js
        // checks only that the *name* is not taken, so the same uid
        // revisiting /join under a second name owns two player docs here
        // (docs/improvements.md item 66). Taking docs[0] would silently
        // attribute the claim to whichever name sorts first, and would
        // permanently lock the other identity out of submitting as itself.
        // Fail loudly instead — the GM can delete the stray player doc.
        if (assassinSnapshot.size > 1) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Multiple player identities are linked to your account in this room — ask your GM for help.'
            );
        }
        const assassinDoc = assassinSnapshot.docs[0];
        const assassinData = assassinDoc.data();

        if (!roomSnapshot.data().isGameActive) {
            throw new functions.https.HttpsError('failed-precondition', 'This game has ended.');
        }

        const targetSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizePlayerName(target))
        );
        if (targetSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${target}`);
        }

        const rateLimits = assassinData.rateLimits || {};
        const currentWindow = rateLimits.photo
            ? {
                  windowStartMs: rateLimits.photo.windowStart.toMillis(),
                  count: rateLimits.photo.count,
              }
            : null;
        const nextWindow = nextRateLimitWindow(currentWindow, Date.now(), PHOTO_RATE_LIMIT);
        if (!nextWindow) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many submissions — slow down and try again in a moment.'
            );
        }

        // --- write phase ---

        transaction.update(assassinDoc.ref, {
            rateLimits: {
                ...rateLimits,
                photo: {
                    windowStart: Timestamp.fromMillis(nextWindow.windowStartMs),
                    count: nextWindow.count,
                },
            },
        });

        transaction.create(roomRef.collection('photos').doc(), {
            url,
            assassin: assassinData.name,
            target,
            timestamp: FieldValue.serverTimestamp(),
            status: 'pending',
            originalPlayerData: null,
        });

        // Posts the photo into the room's own chat immediately, so every
        // player sees the attempt as it happens — the submission itself is
        // the confirmation the assassin gets that it went through, no
        // separate private notice needed.
        transaction.create(roomRef.collection('playerMessages').doc(), {
            type: 'killPhoto',
            recipient: null,
            text: null,
            standings: null,
            mission: null,
            sender: null,
            photoUrl: url,
            assassin: assassinData.name,
            target,
            timestamp: FieldValue.serverTimestamp(),
        });
    });
});
