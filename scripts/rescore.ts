/**
 * Re-scores a spike S1 results file through the app's deterministic verify() gate.
 * Usage: npx tsx scripts/rescore.ts receipts/<file>.json
 */
import { readFileSync } from 'node:fs';
import { verify } from '../src/lib/verify';
import { score } from '../src/spike/score';

const results = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const persona = JSON.parse(readFileSync('public/personas/p1.json', 'utf8'));
const posts = new Map(persona.posts.map((p: { id: string }) => [p.id, p]));
for (const r of results.reports) {
  const raw = score(r.predictions, persona.truth, persona.traps);
  const gated = r.predictions.map((f: { postId: string }) => ({ ...f, verified: verify(f as never, posts.get(f.postId) as never).ok }));
  const s = score(gated, persona.truth, persona.traps);
  console.log(`${r.label.padEnd(26)} raw recall ${(raw.recall * 100).toFixed(0)}% precision ${(raw.precision * 100).toFixed(0)}%  →  after verify(): recall ${(s.recall * 100).toFixed(0)}% precision ${(s.precision * 100).toFixed(0)}% (traps ${s.trapHits}, extra ${s.unlabeled})`);
}
