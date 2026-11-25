// @vitest-environment jsdom
/**
 * Debounce and message flow: content script ⇄ service worker relay ⇄ side-panel engine,
 * with chrome.runtime / chrome.tabs / chrome.sidePanel mocked in memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRelay, type ChromeLike, type PortLike } from '../src/background/relay';
import { createController, DEBOUNCE_MS, type Bridge } from '../src/content/controller';
import { ENGINE_PORT, type Ack, type FromContent, type ToContent, type ToPanel, type Verdict } from '../src/shared/messages';

const TAB = 7;

/** An in-memory Chrome: one tab, one worker, optionally one side panel. */
function fakeChrome() {
  const swListeners: Array<Parameters<ChromeLike['runtime']['onMessage']['addListener']>[0]> = [];
  const connectListeners: Array<(p: PortLike) => void> = [];
  const tabListeners: Array<(m: ToContent) => void> = [];
  const toTab: ToContent[] = [];
  const opened: Array<{ tabId?: number }> = [];
  let gesture = false;

  const chromeLike: ChromeLike = {
    runtime: {
      onMessage: { addListener: (cb) => { swListeners.push(cb); } },
      onConnect: { addListener: (cb) => { connectListeners.push(cb); } },
    },
    tabs: {
      sendMessage: async (tabId, m) => { expect(tabId).toBe(TAB); toTab.push(m); tabListeners.forEach((l) => l(m)); },
    },
    sidePanel: {
      open: async (o) => {
        // Chrome rejects open() outside a user gesture; the relay must call it synchronously.
        if (!gesture) throw new Error('sidePanel.open() may only be called in response to a user gesture.');
        opened.push(o);
      },
      setPanelBehavior: async () => undefined,
    },
  };

  /** The content script's side: runtime.sendMessage goes to the worker with sender.tab. */
  const bridge: Bridge & { sent: FromContent[] } = {
    sent: [],
    send(msg) {
      bridge.sent.push(msg);
      return new Promise<Ack | undefined>((resolve) => {
        let replied = false;
        for (const l of swListeners) l(msg, { tab: { id: TAB, windowId: 1 } }, (r) => { replied = true; resolve(r); });
        if (!replied) resolve(undefined);
      });
    },
    onMessage(cb) { tabListeners.push(cb); return () => tabListeners.splice(tabListeners.indexOf(cb), 1); },
  };

  /** Opens a side panel: connects the engine port. `answer` plays the on-device engine. */
  function openPanel(answer: (d: Extract<ToPanel, { kind: 'draft' }>) => Verdict | null) {
    const panelSide: Array<(m: unknown) => void> = [];
    const swSide: Array<(m: unknown) => void> = [];
    const disconnects: Array<() => void> = [];
    const port: PortLike = {
      name: ENGINE_PORT,
      postMessage: (m) => queueMicrotask(() => panelSide.forEach((l) => l(m))), // worker -> panel
      onMessage: { addListener: (cb) => { swSide.push(cb); } },
      onDisconnect: { addListener: (cb) => { disconnects.push(cb); } },
    };
    const drafts: Array<Extract<ToPanel, { kind: 'draft' }>> = [];
    panelSide.push((m) => {
      const d = m as Extract<ToPanel, { kind: 'draft' }>;
      drafts.push(d);
      const v = answer(d);
      if (v) swSide.forEach((l) => l({ kind: 'verdict', tabId: d.tabId, seq: d.seq, verdict: v }));
    });
    connectListeners.forEach((l) => l(port));
    return { drafts, close: () => disconnects.forEach((d) => d()), post: (m: unknown) => swSide.forEach((l) => l(m)) };
  }

  return { chromeLike, bridge, toTab, opened, openPanel, setGesture: (g: boolean) => { gesture = g; } };
}

