/**
 * The demo history: the synthetic persona u/quietnight_rn from the web app. Its facts come
 * from a real recorded Gemini Nano run (public/personas/p1-replay.json) and are re-checked
 * with today's verify() against the persona's posts, exactly as src/lib/replay.ts recheck()
 * does for the web replay. The build copies a trimmed file (recording metadata, the log's
 * facts, and only the posts those facts quote) into the extension package; it is read from
 * chrome-extension://, never from the network. The persona's answer key is not included.
 */
import { chromeVersion, recheck, type DraftRecording } from '../../../src/lib/replay';
import type { Fact, Post } from '../../../src/lib/types';
import type { StoredHistory } from '../shared/history';

export interface DemoFile {
  persona: string;
  synthetic: true;
  recordedAt: string;
  userAgent: string;
  postsTotal: number;
  facts: Fact[];
  posts: Post[];
  /** The recorded on-device check of the practice page's sample draft. */
  draft?: DraftRecording;
}

export function demoHistory(d: DemoFile): StoredHistory {
  const kept = recheck(d.facts, new Map(d.posts.map((p) => [p.id, p])));
  return {
    v: 1, source: 'demo', facts: kept,
    label: `SYNTHETIC persona u/${d.persona}: a recorded Gemini Nano run (Chrome ${chromeVersion(d.userAgent)}, ${d.recordedAt.slice(0, 10)}), re-checked by today’s checker`,
    posts: d.postsTotal, read: d.postsTotal, savedAt: new Date().toISOString(),
  };
}

export async function loadDemoFile(url: string): Promise<DemoFile> {
  const r = await fetch(url);
  return (await r.json()) as DemoFile;
}

export async function loadDemo(url: string): Promise<StoredHistory> {
  return demoHistory(await loadDemoFile(url));
}
