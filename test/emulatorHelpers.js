import { doc, setDoc, terminate } from 'firebase/firestore';
import { db } from '../src/utils/firebase';

const PROJECT_ID = process.env.REACT_APP_PROJECTID;
const HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8081';

/**
 * Wipes every document in the emulator. Call in beforeEach so tests cannot
 * depend on each other's leftovers.
 */
export const clearFirestore = async () => {
    const url = `http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
        throw new Error(
            `Could not clear the Firestore emulator (${response.status}). ` +
                'Is it running? These tests are meant to be run via `npm run test:emulator`.'
        );
    }
};

/** Closes the client so Jest's worker can exit. */
export const shutdown = () => terminate(db);

/**
 * Seeds a room with players. Writes the same fields `addPlayerForRoom` and
 * `DashBoard` write, so tests exercise realistic documents.
 */
export const seedRoom = async (roomID, players = []) => {
    await setDoc(doc(db, 'rooms', roomID), {
        taskIndex: 1,
        logs: [],
        hostId: 'test-host',
        isGameActive: true,
        storageReference: [],
    });

    for (const player of players) {
        const name = typeof player === 'string' ? player : player.name;
        const extra = typeof player === 'string' ? {} : player;
        const fields = {
            name,
            trimmedNameLowerCase: name.replace(/\s/g, '').toLowerCase(),
            score: 0,
            isAlive: true,
            openSeason: false,
            targets: [],
            assassins: [],
            targetsLength: 0,
            assassinsLength: 0,
            ...extra,
        };

        // Setting a field to `undefined` means "write a document without this
        // field" — Firestore rejects undefined values outright, and omitting
        // the field is what a legacy document actually looks like.
        for (const [key, value] of Object.entries(fields)) {
            if (value === undefined) delete fields[key];
        }

        await setDoc(doc(db, 'rooms', roomID, 'players', name), fields);
    }
};
