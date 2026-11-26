/**
 * Finding the composer the user is typing in, on any site:
 *  - www/sh.reddit.com: shreddit web components. The comment and post editors live inside
 *    open shadow roots (shreddit-composer, faceplate-textarea-input, a Lexical contenteditable).
 *  - old.reddit.com, Hacker News, GitHub comments, forums: plain <textarea>s.
 *  - X, LinkedIn, Discord web, Gmail compose: a contenteditable (Draft.js, Quill, Slate, Gmail's own).
 * Ignored: password, search, URL, email and other non-text inputs; search boxes and comboboxes;
 * read-only or disabled fields; and tiny single-line fields under 40px tall (a name or a subject
 * line, not a post). focusin/input events are composed, so event.composedPath()[0] is the real
 * element even when it sits several shadow roots deep. Pure DOM code: unit-tested under jsdom.
 */

export type Editable = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

/** Hosts whose bounding box is a better anchor for the pill than the inner editable. */
const COMPOSER_HOSTS = 'shreddit-composer, comment-composer-host, faceplate-textarea-input, shreddit-markdown-composer, .usertext-edit';

/** Shorter than this and single-line: a name, subject or chat-style one-liner, not a post. */
export const MIN_SINGLE_LINE_HEIGHT = 40;

export function isTextarea(el: unknown): el is HTMLTextAreaElement {
  return !!el && (el as Element).nodeType === 1 && (el as Element).localName === 'textarea';
}

export function isInput(el: unknown): el is HTMLInputElement {
  return !!el && (el as Element).nodeType === 1 && (el as Element).localName === 'input';
}

/** A field whose value is the text: <textarea> or a plain text <input>. */
function isTextField(el: unknown): el is HTMLTextAreaElement | HTMLInputElement {
  return isTextarea(el) || isInput(el);
}

function isContentEditable(el: Element): boolean {
  const v = el.getAttribute('contenteditable');
  // jsdom doesn't implement isContentEditable; the attribute is what Reddit sets anyway.
  return (el as HTMLElement).isContentEditable === true || v === '' || v === 'true' || v === 'plaintext-only';
}

/** The outermost contenteditable that contains `el` within the same tree. */
function editableRoot(el: Element): HTMLElement {
  let cur = el as HTMLElement;
  while (cur.parentElement && isContentEditable(cur.parentElement)) cur = cur.parentElement;
  return cur;
}

/** Follows shadowRoot.activeElement through open shadow roots. */
export function deepActiveElement(doc: Document | ShadowRoot): Element | null {
  let a: Element | null = doc.activeElement;
  while (a && (a as HTMLElement).shadowRoot?.activeElement) a = (a as HTMLElement).shadowRoot!.activeElement;
  return a;
}

const SEARCHY = /\b(search|query|filter)\b/i;
/** Name/id hints of account fields on a text input (login forms often use type=text). */
const ACCOUNT = /(user(name)?|login|e-?mail|url|website|password|otp)/i;

/** Single-line by nature: an <input>, a textarea with rows=1, or a textbox that says so. */
function singleLine(el: Editable): boolean {
  if (isInput(el)) return true;
  if (isTextarea(el)) return el.getAttribute('rows') === '1';
  return el.getAttribute('aria-multiline') === 'false';
}

/**
 * Ignore our own pill, hidden, read-only and disabled fields, search boxes, credential and URL
 * fields, and tiny single-line widgets. Only real post/comment/message boxes get checked.
 */
