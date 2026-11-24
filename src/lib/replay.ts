/**
 * Recorded runs. A judge without Gemini Nano can watch a real on-device scan played back,
 * labelled as a replay with its recording date, browser and speed-up. Nothing is synthesised:
 * every fact and timing in a replay came out of a live run and is exported from that run.
 */
import type { Fact } from './types';
import type { ScanProgress } from './run';
import { EXTRACT_PROMPT_VERSION } from './prompts';

export interface RunLogEntry { postId: string; ms: number; source: 'on_device' | 'in_cloud' | 'error'; facts: Fact[] }

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

/** Plays a recording back at `speed`× with the same progress shape a live scan emits. */
export async function playReplay(r: Replay, speed: number, onUpdate: (p: ScanProgress) => void, signal?: AbortSignal): Promise<ScanProgress> {
  const st: ScanProgress = { total: r.postsTotal, considered: r.log.length, fastPass: r.fastPass, done: 0, facts: [], rejected: 0, onDevice: 0, inCloud: 0, lastMs: 0, log: [] };
  onUpdate({ ...st });
  for (const e of r.log) {
    if (signal?.aborted) break;
    await sleep(e.ms / speed, signal);
    st.facts.push(...e.facts);
    st.lastMs = e.ms;
    if (e.source === 'on_device') st.onDevice++; else if (e.source === 'in_cloud') st.inCloud++;
    st.log.push(e);
    st.done++;
    onUpdate({ ...st, facts: [...st.facts] });
  }
  st.rejected = r.rejected;
  onUpdate({ ...st });
  return st;
}
