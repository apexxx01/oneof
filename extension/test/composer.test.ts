// @vitest-environment jsdom
/**
 * Composer discovery and text extraction on Reddit-shaped DOM fixtures: old.reddit textareas,
 * shreddit-composer with a Lexical-style contenteditable in an open shadow root, and a textarea
 * two shadow roots deep (shreddit-composer > faceplate-textarea-input > textarea).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { anchorFor, deepActiveElement, extractText, findEditable, normalizeText, replaceText } from '../src/content/composer';

/** Dispatches a composed event on `el` and returns the path a document-level listener saw. */
function pathFromDocument(el: Element, type = 'input'): EventTarget[] {
  let seen: EventTarget[] = [];
  const l = (e: Event) => { seen = e.composedPath(); };
  document.addEventListener(type, l, true);
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  document.removeEventListener(type, l, true);
  return seen;
}

function shadow(host: Element, html: string) {
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  return root;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('old.reddit.com textarea', () => {
  it('finds the textarea, reads its value and anchors on .usertext-edit', () => {
    document.body.innerHTML = `<form class="usertext"><div class="usertext-edit md-container"><div class="md"><textarea name="text" rows="1" cols="1"></textarea></div><div class="bottom-area"><button type="submit">save</button></div></div></form>`;
    const ta = document.querySelector('textarea')!;
    ta.value = '  I moved to Boise in 2019 and work nights.  ';
    const ed = findEditable(pathFromDocument(ta));
    expect(ed).toBe(ta);
    expect(extractText(ed!)).toBe('I moved to Boise in 2019 and work nights.');
    expect(anchorFor(ed!)).toBe(document.querySelector('.usertext-edit'));
  });

  it('ignores read-only and disabled textareas', () => {
    document.body.innerHTML = `<textarea readonly></textarea><textarea disabled></textarea>`;
    const [a, b] = Array.from(document.querySelectorAll('textarea'));
    expect(findEditable(pathFromDocument(a))).toBeNull();
    expect(findEditable([b])).toBeNull();
  });
});

describe('shreddit (new Reddit) composers in shadow DOM', () => {
  it('reads a Lexical-style contenteditable inside shreddit-composer’s open shadow root', () => {
    document.body.innerHTML = `<shreddit-comment-tree><comment-composer-host><shreddit-composer></shreddit-composer></comment-composer-host></shreddit-comment-tree>`;
    const composer = document.querySelector('shreddit-composer')!;
    const root = shadow(composer, `
      <div class="toolbar"><button>B</button></div>
      <div contenteditable="true" role="textbox" data-lexical-editor="true">
        <p dir="ltr"><span data-lexical-text="true">I’m an ICU nurse in Columbus.</span></p>
        <p dir="ltr"><span>My twins</span><br><span>start school in May.</span></p>
        <p><span contenteditable="false" class="mention">u/someone</span><span> thanks!</span></p>
        <div aria-hidden="true">Add a comment</div>
      </div>
      <div class="footer"><button type="submit">Comment</button></div>`);
    const span = root.querySelector('span')!;
    const ed = findEditable(pathFromDocument(span));
    expect(ed).toBe(root.querySelector('[contenteditable="true"]'));
    expect(extractText(ed!)).toBe('I’m an ICU nurse in Columbus.\nMy twins\nstart school in May.\nthanks!');
    // Anchors on the nearest composer host (crossing the shadow boundary), not the inner div.
    expect(anchorFor(ed!)).toBe(composer);
  });

  it('reads a textarea two shadow roots deep (faceplate-textarea-input)', () => {
    document.body.innerHTML = `<shreddit-composer></shreddit-composer>`;
    const composer = document.querySelector('shreddit-composer')!;
    const outer = shadow(composer, `<faceplate-textarea-input name="body"></faceplate-textarea-input>`);
    const face = outer.querySelector('faceplate-textarea-input')!;
    const inner = shadow(face, `<label><textarea placeholder="Body text (optional)"></textarea></label>`);
    const ta = inner.querySelector('textarea')!;
    ta.value = 'Single mom of twins, night shift nurse.';
    const path = pathFromDocument(ta, 'focusin');
    expect(path[0]).toBe(ta); // composedPath sees through both open roots
    const ed = findEditable(path);
    expect(ed).toBe(ta);
    expect(extractText(ed!)).toBe('Single mom of twins, night shift nurse.');
    expect(anchorFor(ed!)).toBe(face);
  });

  it('drills into open roots via activeElement when the path stops at a host', () => {
    document.body.innerHTML = `<shreddit-composer></shreddit-composer>`;
    const composer = document.querySelector('shreddit-composer')!;
    const root = shadow(composer, `<div contenteditable="true"><p>hello there friends</p></div>`);
    const div = root.querySelector('div')! as HTMLElement;
    div.focus();
    expect(deepActiveElement(document)).toBe(div);
    expect(findEditable([composer])).toBe(div);
  });

  it('ignores the OneOf pill itself and non-editable targets', () => {
    document.body.innerHTML = `<div data-oneof-pill><textarea></textarea></div><button>x</button>`;
    expect(findEditable([document.querySelector('textarea')!])).toBeNull();
    expect(findEditable(pathFromDocument(document.querySelector('button')!))).toBeNull();
  });
});

describe('text helpers', () => {
  it('normalizes whitespace without merging paragraphs', () => {
    expect(normalizeText('a ​b  \n\n\n\nc d ')).toBe('a b\n\nc d');
  });

  it('replaceText puts a rewrite into a textarea and fires input', () => {
    document.body.innerHTML = `<textarea></textarea>`;
    const ta = document.querySelector('textarea')!;
    ta.value = 'I am a nurse in Boise';
    let inputs = 0;
    ta.addEventListener('input', () => inputs++);
    replaceText(ta, 'I work in healthcare');
    expect(ta.value).toBe('I work in healthcare');
    expect(inputs).toBe(1);
  });

  it('replaceText rewrites a contenteditable', () => {
    document.body.innerHTML = `<div contenteditable="true"><p>I am a nurse in Boise</p></div>`;
    const div = document.querySelector('div')!;
    replaceText(div, 'I work in healthcare');
    expect(extractText(div)).toBe('I work in healthcare');
  });
});
