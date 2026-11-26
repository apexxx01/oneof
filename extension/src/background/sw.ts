/**
 * Service worker. Relays messages (see relay.ts) and, in development builds only, reloads the
 * extension when dist/build-id.txt changes so a rebuild shows up without visiting chrome://extensions.
 * The build-id fetch reads a file packaged inside this extension (chrome-extension://…), not the network.
 */
import { isBuiltInHost, reconcile, registerSite, scriptId, siteOrigin, type SitesChrome } from '../shared/sites';
import { installRelay, type ChromeLike } from './relay';

declare const __ONEOF_DEV__: boolean;

installRelay(chrome as unknown as ChromeLike);

// Sites turned on with "Check drafts on this site": keep the registered content scripts in line
// with the permissions, including changes made in Chrome's own site-access menu.
const sites = chrome as unknown as SitesChrome;
const sync = () => { reconcile(sites).catch(() => undefined); };
chrome.runtime.onStartup.addListener(sync);
chrome.runtime.onInstalled.addListener(sync);
chrome.permissions.onAdded.addListener((p) => {
  for (const o of p.origins ?? []) { const origin = siteOrigin(o.replace(/\*$/, '')); if (origin && !o.includes('*.') && o !== 'https://*/*' && !isBuiltInHost(origin)) registerSite(sites, origin).catch(() => undefined); }
});
chrome.permissions.onRemoved.addListener((p) => {
  const ids = (p.origins ?? []).map((o) => siteOrigin(o.replace(/\*$/, ''))).filter((o): o is string => !!o).map(scriptId);
  if (ids.length) chrome.scripting.getRegisteredContentScripts({ ids }).then((have) => (have.length ? chrome.scripting.unregisterContentScripts({ ids: have.map((h) => h.id) }) : undefined)).catch(() => undefined);
});

if (__ONEOF_DEV__) {
  let known: string | null = null;
  const poll = async () => {
    try {
      const id = (await (await fetch(chrome.runtime.getURL('build-id.txt'), { cache: 'no-store' })).text()).trim();
      if (known === null) known = id;
      else if (id && id !== known) chrome.runtime.reload();
    } catch {
      /* mid-rebuild: the file is briefly missing */
    }
    // Any extension API call resets the worker's 30 s idle timer, so polling keeps going in dev.
    chrome.runtime.getPlatformInfo().catch(() => undefined);
  };
  void poll();
  setInterval(poll, 3000);
}
