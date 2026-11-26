/**
 * "Check drafts on this site": the permission and registration flow, with chrome.permissions and
 * chrome.scripting mocked in memory. Chrome only shows the permission prompt during a user
 * gesture, so enableSite() must call permissions.request synchronously, before any await.
 */
import { describe, expect, it } from 'vitest';
import { BUILT_IN_MATCHES, disableSite, enableSite, isBuiltIn, isBuiltInHost, listSites, reconcile, scriptId, siteOrigin, type RegisteredScript, type SitesChrome } from '../src/shared/sites';

function fakeChrome(opts: { allow?: boolean; granted?: string[] } = {}) {
  let gesture = false;
  const granted = new Set<string>([...BUILT_IN_MATCHES.map((m) => m.replace(/^(https?:\/\/[^/]+)\/.*$/, '$1/*')), ...(opts.granted ?? [])]);
  const scripts = new Map<string, RegisteredScript>();
  const injected: Array<{ tabId: number; files: string[] }> = [];
  const requests: string[][] = [];
  const c: SitesChrome = {
    permissions: {
      request: (p) => {
        if (!gesture) return Promise.reject(new Error('This function must be called during a user gesture'));
        requests.push(p.origins);
        if (opts.allow !== false) p.origins.forEach((o) => granted.add(o));
        return Promise.resolve(opts.allow !== false);
      },
      remove: async (p) => { p.origins.forEach((o) => granted.delete(o)); return true; },
      getAll: async () => ({ origins: [...granted], permissions: [] } as { origins: string[] }),
    },
    scripting: {
      registerContentScripts: async (list) => {
        for (const s of list) { if (scripts.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`); scripts.set(s.id, s); }
      },
      unregisterContentScripts: async (f) => { for (const id of f?.ids ?? [...scripts.keys()]) scripts.delete(id); },
      getRegisteredContentScripts: async (f) => [...scripts.values()].filter((s) => !f?.ids || f.ids.includes(s.id)),
      executeScript: async (i) => { injected.push({ tabId: i.target.tabId, files: i.files }); return []; },
    },
  };
  /** Runs `fn` as if inside a click: the gesture flag is on only for its synchronous part. */
  const click = <T,>(fn: () => T): T => { gesture = true; try { return fn(); } finally { gesture = false; } };
  return { c, click, granted, scripts, injected, requests };
}

describe('siteOrigin', () => {
  it('normalizes what a user types or a tab reports to an https origin', () => {
    expect(siteOrigin('x.com')).toBe('https://x.com');
    expect(siteOrigin('https://news.ycombinator.com/item?id=1')).toBe('https://news.ycombinator.com');
    expect(siteOrigin('  www.linkedin.com/feed/  ')).toBe('https://www.linkedin.com');
    expect(siteOrigin('https://discord.com:443/channels/1')).toBe('https://discord.com');
  });

  it('refuses what OneOf cannot or should not run on', () => {
    for (const bad of ['', 'chrome://extensions', 'chrome-extension://abc/sidepanel.html', 'http://example.com', 'file:///tmp/a.html', 'localhost', 'https://chromewebstore.google.com/detail/x', 'not a url']) {
      expect(siteOrigin(bad), bad).toBeNull();
    }
  });

  it('knows the built-in hosts', () => {
    expect(isBuiltIn('https://www.reddit.com/r/nursing/comments/1')).toBe(true);
    expect(isBuiltIn('https://oneof-app.vercel.app/practice/')).toBe(true);
    expect(isBuiltIn('https://oneof-app.vercel.app/')).toBe(false);
    expect(isBuiltIn('https://apexxx01.github.io/oneof/practice/')).toBe(true);
    expect(isBuiltIn('https://apexxx01.github.io/oneof/practice')).toBe(true);
    expect(isBuiltIn('http://localhost:5173/practice/')).toBe(true);
    expect(isBuiltIn('https://apexxx01.github.io/oneof/')).toBe(false);
    expect(isBuiltIn('https://x.com/home')).toBe(false);
    expect(isBuiltInHost('https://old.reddit.com')).toBe(true);
    expect(isBuiltInHost('https://x.com')).toBe(false);
  });
});

describe('enabling a site', () => {
  it('asks for exactly that origin from the click, registers a persistent content script and injects into the open tab', async () => {
    const f = fakeChrome();
    const done = f.click(() => enableSite(f.c, 'https://news.ycombinator.com', { id: 4, url: 'https://news.ycombinator.com/reply?id=9' }));
    const r = await done;
    expect(r).toEqual({ granted: true, injected: true });
    expect(f.requests).toEqual([['https://news.ycombinator.com/*']]);
    expect(f.scripts.get(scriptId('https://news.ycombinator.com'))).toEqual({
      id: 'oneof-site:news.ycombinator.com', matches: ['https://news.ycombinator.com/*'], js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
    });
    expect(f.injected).toEqual([{ tabId: 4, files: ['content.js'] }]);
    expect(await listSites(f.c)).toEqual(['https://news.ycombinator.com']);
  });

  it('fails without a user gesture (so the panel must call it straight from the click)', async () => {
    const f = fakeChrome();
    await expect(enableSite(f.c, 'https://x.com')).rejects.toThrow(/user gesture/);
    expect(f.scripts.size).toBe(0);
  });

  it('a declined prompt registers nothing and injects nothing', async () => {
    const f = fakeChrome({ allow: false });
    const r = await f.click(() => enableSite(f.c, 'https://x.com', { id: 1, url: 'https://x.com/home' }));
    expect(r).toEqual({ granted: false, injected: false });
    expect(f.scripts.size).toBe(0);
    expect(f.injected).toEqual([]);
  });

  it('looks the tab up after the grant when its URL was hidden before, and skips other origins', async () => {
    const f = fakeChrome();
    let asked = 0;
    const r = await f.click(() => enableSite(f.c, 'https://github.com', async () => { asked++; return { id: 2, url: 'https://github.com/a/b/issues/1' }; }));
    expect(asked).toBe(1);
    expect(r.injected).toBe(true);
    const r2 = await f.click(() => enableSite(f.c, 'https://x.com', { id: 3, url: 'https://github.com/' }));
    expect(r2).toEqual({ granted: true, injected: false });
    expect(f.injected.map((i) => i.tabId)).toEqual([2]);
  });

  it('is idempotent: enabling twice keeps one registration', async () => {
    const f = fakeChrome();
    await f.click(() => enableSite(f.c, 'https://x.com'));
    await f.click(() => enableSite(f.c, 'https://x.com'));
    expect([...f.scripts.keys()]).toEqual(['oneof-site:x.com']);
  });
});

describe('removing and reconciling', () => {
  it('remove unregisters the script and hands the permission back', async () => {
    const f = fakeChrome();
    await f.click(() => enableSite(f.c, 'https://www.linkedin.com'));
    await disableSite(f.c, 'https://www.linkedin.com');
    expect(f.scripts.size).toBe(0);
    expect(f.granted.has('https://www.linkedin.com/*')).toBe(false);
    expect(await listSites(f.c)).toEqual([]);
  });

  it('reconcile registers granted sites, drops revoked ones, and ignores built-in hosts', async () => {
    const f = fakeChrome({ granted: ['https://mail.google.com/*', 'https://discord.com/*'] });
    // A stale registration whose permission the user revoked in chrome://extensions.
    f.scripts.set('oneof-site:x.com', { id: 'oneof-site:x.com', matches: ['https://x.com/*'], js: ['content.js'] });
    const r = await reconcile(f.c);
    expect(r.removed).toEqual(['https://x.com']);
    expect(r.added.sort()).toEqual(['https://discord.com', 'https://mail.google.com']);
    expect(await listSites(f.c)).toEqual(['https://discord.com', 'https://mail.google.com']);
    // Reddit and the practice page are covered by the manifest; they never get a dynamic script.
    expect([...f.scripts.keys()].some((k) => /reddit|github\.io|localhost/.test(k))).toBe(false);
    expect(await reconcile(f.c)).toEqual({ added: [], removed: [] });
  });
});

import { isPracticeHost } from '../src/shared/sites';
describe('practice host', () => {
  it('only the practice hosts auto-load the synthetic demo history', () => {
    expect(isPracticeHost('oneof-app.vercel.app')).toBe(true);
    expect(isPracticeHost('apexxx01.github.io')).toBe(true);
    expect(isPracticeHost('localhost:5173')).toBe(true);
    for (const h of ['www.reddit.com', 'old.reddit.com', 'news.ycombinator.com', 'github.com', 'evil.github.io', 'oneof-app-evil.vercel.app']) expect(isPracticeHost(h)).toBe(false);
  });
});
