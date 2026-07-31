import { initializeApp, getApps, getApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { readFirebaseConfig, shouldUseEmulators, assertSafeFirebaseTarget } from './firebaseEnv';

// Throws if a test run is about to connect to a live project. See firebaseEnv.js.
assertSafeFirebaseTarget(process.env);

const app = getApps().length ? getApp() : initializeApp(readFirebaseConfig(process.env));

const db = getFirestore(app);
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
