/**
 * Runs before the module registry is populated for each integration test file,
 * so `src/utils/firebase.js` sees these values when it initializes.
 *
 * The project id is deliberately `demo-` prefixed: the Firebase tooling treats
 * `demo-*` as emulator-only and refuses to reach a real backend with it, which
 * makes it impossible for this suite to touch the live project even if the
 * emulator is not running.
 */
process.env.REACT_APP_USE_EMULATORS = 'true';
process.env.REACT_APP_PROJECTID = 'demo-mall-mystery-heroes';
process.env.REACT_APP_APIKEY = 'emulator-key';
process.env.REACT_APP_AUTHDOMAIN = 'demo-mall-mystery-heroes.firebaseapp.com';
process.env.REACT_APP_STORAGEBUCKET = 'demo-mall-mystery-heroes.appspot.com';
process.env.REACT_APP_MESSAGINGSENDERID = '0';
process.env.REACT_APP_APPID = 'emulator-app';
