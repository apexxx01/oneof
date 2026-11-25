/**
 * Content-script logic, with the browser bits injected so it runs under jsdom in tests.
 * Watches focus and typing (capture phase, composed paths, so shadow-DOM editors count),
 * waits until the user pauses for DEBOUNCE_MS, then hands the draft text to the service worker,
 * which relays it to the on-device engine in the side panel. Never touches the network.
 */
import { MIN_DRAFT_CHARS, type Ack, type FromContent, type ToContent, type Verdict } from '../shared/messages';
import { anchorFor, extractText, findEditable, replaceText, type Editable } from './composer';
import { createPill, type Pill } from './pill';

export const DEBOUNCE_MS = 1200;

export interface Bridge {
  /** Resolves with the service worker's ack. Rejects when the extension was reloaded or removed. */
  send(msg: FromContent): Promise<Ack | undefined>;
  onMessage(cb: (m: ToContent) => void): () => void;
}

export const LOCAL: Record<'noEngine' | 'checking' | 'updated', Verdict> = {
  noEngine: { state: 'no-engine', text: 'Open OneOf to check', tone: 'muted', detail: 'OneOf checks drafts with Gemini Nano inside its side panel. Click to open it; nothing is sent anywhere.' },
  checking: { state: 'checking', text: 'reading on-device…', tone: 'device', detail: 'Gemini Nano is reading this draft on this computer.' },
  updated: { state: 'error', text: 'OneOf was updated · reload the page', tone: 'muted' },
};

export interface Controller {
  /** Sends the current draft now instead of waiting for the debounce. */
  flush(): Promise<void>;
  dispose(): void;
  readonly pill: Pill;
  readonly current: Editable | null;
  readonly seq: number;
}

export function createController(doc: Document, bridge: Bridge, opts: { debounceMs?: number; host?: string } = {}): Controller {
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const host = opts.host ?? doc.location?.hostname ?? '';
  const win = doc.defaultView!;
  const dismissed = new WeakSet<Editable>();
  let current: Editable | null = null;
  let lastSent = '';
  let seq = 0;
  /** Seq of the last verdict shown; a fast verdict can beat the worker's ack. */
  let shownSeq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dead = false;

  const pill = createPill(doc, {
    onOpen: () => {
      // Must run inside the click: chrome.sidePanel.open() needs this user gesture.
      bridge.send({ kind: 'open-panel' }).catch(die);
    },
    onDismiss: () => { if (current) dismissed.add(current); pill.hide(); },
  });

  const show = (v: Verdict) => {
    if (!current || dismissed.has(current)) return;
    pill.show(v, anchorFor(current), current);
  };

  function die() {
    // The extension was reloaded or removed: this script is orphaned. Say so once, then stop.
    if (dead) return;
    dead = true;
    if (current) pill.show(LOCAL.updated, anchorFor(current), current);
    detach();
    setTimeout(() => pill.destroy(), 6000);
  }

  async function flush() {
    clearTimeout(timer);
    if (dead || !current) return;
    if (!current.isConnected) { current = null; pill.hide(); return; }
    const text = extractText(current);
    if (text.length < MIN_DRAFT_CHARS) { lastSent = ''; pill.hide(); return; }
    if (text === lastSent) return;
    lastSent = text;
    const mine = ++seq;
    let ack: Ack | undefined;
    try {
      ack = await bridge.send({ kind: 'draft', seq: mine, text, host });
    } catch {
      die();
      return;
    }
    if (mine !== seq || shownSeq === mine) return; // superseded, or the verdict already arrived
    show(ack?.engine ? LOCAL.checking : LOCAL.noEngine);
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, debounceMs);
  };

  const target = (e: Event) => findEditable(e.composedPath ? e.composedPath() : [e.target as EventTarget]);

  const onFocusIn = (e: Event) => {
    const ed = target(e);
    if (!ed) return;
    if (ed !== current) {
      current = ed;
      lastSent = '';
      pill.hide();
    }
    schedule();
  };
  const onInput = (e: Event) => {
    const ed = target(e);
    if (!ed) return;
    if (ed !== current) { current = ed; lastSent = ''; }
    schedule();
  };

  let raf = 0;
  const onScroll = () => {
    if (!pill.visible || raf) return;
    raf = win.requestAnimationFrame ? win.requestAnimationFrame(() => { raf = 0; pill.place(); }) : (pill.place(), 0);
  };
  // Layout shifts (Reddit expands the composer, loads comments above it) without scroll events.
  const tick = setInterval(() => { if (pill.visible) pill.place(); }, 750);

  const offMessage = bridge.onMessage((m) => {
    if (dead) return;
    if (m.kind === 'verdict') {
      if (m.seq === seq) { shownSeq = m.seq; show(m.verdict); }
    } else if (m.kind === 'engine') {
      // The side panel just opened (or closed): re-send the draft so the pill catches up.
      lastSent = '';
      if (current) void flush();
    } else if (m.kind === 'apply-rewrite') {
      if (current?.isConnected) { replaceText(current, m.text); schedule(); }
    }
  });

  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('input', onInput, true);
  win.addEventListener('scroll', onScroll, true);
  win.addEventListener('resize', onScroll);

  function detach() {
    clearTimeout(timer);
    clearInterval(tick);
    offMessage();
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('input', onInput, true);
    win.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('resize', onScroll);
  }

  // Say hello so the worker knows this tab exists (and tells us when the engine appears).
  bridge.send({ kind: 'hello' }).catch(() => undefined);

  return {
    flush,
    dispose() { dead = true; detach(); pill.destroy(); },
    pill,
    get current() { return current; },
    get seq() { return seq; },
  };
}
