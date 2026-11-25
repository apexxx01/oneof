/**
 * Service worker. Relays messages (see relay.ts) and, in development builds only, reloads the
 * extension when dist/build-id.txt changes so a rebuild shows up without visiting chrome://extensions.
 * The build-id fetch reads a file packaged inside this extension (chrome-extension://…), not the network.
 */
import { installRelay, type ChromeLike } from './relay';

declare const __ONEOF_DEV__: boolean;

installRelay(chrome as unknown as ChromeLike);

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
