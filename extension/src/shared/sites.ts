/**
 * "Check drafts on this site": the any-site opt-in.
 *
 * The manifest only grants the built-in hosts (Reddit and the practice page). Any other https site
 * is an optional host permission, asked for one origin at a time from a click in the side panel:
 *
 *   1. chrome.permissions.request({ origins: [origin + '/*'] })  (must be the first call, inside the click)
 *   2. chrome.scripting.registerContentScripts([{ id: 'oneof-site:<host>', matches: [origin + '/*'], js: ['content.js'] }])
 *      with persistAcrossSessions, so the content script loads on that site from now on;
 *   3. chrome.scripting.executeScript into the open tab, so it works without a reload.
 *
 * Removing a site unregisters the script and gives the permission back. The service worker
 * reconciles both on startup and when the user changes site access in Chrome's own UI.
 * No network code: this only talks to Chrome's extension APIs.
 */

export const SCRIPT_PREFIX = 'oneof-site:';

/** Hosts the manifest grants out of the box (kept in step with manifest.json by a test). */
export const BUILT_IN_MATCHES = [
  'https://www.reddit.com/*',
  'https://old.reddit.com/*',
  'https://sh.reddit.com/*',
  'https://oneof-app.vercel.app/practice/*',
  'https://apexxx01.github.io/oneof/practice/*',
  'http://localhost:5173/*',
];

export interface RegisteredScript {
  id: string;
  matches?: string[];
  js?: string[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  allFrames?: boolean;
  persistAcrossSessions?: boolean;
}

export interface SitesChrome {
  permissions: {
    request(p: { origins: string[] }): Promise<boolean>;
    remove(p: { origins: string[] }): Promise<boolean>;
    getAll(): Promise<{ origins?: string[] }>;
  };
  scripting: {
    registerContentScripts(scripts: RegisteredScript[]): Promise<void>;
    unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
    getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredScript[]>;
    executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  };
}

/**
 * "x.com", "https://x.com/home", "www.linkedin.com/feed" → "https://x.com" (an https origin), or
 * null for anything OneOf can't or shouldn't check (other schemes, the extension, Chrome pages).
 */
export function siteOrigin(input: string | undefined | null): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname || !u.hostname.includes('.')) return null;
  if (/^(chrome|chromewebstore)\.google\.com$/.test(u.hostname)) return null; // extensions can't run there
  return `https://${u.host}`;
}

export const originPattern = (origin: string) => `${origin}/*`;
export const scriptId = (origin: string) => `${SCRIPT_PREFIX}${new URL(origin).host}`;
const originOfScript = (s: RegisteredScript) => `https://${s.id.slice(SCRIPT_PREFIX.length)}`;

/** True when the manifest already covers this URL (Reddit, the practice page, the dev server). */
export function isBuiltIn(url: string | undefined | null): boolean {
  if (!url) return false;
  return BUILT_IN_MATCHES.some((m) => {
    const prefix = m.slice(0, -1); // "https://www.reddit.com/"
    return url.startsWith(prefix) || url === prefix.replace(/\/$/, '');
  });
}

/** Registers the content script for one origin (idempotent). */
export async function registerSite(c: SitesChrome, origin: string): Promise<void> {
  const id = scriptId(origin);
  const existing = await c.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) return;
  await c.scripting.registerContentScripts([{ id, matches: [originPattern(origin)], js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }]);
}

export interface EnableResult { granted: boolean; injected: boolean; error?: string }

/**
 * Turns a site on. Call it straight from the click handler, before any await: Chrome only shows
 * the permission prompt during a user gesture. `tab` is the open tab to inject into, if it is on
 * that origin (or a getter, called after the grant).
 */
type TabRef = { id?: number; url?: string } | undefined;

export function enableSite(c: SitesChrome, origin: string, tabRef?: TabRef | (() => Promise<TabRef>)): Promise<EnableResult> {
  const asked = c.permissions.request({ origins: [originPattern(origin)] });
  return asked.then(async (granted) => {
    // Once granted, Chrome reveals the tab's URL, so a getter can look it up now.
    const tab = typeof tabRef === 'function' ? await tabRef().catch(() => undefined) : tabRef;
    if (!granted) return { granted: false, injected: false };
    try {
      await registerSite(c, origin);
    } catch (e) {
      return { granted: true, injected: false, error: (e as Error).message };
    }
    let injected = false;
    if (tab?.id !== undefined && tab.url && siteOrigin(tab.url) === origin) {
      try { await c.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); injected = true; } catch { /* the tab navigated away; the next load gets the script */ }
    }
    return { granted: true, injected };
  });
}

/** Turns a site off: unregisters the script and hands the permission back. */
export async function disableSite(c: SitesChrome, origin: string): Promise<void> {
  const id = scriptId(origin);
  if ((await c.scripting.getRegisteredContentScripts({ ids: [id] })).length) await c.scripting.unregisterContentScripts({ ids: [id] });
  await c.permissions.remove({ origins: [originPattern(origin)] }).catch(() => false);
}

/** The sites the user turned on, sorted. */
export async function listSites(c: SitesChrome): Promise<string[]> {
  const scripts = await c.scripting.getRegisteredContentScripts();
  return scripts.filter((s) => s.id.startsWith(SCRIPT_PREFIX)).map(originOfScript).sort();
}

/** Hosts the manifest already covers; Chrome reports host permissions as host-wide patterns. */
const BUILT_IN_HOSTS = new Set(BUILT_IN_MATCHES.map((m) => new URL(m.replace(/\*$/, '')).host));
export const isBuiltInHost = (origin: string) => BUILT_IN_HOSTS.has(new URL(origin).host);

/** Optional origins granted to the extension, as https origins (built-in hosts excluded). */
async function grantedOrigins(c: SitesChrome): Promise<string[]> {
  const all = (await c.permissions.getAll()).origins ?? [];
  return all.filter((p) => p.startsWith('https://') && !p.includes('*.') && p !== 'https://*/*')
    .map((p) => siteOrigin(p.replace(/\*$/, '')))
    .filter((o): o is string => !!o && !isBuiltInHost(o));
}

/**
 * Brings registrations in line with permissions: a script for every granted site, none for a site
 * whose permission is gone (the user can revoke it in chrome://extensions).
 */
export async function reconcile(c: SitesChrome): Promise<{ added: string[]; removed: string[] }> {
  const granted = new Set(await grantedOrigins(c));
  const registered = await listSites(c);
  const removed = registered.filter((o) => !granted.has(o));
  if (removed.length) await c.scripting.unregisterContentScripts({ ids: removed.map(scriptId) });
  const added: string[] = [];
  for (const o of granted) if (!registered.includes(o)) { await registerSite(c, o); added.push(o); }
  return { added, removed };
}

/** Hosts that serve OneOf's practice composer (a made-up thread). The content script only runs on the
 * practice path of these hosts, so a draft from them comes from the practice page. */
export function isPracticeHost(host: string): boolean {
  return host === 'oneof-app.vercel.app' || host === 'apexxx01.github.io' || host === 'localhost:5173' || host === 'localhost';
}
