/**
 * Content script entry (classic script, bundled as one IIFE: MV3 content scripts can't be modules).
 * Wires the controller to chrome.runtime. No fetch, no XHR, no storage: it only reads the
 * composer you're typing in and talks to this extension's own service worker.
 */
import type { Ack, FromContent, ToContent } from '../shared/messages';
import { createController, type Bridge } from './controller';

const bridge: Bridge = {
  async send(msg: FromContent) {
    if (!chrome.runtime?.id) throw new Error('Extension context invalidated');
    return (await chrome.runtime.sendMessage(msg)) as Ack | undefined;
  },
  onMessage(cb) {
    const l = (m: ToContent) => { cb(m); return false; };
    chrome.runtime.onMessage.addListener(l);
    return () => { try { chrome.runtime.onMessage.removeListener(l); } catch { /* context gone */ } };
  },
};

// One controller per frame, even if the script is injected twice.
const w = window as unknown as { __oneof?: boolean };
if (!w.__oneof) {
  w.__oneof = true;
  createController(document, bridge);
}
