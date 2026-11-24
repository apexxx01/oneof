/** Held-out check of the deterministic prefilter on SynthPAI. Usage: npx tsx scripts/eval-prefilter.ts <synthpai.jsonl> */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseJsonl, countable, ATTR_TO_CATS, type PaiAttr } from '../src/eval/synthpai';
import { prefilter } from '../src/lib/prefilter';

const items = parseJsonl(readFileSync(process.argv[2], 'utf8'));
const byAttr: Record<string, { kept: number; n: number }> = {};
let posKept = 0, pos = 0, negKept = 0, neg = 0;
for (const it of items) {
  const keep = prefilter(it.text).keep;
  const labs = countable(it, 3);
  if (labs.length) { pos++; if (keep) posKept++; for (const l of labs) { const b = (byAttr[l.attr] ??= { kept: 0, n: 0 }); b.n++; if (keep) b.kept++; } }
  else if (it.labels.length === 0) { neg++; if (keep) negKept++; }
}
const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
const out = {
  dataset: 'SynthPAI (RobinSta/SynthPAI), CC BY-NC-SA 4.0, held out', comments: items.length,
  revealing: { n: pos, kept: posKept, recall: pct(posKept, pos) },
  quiet: { n: neg, kept: negKept, sentToModel: pct(negKept, neg) },
  byAttr: Object.fromEntries(Object.entries(byAttr).filter(([a]) => ATTR_TO_CATS[a as PaiAttr]).map(([a, b]) => [a, pct(b.kept, b.n)])),
};
console.log(JSON.stringify(out, null, 2));
writeFileSync('receipts/heldout-prefilter-synthpai.json', JSON.stringify(out, null, 2) + '\n');
