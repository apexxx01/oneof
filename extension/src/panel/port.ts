/**
 * The side panel's link to the service worker. Reconnects when the worker restarts, and sends a
 * small ping every 25 s so the worker stays awake while the panel is open (port messages reset
 * its idle timer).
 */
import { ENGINE_PORT, type FromPanel, type ToPanel } from '../shared/messages';

export function connectEngine(onDraft: (m: Extract<ToPanel, { kind: 'draft' }>) => void) {
  let port: chrome.runtime.Port | null = null;
  let closed = false;
  const open = () => {
    if (closed) return;
    port = chrome.runtime.connect({ name: ENGINE_PORT });
    port.onMessage.addListener((m: ToPanel) => { if (m?.kind === 'draft') onDraft(m); });
    port.onDisconnect.addListener(() => { port = null; setTimeout(open, 250); });
  };
  open();
  const ping = setInterval(() => post({ kind: 'ping' }), 25_000);
  function post(m: FromPanel) { try { port?.postMessage(m); } catch { /* reconnecting */ } }
  return { post, close() { closed = true; clearInterval(ping); port?.disconnect(); } };
}
