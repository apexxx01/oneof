/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { fromPaste, importFile, importRedditZip } from './importers';

const publicPath = (name: string) => fileURLToPath(new URL(`../../public/personas/${name}`, import.meta.url));
const zipPath = publicPath('quietnight_rn-reddit-export.zip');
const persona = JSON.parse(readFileSync(publicPath('p1.json'), 'utf8')) as { posts: Array<{ id: string }> };

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};

const importSyntheticZip = () => importRedditZip(toArrayBuffer(readFileSync(zipPath)));

describe('importRedditZip on the synthetic Reddit export', () => {
  it('returns one post per persona post, each with text and a valid ISO date', async () => {
    const { posts } = await importSyntheticZip();
    expect(posts).toHaveLength(persona.posts.length);
    for (const p of posts) {
      expect(p.text.trim().length).toBeGreaterThan(0);
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      expect(Number.isNaN(Date.parse(p.date))).toBe(false);
    }
  });

  it('lists every non-CSV file as skipped, including the decoys and README', async () => {
    const { skippedFiles } = await importSyntheticZip();
    expect(skippedFiles).toEqual(
      expect.arrayContaining(['ip_logs.csv', 'messages.csv', 'chat_history.csv', 'account_gender.csv', 'README.txt']),
    );
  });

  it('never surfaces the ip column (no 192.0.2. values in any returned post)', async () => {
    const { posts } = await importSyntheticZip();
    expect(JSON.stringify(posts)).not.toContain('192.0.2.');
    for (const p of posts) expect(Object.keys(p)).not.toContain('ip');
  });

  it('drops CSV rows whose body is [deleted] or [removed], even when the row has a title', async () => {
    const zip = new JSZip();
    zip.file(
      'comments.csv',
      [
        'id,permalink,date,ip,subreddit,gildings,link,parent,body,media',
        'c1,/r/x/comments/a/,2023-10-04 18:22:01 UTC,192.0.2.1,x,0,t3_a,t3_a,keep me,',
        'c2,/r/x/comments/a/,2023-10-04 18:23:01 UTC,192.0.2.1,x,0,t3_a,t3_a,[deleted],',
        'c3,/r/x/comments/a/,2023-10-04 18:24:01 UTC,192.0.2.1,x,0,t3_a,t3_a,[removed],',
      ].join('\n'),
    );
    zip.file(
      'posts.csv',
      [
        'id,permalink,date,ip,subreddit,gildings,title,url,body',
        'p1,/r/x/comments/p1/,2023-10-04 18:22:01 UTC,192.0.2.2,x,0,A titled post,,[deleted]',
        'p2,/r/x/comments/p2/,2023-10-04 18:22:02 UTC,192.0.2.2,x,0,A titled post,,[removed]',
        'p3,/r/x/comments/p3/,2023-10-04 18:22:03 UTC,192.0.2.2,x,0,A titled post,,kept body',
      ].join('\n'),
    );
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const { posts } = await importRedditZip(buf);
    expect(posts.map((p) => p.id).sort()).toEqual(['c1', 'p3']);
  });
});

describe('fromPaste', () => {
  it('splits on blank lines and trims each chunk', () => {
    const posts = fromPaste('  first post  \n\n\n  second\n line \n \n third ');
    expect(posts.map((p) => p.text)).toEqual(['first post', 'second\n line', 'third']);
  });
});

describe('importFile JSON', () => {
  it('reads unix-second created_utc and skips empty bodies', async () => {
    const json = JSON.stringify([
      { id: 'j1', created_utc: 1696443721, body: 'hello json' },
      { id: 'j2', created_utc: 1696443800, body: '' },
    ]);
    const res = await importFile(new File([json], 'x.json'));
    expect(res.format).toBe('JSON');
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0]).toMatchObject({
      id: 'j1',
      text: 'hello json',
      date: new Date(1696443721 * 1000).toISOString(),
    });
  });
});
