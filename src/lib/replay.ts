/**
 * Recorded runs. A judge without Gemini Nano can watch a real on-device scan played back,
 * labelled as a replay with its recording date, browser and speed-up. Nothing is synthesised:
 * every fact and timing in a replay came out of a live run and is exported from that run.
 */
import type { Fact } from './types';
import type { ScanProgress } from './run';
import { EXTRACT_PROMPT_VERSION } from './prompts';
import { record } from './ledger';
import { verify } from './verify';
import type { Post } from './types';

export interface RunLogEntry { postId: string; ms: number; source: 'on_device' | 'in_cloud' | 'error'; facts: Fact[] }

/** The sample draft, run once on Gemini Nano and recorded, for browsers without Nano. */
export interface DraftRecording {
  text: string;
  recordedAt: string;
  userAgent: string;
  sentences: Array<{ text: string; ms: number; facts: Fact[] }>;
}

export interface Replay {
  version: 1;
  recordedAt: string;
  userAgent: string;
  persona: string;
  /** Extraction prompt version the run was recorded with. */
  promptVersion?: string;
  postsTotal: number;
  postsRead: number;
  fastPass: number;
  onDevice: number;
  inCloud: number;
  rejected: number;
  totalMs: number;
  log: RunLogEntry[];
  draft?: DraftRecording;
}

export function toReplay(p: ScanProgress, persona: string): Replay {
  return {
    version: 1, recordedAt: new Date().toISOString(), userAgent: navigator.userAgent, persona, promptVersion: EXTRACT_PROMPT_VERSION,
    postsTotal: p.total, postsRead: p.done, fastPass: p.fastPass, onDevice: p.onDevice, inCloud: p.inCloud, rejected: p.rejected,
    totalMs: Math.round(p.log.reduce((s, e) => s + e.ms, 0)), log: p.log,
  };
}

export function chromeVersion(ua: string) {
  return ua.match(/Chrome\/(\d+)/)?.[1] ?? '?';
}

export function downloadJson(name: string, body: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

/**
 * Plays a recording back at `speed`x with the same progress shape a live scan emits. Facts go
 * through the current deterministic checker (verify.ts), so a recording made before a checker
 * fix doesn't show facts the shipped pipeline would reject. Each recorded call is added to the
 * ledger, marked as a replay, so "What the cloud saw" shows what the run did.
 */
export async function playReplay(r: Replay, speed: number, onUpdate: (p: ScanProgress) => void, signal?: AbortSignal, posts?: Map<string, Post>): Promise<ScanProgress> {
  const st: ScanProgress = { total: r.postsTotal, considered: r.log.length, fastPass: r.fastPass, done: 0, facts: [], rejected: 0, onDevice: 0, inCloud: 0, lastMs: 0, log: [] };
  onUpdate({ ...st });
  for (const e of r.log) {
    if (signal?.aborted) break;
    await sleep(e.ms / speed, signal);
    const kept = recheck(e.facts, posts);
    st.facts.push(...kept);
    st.rejected += e.facts.length - kept.length;
    st.lastMs = e.ms;
    if (e.source === 'on_device') st.onDevice++; else if (e.source === 'in_cloud') st.inCloud++;
    st.log.push(e);
    st.done++;
    record({ task: 'extract', mode: 'PREFER_ON_DEVICE', reason: 'Recorded Gemini Nano run, played back', source: e.source === 'in_cloud' ? 'in_cloud' : e.source === 'error' ? 'error' : 'on_device', ms: e.ms, sentToCloud: '', replay: true, data: 'synthetic' });
    onUpdate({ ...st, facts: [...st.facts] });
  }
  st.rejected += r.rejected;
  onUpdate({ ...st });
  return st;
}

/** The recording's facts, filtered by today's checker (needs the post text). */
export function recheck(facts: Fact[], posts?: Map<string, Post>): Fact[] {
  if (!posts) return facts;
  return facts.filter((f) => {
    const post = posts.get(f.postId);
    return !post || verify({ p: 0, cat: f.cat, value: f.value, quote: f.quote, about_self: true, certainty: f.certainty === 'stated' ? 'stated' : 'implied' }, post).ok;
  });
}
