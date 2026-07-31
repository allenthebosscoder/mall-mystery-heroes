import { readFirebaseConfig, shouldUseEmulators, assertSafeFirebaseTarget } from './firebaseEnv';

const validEnv = {
    REACT_APP_APIKEY: 'key',
    REACT_APP_AUTHDOMAIN: 'domain',
    REACT_APP_PROJECTID: 'mall-mystery-heroes',
    REACT_APP_STORAGEBUCKET: 'bucket',
    REACT_APP_MESSAGINGSENDERID: 'sender',
    REACT_APP_APPID: 'app',
};

describe('readFirebaseConfig', () => {
    it('maps the REACT_APP_* variables onto the Firebase config shape', () => {
        expect(readFirebaseConfig(validEnv)).toEqual({
            apiKey: 'key',
            authDomain: 'domain',
            projectId: 'mall-mystery-heroes',
            storageBucket: 'bucket',
            messagingSenderId: 'sender',
            appId: 'app',
        });
    });

    it('throws naming the missing variables rather than building a broken config', () => {
        const { REACT_APP_APIKEY, REACT_APP_APPID, ...partial } = validEnv;

        expect(() => readFirebaseConfig(partial)).toThrow(/REACT_APP_APIKEY.*REACT_APP_APPID/);
    });
});

describe('shouldUseEmulators', () => {
    it('is true when REACT_APP_USE_EMULATORS is the string "true"', () => {
        expect(shouldUseEmulators({ REACT_APP_USE_EMULATORS: 'true' })).toBe(true);
    });

    it('is false when the flag is absent, regardless of NODE_ENV', () => {
        expect(shouldUseEmulators({ NODE_ENV: 'development' })).toBe(false);
    });

    it('is false for any value other than "true"', () => {
        expect(shouldUseEmulators({ REACT_APP_USE_EMULATORS: 'false' })).toBe(false);
        expect(shouldUseEmulators({ REACT_APP_USE_EMULATORS: '1' })).toBe(false);
    });
});

describe('assertSafeFirebaseTarget', () => {
    it('throws under NODE_ENV=test when emulators are not enabled', () => {
        expect(() => assertSafeFirebaseTarget({ ...validEnv, NODE_ENV: 'test' })).toThrow(
            /REACT_APP_USE_EMULATORS/
        );
    });

    it('names the project the tests were about to hit', () => {
        expect(() => assertSafeFirebaseTarget({ ...validEnv, NODE_ENV: 'test' })).toThrow(
            /mall-mystery-heroes/
        );
    });

    it('permits NODE_ENV=test when emulators are enabled', () => {
        expect(() =>
            assertSafeFirebaseTarget({
                ...validEnv,
                NODE_ENV: 'test',
                REACT_APP_USE_EMULATORS: 'true',
            })
        ).not.toThrow();
    });

    it('permits production without emulators', () => {
        expect(() =>
            assertSafeFirebaseTarget({ ...validEnv, NODE_ENV: 'production' })
        ).not.toThrow();
    });
});
