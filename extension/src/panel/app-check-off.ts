/**
 * Build-time stand-in for 'firebase/app-check', used only in the extension bundle and only for
 * the import in src/lib/firebase.ts (see the alias in extension/vite.config.ts).
 *
 * Why: the extension makes no cloud calls, and an ONLY_ON_DEVICE call never asks for an App Check
 * token (@firebase/ai only reads one inside its HTTP request path). The reCAPTCHA providers would
 * also try to load a script from google.com, which MV3 forbids (no remote code) and this panel's
 * CSP blocks. The build sets VITE_APPCHECK=off so getFirebase() never calls these; if it ever did,
 * it fails loudly instead of silently reaching the network.
 *
 * To add a cloud call later: drop the alias, relax connect-src for the Firebase AI Logic and App
 * Check hosts, and initialise App Check lazily, right before that call, with a provider that
 * works in extension pages (debug token or a custom provider).
 */
const off = () => { throw new Error('App Check is compiled out of the OneOf extension: it makes no cloud calls.'); };

export function initializeAppCheck(): never { return off(); }
export class ReCaptchaV3Provider { constructor() { off(); } }
export class ReCaptchaEnterpriseProvider { constructor() { off(); } }
export class CustomProvider { constructor() { off(); } }
export type AppCheck = never;
