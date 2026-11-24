/**
 * Deterministic prefilter: decides which posts are worth sending to the on-device model.
 * Cheap, explainable, and tuned for recall (it's fine to send a few extra posts; it's not
 * fine to skip a post that leaks something). Every skip carries a reason for the receipts.
 */
const SELF = /\b(i|i'm|im|i've|ive|i'd|my|me|mine|we|our|us)\b/i;
const CUES = new RegExp(
  [
    // places & movement
    'here in', 'born', 'raised', 'moved', 'live', 'living', 'hometown', 'district', 'city', 'town', 'village', 'near', 'walk along',
    // work
    'work', 'job', 'shift', 'nurse', 'engineer', 'teacher', 'doctor', 'office', 'hospital', 'school', 'college', 'company', 'promoted', 'salary', 'pay', 'boss', 'rota',
    // family & relationships
    'kid', 'kids', 'son', 'daughter', 'twins', 'wife', 'husband', 'mom', 'mum', 'dad', 'divorce', 'ex', 'married', 'single', 'baby', 'sister', 'brother', 'cousin',
    // age, time, events
    'years', 'turned', 'birthday', 'since', 'volunteer', 'marathon', 'graduated', 'batch', 'degree', '19\\d\\d', '20\\d\\d',
    // possessions & identifiers
    'car', 'scooter', 'bike', 'subaru', 'truck', 'cat', 'dog', 'kindergarten', 'icu', 'tip', 'speak', 'language', 'kannada', 'hindi', 'tamil', 'telugu', 'malayalam',
  ].join('|'),
  'i',
);

export interface PrefilterResult { keep: boolean; reason: string }

export function prefilter(text: string): PrefilterResult {
  const t = text.trim();
  if (t.length < 12) return { keep: false, reason: 'too_short' };
  if (/^https?:\/\/\S+$/.test(t)) return { keep: false, reason: 'link_only' };
  const self = SELF.test(t);
  const cue = CUES.test(t);
  if (cue && self) return { keep: true, reason: 'self+cue' };
  if (cue) return { keep: true, reason: 'cue' };
  return { keep: false, reason: 'no_disclosure_cue' };
}