export function usable(el: Editable): boolean {
  if (el.closest?.('[data-oneof-pill]')) return false;
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'searchbox' || role === 'combobox') return false;
  if (el.closest?.('[role="search"], form[role="search"], search')) return false;
  if (isInput(el)) {
    // Only free-text inputs; never password, search, url, email, tel, number, hidden…
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type !== 'text') return false;
    if ((el.getAttribute('autocomplete') ?? '').match(/username|email|password|one-time-code|url/)) return false;
    if (ACCOUNT.test(`${el.getAttribute('name') ?? ''} ${el.id}`)) return false;
  }
  if (isTextField(el)) {
    if (el.readOnly || el.disabled) return false;
    const hint = `${el.getAttribute('name') ?? ''} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.id}`;
    if (SEARCHY.test(hint)) return false;
  } else {
    if (el.getAttribute('aria-readonly') === 'true' || el.getAttribute('aria-disabled') === 'true') return false;
    if (SEARCHY.test(el.getAttribute('aria-label') ?? '')) return false;
  }
  if (singleLine(el)) {
    // Inputs must be measured tall enough; textareas/textboxes are skipped only when measured short
    // (an unrendered box reports 0 and is given the benefit of the doubt).
    const h = el.getBoundingClientRect?.().height ?? 0;
    if (isInput(el) ? h < MIN_SINGLE_LINE_HEIGHT : h > 0 && h < MIN_SINGLE_LINE_HEIGHT) return false;
  }
  return true;
}

/**
 * The editable element an event was aimed at, from its composed path. If the path stops at a
 * shadow host (a closed root, or a synthetic event), drills in through open roots.
 */
export function findEditable(path: readonly EventTarget[]): Editable | null {
  for (const t of path) {
    const el = t as Element;
    if (!el || el.nodeType !== 1) continue;
    if (isTextField(el)) return usable(el) ? el : null;
    if (isContentEditable(el)) {
      const root = editableRoot(el);
      return usable(root) ? root : null;
    }
  }
  const first = path[0] as HTMLElement | undefined;
  if (first?.nodeType === 1 && first.shadowRoot) {
    const inner = deepActiveElement(first.shadowRoot);
    if (inner && inner !== first) return findEditable([inner]);
  }
  return null;
}

const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'section', 'article']);

/**
 * Plain text of a composer. For a contenteditable this walks the DOM (innerText is layout-
 * dependent and missing in jsdom): blocks and <br> become line breaks, hidden bits are skipped.
 */
export function extractText(el: Editable): string {
  if (isTextField(el)) return normalizeText(el.value);
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const v = n.nodeValue ?? '';
      // Formatting whitespace between blocks (it would collapse when rendered).
      if (!/\S/.test(v) && v.includes('\n')) return;
      out.push(v);
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.localName;
    if (tag === 'br') { out.push('\n'); return; }
    if (tag === 'script' || tag === 'style' || tag === 'template') return;
    if (e.getAttribute('aria-hidden') === 'true' || e.hasAttribute('hidden')) return;
    if (e.getAttribute('contenteditable') === 'false') return; // mentions/embeds widgets
    const block = BLOCK.has(tag);
    if (block && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
    // Some editors render into an open shadow root of a custom element.
    const kids = (e as HTMLElement).shadowRoot ? (e as HTMLElement).shadowRoot!.childNodes : e.childNodes;
    kids.forEach(walk);
    if (block && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
  };
  walk(el);
  return normalizeText(out.join(''));
}

export function normalizeText(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/[\u200b\ufeff]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The box to position the pill against: the nearest known composer host, crossing shadow
 * boundaries upward, or the editable itself.
 */
export function anchorFor(el: Editable): Element {
  let node: Node | null = el;
  while (node) {
    if (node.nodeType === 1) {
      const hit = (node as Element).closest?.(COMPOSER_HOSTS);
      if (hit) return hit;
    }
    const root = node.getRootNode() as ShadowRoot | Document;
    node = (root as ShadowRoot).host ?? null;
  }
  return el;
}

/**
 * Replaces the composer's content with `text` the way a user would (so the page's own editor
 * state, React or Lexical, sees it): select all, insertText. Falls back to setting the value.
 */
export function replaceText(el: Editable, text: string): boolean {
  el.focus();
  const doc = el.ownerDocument;
  if (isTextField(el)) {
    el.select();
    if (doc.execCommand?.('insertText', false, text)) return true;
    el.value = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: text }));
    return true;
  }
  const sel = doc.getSelection?.();
  if (sel) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  if (doc.execCommand?.('insertText', false, text)) return true;
  el.textContent = text;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: text }));
  return true;
}
