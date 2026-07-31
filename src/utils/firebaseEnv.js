/**
 * Environment handling for the Firebase client, kept separate from
 * `firebase.js` so it can be tested without initializing an SDK.
 *
 * Emulator targeting is keyed on an explicit REACT_APP_USE_EMULATORS flag
 * rather than on NODE_ENV. Keying it on NODE_ENV meant `npm start` could never
 * be pointed at a real project, and — worse — that Jest (NODE_ENV=test) fell
 * through to the production project. See docs/testing.md.
 */

const CONFIG_KEYS = {
    apiKey: 'REACT_APP_APIKEY',
    authDomain: 'REACT_APP_AUTHDOMAIN',
    projectId: 'REACT_APP_PROJECTID',
    storageBucket: 'REACT_APP_STORAGEBUCKET',
    messagingSenderId: 'REACT_APP_MESSAGINGSENDERID',
    appId: 'REACT_APP_APPID',
};

export const readFirebaseConfig = (env) => {
    const missing = Object.values(CONFIG_KEYS).filter((name) => !env[name]);
    if (missing.length > 0) {
        throw new Error(
            `Firebase config is incomplete. Missing: ${missing.join(', ')}. ` +
                'Add them to .env — see the Setup section of README.md.'
        );
    }

    return Object.fromEntries(Object.entries(CONFIG_KEYS).map(([key, name]) => [key, env[name]]));
};

export const shouldUseEmulators = (env) => env.REACT_APP_USE_EMULATORS === 'true';

/**
 * Guards the one mistake that cannot be undone: a test suite writing to the
 * live game. `.firebaserc` maps dev and prod to the same project, so there is
 * no safe non-emulator target.
 */
export const assertSafeFirebaseTarget = (env) => {
    if (env.NODE_ENV === 'test' && !shouldUseEmulators(env)) {
        throw new Error(
            'Refusing to initialize Firebase against a live project from a test run. ' +
                `This would have connected to "${env.REACT_APP_PROJECTID}". ` +
                'Set REACT_APP_USE_EMULATORS=true and start the emulators, or keep ' +
                'Firebase out of this test (see docs/testing.md).'
        );
    }
};
