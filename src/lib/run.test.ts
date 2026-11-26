import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let failIds = new Set<string>();
vi.mock('./ai', () => ({
  BlockedError: class BlockedError extends Error {},
  lookupBaseRate: vi.fn(),
  extractFromPost: vi.fn(async (post: { id: string }) => {
    calls.push(post.id);
    if (failIds.has(post.id)) { failIds.delete(post.id); throw new Error('on-device call timed out after 20s'); }
    return { facts: [], rejected: 0, source: 'on_device', ms: 5, raw: [] };
  }),
}));

import { scan } from './run';

const post = (i: number) => ({ id: `p${i}`, date: '2024-01-01', text: `my job at the hospital, post number ${i}` });

describe('scan resilience', () => {
  it('cools down after two failures in a row and retries failed posts once at the end', async () => {
    calls.length = 0; failIds = new Set(['p1', 'p2']);
    const seen: boolean[] = [];
    const out = await scan([0, 1, 2, 3].map(post), 'synthetic', (p) => seen.push(!!p.cooling), undefined, { coolMs: 1 });
    expect(seen).toContain(true);
    expect(out.retried).toBe(2);
    expect(calls).toEqual(['p0', 'p1', 'p2', 'p3', 'p1', 'p2']);
    expect(out.onDevice).toBe(4);
    expect(out.log.filter((e) => e.source === 'error')).toHaveLength(0);
  });
  it('recovers a post whose first attempt fails', async () => {
    calls.length = 0; failIds = new Set(['p0']);
    const out = await scan([post(0)], 'synthetic', () => undefined, undefined, { coolMs: 1 });
    expect(out.onDevice).toBe(1);
    expect(out.log.filter((e) => e.source === 'error')).toHaveLength(0);
  });
  it('logs a post as an error when its retry fails too', async () => {
    calls.length = 0; failIds = new Set(['p0']);
    const { extractFromPost } = await import('./ai');
    (extractFromPost as unknown as { mockImplementationOnce: (f: unknown) => void }).mockImplementationOnce(async () => { throw new Error('timed out'); });
    (extractFromPost as unknown as { mockImplementationOnce: (f: unknown) => void }).mockImplementationOnce(async () => { throw new Error('timed out'); });
    const out = await scan([post(0)], 'synthetic', () => undefined, undefined, { coolMs: 1 });
    expect(out.log.filter((e) => e.source === 'error')).toHaveLength(1);
    expect(out.onDevice).toBe(0);
  });
});

import { planScan } from './run';
describe('planScan (the live cloud demo limit)', () => {
  const day = (i: number) => new Date(Date.UTC(2019, 0, 1) + i * 86400000 * 10).toISOString();
  // Every 8th post has a life-detail cue; the rest are chatter.
  const history = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, date: day(i), text: i % 8 === 0 ? `my shift at the hospital ran long again, post ${i}` : `lovely weather for a walk today, post ${i}` }));
  it('reads everything when there is no limit, cue posts first', () => {
    const out = planScan(history);
    expect(out.considered).toHaveLength(200);
    expect(out.fastPass).toBe(25);
    expect(out.considered.slice(0, 25).every((p) => p.text.includes('hospital'))).toBe(true);
  });
  it('spreads a 25-post sample across the whole timeline instead of the first posts', () => {
    const out = planScan(history, 25);
    expect(out.considered).toHaveLength(25);
    const dates = out.considered.map((p) => p.date).sort();
    // Covers the first and the last tenth of the history.
    expect(dates[0] <= history[20].date).toBe(true);
    expect(dates.at(-1)! >= history[180].date).toBe(true);
  });
  it('a capped run reads cue posts first and only fills with chatter when they run out', () => {
    const out = planScan(history, 25);
    expect(out.fastPass).toBe(25);
    const mixed = planScan(history, 50);
    expect(mixed.considered).toHaveLength(50);
    expect(mixed.fastPass).toBe(25);
    expect(mixed.considered.slice(0, mixed.fastPass).every((p) => p.text.includes('hospital'))).toBe(true);
    expect(mixed.considered.slice(mixed.fastPass).every((p) => !p.text.includes('hospital'))).toBe(true);
  });
});
