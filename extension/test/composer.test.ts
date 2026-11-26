// @vitest-environment jsdom
/**
 * Composer discovery and text extraction on Reddit-shaped DOM fixtures: old.reddit textareas,
 * shreddit-composer with a Lexical-style contenteditable in an open shadow root, and a textarea
 * two shadow roots deep (shreddit-composer > faceplate-textarea-input > textarea).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { anchorFor, deepActiveElement, extractText, findEditable, MIN_SINGLE_LINE_HEIGHT, normalizeText, replaceText } from '../src/content/composer';

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

/** jsdom has no layout: give an element a measured height. */
function sized(el: Element, height: number) {
  (el as HTMLElement).getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 400, bottom: height, width: 400, height, toJSON() { return this; } }) as DOMRect;
  return el;
}

describe('generic composers on other sites', () => {
  it('Hacker News and GitHub: a plain textarea', () => {
    document.body.innerHTML = `<form method="post" action="comment"><textarea name="text" rows="8" cols="80"></textarea><input type="submit" value="add comment"></form>
      <div class="js-comment"><textarea name="comment[body]" placeholder="Leave a comment" aria-label="Comment body"></textarea></div>`;
    const [hn, gh] = Array.from(document.querySelectorAll('textarea'));
    hn.value = 'I worked nights in the ICU for twelve years.';
    gh.value = 'Repro on my work laptop in Columbus.';
    expect(findEditable(pathFromDocument(hn))).toBe(hn);
    expect(extractText(findEditable(pathFromDocument(gh))!)).toBe('Repro on my work laptop in Columbus.');
    expect(anchorFor(hn)).toBe(hn);
  });

  it('X (Draft.js): the outer contenteditable, read block by block', () => {
    document.body.innerHTML = `<div class="DraftEditor-root"><div class="public-DraftEditor-content" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Post text">
      <div data-contents="true"><div data-block="true"><div class="public-DraftStyleDefault-block"><span data-text="true">Twelve years in the ICU.</span></div></div>
      <div data-block="true"><div class="public-DraftStyleDefault-block"><span data-text="true">My twins start school Monday.</span></div></div></div></div></div>`;
    const span = document.querySelector('[data-text]')!;
    const ed = findEditable(pathFromDocument(span));
    expect(ed).toBe(document.querySelector('[contenteditable]'));
    expect(extractText(ed!)).toBe('Twelve years in the ICU.\nMy twins start school Monday.');
  });

  it('LinkedIn (Quill), Discord (Slate) and Gmail compose: role=textbox contenteditables', () => {
    document.body.innerHTML = `
      <div class="ql-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Text editor for creating content"><p>Proud to join the night ICU team in Columbus.</p></div>
      <div role="textbox" aria-multiline="true" contenteditable="true" aria-label="Message #general" data-slate-editor="true"><div data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true">my twins are 5 now</span></span></span></div></div>
      <div class="Am Al editable" role="textbox" aria-label="Message Body" aria-multiline="true" contenteditable="true">Hi all,<br>I moved to Boise in 2019.<div><br></div><div>Thanks</div></div>`;
    const [li, dc, gm] = Array.from(document.querySelectorAll('[contenteditable]'));
    expect(extractText(findEditable(pathFromDocument(li.querySelector('p')!))!)).toBe('Proud to join the night ICU team in Columbus.');
    expect(extractText(findEditable(pathFromDocument(dc.querySelector('[data-slate-string]')!))!)).toBe('my twins are 5 now');
    expect(findEditable(pathFromDocument(gm))).toBe(gm);
    expect(extractText(gm as HTMLElement)).toBe('Hi all,\nI moved to Boise in 2019.\n\nThanks');
  });

  it('a tall free-text input counts; its value is the draft', () => {
    document.body.innerHTML = `<input type="text" id="t" aria-label="Write a post">`;
    const input = sized(document.querySelector('input')!, 56) as HTMLInputElement;
    input.value = 'Night nurse, twin mom, Columbus.';
    expect(findEditable(pathFromDocument(input))).toBe(input);
    expect(extractText(input)).toBe('Night nurse, twin mom, Columbus.');
  });
});

describe('ignore rules', () => {
  it('ignores password, search, URL, email and other non-text inputs', () => {
    document.body.innerHTML = ['password', 'search', 'url', 'email', 'tel', 'number', 'hidden', 'checkbox'].map((t) => `<input type="${t}">`).join('');
    for (const input of Array.from(document.querySelectorAll('input'))) {
      sized(input, 60);
      expect(findEditable(pathFromDocument(input)), input.type).toBeNull();
    }
  });

  it(`ignores tiny single-line fields under ${MIN_SINGLE_LINE_HEIGHT}px tall`, () => {
    document.body.innerHTML = `<input type="text" name="title"><input type="text" name="nick"><textarea rows="1"></textarea><div contenteditable="true" role="textbox" aria-multiline="false"></div>`;
    const [title, nick, ta, ce] = Array.from(document.querySelectorAll('input, textarea, [contenteditable]'));
    sized(title, MIN_SINGLE_LINE_HEIGHT - 1);
    expect(findEditable([title])).toBeNull();
    // An input that was never laid out is not trusted to be a composer.
    expect(findEditable([nick])).toBeNull();
    sized(ta, 24);
    expect(findEditable([ta])).toBeNull();
    sized(ce, 30);
    expect(findEditable([ce])).toBeNull();
    // The same widgets, tall enough, are composers.
    sized(title, MIN_SINGLE_LINE_HEIGHT);
    expect(findEditable([title])).toBe(title);
    sized(ta, 120);
    expect(findEditable([ta])).toBe(ta);
    sized(ce, 80);
    expect(findEditable([ce])).toBe(ce);
  });

  it('ignores search boxes, account fields and comboboxes even when they are big', () => {
    document.body.innerHTML = `
      <div role="search"><textarea id="a"></textarea></div>
      <textarea id="b" placeholder="Search mail"></textarea>
      <div id="c" contenteditable="true" role="combobox"></div>
      <div id="d" contenteditable="true" role="searchbox"></div>
      <input id="e" type="text" name="username">
      <input id="f" type="text" autocomplete="email">
      <div id="g" contenteditable="true" aria-readonly="true"></div>`;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const el = sized(document.getElementById(id)!, 120);
      expect(findEditable(pathFromDocument(el)), id).toBeNull();
    }
  });

  it('a plain textarea with no layout info (rows unset) is still checked', () => {
    document.body.innerHTML = `<textarea></textarea>`;
    expect(findEditable([document.querySelector('textarea')!])).not.toBeNull();
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
