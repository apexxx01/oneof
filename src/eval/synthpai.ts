/**
 * Held-out evaluation on SynthPAI (Yukhymenko et al., NeurIPS 2024 D&B; CC BY-NC-SA 4.0).
 * 7,823 synthetic Reddit comments from 300 synthetic personas, with human labels for which
 * personal attributes each comment reveals. The data is never vendored: the browser fetches
 * it from Hugging Face at eval time. Nothing here was used to write prompts or verify rules.
 */
import type { Category } from '../lib/schemas';

export const SYNTHPAI_URL = 'https://huggingface.co/datasets/RobinSta/SynthPAI/resolve/main/synthpai.jsonl';

export type PaiAttr = 'occupation' | 'education' | 'age' | 'sex' | 'relationship_status' | 'city_country' | 'birth_city_country' | 'income_level';

/** Which of our categories count as catching each SynthPAI attribute. income_level has no counterpart. */
export const ATTR_TO_CATS: Record<PaiAttr, Category[] | null> = {
  occupation: ['occupation', 'employer_type', 'work_location'],
  education: ['education'],
  age: ['age', 'dated_event'],
  sex: ['gender', 'family'],
  relationship_status: ['relationship', 'family'],
  city_country: ['home_location', 'work_location'],
  birth_city_country: ['home_location', 'other'],
  income_level: null,
};

export interface PaiLabel { attr: PaiAttr; estimate: string; hardness: number; certainty: number }
export interface PaiItem { id: string; author: string; text: string; labels: PaiLabel[] }

/** The dataset stores reviews as a Python-literal string; we only need the quoted estimates. */
function parseReviews(raw: unknown): PaiLabel[] {
  const s = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
  const out: PaiLabel[] = [];
  const re = /['"](\w+)['"]:\s*\{['"]estimate['"]:\s*(['"])(.*?)\2,\s*['"]hardness['"]:\s*(\d+),\s*['"]certainty['"]:\s*(\d+)/g;
  for (const m of s.matchAll(re)) {
    if (m[3] && m[1] in ATTR_TO_CATS) out.push({ attr: m[1] as PaiAttr, estimate: m[3], hardness: +m[4], certainty: +m[5] });
  }
  return out;
}

export function parseJsonl(text: string): PaiItem[] {
  const items: PaiItem[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { id: string; author: string; text: string; reviews: unknown };
    items.push({ id: r.id, author: r.author, text: r.text, labels: parseReviews(r.reviews) });
  }
  return items;
}

function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Countable labels: an attribute we model, judged fairly easy (hardness ≤ maxHardness) and fairly sure (certainty ≥ 3). */
export function countable(it: PaiItem, maxHardness = 2) {
  return it.labels.filter((l) => ATTR_TO_CATS[l.attr] && l.hardness >= 1 && l.hardness <= maxHardness && l.certainty >= 3);
}

/** Split by persona so nothing tuned on the dev half can leak into the reported test half. */
export const isTestPersona = (author: string) => Number(author.replace(/\D/g, '')) % 2 === 1;
export const isDevPersona = (author: string) => !isTestPersona(author);

/** Deterministic sample: nPos comments that reveal something, nNeg that annotators marked as revealing nothing. */
export function sampleSet(items: PaiItem[], nPos: number, nNeg: number, seed = 7) {
  const rnd = mulberry(seed);
  const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const pos = shuffle(items.filter((it) => countable(it).length > 0)).slice(0, nPos);
  const neg = shuffle(items.filter((it) => it.labels.length === 0 && it.text.trim().length >= 12)).slice(0, nNeg);
  return { pos, neg };
}

export interface ItemResult { id: string; kind: 'pos' | 'neg'; cats: Category[]; hit: number; total: number; ms: number; source: string; error?: string; missed?: string[]; raw?: Array<{ cat: string; value: string; about_self: boolean; certainty: string; why: string }> }

/** Label recall: how many countable labels have at least one extracted fact in a matching category. */
export function scoreItem(it: PaiItem, kind: 'pos' | 'neg', cats: Category[], ms: number, source: string): ItemResult {
  const labels = kind === 'pos' ? countable(it) : [];
  const caught = (l: PaiLabel) => ATTR_TO_CATS[l.attr]!.some((c) => cats.includes(c));
  const hit = labels.filter(caught).length;
  return { id: it.id, kind, cats, hit, total: labels.length, ms, source, missed: labels.filter((l) => !caught(l)).map((l) => `${l.attr}:h${l.hardness}`) };
}

export function summarize(rs: ItemResult[]) {
  const pos = rs.filter((r) => r.kind === 'pos' && !r.error), neg = rs.filter((r) => r.kind === 'neg' && !r.error);
  const hit = pos.reduce((s, r) => s + r.hit, 0), total = pos.reduce((s, r) => s + r.total, 0);
  const anyOnNeg = neg.filter((r) => r.cats.length > 0).length;
  const ms = rs.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
  const q = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0);
  return {
    labelRecall: total ? hit / total : 0, hit, total,
    quietRate: neg.length ? 1 - anyOnNeg / neg.length : 0, negWithFacts: anyOnNeg, neg: neg.length,
    p50: q(0.5), p95: q(0.95), errors: rs.filter((r) => r.error).length,
    onDevice: rs.filter((r) => r.source === 'on_device').length, n: rs.length,
  };
}
