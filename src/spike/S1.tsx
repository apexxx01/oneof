import { useEffect, useMemo, useState } from 'react';
import { getGenerativeModel } from 'firebase/ai';
import { getFirebase, configProblems } from '../lib/firebase';
import { prefilter } from '../lib/prefilter';
import { onDeviceExtractor, cloudExtractor, runBatch, quoteVerified, CLOUD_MODEL } from './extract';
import { PageTop } from '../ui/PageTop';
import { score, type Predicted, type Score, type Truth } from './score';

interface Persona { id: string; handle: string; posts: { id: string; text: string }[]; truth: Truth[]; traps: Truth[] }

interface RunReport {
  label: string;
  target: 'on_device' | 'cloud';
  batch: number;
  concurrency: number;
  calls: number;
  postsSent: number;
  wallSec: number;
  secPerCallP50: number;
  secPerCallP95: number;
  validJsonRate: number;
  sources: Record<string, number>;
  errors: Record<string, number>;
  score: Score;
  predictions: Predicted[];
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

declare global {
  // Chrome Prompt API global (present in Chrome 138+ with built-in AI)
  // eslint-disable-next-line no-var
  var LanguageModel: { availability: (o?: unknown) => Promise<string> } | undefined;
}

export default function S1() {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [availability, setAvailability] = useState<string>('unknown');
  const [download, setDownload] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [reports, setReports] = useState<RunReport[]>([]);
  const [grounding, setGrounding] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = useMemo(configProblems, []);

  // Cloud runs and the grounding test spend the free tier; they only make sense next to a Nano run.
  const nanoReady = availability === 'available';
  const needsNano = nanoReady ? undefined : 'Needs Gemini Nano: the cloud runs are baselines for an on-device run';
  useEffect(() => { checkAvailability(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 200));

  async function load() {
    const p = (await (await fetch(`${import.meta.env.BASE_URL}personas/p1.json`)).json()) as Persona;
    setPersona(p);
    const kept = p.posts.filter((x) => prefilter(x.text).keep).length;
    say(`Loaded ${p.handle}: ${p.posts.length} posts, ${p.truth.length} planted facts, ${p.traps.length} traps. Prefilter keeps ${kept}.`);
  }

  async function checkAvailability() {
    if (!globalThis.LanguageModel) { setAvailability('no LanguageModel global (Prompt API missing)'); return; }
    const a = await globalThis.LanguageModel.availability({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    setAvailability(a);
    say(`LanguageModel.availability() = ${a}`);
  }

  async function prepare() {
    setBusy(true);
    try {
      const m = onDeviceExtractor();
      await m.initializeDeviceModel((v) => setDownload(v));
      say('initializeDeviceModel() resolved');
      await checkAvailability();
    } catch (e) {
      say(`initializeDeviceModel failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function run(target: 'on_device' | 'cloud', batch: number, concurrency: number) {
    if (!persona) return;
    setBusy(true);
    const label = `${target} · batch ${batch} · x${concurrency}`;
    say(`▶ ${label}`);
    const model = target === 'cloud' ? cloudExtractor() : onDeviceExtractor();
    const posts = persona.posts.filter((p) => prefilter(p.text).keep);
    const batches: (typeof posts)[] = [];
    for (let i = 0; i < posts.length; i += batch) batches.push(posts.slice(i, i + batch));
    const times: number[] = [];
    const sources: Record<string, number> = {};
    const errors: Record<string, number> = {};
    const predictions: Predicted[] = [];
    let ok = 0;
    const t0 = performance.now();
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const b = batches[next++];
        const r = await runBatch(model, b.map((x) => x.text), target === 'cloud');
        times.push(r.ms);
        if (r.source) sources[r.source] = (sources[r.source] ?? 0) + 1;
        if (r.ok) ok++;
        else errors[r.error ?? 'error'] = (errors[r.error ?? 'error'] ?? 0) + 1;
        for (const f of r.facts) {
          const post = b[f.p];
          predictions.push({ ...f, postId: post.id, verified: quoteVerified(f.quote, post.text) });
        }
        if (times.length % 5 === 0) say(`  ${times.length}/${batches.length} calls`);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    const rep: RunReport = {
      label, target, batch, concurrency,
      calls: batches.length,
      postsSent: posts.length,
      wallSec: (performance.now() - t0) / 1000,
      secPerCallP50: quantile(times, 0.5) / 1000,
      secPerCallP95: quantile(times, 0.95) / 1000,
      validJsonRate: batches.length ? ok / batches.length : 0,
      sources, errors,
      score: score(predictions, persona.truth, persona.traps),
      predictions,
    };
    setReports((r) => [...r, rep]);
    say(`■ ${label}: recall ${pct(rep.score.recall)}, precision ${pct(rep.score.precision)}, ${rep.wallSec.toFixed(1)}s wall`);
    setBusy(false);
  }

  async function runSuite() {
    for (const [b, c] of [[1, 1], [5, 1], [10, 1], [5, 2]] as const) await run('on_device', b, c);
    await run('cloud', 10, 1);
  }

  async function testGrounding() {
    setBusy(true);
    const { ai } = getFirebase();
    const out: Record<string, unknown> = {};
    const q = 'What fraction of all residents of Karnataka, India are registered nurses? Answer with a low and high estimate as fractions of the total population and one sentence of basis.';
    try {
      const g = getGenerativeModel(ai, { model: CLOUD_MODEL, tools: [{ googleSearch: {} }] });
      const r = await g.generateContent(q);
      const gm = r.response.candidates?.[0]?.groundingMetadata;
      out.groundedText = { ok: true, text: r.response.text().slice(0, 400), chunks: gm?.groundingChunks?.length ?? 0, queries: gm?.webSearchQueries };
    } catch (e) { out.groundedText = { ok: false, error: (e as Error).message }; }
    try {
      const g2 = getGenerativeModel(ai, {
        model: CLOUD_MODEL,
        tools: [{ googleSearch: {} }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: { type: 'object', properties: { fraction_low: { type: 'number' }, fraction_high: { type: 'number' }, basis: { type: 'string' } }, required: ['fraction_low', 'fraction_high', 'basis'] },
        },
      });
      const r2 = await g2.generateContent(q);
      out.groundedJson = { ok: true, text: r2.response.text().slice(0, 400), chunks: r2.response.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0 };
    } catch (e) { out.groundedJson = { ok: false, error: (e as Error).message }; }
    setGrounding(out);
    say(`grounding test done: ${JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, (v as { ok: boolean }).ok])))}`);
    setBusy(false);
  }

  function exportResults() {
    const payload = {
      spike: 'S1', at: new Date().toISOString(), userAgent: navigator.userAgent, availability,
      hardwareConcurrency: navigator.hardwareConcurrency,
      reports, grounding,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `s1-results-${Date.now()}.json`;
    a.click();
  }

  const gate = (r: RunReport) => {
    const s = r.score;
    if (r.target === 'cloud') return 'baseline';
    if (s.recall >= 0.7 && s.precision >= 0.8 && r.secPerCallP50 <= 6 && r.validJsonRate >= 0.95) return 'GO';
    if (s.recall >= 0.5) return 'RESCOPE';
    return 'PIVOT';
  };

  return (
    <div className="app spike-page">
      <PageTop />
      <section className="sec pad">
        <span className="lbl mut">Day-one benchmark</span>
        <h1>Spike S1: on-device extraction</h1>
        <p className="lede mt">Synthetic persona only. Measures Gemini Nano (via Firebase AI Logic, ONLY_ON_DEVICE) against a planted answer key, with a cloud baseline.</p>
      </section>
      {problems.length > 0 && <div className="notice warn">{problems.map((p) => <div key={p}>{p}</div>)}</div>}

      <section className="sec">
        <div className="sec-head"><h2>Run</h2><p>Availability: <b className="mono">{availability}</b>{download !== null && <> (download {pct(download)})</>}</p></div>
        <div className="pad stack">
          <div className="controls">
            <button onClick={load} disabled={busy}>1. Load persona</button>
            <button onClick={checkAvailability} disabled={busy}>2. Check availability</button>
            <button onClick={prepare} disabled={busy}>3. Prepare on-device model</button>
            <button className="primary" onClick={runSuite} disabled={busy || !persona || !nanoReady} title={needsNano}>4. Run full suite</button>
            <button onClick={testGrounding} disabled={busy || !nanoReady} title={needsNano}>5. Test grounding</button>
            <button onClick={exportResults} disabled={!reports.length && !grounding}>6. Download results</button>
          </div>
          {!nanoReady && <p className="locked">Run buttons need Gemini Nano (desktop Chrome). The committed results are in <a href="https://github.com/apexxx01/oneof/blob/main/receipts/s1-nano-promptv2.json" target="_blank" rel="noreferrer">receipts/s1-nano-promptv2.json</a>.</p>}
          <div className="controls">
            <span className="lbl mut">Single runs</span>
            {([['on_device', 1, 1], ['on_device', 5, 1], ['on_device', 10, 1], ['on_device', 5, 2], ['on_device', 20, 1], ['cloud', 10, 1]] as const).map(([t, b, c]) => (
              <button key={`${t}${b}${c}`} onClick={() => run(t, b, c)} disabled={busy || !persona || !nanoReady} title={needsNano}>{t} b{b} x{c}</button>
            ))}
          </div>
        </div>
      </section>

      {reports.length > 0 && (
        <section className="sec">
          <div className="sec-head"><h2>Reports</h2></div>
          <div className="pad tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Run</th><th>Gate</th><th>Recall</th><th>Precision</th><th>Traps hit</th><th>Extra</th><th>Quote fail</th><th>Valid JSON</th><th>s/call p50</th><th>p95</th><th>Wall s</th><th>Source</th><th>Errors</th></tr>
              </thead>
              <tbody>
                {reports.map((r, i) => (
                  <tr key={i}>
                    <td>{r.label}</td><td>{gate(r)}</td>
                    <td>{pct(r.score.recall)} ({r.score.tp})</td><td>{pct(r.score.precision)}</td>
                    <td>{r.score.trapHits}</td><td>{r.score.unlabeled}</td><td>{pct(r.score.quoteFailRate)}</td>
                    <td>{pct(r.validJsonRate)}</td>
                    <td>{r.secPerCallP50.toFixed(2)}</td><td>{r.secPerCallP95.toFixed(2)}</td><td>{r.wallSec.toFixed(1)}</td>
                    <td>{Object.entries(r.sources).map(([k, v]) => `${k}:${v}`).join(' ')}</td>
                    <td>{Object.entries(r.errors).map(([k, v]) => `${k}:${v}`).join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="sec">
        <div className="sec-head"><h2>Log</h2></div>
        <div className="pad stack">
          {grounding && <pre className="box">{JSON.stringify(grounding, null, 2)}</pre>}
          <pre className="box log">{log.join('\n') || 'Nothing yet.'}</pre>
        </div>
      </section>
    </div>
  );
}
