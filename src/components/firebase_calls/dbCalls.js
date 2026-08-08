import { db } from '../../utils/firebase';
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    updateDoc,
    addDoc,
    orderBy,
    deleteDoc,
    arrayUnion,
    runTransaction,
    increment,
    serverTimestamp,
} from 'firebase/firestore';
// Every player lookup below queries this instead of the case-preserved `name`
// field, so GM input is case- and whitespace-insensitive end to end
// (docs/improvements.md item 1). addPlayerForRoom already wrote this field
// for duplicate detection; this is what makes it load-bearing for reads too.
// Shared with ChatInput.js and executeKill.js (docs/improvements.md item 35)
// so every caller strips whitespace identically, not just this file's own
// queries.
import { normalizePlayerName } from '../../game/playerNames';

//fetches all players from database
export const fetchAllPlayersForRoom = async (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerSnapshot = await getDocs(playerCollectionRef);
    return playerSnapshot.docs.map((doc) => doc.data().name);
};

//fetch all players by living status from database
export const fetchPlayersByStatusForRoom = async (isAlive, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(playerCollectionRef, where('isAlive', '==', isAlive));
    const playerSnapshot = await getDocs(playerQuery);
    return playerSnapshot.docs.map((doc) => doc.data().name);
};

// returns a query of logs by ascending timestamp — same shape as
// fetchPhotosQueryByAscendingTimestampForRoom (docs/improvements.md item 22)
export const fetchLogsQueryByAscendingTimestampForRoom = (roomID) => {
    const logsCollectionRef = collection(db, 'rooms', roomID, 'logs');
    return query(logsCollectionRef, orderBy('timestamp', 'asc'));
};

// Adds a log entry to the room's logs subcollection. Replaces
// updateLogsForRoom (docs/improvements.md item 22) — logs used to live as an
// array field on the room document, capped by Firestore's 1MiB document
// limit and rewritten in full on every message; arrayUnion also silently
// dropped two messages with identical {time, log, color} (deep-equality
// dedup). Named add…, not update…, per this file's convention (add…For…
// creates a new document, matching addPlayerForRoom/addTaskForRoom) — an
// addDoc into a subcollection isn't an update to an existing one. Returns
// nothing: callers subscribe to fetchLogsQueryByAscendingTimestampForRoom
// instead of consuming a return value.
export const addLogForRoom = async (newLog, color, roomID) => {
    const logsCollectionRef = collection(db, 'rooms', roomID, 'logs');
    await addDoc(logsCollectionRef, {
        time: new Date().toLocaleTimeString(),
        log: newLog,
        color,
        timestamp: serverTimestamp(),
    });
};

// Adds a player-facing message to the room's playerMessages subcollection —
// the write-side half of a contract with the player mobile app that
// doesn't exist yet (docs/superpowers/specs/2026-08-06-player-messaging-
// mobile-prep-design.md), the same interim shape `photos` already uses.
// `message` is `{ type, recipient, text, standings }` — see the spec for
// which fields apply to which `type`.
export const addPlayerMessageForRoom = async (message, roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    await addDoc(messagesRef, { ...message, timestamp: serverTimestamp() });
};

//fetches all tasks by completion from database
export const fetchTasksByCompletionForRoom = async (isComplete, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(taskCollectionRef, where('isComplete', '==', isComplete));
    return await getDocs(taskQuery);
};

// fetches a task's data by its index from database
export const fetchTaskByIndexForRoom = async (index, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
    const taskSnapshot = await getDocs(taskQuery);
    return taskSnapshot.empty ? null : taskSnapshot.docs[0].data();
};

//updates player's score
//
// Uses Firestore's increment() so concurrent calls (two GMs, or a GM plus a
// task completion) add up instead of racing on a read-then-write and
// silently dropping one of the increments (docs/improvements.md item 7).
export const updatePointsForPlayer = async (player, points, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerdoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerdoc, { score: increment(points) });
};

//updates the 'isAlive' field of a player
export const updateIsAliveForPlayer = async (player, isAlive, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerdoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerdoc, { isAlive: isAlive });
};

