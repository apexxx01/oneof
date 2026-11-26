/**
 * The crowd field's arithmetic, shared by the web app and the extension (and mirrored on iOS).
 *
 *   N     = 1600 dots
 *   ratio = clamp(p50 / base, 0, 1)        base = adults in the starting population
 *   lit   = clamp(round(N × ratio^0.35), 1, N)
 *
 * 258M → all 1600 lit, ~1.4M → ~256, ~2.3k → ~27, ~50 → ~7, ~1 → 1 or 2.
 * Which dots stay lit is a fixed shuffle (mulberry32(7)): the first `lit` indices of it. The same
 * dots stay lit as the crowd shrinks, so the field thins instead of reshuffling.
 */
import { DEFAULT_REGION } from '../data/baserates';
import { mulberry32 } from '../lib/estimate';
import type { Region } from '../lib/types';

export const FIELD_N = 1600;
export const FIELD_EXPONENT = 0.35;
export const FIELD_SEED = 7;

export function litCount(p50: number, base: number, n = FIELD_N): number {
  const ratio = base > 0 ? Math.min(1, Math.max(0, p50 / base)) : 1;
  return Math.min(n, Math.max(1, Math.round(n * ratio ** FIELD_EXPONENT)));
}

/**
 * The population the field starts from: every adult in the country. A US region narrows from all
 * US adults (so naming a county darkens the field too); a region with no country entry in the
 * bundled tables starts from its own adults.
 */
export function fieldBase(region: Region): number {
  const country = region.key.split(':')[0] === DEFAULT_REGION.key ? DEFAULT_REGION : region;
  return country.population * (country.adultShare ?? 1);
}

let cached: Uint16Array | null = null;
/** Fisher–Yates over 0..N-1 with mulberry32(7). rank[i] = position of dot i in the lighting order. */
export function litRank(n = FIELD_N): Uint16Array {
  if (n === FIELD_N && cached) return cached;
  const order = Array.from({ length: n }, (_, i) => i);
  const rnd = mulberry32(FIELD_SEED);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const rank = new Uint16Array(n);
  order.forEach((dot, pos) => { rank[dot] = pos; });
  if (n === FIELD_N) cached = rank;
  return rank;
}

/** The grid of N dots whose shape is closest to the box's aspect ratio (40×40, 50×32, 64×25…). */
export function gridFor(width: number, height: number, n = FIELD_N): { cols: number; rows: number } {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  let best = { cols: 40, rows: 40 }, err = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    if (n % cols) continue;
    const rows = n / cols;
    const e = Math.abs(Math.log(cols / rows / aspect));
    if (e < err) { err = e; best = { cols, rows }; }
  }
  return best;
}

