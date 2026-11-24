import type { RawFact } from './schemas';
import type { Post } from './types';

/** Deterministic checks between the model and the dossier. Pure: no Firebase, runs in tests and scripts. */
const PLACEHOLDER = /\b(unknown|unspecified|not specified|n\/a|none|near me|somewhere|location|self|myself|me)\b/i;
/** Hypotheticals the model sometimes misses: "imagine having five kids", "if I had a Harley". */
const HYPOTHETICAL = /\b(imagine|if i (had|were|was|lived)|i wish i|someday|hypothetically|pretend)\b/i;
/** Everyday interests that never narrow anyone down. */
const GENERIC = /\b(cooking|board games?|football|soccer|basketball|music|movies?|tv|netflix|reading|books?|gaming|video games?|coffee|tea|sleep|food|baking|walking|shopping|travel)\b/i;
const GROUNDED_CATS = new Set(['home_location', 'work_location', 'vehicle', 'pet', 'language', 'education', 'employer_type']);
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));

export function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

/** Deterministic checks between the model and the dossier. Hallucinations die here. */
export function verify(f: RawFact, post: Post): { ok: boolean; why?: string } {
  if (!f.about_self) return { ok: false, why: 'not about the author' };
  if (f.cat === 'other') return { ok: false, why: 'uncategorized' };
  if (PLACEHOLDER.test(f.value)) return { ok: false, why: 'placeholder value' };
  if (!normalize(post.text).includes(normalize(f.quote))) return { ok: false, why: 'quote not in post' };
  const lead = normalize(post.text).slice(0, normalize(post.text).indexOf(normalize(f.quote)) + normalize(f.quote).length);
  if (HYPOTHETICAL.test(lead)) return { ok: false, why: 'hypothetical' };
  if (f.cat === 'rare_hobby' && GENERIC.test(f.value)) return { ok: false, why: 'generic interest' };
  if ((f.cat === 'home_location' || f.cat === 'work_location') && !/[A-Z]/.test(f.value) && !/night|day|shift|remote|hospital|office/i.test(f.value)) {
    return { ok: false, why: 'not a place name' };
  }
  if (GROUNDED_CATS.has(f.cat)) {
    const post_t = tokens(post.text);
    const hit = [...tokens(f.value)].some((w) => post_t.has(w));
    if (!hit) return { ok: false, why: 'value not grounded in post' };
  }
  return { ok: true };
}

