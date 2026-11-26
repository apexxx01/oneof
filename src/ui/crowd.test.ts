import { describe, expect, it } from 'vitest';
import { DEFAULT_REGION, REGIONS } from '../data/baserates';
import { FIELD_N, fieldBase, gridFor, litCount, litRank } from './crowd';

const US = DEFAULT_REGION.population * DEFAULT_REGION.adultShare;

describe('crowd field mapping', () => {
  it('lights every dot for the whole population and a handful for ~50 people', () => {
    expect(litCount(US, US)).toBe(FIELD_N);
    expect(litCount(263e6, 263e6)).toBe(1600);
    expect(litCount(1.4e6, 263e6)).toBeGreaterThan(240);
    expect(litCount(1.4e6, 263e6)).toBeLessThan(270);
    expect(litCount(2300, 263e6)).toBe(27);
    expect(litCount(50, 263e6)).toBe(7);
    expect(litCount(1, 263e6)).toBeGreaterThanOrEqual(1);
    expect(litCount(1, 263e6)).toBeLessThanOrEqual(2);
  });

  it('never goes below one dot or above N', () => {
    expect(litCount(0, US)).toBe(1);
    expect(litCount(US * 10, US)).toBe(FIELD_N);
  });

  it('is monotonic: a smaller crowd never lights more dots', () => {
    let prev = Infinity;
    for (let k = US; k >= 1; k /= 1.7) {
      const l = litCount(k, US);
      expect(l).toBeLessThanOrEqual(prev);
      prev = l;
    }
  });

  it('uses a fixed shuffle, so the field thins instead of reshuffling', () => {
    const rank = litRank();
    expect(rank).toHaveLength(FIELD_N);
    expect(new Set(rank).size).toBe(FIELD_N);
    expect(Array.from(litRank())).toEqual(Array.from(rank));
    // The dots lit at 7 are a subset of the dots lit at 27.
    const lit = (n: number) => new Set(Array.from(rank.keys()).filter((i) => rank[i] < n));
    for (const d of lit(7)) expect(lit(27).has(d)).toBe(true);
  });

  it('starts US regions from all US adults, so naming a county darkens the field', () => {
    const franklin = REGIONS.find((r) => r.key === 'us:oh:franklin')!;
    expect(fieldBase(franklin)).toBe(US);
    expect(fieldBase(DEFAULT_REGION)).toBe(US);
  });

  it('picks the 1600-dot grid closest to the box', () => {
    expect(gridFor(400, 400)).toEqual({ cols: 40, rows: 40 });
    expect(gridFor(500, 320)).toEqual({ cols: 50, rows: 32 });
    expect(gridFor(1200, 300)).toEqual({ cols: 80, rows: 20 });
  });
});
