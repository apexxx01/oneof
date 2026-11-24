import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export function configProblems(): string[] {
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return missing.length ? [`Missing Firebase config: ${missing.join(', ')} (copy .env.example to .env.local)`] : [];
}

let app: FirebaseApp | undefined;
let ai: AI | undefined;

export function getFirebase(): { app: FirebaseApp; ai: AI } {
  if (app && ai) return { app, ai };
  app = initializeApp(firebaseConfig);
  if (env.DEV) {
    // Local dev only: prints a debug token you register in Firebase console → App Check.
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  // App Check is required for submission. Local runs tolerate it being off; Firebase only
  // rejects calls when enforcement is on in the console.
  if (env.VITE_APPCHECK !== 'off' && env.VITE_RECAPTCHA_V3_SITE_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    console.warn('[oneof] App Check disabled for this run');
  }
  ai = getAI(app, { backend: new GoogleAIBackend() });
  return { app, ai };
}
