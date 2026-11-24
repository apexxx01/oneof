import type { RawFact } from '../lib/schemas';

export interface Truth { postId: string; cat: string; value: string; quote: string }
export interface Predicted extends RawFact { postId: string; verified: boolean }

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'from', 'parent'].includes(w)),
  );

function overlaps(a: string, b: string) {
  const A = tokens(a);
  for (const w of tokens(b)) if (A.has(w)) return true;
  return false;
}

/** A prediction matches a truth item if it's on the same post and the value or quote overlaps. */
function matches(p: Predicted, t: Truth) {
  return p.postId === t.postId && (overlaps(p.value, t.value) || overlaps(p.quote, t.quote));
}

export interface Score {
  predicted: number;
  selfVerified: number;
  tp: number;
  recall: number;
  precision: number;
  trapHits: number;
  unlabeled: number;
  quoteFailRate: number;
}

export function score(preds: Predicted[], truth: Truth[], traps: Truth[]): Score {
  const usable = preds.filter((p) => p.about_self && p.verified);
  const found = new Set<number>();
  let trapHits = 0;
  let unlabeled = 0;
  for (const p of usable) {
    const ti = truth.findIndex((t, i) => !found.has(i) && matches(p, t));
    if (ti >= 0) { found.add(ti); continue; }
    if (truth.some((t) => matches(p, t))) continue; // duplicate of an already-found truth: neutral
    if (traps.some((t) => matches(p, t))) trapHits++;
    else unlabeled++;
  }
  const tp = found.size;
  const quoteFails = preds.filter((p) => !p.verified).length;
  return {
    predicted: preds.length,
    selfVerified: usable.length,
    tp,
    recall: truth.length ? tp / truth.length : 0,
    precision: tp + trapHits + unlabeled ? tp / (tp + trapHits + unlabeled) : 0,
    trapHits,
    unlabeled,
    quoteFailRate: preds.length ? quoteFails / preds.length : 0,
  };
}
