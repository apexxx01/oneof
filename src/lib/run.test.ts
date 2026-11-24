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
  it('logs a post as an error only if its retry also fails', async () => {
    calls.length = 0; failIds = new Set(['p0']);
    const out = await scan([post(0)], 'synthetic', () => undefined, undefined, { coolMs: 1 });
    expect(out.onDevice).toBe(1);
  });
});