//marks task as completed by index
export const updateIsCompleteToTrueForTaskByIndex = async (index, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
    const taskSnapshot = await getDocs(taskQuery);
    if (taskSnapshot.empty) {
        throw new Error('Task not found');
    }
    await updateDoc(taskSnapshot.docs[0].ref, { isComplete: true });
};
//updates the 'completedBy' field of a task
export const addPlayerToCompletedByForTask = async (taskDocRef, player) => {
    await updateDoc(taskDocRef, { completedBy: arrayUnion(player) });
};

export const addTaskForRoom = async (task, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    await addDoc(taskCollectionRef, task);
};

//check if task title already exists in database
export const checkForTaskDupesForRoom = async (task, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(
        taskCollectionRef,
        where('titleTrimmedLowerCase', '==', task.titleTrimmedLowerCase)
    );
    const taskSnapshot = await getDocs(taskQuery);
    return !taskSnapshot.empty;
};

//returns a query of alive players in descending order of score with dead players at bottom
export const fetchPlayersQueryByDescendPointsThenIsAliveForRoom = (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    return query(playerCollectionRef, orderBy('isAlive', 'desc'), orderBy('score', 'desc'));
};

// returns a query of photos by ascending order
export const fetchPhotosQueryByAscendingTimestampForRoom = (roomID) => {
    const photosCollectionRef = collection(db, 'rooms', roomID, 'photos');
    return query(photosCollectionRef, orderBy('timestamp', 'asc'));
};

// updates a photo's status in Firestore
export const updatePhotoStatusForRoom = async (roomID, photoID, status) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, { status: status });
};

// Approves a photo and persists the pre-kill player snapshot onto the photo
// document itself (docs/improvements.md item 6) — judgedPhotos used to live
// only in React state, so reloading the console lost the data an undo needs,
// even though the photo's approved/denied status was already durable.
export const approvePhotoForRoom = async (roomID, photoID, originalPlayerData) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, { status: 'approved', originalPlayerData });
};

//returns a query of all tasks for room
export const fetchTasksQueryForRoom = (roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    return query(taskCollectionRef);
};

//returns document of player
export const fetchPlayerForRoom = async (playerName, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(playerName))
    );
    const playerSnapshot = await getDocs(playerQuery);
    if (playerSnapshot.empty) {
        throw new Error('Player not found');
    }
    return playerSnapshot.docs[0];
};

//add player to database
//
// Keyed on trimmedNameLowerCase rather than an auto-generated ID so the
// duplicate check and the write can run as one atomic transaction: a plain
// query-then-addDoc lets two concurrent calls both see "no duplicate" before
// either write lands (e.g. two Enter presses during UI lag), creating two
// players with the same name. No other function in this file looks up a
// player by document ID (all query by trimmedNameLowerCase), so this is safe
// to change without touching them.
export const addPlayerForRoom = async (player, roomID) => {
    const trimmedLowercaseName = normalizePlayerName(player);
    const playerRef = doc(db, 'rooms', roomID, 'players', trimmedLowercaseName);

    await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(playerRef);
        if (existing.exists()) {
            throw new Error('Player already exists');
        }
        transaction.set(playerRef, {
            name: player,
            trimmedNameLowerCase: trimmedLowercaseName,
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            openSeason: false,
        });
    });

    return playerRef;
};

//removes player from database
export const removePlayerForRoom = async (player, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    //returns error if player not found
    if (playerSnapshot.empty) throw new Error('Player not found');
    const docRef = playerSnapshot.docs[0].ref;
    await deleteDoc(docRef);
};

//dupates assassins of player in database
export const updateAssassinsForPlayer = async (player, assassins, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerdoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerdoc, {
        assassins: assassins,
    });
};

//updates targets of player in database
export const updateTargetsForPlayer = async (player, targets, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerdoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerdoc, {
        targets: targets,
    });
};

//fetches player's assassins
export const fetchAssassinsForPlayer = async (player, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    return playerSnapshot.docs[0].data().assassins;
};

export const fetchReferenceByIndexForTask = async (index, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
    const taskSnapshot = await getDocs(taskQuery);
    if (taskSnapshot.empty) {
        throw new Error('Task not found');
    }
    return taskSnapshot.docs[0].ref;
};

//fetches array of alive player names in room
export const fetchAlivePlayerNamesForRoom = async (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(playerCollectionRef, where('isAlive', '==', true));
    const playerSnapshot = await getDocs(playerQuery);
    return playerSnapshot.docs.map((doc) => doc.data().name);
};

