import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { estimate, humanCount } from './estimate';
import type { Attribute, Region } from './types';

const region: Region = { key: 'r', label: 'R', population: 1_000_000, adultShare: 1, grade: 'A', source: 't' };
const attr = (low: number, high: number, grade: 'A' | 'B' | 'C' = 'A'): Attribute => ({
  rate: { key: `k${low}${high}${grade}${Math.random()}`, label: 'x', cat: 'occupation', low, high, grade, source: 't', origin: 'bundled' },
  facts: [],
  firstSeen: '2020-01-01',
});

describe('estimate', () => {
  it('with no attributes returns roughly the region population', () => {
    const e = estimate(region, []);
    expect(e.p50).toBeGreaterThan(900_000);
    expect(e.p50).toBeLessThan(1_100_000);
    expect(e.band).toBe('crowd');
  });

  it('is ordered p10 <= p50 <= p90 and never below one person', () => {
    const e = estimate(region, [attr(1e-6, 2e-6), attr(1e-3, 2e-3)]);
    expect(e.p10).toBeGreaterThanOrEqual(1);
    expect(e.p10).toBeLessThanOrEqual(e.p50);
    expect(e.p50).toBeLessThanOrEqual(e.p90);
  });

  it('weaker evidence gives a wider range', () => {
    const a = estimate(region, [attr(0.01, 0.01, 'A')]);
    const c = estimate(region, [attr(0.01, 0.01, 'C')]);
    expect(c.p90 / c.p10).toBeGreaterThan(a.p90 / a.p10);
  });

  it('property: adding an attribute never makes the median crowd larger', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1e-4, max: 0.9, noNaN: true }), { minLength: 0, maxLength: 5 }),
        fc.double({ min: 1e-4, max: 0.9, noNaN: true }),
        (fracs, extra) => {
          const base = fracs.map((f) => attr(f, Math.min(1, f * 1.5)));
          const before = estimate(region, base, 11).p50;
          const after = estimate(region, [...base, attr(extra, Math.min(1, extra * 1.5))], 11).p50;
          // Correlation correction can only *raise* k up to CORR_MAX per attribute,
          // and fraction <= 0.9*1.5 capped at 1 → allow tiny MC noise.
          return after <= before * 1.02 + 1;
        },
      ),
      { numRuns: 60 },
    );
  });

  it('is deterministic for a given seed', () => {
    const attrs = [attr(0.002, 0.003)];
    expect(estimate(region, attrs, 3)).toEqual(estimate(region, attrs, 3));
  });
});

describe('humanCount', () => {
  it('rounds for humans', () => {
    expect(humanCount(1)).toBe('1');
    expect(humanCount(23)).toBe('25');
    expect(humanCount(1_752_753)).toBe('1.75M');
  });
});
