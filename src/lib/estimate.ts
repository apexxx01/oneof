import { liftFor } from '../data/baserates';
import type { Attribute, CrowdEstimate, Grade, Region } from './types';

/**
 * Crowd-size estimator. Pure and deterministic given a seed.
 *
 *   k = N(region) × Π fᵢ × C
 *
 * - fᵢ is sampled log-uniformly inside each attribute's [low, high], widened by the
 *   evidence grade (A ±10%, B ×/÷2, C ×/÷5), so weak sources produce wide ranges.
 * - C is a correlation correction. Independence makes k too small when attributes
 *   overlap (nurse & female, nurse & hospital), so every attribute after the first
 *   multiplies k by a factor sampled from [1, CORR_MAX]. It is conservative on purpose:
 *   OneOf would rather tell you the crowd is bigger than it is than smaller.
 * - Output is P10 / P50 / P90 over Monte Carlo draws. Never a single number.
 */
export const GRADE_SPREAD: Record<Grade, number> = { A: 1.1, B: 2, C: 5 };
export const CORR_MAX = 1.6;
const DRAWS = 4000;

export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const logUniform = (r: number, lo: number, hi: number) => Math.exp(Math.log(lo) + r * (Math.log(hi) - Math.log(lo)));

export function bandFor(k: number): CrowdEstimate['band'] {
  if (k >= 10_000) return 'crowd';
  if (k >= 1_000) return 'neighbourhood';
  if (k >= 10) return 'room';
  return 'handful';
}

function quantile(sorted: number[], q: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

export function estimate(region: Region, attrs: Attribute[], seed = 7): CrowdEstimate {
  const rnd = mulberry32(seed);
  const regionSpread = GRADE_SPREAD[region.grade];
  const draws: number[] = new Array(DRAWS);
  for (let d = 0; d < DRAWS; d++) {
    const adults = region.population * (region.adultShare ?? 1);
    let k = logUniform(rnd(), adults / regionSpread, adults * regionSpread);
    const seen: string[] = [];
    attrs.forEach((a, i) => {
      const s = GRADE_SPREAD[a.rate.grade];
      const lo = Math.max(1e-9, a.rate.low / s);
      const hi = Math.min(1, a.rate.high * s);
      // Known overlaps with attributes already counted (cited lifts), then a small
      // unknown-correlation factor for everything else.
      const f = Math.min(1, logUniform(rnd(), lo, Math.max(lo, hi)) * liftFor(a.rate.key, seen).lift);
      seen.push(a.rate.key);
      // Correlation can soften an attribute's effect, never reverse it: factor stays <= 1.
      const c = i > 0 ? logUniform(rnd(), 1, CORR_MAX) : 1;
      k *= Math.min(1, f * c);
    });
    draws[d] = k;
  }
  draws.sort((a, b) => a - b);
  // A crowd can't be smaller than one person: you.
  const clamp = (x: number) => Math.max(1, x);
  const p10 = clamp(quantile(draws, 0.1));
  const p50 = clamp(quantile(draws, 0.5));
  const p90 = clamp(quantile(draws, 0.9));
  return { p10, p50, p90, band: bandFor(p50), bits: Math.max(0, Math.log2((region.population * (region.adultShare ?? 1)) / p50)) };
}

/**
 * How many people, rounded for humans: 1,752,753 → "1.75M", 1,000,000 → "1M", 23.4 → "25".
 * Trailing zeros are dropped, so axis ticks and the meter read the same ("1M", not "1.00M").
 */
export function humanCount(n: number): string {
  const trim = (x: number, digits: number) => String(Number(x.toFixed(digits)));
  if (n < 2) return '1';
  if (n < 10) return String(Math.round(n));
  if (n < 100) return String(Math.round(n / 5) * 5);
  if (n < 1000) return String(Math.round(n / 10) * 10);
  if (n < 1e6) return `${trim(n / 1000, n < 1e4 ? 1 : 0)}k`;
  if (n < 1e9) return `${trim(n / 1e6, n < 1e7 ? 2 : 1)}M`;
  return `${trim(n / 1e9, 2)}B`;
}

export function rangeLabel(e: CrowdEstimate): string {
  return `${humanCount(e.p10)}–${humanCount(e.p90)}`;
}