//fetches the full alive roster in one read, shaped for src/game/remapPlan.js
export const fetchAliveRosterForRoom = async (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(playerCollectionRef, where('isAlive', '==', true));
    const playerSnapshot = await getDocs(playerQuery);
    return playerSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            name: data.name,
            targets: data.targets ?? [],
            assassins: data.assassins ?? [],
        };
    });
};

//ends the game
export const endGame = async (roomID) => {
    const roomRef = doc(db, 'rooms', roomID);
    await updateDoc(roomRef, { isGameActive: false, endedAt: serverTimestamp() });
};

// Marks the room's Lobby phase as over — written once, when "Confirm and
// Begin Game" is clicked. Distinct from isGameActive, which is set true at
// room creation and only goes false on explicit "End Game": it answers
// "does this room still exist," not "has gameplay started"
// (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
// joinRoom (functions/callableFunctions/joinRoom.js) reads this field via
// the Admin SDK to reject self-registration once it's true.
export const markGameAsStarted = async (roomID) => {
    const roomRef = doc(db, 'rooms', roomID);
    await updateDoc(roomRef, { gameStarted: true });
};

// A reference to the room document itself, for onSnapshot — isGameActive
// used to be written by endGame and never read anywhere (docs/improvements.md
// item 15's "relatedly" note), so a room a GM had ended still fully accepted
// commands from any tab still open on it.
export const fetchRoomReferenceForRoom = (roomID) => {
    return doc(db, 'rooms', roomID);
};

export const setOpenSznOfPlayerToValueForRoom = async (openSeasonPlayer, value, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(openSeasonPlayer))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerDoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerDoc, { openSeason: value });
};

//checks if roomID already exists
export const checkForRoomIDDupes = async (roomID) => {
    const roomDocRef = doc(db, 'rooms', roomID);
    const roomSnapshot = await getDoc(roomDocRef);
    return !roomSnapshot.exists();
};

// Finds the room this host is currently running (isGameActive: true), so a
// returning GM lands back in their existing room instead of getting a new
// one created on every login (DashBoard.js,
// docs/superpowers/specs/2026-08-08-dashboard-removal-design.md). The
// firestore.rules `allow list` grant is scoped to exactly this query shape
// (`where('hostId', '==', uid)`) — Firestore can only authorize a `list`
// query when the rule is provably true for every possible result, so the
// isGameActive filter happens here in JS rather than as a second `where`
// clause. A host realistically has at most a couple of rooms, so filtering
// client-side after one read is not a real cost.
export const fetchActiveRoomForHost = async (hostId) => {
    const roomsCollectionRef = collection(db, 'rooms');
    const roomsQuery = query(roomsCollectionRef, where('hostId', '==', hostId));
    const roomsSnapshot = await getDocs(roomsQuery);
    const activeRoomDoc = roomsSnapshot.docs.find(
        (roomDoc) => roomDoc.data().isGameActive === true
    );
    if (!activeRoomDoc) return null;
    return { id: activeRoomDoc.id, gameStarted: activeRoomDoc.data().gameStarted };
};

// get task index and increment by 1
//
// Wrapped in a transaction so two concurrent mission creations can't read
// the same taskIndex and both hand it out (docs/improvements.md item 7) —
// increment() alone isn't enough here, since the caller needs to know which
// index it was assigned, not just that the counter moved.
export const fetchTaskIndexThenIncrement = async (roomID) => {
    const roomDocRef = doc(db, 'rooms', roomID);
    return runTransaction(db, async (transaction) => {
        const roomSnapshot = await transaction.get(roomDocRef);
        const index = Number(roomSnapshot.data().taskIndex);
        transaction.update(roomDocRef, { taskIndex: index + 1 });
        return index;
    });
};

export const remapPlayerAsTarget = async (revivedPlayerName, roomID, originalAssassins) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const snapshot = await getDocs(playerCollectionRef);

    for (const docSnap of snapshot.docs) {
        const player = docSnap.data();
        const docRef = docSnap.ref;

        const isAlive = player.isAlive;
        const alreadyTargeted = player.targets?.includes(revivedPlayerName);

        if (isAlive && originalAssassins.includes(player.name) && !alreadyTargeted) {
            const updatedTargets = [...(player.targets || []), revivedPlayerName];
            await updateDoc(docRef, {
                targets: updatedTargets,
            });
        }
    }
};
