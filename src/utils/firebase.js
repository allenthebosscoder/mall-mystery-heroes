import { initializeApp, getApps, getApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { readFirebaseConfig, shouldUseEmulators, assertSafeFirebaseTarget } from './firebaseEnv';

// Throws if a test run is about to connect to a live project. See firebaseEnv.js.
assertSafeFirebaseTarget(process.env);

const app = getApps().length ? getApp() : initializeApp(readFirebaseConfig(process.env));

// Plain getFirestore(app) lets the SDK guess, at connect time, whether a
// real WebSocket-style stream will work on this network. On some networks
// (certain corporate/VPN/mobile setups) that guess is wrong in a way that
// doesn't error: the stream appears to connect, but live pushes silently
// stop arriving until unrelated network activity (e.g. an unrelated
// request) happens to revive it — matching a real report this session of
// player chat needing an unrelated send to "unstick" incoming messages.
// experimentalAutoDetectLongPolling has the SDK actively probe which
// connection type genuinely works, instead of assuming — Firebase's own
// documented fix for this exact symptom.
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app);

if (shouldUseEmulators(process.env)) {
    connectFunctionsEmulator(functions, 'localhost', 5001);
    connectAuthEmulator(auth, 'http://localhost:9099');
    connectFirestoreEmulator(db, 'localhost', 8081);
    connectStorageEmulator(storage, 'localhost', 9199);
}

export const googleProvider = new GoogleAuthProvider();
export { app, auth, db, functions, storage };
