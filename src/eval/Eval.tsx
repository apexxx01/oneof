import { useRef, useState } from 'react';
import { extractFromPost, onDeviceAvailability } from '../lib/ai';
import { SYNTHPAI_URL, isTestPersona, parseJsonl, sampleSet, scoreItem, summarize, countable, type ItemResult, type PaiItem } from './synthpai';

type Arm = 'on_device' | 'cloud';

export default function Eval() {
  const [n, setN] = useState(40);
  const [arm, setArm] = useState<Arm>('on_device');
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState<ItemResult[]>([]);
  const [set, setSet] = useState<{ pos: PaiItem[]; neg: PaiItem[] }>();
  const stop = useRef(false);

  async function run() {
    stop.current = false; setResults([]);
    if (arm === 'on_device' && (await onDeviceAvailability()) !== 'available') { setStatus('Gemini Nano is not available in this browser: open the home page and download it first.'); return; }
    setStatus('fetching SynthPAI from Hugging Face (20 MB, not stored)…');
    const items = parseJsonl(await (await fetch(SYNTHPAI_URL)).text()).filter((i) => isTestPersona(i.author));
    const s = sampleSet(items, n, n, 7); setSet(s);
    const queue = [...s.pos.map((it) => ({ it, kind: 'pos' as const })), ...s.neg.map((it) => ({ it, kind: 'neg' as const }))];
    const out: ItemResult[] = [];
    for (const [i, { it, kind }] of queue.entries()) {
      if (stop.current) break;
      setStatus(`${i + 1} / ${queue.length} · ${arm}`);
      try {
        const r = await extractFromPost({ id: it.id, date: '2024-01-01', text: it.text }, 'synthetic', 'extract', arm === 'cloud' ? 'ONLY_IN_CLOUD' : 'ONLY_ON_DEVICE');
        out.push(scoreItem(it, kind, r.facts.map((f) => f.cat), r.ms, r.source));
      } catch (e) {
        out.push({ id: it.id, kind, cats: [], hit: 0, total: kind === 'pos' ? countable(it).length : 0, ms: 0, source: 'error', error: String((e as Error).message).slice(0, 120) });
      }
      setResults([...out]);
    }
    setStatus('done');
  }

  const sum = summarize(results);
  function exportReceipt() {
    const body = { dataset: 'SynthPAI (RobinSta/SynthPAI), CC BY-NC-SA 4.0', split: 'test personas (odd ids), never used for tuning', arm, seed: 7, perKind: n, at: new Date().toISOString(), summary: sum, results };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
    a.download = `heldout-synthpai-${arm}.json`; a.click();
  }
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <main className="spike">
      <h1>Held-out eval · SynthPAI</h1>
      <p className="small muted">300 synthetic personas, human-labelled. Test split = odd persona ids, never used to write prompts or verify rules. Labels counted: hardness 1–2, certainty ≥ 3. Income has no OneOf category and is excluded.</p>
      <div className="row">
        <label>per side <input type="number" value={n} min={5} max={200} onChange={(e) => setN(+e.target.value)} /></label>
        <label><input type="radio" checked={arm === 'on_device'} onChange={() => setArm('on_device')} /> Gemini Nano (ONLY_ON_DEVICE)</label>
        <label><input type="radio" checked={arm === 'cloud'} onChange={() => setArm('cloud')} /> Cloud baseline (ONLY_IN_CLOUD)</label>
        <button onClick={run} disabled={status !== 'idle' && status !== 'done' && !status.startsWith('Gemini')}>Run</button>
        <button className="ghost" onClick={() => (stop.current = true)}>Stop</button>
        <button className="ghost" disabled={!results.length} onClick={exportReceipt}>Export receipt</button>
      </div>
      <p className="mono">{status}</p>
      {results.length > 0 && (
        <pre>{`label recall      ${pct(sum.labelRecall)}  (${sum.hit}/${sum.total} labels caught on revealing comments)
quiet comments    ${pct(sum.quietRate)} produced no fact  (${sum.negWithFacts}/${sum.neg} produced at least one)
latency           p50 ${Math.round(sum.p50)} ms · p95 ${Math.round(sum.p95)} ms
ran on device     ${sum.onDevice}/${sum.n} · errors ${sum.errors}`}</pre>
      )}
      {set && <p className="small muted">Sampled {set.pos.length} revealing + {set.neg.length} quiet comments (seed 7).</p>}
      <p className="small muted">Note: "quiet" means annotators found none of SynthPAI's 8 attributes. A fact about a pet or hobby there is not necessarily wrong, so this is an upper bound on false alarms.</p>
    </main>
  );
}
