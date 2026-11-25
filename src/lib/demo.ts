import type { Post } from './types';

/** The synthetic persona shipped with the app (public/personas/p1.json). */
export const DEMO_HANDLE = 'quietnight_rn';
const DEMO_ID = /^p1_\d{4}$/;
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Is this "own history" really the synthetic demo export (quietnight_rn-reddit-export.zip, or its
 * posts pasted)? Judged by the persona's post ids, its handle, or, when the persona is given, by
 * how many texts match it. Used only to offer the recorded run; it never sends anything.
 */
export function isDemoExport(list: Post[], persona?: Post[]): boolean {
  if (!list.length) return false;
  const byId = list.filter((p) => DEMO_ID.test(p.id)).length;
  if (byId / list.length >= 0.8) return true;
  if (list.some((p) => p.text.includes(DEMO_HANDLE) || (p.permalink ?? '').includes(DEMO_HANDLE))) return true;
  if (!persona?.length) return false;
  const known = new Set(persona.map((p) => norm(p.text)));
  // Reddit exports join title and body ("title — body"); match either half.
  const hits = list.filter((p) => known.has(norm(p.text)) || p.text.split(' — ').some((part) => known.has(norm(part)))).length;
  return hits / list.length >= 0.6;
}
