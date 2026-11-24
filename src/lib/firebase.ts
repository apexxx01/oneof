import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

const env = import.meta.env;

/**
 * Firebase web config. These values identify the project; they are not secrets
 * (https://firebase.google.com/docs/projects/api-keys). Access is protected by App Check
 * and API-key restrictions, not by hiding them. .env.local overrides for forks.
 */
const PUBLIC = {
  apiKey: 'AIzaSyDhMO0hC9Jn1qGNdpkFAql29nEOBdgzKRY',
  authDomain: 'oneof-8d62e.firebaseapp.com',
  projectId: 'oneof-8d62e',
  storageBucket: 'oneof-8d62e.firebasestorage.app',
  messagingSenderId: '588996291286',
  appId: '1:588996291286:web:3d5a2af5169a449caf7777',
};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || PUBLIC.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || PUBLIC.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || PUBLIC.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || PUBLIC.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || PUBLIC.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || PUBLIC.appId,
};

export function configProblems(): string[] {
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return missing.length ? [`Missing Firebase config: ${missing.join(', ')} (copy .env.example to .env.local)`] : [];
}

let app: FirebaseApp | undefined;
let ai: AI | undefined;
let appCheck: AppCheck | undefined;

/** Which App Check provider this build uses, shown in the header so judges can see it. */
export type AppCheckMode = 'enterprise' | 'recaptcha-v3' | 'debug-token' | 'off';
export function appCheckMode(): AppCheckMode {
  if (env.VITE_APPCHECK === 'off') return 'off';
  if (env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) return 'enterprise';
  if (env.VITE_RECAPTCHA_V3_SITE_KEY) return 'recaptcha-v3';
  if (env.VITE_APPCHECK_DEBUG_TOKEN || env.DEV) return 'debug-token';
  return 'off';
}

export function getFirebase(): { app: FirebaseApp; ai: AI } {
  if (app && ai) return { app, ai };
  app = initializeApp(firebaseConfig);
  const mode = appCheckMode();
  if (mode === 'debug-token') {
    // Firebase App Check debug provider. The hackathon rules accept debug tokens. Locally this
    // prints a token to register in the console; a deployed build can carry a registered token.
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  if (mode !== 'off') {
    // The debug provider is selected by the global above; the site key is then unused.
    const provider = mode === 'enterprise'
      ? new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY)
      : new ReCaptchaV3Provider(env.VITE_RECAPTCHA_V3_SITE_KEY || 'debug-provider');
    appCheck = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  } else {
    console.warn('[oneof] App Check disabled for this build');
  }
  // Limited-use tokens: each AI Logic request carries a fresh, single-use App Check token
  // (replay protection), recommended for AI Logic.
  ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: mode !== 'off' });
  return { app, ai };
}

export function hasAppCheck() { return !!appCheck; }
