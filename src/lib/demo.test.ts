import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDemoExport } from './demo';
import { fromPaste, importRedditZip } from './importers';

const pub = (f: string) => fileURLToPath(new URL(`../../public/personas/${f}`, import.meta.url));
const persona = JSON.parse(readFileSync(pub('p1.json'), 'utf8')) as { posts: Array<{ id: string; date: string; text: string }> };

describe('isDemoExport', () => {
  it('recognises the shipped synthetic Reddit export by its post ids', async () => {
    const buf = readFileSync(pub('quietnight_rn-reddit-export.zip'));
    const r = await importRedditZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(isDemoExport(r.posts)).toBe(true);
  });
  it('recognises the persona’s posts pasted in, by content', () => {
    const pasted = fromPaste(persona.posts.slice(0, 12).map((p) => p.text).join('\n\n'));
    expect(isDemoExport(pasted)).toBe(false);
    expect(isDemoExport(pasted, persona.posts)).toBe(true);
  });
  it('does not flag a real history', () => {
    const own = fromPaste('I moved to Pune for work last spring.\n\nMy dog hates the monsoon.\n\nFinally fixed my bike.');
    expect(isDemoExport(own, persona.posts)).toBe(false);
    expect(isDemoExport([])).toBe(false);
  });
});
