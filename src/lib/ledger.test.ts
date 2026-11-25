/**
 * The header's byte counters, end to end through the real extractFromPost() with a stubbed
 * Firebase SDK: demo text sent to the cloud must never be counted as the user's own posts,
 * and a Stop mid-call must be logged as the user's choice, with its bytes still counted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let behaviour: 'answer' | 'hang' = 'answer';
vi.mock('./firebase', () => ({ getFirebase: () => ({ app: {}, ai: {} }) }));
vi.mock('firebase/ai', () => ({
  InferenceMode: { ONLY_ON_DEVICE: 'only_on_device', PREFER_ON_DEVICE: 'prefer_on_device', ONLY_IN_CLOUD: 'only_in_cloud', PREFER_IN_CLOUD: 'prefer_in_cloud' },
  getGenerativeModel: () => ({
    // Like fetch: an already-aborted signal rejects at once without sending anything.
    generateContent: (_prompt: string, opts?: { signal?: AbortSignal }) => opts?.signal?.aborted
      ? Promise.reject(new DOMException('aborted', 'AbortError'))
      : behaviour === 'answer'
      ? Promise.resolve({ response: { inferenceSource: 'in_cloud', text: () => '{"facts":[]}' } })
      : new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
  }),
}));

import { extractFromPost, STOPPED_BY_YOU } from './ai';
import { getLedger, record, resetLedger, summary } from './ledger';

const post = { id: 'p1_0001', date: '2024-01-01', text: 'twelve years in the ICU and the night shift still gets me' };

describe('ledger byte counters', () => {
  beforeEach(() => { resetLedger(); behaviour = 'answer'; delete (globalThis as { LanguageModel?: unknown }).LanguageModel; });

  it('keeps own-post bytes at 0 after a synthetic cloud call', async () => {
    await extractFromPost(post, 'synthetic');
    const [e] = getLedger();
    expect(e.source).toBe('in_cloud');
    expect(e.data).toBe('synthetic');
    const s = summary();
    expect(s.demoPostBytesOut).toBeGreaterThan(0);
    expect(s.ownPostBytesOut).toBe(0);
    expect(s.postBytesOut).toBe(s.demoPostBytesOut);
  });

  it('counts an unlabelled entry as the user’s own (the cautious reading)', () => {
    record({ task: 'extract', mode: 'ONLY_IN_CLOUD', reason: 'r', source: 'in_cloud', ms: 1, sentToCloud: 'abc' });
    expect(summary().ownPostBytesOut).toBe(3);
  });

  it('logs a Stop during a dispatched cloud call as stopped, not an error, and still counts its bytes', async () => {
    behaviour = 'hang';
    const ac = new AbortController();
    const p = extractFromPost(post, 'synthetic', 'extract', undefined, ac.signal);
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await expect(p).rejects.toThrow();
    const [e] = getLedger();
    expect(e.source).toBe('stopped');
    expect(e.error).toBe(STOPPED_BY_YOU);
    expect(e.sentToCloud).not.toBe('');
    expect(summary().stopped).toBe(1);
    expect(summary().demoPostBytesOut).toBeGreaterThan(0);
  });

  it('sends nothing when the run was stopped before the call went out', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(extractFromPost(post, 'synthetic', 'extract', undefined, ac.signal)).rejects.toThrow();
    const [e] = getLedger();
    expect(e.source).toBe('stopped');
    expect(e.sentToCloud).toBe('');
  });
});
