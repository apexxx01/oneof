import { describe, expect, it } from 'vitest';
import { playReplay, type Replay } from './replay';

const f = (id: string) => ({ id, postId: id, date: '2023-01-01', cat: 'occupation' as const, value: 'nurse', quote: 'nurse', certainty: 'stated' as const, source: 'on_device' as const });
const rec: Replay = {
  version: 1, recordedAt: '2026-11-24T00:00:00Z', userAgent: 'Chrome/148', persona: 'p', postsTotal: 3, postsRead: 3, fastPass: 2,
  onDevice: 2, inCloud: 0, rejected: 1, totalMs: 30,
  log: [{ postId: 'a', ms: 10, source: 'on_device', facts: [f('a')] }, { postId: 'b', ms: 20, source: 'on_device', facts: [] }, { postId: 'c', ms: 0, source: 'error', facts: [] }],
};

describe('replay', () => {
  it('reproduces the recorded facts and counts exactly', async () => {
    const seen: number[] = [];
    const out = await playReplay(rec, 1000, (p) => seen.push(p.done));
    expect(out.facts.map((x) => x.id)).toEqual(['a']);
    expect([out.onDevice, out.inCloud, out.done, out.rejected]).toEqual([2, 0, 3, 1]);
    expect(seen.at(-1)).toBe(3);
  });
  it('stops when aborted', async () => {
    const ac = new AbortController(); ac.abort();
    const out = await playReplay(rec, 1, () => undefined, ac.signal);
    expect(out.done).toBe(0);
  });
});

import { withBudget } from './ai';
describe('withBudget', () => {
  it('rejects a call that never resolves', async () => {
    await expect(withBudget(new Promise(() => undefined), 20)).rejects.toThrow(/timed out/);
  });
  it('passes a fast result through', async () => {
    await expect(withBudget(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});
