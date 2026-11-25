import { useEffect, useRef, useState } from 'react';
import { extractFromPost, onDeviceAvailability, setPromptOverride, type Availability } from '../lib/ai';
import { EXTRACT_PROMPT_VERSION, EXTRACT_SYSTEM } from '../lib/prompts';
import { COMMITTED, PREFILTER, receiptUrl } from './receipts';
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
  const [nano, setNano] = useState<Availability | 'checking'>('checking');
  useEffect(() => { onDeviceAvailability().then(setNano); }, []);
  const nanoReady = nano === 'available';

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
      <a className="home-link" href={import.meta.env.BASE_URL}>← OneOf</a>
      <h1>Held-out eval · SynthPAI</h1>
      <p className="small muted">300 synthetic personas, human-labelled. Test split = odd persona ids, never used to write prompts or verify rules. Labels counted: hardness 1–2, certainty ≥ 3. Income has no OneOf category and is excluded.</p>

      <h2>Committed results</h2>
      <p className="small muted">Read from the receipts in the repo at build time. Shipped extraction prompt: <span className="mono">{EXTRACT_PROMPT_VERSION}</span>.</p>
      <div className="receipts" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>run</th><th>label recall</th><th>quiet comments with no fact</th><th>latency p50 / p95</th><th>ran on device</th><th>errors</th><th>receipt</th></tr></thead>
          <tbody>
            {COMMITTED.map((r) => (
              <tr key={r.file}>
                <td>{r.label}</td>
                <td className="mono">{pct(r.summary.labelRecall)} ({r.summary.hit}/{r.summary.total})</td>
                <td className="mono">{pct(r.summary.quietRate)} ({r.summary.neg - r.summary.negWithFacts}/{r.summary.neg})</td>
                <td className="mono">{(r.summary.p50 / 1000).toFixed(1)} s / {(r.summary.p95 / 1000).toFixed(1)} s</td>
                <td className="mono">{r.summary.onDevice}/{r.summary.n}</td>
                <td className="mono">{r.summary.errors}</td>
                <td><a href={receiptUrl(r.file)} target="_blank" rel="noreferrer">{r.file}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {PREFILTER && (
        <p className="small muted">Keyword prefilter on {PREFILTER.comments.toLocaleString('en-US')} held-out comments: it kept {PREFILTER.revealing.recall} of revealing ones, so it now only orders the scan and never excludes a post. <a href={receiptUrl('heldout-prefilter-synthpai.json')} target="_blank" rel="noreferrer">heldout-prefilter-synthpai.json</a></p>
      )}

      <h2>Run it yourself (needs Gemini Nano)</h2>
      {!nanoReady && <p className="small warn-text mono">{nano === 'checking' ? 'Checking for Gemini Nano…' : 'Gemini Nano isn’t available in this browser, so the runs are off: the cloud baseline would only spend the free tier. Open this page in desktop Chrome with Gemini Nano to reproduce the receipts.'}</p>}
      <div className="row">
        <label>per side <input type="number" value={n} min={5} max={200} onChange={(e) => setN(+e.target.value)} /></label>
        <label><input type="radio" checked={arm === 'on_device'} onChange={() => setArm('on_device')} /> Gemini Nano (ONLY_ON_DEVICE)</label>
        <label><input type="radio" checked={arm === 'cloud'} onChange={() => setArm('cloud')} /> Cloud baseline (ONLY_IN_CLOUD)</label>
        <label><select value={split} onChange={(e) => setSplit(e.target.value as 'test' | 'dev')}><option value="test">test split (report)</option><option value="dev">dev split (tune)</option></select></label>
        <label><select value={which} onChange={(e) => setWhich(e.target.value as 'both' | 'pos' | 'neg')}><option value="both">revealing + quiet</option><option value="pos">revealing only</option><option value="neg">quiet only</option></select></label>
        <button onClick={run} disabled={!nanoReady || (status !== 'idle' && status !== 'done' && !status.startsWith('Gemini'))} title={nanoReady ? undefined : 'Needs Gemini Nano'}>Run</button>
        <button className="ghost" onClick={() => (stop.current = true)}>Stop</button>
        <button className="ghost" disabled={!results.length} onClick={exportReceipt}>Export receipt</button>
      </div>
      {split === 'dev' && (
        <details>
          <summary className="small">Prompt override (dev split only; empty = shipped prompt {EXTRACT_PROMPT_VERSION})</summary>
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
