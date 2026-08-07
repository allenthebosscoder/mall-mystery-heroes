import { doc, setDoc, terminate } from 'firebase/firestore';
import { signInAnonymously, getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { initializeApp } from 'firebase/app';
import { auth, db } from '../src/utils/firebase';
import { readFirebaseConfig } from '../src/utils/firebaseEnv';

const PROJECT_ID = process.env.REACT_APP_PROJECTID;
const HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8081';

/**
 * dbCalls runs as a signed-in host in the real app, and now that
 * firestore.rules requires auth (docs/improvements.md item 2), it has to
 * here too. Signs in once (against the Auth emulator — see
 * test:emulator's `--only firestore,auth`) and reuses the resulting uid as
 * every seeded room's hostId, so dbCalls' writes are always the host.
 */
let hostUidPromise;

const hostUid = () => {
    if (!hostUidPromise) {
        hostUidPromise = signInAnonymously(auth).then((credential) => credential.user.uid);
    }
    return hostUidPromise;
};

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
 * A second, independent signed-in identity — a distinct anonymous user on
 * its own Firebase app instance, connected to the same emulators. The
 * default `db`/`auth`/`functions` in `src/utils/firebase.js` are one
 * process-wide singleton signed in once as `hostUid()`; testing "a
 * non-host calls a callable function" needs a genuinely different caller,
 * not just a different `hostId` string, since a Cloud Function checks
 * `context.auth.uid` — the identity a real request actually carried, not
 * anything the test can just assert into existence.
 */
export const callableAsNonHost = (functionName) => {
    const app = initializeApp(readFirebaseConfig(process.env), `non-host-${Date.now()}`);
    const nonHostAuth = getAuth(app);
    const nonHostFunctions = getFunctions(app);
    connectAuthEmulator(nonHostAuth, 'http://localhost:9099');
    connectFunctionsEmulator(nonHostFunctions, 'localhost', 5001);

    const callable = httpsCallable(nonHostFunctions, functionName);
    return async (data) => {
        await signInAnonymously(nonHostAuth);
        return callable(data);
    };
};

/**
 * Seeds a room with players. Writes the same fields `addPlayerForRoom` and
 * `DashBoard` write, so tests exercise realistic documents.
 */
export const seedRoom = async (roomID, players = [], roomOverrides = {}) => {
    await setDoc(doc(db, 'rooms', roomID), {
        taskIndex: 1,
        hostId: await hostUid(),
        isGameActive: true,
        gameStarted: false,
        storageReference: [],
        ...roomOverrides,
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
            ...extra,
        };

        // Setting a field to `undefined` means "write a document without this
        // field" — Firestore rejects undefined values outright, and omitting
        // the field is what a legacy document actually looks like.
        for (const [key, value] of Object.entries(fields)) {
            if (value === undefined) delete fields[key];
        }

        // Keyed on trimmedNameLowerCase to match addPlayerForRoom's scheme
        // (see its comment in dbCalls.js) rather than the raw name.
        await setDoc(doc(db, 'rooms', roomID, 'players', fields.trimmedNameLowerCase), fields);
    }
};