const pillText = (c: ReturnType<typeof createController>) => c.pill.root.querySelector('.text')!.textContent;
const flushPromises = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function type(ta: HTMLTextAreaElement, text: string) {
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

let ctl: ReturnType<typeof createController> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<shreddit-composer></shreddit-composer>`;
  const host = document.querySelector('shreddit-composer')!;
  host.attachShadow({ mode: 'open' }).innerHTML = `<textarea></textarea><button type="submit">Comment</button>`;
});
afterEach(() => { ctl?.dispose(); ctl = null; vi.useRealTimers(); });

const textarea = () => document.querySelector('shreddit-composer')!.shadowRoot!.querySelector('textarea')!;

describe('debounce', () => {
  it(`waits ${DEBOUNCE_MS} ms after the last keystroke, then sends the latest text once`, async () => {
    const fc = fakeChrome();
    installRelay(fc.chromeLike);
    ctl = createController(document, fc.bridge, { host: 'www.reddit.com' });
    const ta = textarea();
    ta.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    for (const t of ['I work', 'I work nights', 'I work nights as an ICU nurse']) { type(ta, t); await vi.advanceTimersByTimeAsync(400); }
    expect(fc.bridge.sent.filter((m) => m.kind === 'draft')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const drafts = fc.bridge.sent.filter((m) => m.kind === 'draft');
    expect(drafts).toEqual([{ kind: 'draft', seq: 1, text: 'I work nights as an ICU nurse', host: 'www.reddit.com' }]);
    // Same text again: not re-sent.
    type(ta, 'I work nights as an ICU nurse');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(fc.bridge.sent.filter((m) => m.kind === 'draft')).toHaveLength(1);
  });

  it('never sends very short drafts and hides the pill for them', async () => {
    const fc = fakeChrome();
    installRelay(fc.chromeLike);
    ctl = createController(document, fc.bridge);
    type(textarea(), 'lol ok');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(fc.bridge.sent.some((m) => m.kind === 'draft')).toBe(false);
    expect(ctl.pill.visible).toBe(false);
  });
});

describe('message flow', () => {
  it('without a side panel the pill says "Open OneOf to check", and its click opens the panel for this tab', async () => {
    const fc = fakeChrome();
    installRelay(fc.chromeLike);
    ctl = createController(document, fc.bridge);
    type(textarea(), 'My twins start kindergarten in Boise next week.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pillText(ctl)).toBe('Open OneOf to check');
    fc.setGesture(true);
    (ctl.pill.root.querySelector('.main') as HTMLElement).click();
    fc.setGesture(false);
    await flushPromises();
    expect(fc.opened).toEqual([{ tabId: TAB }]);
  });

  it('relays the draft to the panel engine and shows its verdict; stale verdicts are ignored', async () => {
    const fc = fakeChrome();
    installRelay(fc.chromeLike);
    const answers: Record<string, Verdict> = {
      'I am a nurse in Columbus, Ohio.': { state: 'result', text: 'one of ~50 → ~1 if you post this', tone: 'danger' },
    };
    const panel = fc.openPanel((d) => answers[d.text] ?? null);
    ctl = createController(document, fc.bridge);
    type(textarea(), 'I am a nurse in Columbus, Ohio.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(panel.drafts).toEqual([{ kind: 'draft', tabId: TAB, seq: 1, text: 'I am a nurse in Columbus, Ohio.', host: 'localhost' }]);
    await flushPromises();
    expect(pillText(ctl)).toBe('one of ~50 → ~1 if you post this');
    expect(fc.toTab.at(-1)).toMatchObject({ kind: 'verdict', seq: 1 });

    // A verdict for an older draft must not overwrite the newer one.
    type(textarea(), 'I am a nurse in Columbus, Ohio. I drive a red truck.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    await flushPromises();
    expect(pillText(ctl)).toBe('reading on-device…');
    panel.post({ kind: 'verdict', tabId: TAB, seq: 1, verdict: { state: 'result', text: 'stale', tone: 'muted' } });
    await flushPromises();
    expect(pillText(ctl)).toBe('reading on-device…');
  });

  it('re-sends the open draft when the panel connects, and falls back when it disconnects', async () => {
    const fc = fakeChrome();
    installRelay(fc.chromeLike);
    ctl = createController(document, fc.bridge);
    type(textarea(), 'Retired firefighter, three dogs, live near Tacoma.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pillText(ctl)).toBe('Open OneOf to check');
    const panel = fc.openPanel(() => ({ state: 'result', text: 'one of ~2.4k → ~40 if you post this', tone: 'signal' }));
    await flushPromises();
    await flushPromises();
    expect(panel.drafts.map((d) => d.text)).toEqual(['Retired firefighter, three dogs, live near Tacoma.']);
    expect(pillText(ctl)).toBe('one of ~2.4k → ~40 if you post this');
    panel.close();
    await flushPromises();
    await flushPromises();
    expect(pillText(ctl)).toBe('Open OneOf to check');
  });

  it('the dismiss button hides the pill for this box, and later verdicts stay hidden', async () => {
    const fc = fakeChrome();
    installRelay(fc.chromeLike);
    fc.openPanel(() => ({ state: 'result', text: 'one of ~9 → ~1 if you post this', tone: 'danger' }));
    ctl = createController(document, fc.bridge);
    type(textarea(), 'Night shift ICU nurse, single mom of twins.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    await flushPromises();
    expect(ctl.pill.visible).toBe(true);
    (ctl.pill.root.querySelector('.x') as HTMLElement).click();
    expect(ctl.pill.visible).toBe(false);
    type(textarea(), 'Night shift ICU nurse, single mom of twins, in Columbus.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    await flushPromises();
    expect(ctl.pill.visible).toBe(false);
  });

  it('puts a Blur rewrite from the panel into the composer, which then gets re-checked', async () => {
    const fc = fakeChrome();
    installRelay(fc.chromeLike);
    const panel = fc.openPanel(() => null);
    ctl = createController(document, fc.bridge);
    type(textarea(), 'I am the only ICU nurse in Driggs, Idaho.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    panel.post({ kind: 'apply-rewrite', tabId: TAB, text: 'I work in healthcare in a small town.' });
    await flushPromises();
    expect(textarea().value).toBe('I work in healthcare in a small town.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(panel.drafts.map((d) => d.text)).toEqual(['I am the only ICU nurse in Driggs, Idaho.', 'I work in healthcare in a small town.']);
  });

  it('when the extension is reloaded, the orphaned script says so and stops listening', async () => {
    const fc = fakeChrome();
    ctl = createController(document, { ...fc.bridge, send: () => Promise.reject(new Error('Extension context invalidated')) });
    type(textarea(), 'Long enough draft text here.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pillText(ctl)).toBe('OneOf was updated · reload the page');
  });

  it('keeps the pill out of the composer box and the page’s CSS out of the pill', async () => {
    const fc = fakeChrome();
    installRelay(fc.chromeLike);
    ctl = createController(document, fc.bridge);
    type(textarea(), 'A draft long enough to check.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    const host = document.querySelector('oneof-pill')!;
    expect(host.shadowRoot).toBeNull(); // closed root: page scripts can't read the verdict
    expect(ctl.pill.root.querySelector('style')!.textContent).toContain(':host { all: initial; }');
    expect(ctl.pill.root.querySelector('.wrap')!.getAttribute('class')).toContain('on');
  });
});
