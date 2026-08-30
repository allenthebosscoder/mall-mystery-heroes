const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.FieldValue —
// see joinRoom.js's/undoMissionCompletion.js's identical comment for why
// (the Functions emulator strips static properties off the top-level
// admin.firestore binding).
const { FieldValue } = require('firebase-admin/firestore');
const { planRemap } = require('../vendor/game/remapPlan');
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The shared removal step both leaveGame and removePlayer call: unmaps
 * playerDoc from the target graph — mirrors killPlayer.js's unmap-then-
 * remap section exactly, minus the score-transfer and isAlive/openSeason
 * reset pieces, which are kill-specific — then deletes the player's own
 * document instead of updating it
 * (docs/superpowers/specs/2026-08-29-player-leave-and-kick-design.md).
 */
const removeAndRemap = async (transaction, roomRef, playerDoc) => {
    const playersRef = roomRef.collection('players');
    const playerData = playerDoc.data();
    const playerKey = normalizePlayerName(playerData.name);

    // The removed player's former hunters and prey — these need
    // unmapping. Deduped by normalized name, same reasoning as
    // killPlayer.js: a stale reference to a since-deleted player
    // shouldn't block this removal, so it's skipped, not thrown.
    const neighborNames = [...(playerData.assassins || []), ...(playerData.targets || [])];
    const neighborDocsByName = new Map();
    for (const name of neighborNames) {
        const key = normalizePlayerName(name);
        if (neighborDocsByName.has(key)) continue;
        const neighborSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', key)
        );
        if (neighborSnapshot.empty) {
            console.warn(`removePlayer: neighbor not found, skipping unmap: ${name}`);
            continue;
        }
        neighborDocsByName.set(key, neighborSnapshot.docs[0]);
    }

    // The alive roster for the remap step, as planRemap expects it: the
    // removed player excluded (their deletion write hasn't landed yet
    // within this transaction) and scrubbed from every neighbor's own
    // targets/assassins arrays (their unmap write hasn't landed yet
    // either) — identical reasoning to killPlayer.js's own roster read.
    const rosterSnapshot = await transaction.get(playersRef.where('isAlive', '==', true));
    const rosterDocsByName = new Map();
    const roster = [];
    for (const doc of rosterSnapshot.docs) {
        const docData = doc.data();
        if (docData.trimmedNameLowerCase === playerKey) continue;
        rosterDocsByName.set(normalizePlayerName(docData.name), doc);
        roster.push({
            name: docData.name,
            targets: (docData.targets || []).filter(
                (name) => normalizePlayerName(name) !== playerKey
            ),
            assassins: (docData.assassins || []).filter(
                (name) => normalizePlayerName(name) !== playerKey
            ),
        });
    }

    const plan = planRemap(roster, {
        needTargets: playerData.assassins || [],
        needAssassins: playerData.targets || [],
    });

    // --- write phase ---

    const pendingUpdates = new Map();
    const queueUpdate = (name, ref, fields) => {
        const key = normalizePlayerName(name);
        const existing = pendingUpdates.get(key);
        if (existing) {
            Object.assign(existing.fields, fields);
        } else {
            pendingUpdates.set(key, { ref, fields: { ...fields } });
        }
    };

    for (const name of playerData.assassins || []) {
        const neighborDoc = neighborDocsByName.get(normalizePlayerName(name));
        if (!neighborDoc) continue;
        const newTargets = (neighborDoc.data().targets || []).filter(
            (n) => normalizePlayerName(n) !== playerKey
        );
        queueUpdate(name, neighborDoc.ref, { targets: newTargets });
    }
    for (const name of playerData.targets || []) {
        const neighborDoc = neighborDocsByName.get(normalizePlayerName(name));
        if (!neighborDoc) continue;
        const newAssassins = (neighborDoc.data().assassins || []).filter(
            (n) => normalizePlayerName(n) !== playerKey
        );
        queueUpdate(name, neighborDoc.ref, { assassins: newAssassins });
    }

    for (const write of plan.writes) {
        const doc = rosterDocsByName.get(normalizePlayerName(write.player));
        if (!doc) continue; // defensive; every plan.writes entry came from `roster`
        queueUpdate(write.player, doc.ref, {
            targets: write.targets,
            assassins: write.assassins,
        });
    }

    for (const { ref, fields } of pendingUpdates.values()) {
        transaction.update(ref, fields);
    }

    transaction.delete(playerDoc.ref);

    return {
        removedPlayerName: playerData.name,
        addedTargets: plan.added.targets,
        addedAssassins: plan.added.assassins,
        remapLogs: plan.logs,
    };
};

/**
 * Removes the calling player from the room for good — self-service.
 * Resolves which player to remove from the caller's own uid, so a player
 * can only ever remove themselves. Announces the departure itself (a
 * logs entry and a broadcast playerMessages entry, inside this same
 * transaction) since firestore.rules restricts both collections to
 * `isHostOfExistingRoom` — a player's own browser cannot write either
 * directly, the same reason submitChatMessage.js/submitKillPhoto.js had
 * to move player-initiated writes behind the Admin SDK.
 */
exports.leaveGame = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId } = data;
    if (!roomId) {
        throw new functions.https.HttpsError('invalid-argument', 'roomId is required.');
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }

        const playerSnapshot = await transaction.get(
            playersRef.where('uid', '==', context.auth.uid)
        );
        if (playerSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', 'You have not joined this room.');
        }
        const playerDoc = playerSnapshot.docs[0];

        const result = await removeAndRemap(transaction, roomRef, playerDoc);

        const logRef = roomRef.collection('logs').doc();
        transaction.set(logRef, {
            time: new Date().toLocaleTimeString(),
            log: `${result.removedPlayerName} left the game`,
            color: 'gray.400',
            timestamp: FieldValue.serverTimestamp(),
        });

        const messageRef = roomRef.collection('playerMessages').doc();
        transaction.set(messageRef, {
            type: 'broadcast',
            recipient: null,
            text: `${result.removedPlayerName} left the game`,
            standings: null,
            timestamp: FieldValue.serverTimestamp(),
        });

        return result;
    });
});

/**
 * Removes a named player from the room for good — host-only, powers the
 * console's `/kick <player>` command. Writes only the shared removal
 * fields; unlike leaveGame, this does not announce anything itself — the
 * host's own, already-privileged browser (ChatInput.js) logs and
 * broadcasts after the call succeeds, exactly like `/kill` already does.
 */
exports.removePlayer = functions.https.onCall(async (data, context) => {
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

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can remove a player.'
            );
        }

        const playerSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizePlayerName(playerName))
        );
        if (playerSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${playerName}`);
        }
        const playerDoc = playerSnapshot.docs[0];

        return removeAndRemap(transaction, roomRef, playerDoc);
    });
});
