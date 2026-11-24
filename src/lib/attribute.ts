/**
 * What may leave the device for a base-rate lookup. Pure, so it is unit-tested.
 *
 * A lookup sends ONE generic attribute ("occupation: registered nurse"). Values come from the
 * model's reading of the user's own posts, so they can carry the user's words: an employer name,
 * a street, a ship. Anything that looks like a proper noun, a number or a long phrase stays local
 * and is never looked up. Places are never looked up (regions come from the bundled census pack).
 */
import type { Fact } from './types';

const NEVER_CATS = new Set(['home_location', 'work_location', 'health', 'religion_community', 'dated_event', 'other']);
const MAX_WORDS = 4;

export type AttributeVerdict = { ok: true; attribute: string } | { ok: false; why: string };

export function cloudSafeAttribute(f: Pick<Fact, 'cat' | 'value'>): AttributeVerdict {
  if (NEVER_CATS.has(f.cat)) return { ok: false, why: 'places, health and dated events never leave the device' };
  const value = f.value.replace(/\b(my|our|his|her|their)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, why: 'empty' };
  if (/\d/.test(value)) return { ok: false, why: 'contains a number' };
  if (/['’]s\b/.test(value)) return { ok: false, why: 'possessive name' };
  const words = value.split(' ');
  if (words.length > MAX_WORDS) return { ok: false, why: 'too specific' };
  // A capitalised word anywhere (the model lower-cases generic nouns) is treated as a name.
  // Short all-caps acronyms (ICU, RN, BSN) are generic and allowed.
  if (words.some((w) => /^[A-Z][a-z]/.test(w))) return { ok: false, why: 'looks like a name' };
  if (!/^[a-zA-Z][a-zA-Z \-/&]*$/.test(value)) return { ok: false, why: 'unusual characters' };
  return { ok: true, attribute: `${f.cat.replace(/_/g, ' ')}: ${value.toLowerCase()}` };
}
