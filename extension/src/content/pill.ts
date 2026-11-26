/**
 * The pill: a small status chip next to the composer. Rendered in a CLOSED shadow root so
 * Reddit's CSS can't restyle it and Reddit's scripts can't read the verdict out of it.
 * The host is pointer-events:none; only the chip itself takes clicks, and it sits outside
 * the composer box (above it, or below when there's no room) so it never covers the text
 * or the submit buttons.
 */
import type { Tone, Verdict } from '../shared/messages';
import monoFont from './fonts/pill-mono.woff2?inline';
import numFont from './fonts/pill-numeral.woff2?inline';

/**
 * Fonts: tiny subsets of the self-hosted Archivo (condensed numerals) and JetBrains Mono, inlined
 * in this script and registered from bytes, so nothing is fetched and the page's CSP never applies.
 * Shadow-root @font-face rules are ignored by Chrome, hence document.fonts.
 */
const FAMILY = { num: 'OneOf Pill Numeral', mono: 'OneOf Pill Mono' };
let fontsAdded = false;
function addFonts(doc: Document) {
  if (fontsAdded || typeof FontFace === 'undefined' || !doc.fonts) return;
  fontsAdded = true;
  const bytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  try {
    doc.fonts.add(new FontFace(FAMILY.num, bytes(numFont), { weight: '900' }));
    doc.fonts.add(new FontFace(FAMILY.mono, bytes(monoFont), { weight: '700' }));
  } catch { /* fall back to system fonts */ }
}

const MONO = `"${FAMILY.mono}", ui-monospace, Menlo, Consolas, monospace`;
const NUM = `"${FAMILY.num}", "Arial Narrow", Arial, sans-serif`;

export const CSS = `
:host { all: initial; }
.wrap { position: fixed; top: 0; left: 0; display: none; pointer-events: none; z-index: 2147483646;
  --bg: #000; --fg: #f5f5f2; --mut: #9b9b9b; --line: #3a3a3a; --signal: #ff4a1c; --device: #1fe07f; --amber: #f5b544; }
@media (prefers-color-scheme: light) { .wrap { --bg: #fff; --fg: #0a0a0a; --mut: #5e5e5e; --line: #bdbdbd; --signal: #e8380d; --device: #007a3f; --amber: #a86500; } }
.wrap.on { display: block; }
.pill { pointer-events: auto; display: inline-flex; align-items: stretch; max-width: min(460px, calc(100vw - 16px));
  background: var(--bg); color: var(--fg); border: 2px solid var(--fg); border-radius: 0;
  box-shadow: 4px 4px 0 var(--fg); font: 700 11px/1.2 ${MONO}; letter-spacing: .06em; text-transform: uppercase;
  animation: pop .2s ease; }
@keyframes pop { from { transform: translateY(3px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .pill, .checking .sq { animation: none !important; } }
button { all: unset; cursor: pointer; display: inline-flex; align-items: center; }
.main { gap: 9px; padding: 0 10px 0 0; min-width: 0; }
.main:focus-visible, .x:focus-visible { outline: 3px solid var(--signal); outline-offset: 2px; }
.mark { display: grid; place-items: center; align-self: stretch; min-width: 30px; padding: 0 4px; background: var(--fg); color: var(--bg);
  font: 900 17px/1 ${NUM}; letter-spacing: -.02em; flex: none; }
.sq { width: 8px; height: 8px; flex: none; background: var(--mut); }
.lbl { color: var(--mut); flex: none; }
.num { font: 900 30px/.86 ${NUM}; letter-spacing: -.01em; text-transform: none; padding: 5px 0 2px; flex: none; }
.note, .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; padding: 9px 0; }
.rich .text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); padding: 0; }
.plain .lbl, .plain .num, .plain .note, .rich .sq { display: none; }
.x { padding: 0 10px; color: var(--mut); font-size: 15px; border-left: 2px solid var(--fg); }
.x:hover { color: var(--bg); background: var(--fg); }
.t-device .sq { background: var(--device); }
.t-amber .num { color: var(--amber); } .t-amber .sq { background: var(--amber); }
.t-muted .num { color: var(--mut); }
.t-signal .num, .shrinks .num { color: var(--signal); }
.t-danger .num { color: var(--signal); }
.shrinks .pill { border-color: var(--signal); box-shadow: 4px 4px 0 var(--signal); }
.shrinks .mark { background: var(--signal); color: #000; }
.shrinks .x { border-color: var(--signal); }
.checking .sq { animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: .2; } }
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
  root.innerHTML = `<style>${CSS}</style><div class="wrap" part="wrap"><div class="pill" role="status" aria-live="polite"><button class="main" type="button"><span class="mark" aria-hidden="true">1/</span><span class="sq" aria-hidden="true"></span><span class="lbl" aria-hidden="true">one of</span><span class="num" aria-hidden="true"></span><span class="note" aria-hidden="true"></span><span class="text"></span></button><button class="x" type="button" aria-label="Hide OneOf for this box" title="Hide for this box">×</button></div></div>`;
  addFonts(doc);
  const wrap = root.querySelector('.wrap') as HTMLElement;
  const main = root.querySelector('.main') as HTMLElement;
  const text = root.querySelector('.text') as HTMLElement;
  const num = root.querySelector('.num') as HTMLElement;
  const note = root.querySelector('.note') as HTMLElement;
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
      // .text carries the whole sentence (the live region screen readers hear); the numeral and
      // the short note are its visual form.
      text.textContent = v.text;
      num.textContent = v.num ?? '';
      note.textContent = v.note ?? '';
      main.title = v.detail ?? v.text;
      main.setAttribute('aria-label', `OneOf: ${v.text}. Open the OneOf side panel.`);
      wrap.className = `wrap on t-${v.tone satisfies Tone} ${v.num ? 'rich' : 'plain'}${v.shrinks ? ' shrinks' : ''}${v.state === 'checking' ? ' checking' : ''}`;
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
