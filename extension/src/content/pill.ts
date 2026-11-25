/**
 * The pill: a small status chip next to the composer. Rendered in a CLOSED shadow root so
 * Reddit's CSS can't restyle it and Reddit's scripts can't read the verdict out of it.
 * The host is pointer-events:none; only the chip itself takes clicks, and it sits outside
 * the composer box (above it, or below when there's no room) so it never covers the text
 * or the submit buttons.
 */
import type { Tone, Verdict } from '../shared/messages';

const CSS = `
:host { all: initial; }
.wrap { position: fixed; top: 0; left: 0; display: none; pointer-events: none; z-index: 2147483646; }
.wrap.on { display: block; }
.pill { pointer-events: auto; display: inline-flex; align-items: stretch; max-width: min(460px, calc(100vw - 16px));
  background: #0c0c0d; color: #ecebe6; border: 1px solid #26262a; border-radius: 999px;
  font: 500 12px/1.2 "Inter Tight", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 6px 24px #0007; overflow: hidden; animation: pop .25s ease; }
@keyframes pop { from { transform: translateY(3px); opacity: 0; } to { transform: none; opacity: 1; } }
button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.main { padding: 6px 4px 6px 7px; min-width: 0; }
.main:focus-visible, .x:focus-visible { outline: 2px solid #ff5b2e; outline-offset: -2px; }
.logo { font: 700 10.5px/1 ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; background: #ff5b2e; color: #120604; border-radius: 6px; padding: 3px 5px; flex: none; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: currentColor; }
.text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-feature-settings: "tnum"; }
.x { padding: 0 9px 0 6px; color: #9a988f; font-size: 14px; border-left: 1px solid #26262a; }
.x:hover { color: #ecebe6; }
.t-device { color: #39d98a; } .t-signal { color: #ff5b2e; } .t-amber { color: #f5b544; }
.t-danger { color: #ff4d5e; } .t-muted, .t-idle { color: #9a988f; }
.t-device .pill { border-color: color-mix(in srgb, #39d98a 45%, transparent); }
.t-danger .pill { border-color: color-mix(in srgb, #ff4d5e 55%, transparent); }
.t-signal .pill { border-color: color-mix(in srgb, #ff5b2e 55%, transparent); }
.t-amber .pill { border-color: color-mix(in srgb, #f5b544 45%, transparent); }
.text { color: #ecebe6; }
.checking .dot { animation: blink 1s ease-in-out infinite; }
@keyframes blink { 50% { opacity: .25; } }
`;

/**
 * The composer's box: the host element when it really wraps the editable (shreddit-composer
 * includes its toolbar and buttons), else the editable itself (custom elements without a
 * display style report an inline line box, not the area you type in).
 */
export function boxFor(anchor: Element, editable?: Element | null): DOMRect {
  const a = anchor.getBoundingClientRect();
  if (!editable || editable === anchor) return a;
  const e = editable.getBoundingClientRect();
  const wraps = a.left <= e.left + 1 && a.top <= e.top + 1 && a.right >= e.right - 1 && a.bottom >= e.bottom - 1;
  return wraps && a.width > 0 && a.height > 0 ? a : e;
}

export interface Pill {
  /** `editable` is the element typed in; `anchor` the composer host around it. */
  show(v: Verdict, anchor: Element, editable?: Element | null): void;
  hide(): void;
  destroy(): void;
  /** Re-run positioning (scroll, resize, layout change). */
  place(): void;
  readonly visible: boolean;
  /** Test hook: the closed shadow root. */
  readonly root: ShadowRoot;
}

export function createPill(doc: Document, handlers: { onOpen: () => void; onDismiss: () => void }): Pill {
  const host = doc.createElement('oneof-pill');
  host.setAttribute('data-oneof-pill', '');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style><div class="wrap" part="wrap"><div class="pill" role="status" aria-live="polite"><button class="main" type="button"><span class="logo">OneOf</span><span class="dot"></span><span class="text"></span></button><button class="x" type="button" aria-label="Hide OneOf for this box" title="Hide for this box">×</button></div></div>`;
  const wrap = root.querySelector('.wrap') as HTMLElement;
  const main = root.querySelector('.main') as HTMLElement;
  const text = root.querySelector('.text') as HTMLElement;
  const x = root.querySelector('.x') as HTMLElement;
  let anchor: Element | null = null;
  let editable: Element | null = null;
  let visible = false;

  // Clicking the pill must not steal focus from the composer (or the caret jumps).
  for (const b of [main, x]) b.addEventListener('mousedown', (e) => e.preventDefault());
  main.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onOpen(); });
  x.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onDismiss(); });

  const mount = () => { if (!host.isConnected) (doc.body ?? doc.documentElement).appendChild(host); };

  const place = () => {
    if (!visible || !anchor) return;
    if (!anchor.isConnected) { api.hide(); return; }
    const r = boxFor(anchor, editable);
    const vw = doc.defaultView?.innerWidth ?? 1024;
    const vh = doc.defaultView?.innerHeight ?? 768;
    const pill = wrap.firstElementChild as HTMLElement;
    const w = pill.offsetWidth || 260;
    const h = pill.offsetHeight || 28;
    if (r.bottom < 0 || r.top > vh || (r.width === 0 && r.height === 0)) { wrap.style.visibility = 'hidden'; return; }
    wrap.style.visibility = 'visible';
    let top = r.top - h - 6; // above the box: never over the text or the buttons below it
    if (top < 4) top = r.bottom + 6; // no room above: just below the box
    if (top + h > vh - 4) top = Math.max(4, r.top + 4); // last resort: inside the top edge
    const left = Math.min(Math.max(4, r.right - w), vw - w - 4);
    wrap.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  const api: Pill = {
    show(v, a, ed) {
      mount();
      anchor = a;
      editable = ed ?? null;
      text.textContent = v.text;
      main.title = v.detail ?? v.text;
      main.setAttribute('aria-label', `OneOf: ${v.text}. Open the OneOf side panel.`);
      wrap.className = `wrap on t-${v.tone satisfies Tone}${v.state === 'checking' ? ' checking' : ''}`;
      visible = true;
      place();
    },
    hide() { visible = false; wrap.classList.remove('on'); },
    destroy() { visible = false; host.remove(); },
    place,
    get visible() { return visible; },
    root,
  };
  return api;
}
