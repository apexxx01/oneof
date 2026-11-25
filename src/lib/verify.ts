import type { RawFact } from './schemas';
import type { Post } from './types';

/** Deterministic checks between the model and the dossier. Pure: no Firebase, runs in tests and scripts. */
const PLACEHOLDER = /\b(unknown|unspecified|not specified|n\/a|none|near me|somewhere|location|self|myself|me)\b/i;
/** Hypotheticals the model sometimes misses: "imagine having five kids", "if I had a Harley". */
const HYPOTHETICAL = /\b(imagine|if i (had|were|was|lived)|i wish i|someday|hypothetically|pretend)\b/i;
/** "I feel 80 years old after that shift": a figure of speech, not an age. A designed trap in the
 * sample persona; Apple's on-device model filed it as a stated age, so the checker now catches it. */
const FIGURATIVE_AGE = /\b(feel|feels|feeling|felt)( like)?( i'?m| i am)? (\d+|a hundred|ancient|old)\b/i;
/** "the bus driver waited for me", "the doctor on duty asked me": a job named with "the" belongs
 * to someone else, unless the author claims it ("as the", "I'm the"). Seen on Apple's model. */
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function othersJob(value: string, quote: string) {
  const v = esc(value.trim());
  if (!v) return false;
  const named = new RegExp(`\\bthe ${v}\\b`, 'i').test(quote);
  const claimed = new RegExp(`\\b(as|i'?m|i am|work as|working as) (an?|the) ${v}\\b`, 'i').test(quote);
  return named && !claimed;
}
/** Everyday interests that never narrow anyone down. */
const GENERIC = /\b(cooking|board games?|football|soccer|basketball|music|movies?|tv|netflix|reading|books?|gaming|video games?|coffee|tea|sleep|food|baking|walking|shopping|travel)\b/i;
/**
 * "my sister in Seattle", "my cousin drives a Tesla": the fact belongs to the relative. Seen live
 * on Nano (it set about_self=true for "my sister in Seattle"). Relationship and family facts are
 * exempt: "my husband" does say something about the author.
 */
const SOMEONE_ELSE = /\bmy (sister|brother|cousin|friend|best friend|bff|mom|mum|mother|dad|father|aunt|uncle|grand(ma|pa|mother|father)|neighbou?r|co-?worker|colleague|boss|roommate|son|daughter|kid|niece|nephew|in-laws?)s?\b/i;
const THIRD_PARTY_CATS = new Set(['home_location', 'work_location', 'occupation', 'employer_type', 'education', 'vehicle', 'pet', 'rare_hobby', 'age']);
/** Family values that name an actual role. */
const FAMILY_ROLE = /\b(mom|mum|mother|dad|father|parent|single|twins?|kids?|children|son|daughter|wife|husband|divorced|widow)/i;
/** Values that name no actual job. */
const VAGUE_OCCUPATION = /^(an? )?(job|work|worker|grind|person|people|professional|expert|individual|employee|staff|someone|flexible.*|intellectual.*|career)$/i;
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
  if (THIRD_PARTY_CATS.has(f.cat) && SOMEONE_ELSE.test(f.quote)) return { ok: false, why: 'about someone else' };
  const lead = normalize(post.text).slice(0, normalize(post.text).indexOf(normalize(f.quote)) + normalize(f.quote).length);
  if (HYPOTHETICAL.test(lead)) return { ok: false, why: 'hypothetical' };
  // The words just before the quote count too: the model may quote "80 years old" without "I feel".
  if (f.cat === 'age' && FIGURATIVE_AGE.test(lead.slice(Math.max(0, lead.length - normalize(f.quote).length - 25)))) return { ok: false, why: 'figure of speech' };
  if ((f.cat === 'occupation' || f.cat === 'employer_type') && othersJob(f.value, f.quote)) return { ok: false, why: 'about someone else' };
  if (f.cat === 'rare_hobby' && GENERIC.test(f.value)) return { ok: false, why: 'generic interest' };
  if ((f.cat === 'occupation' || f.cat === 'employer_type') && VAGUE_OCCUPATION.test(f.value.trim())) return { ok: false, why: 'vague job' };
  // Implied hobbies, ages and family facts were mostly noise on SynthPAI dev personas
  // ("chili enthusiast", "30s", "member of group"). Implied family roles stay: Nano labels
  // "being a single mom" as implied.
  if ((f.cat === 'rare_hobby' || f.cat === 'age') && f.certainty === 'implied') return { ok: false, why: 'implied hobby or age' };
  if (f.cat === 'family' && f.certainty === 'implied' && !FAMILY_ROLE.test(f.value)) return { ok: false, why: 'implied family, no role' };
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

