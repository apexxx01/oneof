import { useRef, useState } from 'react';
import { extractFromPost, onDeviceAvailability, setPromptOverride } from '../lib/ai';
import { EXTRACT_SYSTEM } from '../lib/prompts';
import { SYNTHPAI_URL, isTestPersona, isDevPersona, parseJsonl, sampleSet, scoreItem, summarize, countable, type ItemResult, type PaiItem } from './synthpai';

type Arm = 'on_device' | 'cloud';

export default function Eval() {
  const [n, setN] = useState(40);
  const [arm, setArm] = useState<Arm>('on_device');
  const [split, setSplit] = useState<'test' | 'dev'>('test');
  const [which, setWhich] = useState<'both' | 'pos' | 'neg'>('both');
  const [prompt, setPrompt] = useState<string>(() => { try { return localStorage.getItem('oneof.eval.prompt') ?? ''; } catch { return ''; } });
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState<ItemResult[]>([]);
  const [set, setSet] = useState<{ pos: PaiItem[]; neg: PaiItem[] }>();
  const stop = useRef(false);

  async function run() {
    stop.current = false; setResults([]);
    // A prompt override is a tuning tool: it is only allowed on the dev split.
    setPromptOverride(split === 'dev' ? prompt : null);
    try { localStorage.setItem('oneof.eval.prompt', prompt); } catch { /* storage unavailable */ }
    if (arm === 'on_device' && (await onDeviceAvailability()) !== 'available') { setStatus('Gemini Nano is not available in this browser: open the home page and download it first.'); return; }
    setStatus('fetching SynthPAI from Hugging Face (20 MB, not stored)…');
    const items = parseJsonl(await (await fetch(SYNTHPAI_URL)).text()).filter((i) => (split === 'test' ? isTestPersona(i.author) : isDevPersona(i.author)));
    const s = sampleSet(items, n, n, 7); setSet(s);
    const all = [...s.pos.map((it) => ({ it, kind: 'pos' as const })), ...s.neg.map((it) => ({ it, kind: 'neg' as const }))];
    const queue = all.filter((q) => which === 'both' || (which === 'pos') === (q.kind === 'pos'));
    const out: ItemResult[] = [];
    // Same resilience as a scan: Gemini Nano tires under sustained load, so two failures in a
    // row trigger a 30 s cool-down, and failed items are retried once at the end.
    const failed: typeof queue = [];
    let streak = 0;
    const one = async ({ it, kind }: (typeof queue)[number], retry: boolean) => {
      try {
        const r = await extractFromPost({ id: it.id, date: '2024-01-01', text: it.text }, 'synthetic', 'extract', arm === 'cloud' ? 'ONLY_IN_CLOUD' : 'ONLY_ON_DEVICE');
        out.push({ ...scoreItem(it, kind, r.facts.map((f) => f.cat), r.ms, r.source), raw: r.raw });
        streak = 0;
      } catch (e) {
        streak++;
        if (!retry) failed.push({ it, kind });
        else out.push({ id: it.id, kind, cats: [], hit: 0, total: kind === 'pos' ? countable(it).length : 0, ms: 0, source: 'error', error: String((e as Error).message).slice(0, 120) });
      }
      setResults([...out]);
    };
    const cool = async () => { setStatus('Gemini Nano is struggling: cooling down 30 s'); await new Promise((r) => setTimeout(r, 30_000)); streak = 0; };
    for (const [i, q] of queue.entries()) {
      if (stop.current) break;
      setStatus(`${i + 1} / ${queue.length} · ${arm}`);
      await one(q, false);
      if (streak >= 2) await cool();
    }
    if (failed.length && !stop.current) {
      await cool();
      for (const [i, q] of failed.entries()) {
        if (stop.current) break;
        setStatus(`retry ${i + 1} / ${failed.length}`);
        await one(q, true);
      }
    }
    (window as unknown as { __eval?: unknown }).__eval = { split, arm, override: split === 'dev' && !!prompt.trim(), summary: summarize(out), results: out, which };
    setStatus('done');
  }

  const sum = summarize(results);
  function exportReceipt() {
    const body = { dataset: 'SynthPAI (RobinSta/SynthPAI), CC BY-NC-SA 4.0', split: split === 'test' ? 'test personas (odd ids), never used for tuning' : 'dev personas (even ids), used for tuning', promptOverride: split === 'dev' && !!prompt.trim(), which, arm, seed: 7, perKind: n, at: new Date().toISOString(), summary: sum, results };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
    a.download = `synthpai-${split}-${arm}.json`; a.click();
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
        <label><select value={split} onChange={(e) => setSplit(e.target.value as 'test' | 'dev')}><option value="test">test split (report)</option><option value="dev">dev split (tune)</option></select></label>
        <label><select value={which} onChange={(e) => setWhich(e.target.value as 'both' | 'pos' | 'neg')}><option value="both">revealing + quiet</option><option value="pos">revealing only</option><option value="neg">quiet only</option></select></label>
        <button onClick={run} disabled={status !== 'idle' && status !== 'done' && !status.startsWith('Gemini')}>Run</button>
        <button className="ghost" onClick={() => (stop.current = true)}>Stop</button>
        <button className="ghost" disabled={!results.length} onClick={exportReceipt}>Export receipt</button>
      </div>
      {split === 'dev' && (
        <details>
          <summary className="small">Prompt override (dev split only; empty = shipped prompt {'x2'})</summary>
          <textarea rows={10} style={{ width: '100%' }} value={prompt} placeholder={EXTRACT_SYSTEM} onChange={(e) => setPrompt(e.target.value)} />
        </details>
      )}
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
