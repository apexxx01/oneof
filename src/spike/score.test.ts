import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { score, type Predicted } from './score';
import { quoteVerified } from './extract';
import { prefilter } from '../lib/prefilter';

const p1 = JSON.parse(readFileSync(new URL('../../public/personas/p1.json', import.meta.url), 'utf8'));

describe('prefilter', () => {
  it('keeps every post that carries a planted fact (recall-first)', () => {
    const truthIds = new Set(p1.truth.map((t: { postId: string }) => t.postId));
    const missed = p1.posts.filter((p: { id: string; text: string }) => truthIds.has(p.id) && !prefilter(p.text).keep);
    expect(missed).toEqual([]);
  });
  it('drops link-only and tiny posts', () => {
    expect(prefilter('https://example.com/x').keep).toBe(false);
    expect(prefilter('lol ok').keep).toBe(false);
  });
});

describe('quoteVerified', () => {
  it('accepts verbatim quotes ignoring case and whitespace', () => {
    expect(quoteVerified('My  Blue activa', 'my blue Activa has survived')).toBe(true);
  });
  it('rejects paraphrases (hallucination guard)', () => {
    expect(quoteVerified('my blue scooter', 'my blue Activa has survived')).toBe(false);
  });
});

describe('score', () => {
  const t = p1.truth[0];
  const trap = p1.traps[0];
  const mk = (o: Partial<Predicted>): Predicted => ({
    p: 0, cat: 'other', value: 'x', quote: 'x', about_self: true, certainty: 'stated', postId: 'none', verified: true, ...o,
  });
  it('counts a matching verified self fact as a true positive', () => {
    const s = score([mk({ postId: t.postId, value: t.value })], p1.truth, p1.traps);
    expect(s.tp).toBe(1);
    expect(s.precision).toBe(1);
  });
  it('counts trap facts as false positives only when marked about_self', () => {
    const hit = score([mk({ postId: trap.postId, value: trap.value })], p1.truth, p1.traps);
    expect(hit.trapHits).toBe(1);
    const ok = score([mk({ postId: trap.postId, value: trap.value, about_self: false })], p1.truth, p1.traps);
    expect(ok.trapHits).toBe(0);
  });
  it('ignores unverified quotes', () => {
    const s = score([mk({ postId: t.postId, value: t.value, verified: false })], p1.truth, p1.traps);
    expect(s.tp).toBe(0);
    expect(s.quoteFailRate).toBe(1);
  });
});
