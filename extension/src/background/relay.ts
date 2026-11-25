/**
 * The service worker's job, as a pure object so it can be tested with a mock `chrome`:
 * relay draft text from tabs to the engine (side panel) and verdicts back, and open the panel
 * from a pill click. It holds no draft text beyond the in-flight message, and has no network code.
 */
import { ENGINE_PORT, isFromContent, isFromPanel, type Ack, type ToContent, type ToPanel } from '../shared/messages';

export interface PortLike {
  name: string;
  postMessage(m: unknown): void;
  onMessage: { addListener(cb: (m: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export interface ChromeLike {
  runtime: {
    onMessage: { addListener(cb: (m: unknown, sender: { tab?: { id?: number; windowId?: number } }, reply: (r: Ack) => void) => boolean | void): void };
    onConnect: { addListener(cb: (p: PortLike) => void): void };
  };
  tabs: { sendMessage(tabId: number, m: ToContent): Promise<unknown> };
  sidePanel: {
    open(o: { tabId?: number; windowId?: number }): Promise<void>;
    setPanelBehavior?(o: { openPanelOnActionClick: boolean }): Promise<void>;
  };
}

export function installRelay(c: ChromeLike) {
  let engine: PortLike | null = null;
  /** Tabs that have a composer script, so we can tell them when the engine comes and goes. */
  const tabs = new Set<number>();

  const toTab = (tabId: number, m: ToContent) => {
    c.tabs.sendMessage(tabId, m).catch(() => tabs.delete(tabId)); // tab closed or navigated away
  };

  c.runtime.onMessage.addListener((m, sender, reply) => {
    if (!isFromContent(m)) return;
    const tabId = sender.tab?.id;
    if (m.kind === 'open-panel') {
      // Called synchronously inside the pill's click, so the user gesture still counts.
      if (tabId !== undefined) c.sidePanel.open({ tabId }).catch(() => c.sidePanel.open({ windowId: sender.tab!.windowId }).catch(() => undefined));
      reply({ engine: !!engine });
      return;
    }
    if (tabId === undefined) return;
    tabs.add(tabId);
    if (m.kind === 'hello') { reply({ engine: !!engine }); return; }
    // kind === 'draft'
    if (engine) engine.postMessage({ kind: 'draft', tabId, seq: m.seq, text: m.text, host: m.host } satisfies ToPanel);
    reply({ engine: !!engine });
  });

  c.runtime.onConnect.addListener((port) => {
    if (port.name !== ENGINE_PORT) return;
    engine = port;
    port.onMessage.addListener((m) => {
      if (!isFromPanel(m)) return;
      if (m.kind === 'verdict') toTab(m.tabId, { kind: 'verdict', seq: m.seq, verdict: m.verdict });
      else if (m.kind === 'apply-rewrite') toTab(m.tabId, { kind: 'apply-rewrite', text: m.text });
    });
    port.onDisconnect.addListener(() => {
      if (engine === port) engine = null;
      for (const t of tabs) toTab(t, { kind: 'engine', ready: false });
    });
    for (const t of tabs) toTab(t, { kind: 'engine', ready: true });
  });

  c.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);

  return { get engine() { return engine; }, tabs };
}
