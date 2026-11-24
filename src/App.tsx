import { useEffect, useMemo, useRef, useState } from 'react';
import { BlockedError, onDeviceAvailability, prepareOnDevice, type Availability, type DataKind } from './lib/ai';
import { buildDossier, crowdNow, crumbTrail, leftTheCrowd, minimumFix } from './lib/dossier';
import { estimate, humanCount } from './lib/estimate';
import { fromPaste, importFile } from './lib/importers';
import { loadRateCache, refineRates, scan, type ScanProgress } from './lib/run';
import { configProblems } from './lib/firebase';
import { subscribe, summary } from './lib/ledger';
import type { BaseRate, Fact, Post } from './lib/types';
import { Meter, SourceBadge } from './ui/bits';
import { DossierList, Draft, Formula, Ledger } from './ui/Panels';
import { Trail } from './ui/Trail';

type Phase = 'home' | 'scan' | 'result';
interface Persona { handle: string; posts: Post[]; draft?: string }

export default function App() {
  const [phase, setPhase] = useState<Phase>('home');
  const [avail, setAvail] = useState<Availability>('unsupported');
  const [dl, setDl] = useState<number | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [data, setData] = useState<DataKind>('synthetic');
  const [persona, setPersona] = useState<Persona | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [rates, setRates] = useState<Map<string, BaseRate>>(loadRateCache());
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [cloudCount, setCloudCount] = useState({ onDevice: 0, cloud: 0, postBytesOut: 0 });
  const abort = useRef<AbortController | null>(null);
  const problems = useMemo(configProblems, []);

  useEffect(() => { onDeviceAvailability().then(setAvail); }, []);
  useEffect(() => subscribe((e) => setCloudCount(summary(e))), []);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setLedgerOpen(false); setFormulaOpen(false); } };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('keydown', key); };
  }, []);

  const postMap = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);
  const dossier = useMemo(() => buildDossier(facts, rates), [facts, rates]);
  const now = useMemo(() => crowdNow(dossier), [dossier]);
  const trail = useMemo(() => crumbTrail(dossier), [dossier]);
  const left = useMemo(() => leftTheCrowd(trail), [trail]);
  const fix = useMemo(() => minimumFix(dossier, 1000), [dossier]);
  const fixed = useMemo(() => estimate(dossier.region, dossier.attributes.filter((a) => !fix.includes(a))), [dossier, fix]);

  async function prepare() {
    setError(null);
    try {
      setAvail('downloading');
      await prepareOnDevice((p) => setDl(p));
      setAvail(await onDeviceAvailability());
    } catch (e) {
      setError(`Couldn’t prepare the on-device model: ${(e as Error).message}`);
      setAvail(await onDeviceAvailability());
    }
  }

  async function start(list: Post[], kind: DataKind) {
    setError(null);
    setPosts(list);
    setData(kind);
    setFacts([]);
    setPhase('scan');
    abort.current = new AbortController();
    try {
      const res = await scan(list, kind, (p) => { setProgress(p); setFacts(p.facts); }, abort.current.signal);
      setFacts(res.facts);
      setPhase('result');
      if (navigator.onLine) refineRates(res.facts, 'United States', setRates).catch(() => undefined);
    } catch (e) {
      setPhase('home');
      setError(e instanceof BlockedError
        ? 'Your own posts only ever run on this device, and this browser has no on-device model. Use desktop Chrome 148+, or try the synthetic persona.'
        : `Scan failed: ${(e as Error).message}`);
    }
  }

  async function loadPersona() {
    const p = (await (await fetch('/personas/p1.json')).json()) as Persona;
    setPersona(p);
    return p;
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand" onClick={() => setPhase('home')}><span className="logo">1/</span>OneOf</div>
        <div className="top-right mono">
          <span className={`pill ${avail === 'available' ? 'ok' : 'warn'}`} title="Gemini Nano via Chrome built-in AI">
            on-device model: {avail === 'downloading' && dl !== null ? `downloading ${Math.round(dl * 100)}%` : avail}
          </span>
          <span className={`pill ${online ? '' : 'off'}`}>{online ? 'online' : 'offline'}</span>
          <button className="ghost" onClick={() => setLedgerOpen(true)}>
            What the cloud saw · <b>{cloudCount.postBytesOut}</b> B of posts
          </button>
        </div>
      </header>

      {problems.length > 0 && <div className="banner warn">{problems.join(' · ')}</div>}
      {error && <div className="banner err">{error}</div>}

      {phase === 'home' && (
        <main className="home">
          <section className="hero">
            <h1>How many people<br />could you be?</h1>
            <p className="lede">
              AI can now unmask pseudonymous accounts for <b>$1–4 a profile</b> by stitching together harmless details across years of posts.
              OneOf builds that dossier first, <b>on your own device</b>, and shows how small a crowd you’re really hiding in.
            </p>
            <p className="cite small">Lermen et al., “Large-scale online deanonymization with LLMs”, USENIX Security ’26: 68% recall at 90% precision.</p>
          </section>

          <section className="start">
            <div className="card">
              <h3>Try it with a synthetic person</h3>
              <p>“quietnight_rn”: six years of posts by a night-shift nurse. <span className="tag">SYNTHETIC, NOT A REAL PERSON</span></p>
              <button className="primary" onClick={async () => start((await loadPersona()).posts, 'synthetic')}>Scan quietnight_rn</button>
              <p className="small muted">Runs on-device when available; this demo data may fall back to the cloud.</p>
            </div>
            <div className="card">
              <h3>Check your own history</h3>
              <p>Drop your Reddit data export (.zip), a JSON/CSV of posts, or paste text. <b>Your posts never leave this device.</b> We never open IP logs or messages.</p>
              <label className="drop">
                <input type="file" accept=".zip,.json,.csv,.txt" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  try { const r = await importFile(f); start(r.posts, 'own'); } catch (err) { setError(`Couldn’t read that file: ${(err as Error).message}`); }
                }} />
                Choose a file
              </label>
              <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste posts here, one per paragraph" />
              <button disabled={!paste.trim()} onClick={() => start(fromPaste(paste), 'own')}>Scan pasted posts</button>
            </div>
            <div className="card">
              <h3>On-device model</h3>
              <p className="mono">{avail}</p>
              {avail !== 'available' && avail !== 'unsupported' && <button onClick={prepare}>Download Gemini Nano (one time)</button>}
              {avail === 'unsupported' && <p className="small">This browser has no built-in AI. Use desktop Chrome 148+ for on-device mode; the synthetic demo still works via cloud fallback.</p>}
              <p className="small muted">Uses Firebase AI Logic hybrid inference: on-device first, cloud only where the router allows it.</p>
            </div>
          </section>
        </main>
      )}

      {phase === 'scan' && progress && (
        <main className="scan">
          <h2>Reading {progress.total} posts like an attacker would</h2>
          <div className="scan-stats mono">
            <span>{progress.done} / {progress.considered} candidate posts</span>
            <span>{progress.total - progress.considered} skipped by the deterministic filter</span>
            <span><SourceBadge source="on_device" /> {progress.onDevice}</span>
            <span><SourceBadge source="in_cloud" /> {progress.inCloud}</span>
            <span><b>{cloudCount.postBytesOut}</b> bytes of your posts sent</span>
          </div>
          <div className="bar"><div style={{ width: `${(progress.done / Math.max(1, progress.considered)) * 100}%` }} /></div>
          <p className="small muted">Keep this tab in front: Chrome can pause on-device AI in background tabs.</p>
          {progress.current && <div className="current mono">“{progress.current.text.slice(0, 120)}”</div>}
          <div className="live">
            <Meter e={estimate(buildDossier(facts, rates).region, buildDossier(facts, rates).attributes)} label="Crowd so far" />
            <div className="chips">
              {facts.slice().reverse().map((f) => <span key={f.id} className="chip">{f.value} <SourceBadge source={f.source} /></span>)}
            </div>
          </div>
          <button className="ghost" onClick={() => abort.current?.abort()}>Stop and show results</button>
        </main>
      )}

      {phase === 'result' && (
        <main className="result">
          <section className="r-hero">
            <div>
              <div className="eyebrow mono">{persona && data === 'synthetic' ? `u/${persona.handle} · SYNTHETIC` : 'your history'} · {posts.length} posts · {facts.length} facts · {dossier.region.label}</div>
              <Meter e={now} />
              <button className="ghost" onClick={() => setFormulaOpen((v) => !v)}>{formulaOpen ? 'Hide' : 'Show'} the math</button>
            </div>
            <div className="r-trail">
              <h3>Your crumb trail</h3>
              <p className="small muted">No single post gave you away. Together, they did.</p>
              <Trail points={trail} left={left} />
            </div>
          </section>
          {formulaOpen && <Formula d={dossier} e={now} />}

          <section className="r-grid">
            <div>
              <h3>The dossier an attacker would build</h3>
              <p className="small muted">Built on this device from your own words. Never a name, never a verdict, just the evidence.</p>
              <DossierList attrs={dossier.attributes} posts={postMap} />
              {dossier.localOnly.length > 0 && <p className="small">{dossier.localOnly.length} sensitive facts (health, religion) stay on this device and aren’t counted.</p>}
            </div>
            <div>
              <h3>Rejoin the crowd</h3>
              {fix.length ? (
                <>
                  <p>Edit or delete <b>{fix.reduce((n, a) => n + a.facts.length, 0)} posts</b> and you’re back to one of ~<b>{humanCount(fixed.p50)}</b>.</p>
                  <ul className="fix">
                    {fix.map((a) => a.facts.map((f) => {
                      const p = postMap.get(f.postId);
                      return <li key={f.id}><span className="mono">{f.date.slice(0, 10)}</span> “{p?.text.slice(0, 90) ?? f.quote}” {p?.permalink && <a href={`https://reddit.com${p.permalink}`} target="_blank" rel="noreferrer">open</a>}</li>;
                    }))}
                  </ul>
                </>
              ) : <p>You’re already hiding in a crowd of 1,000+.</p>}
              <h3>Before your next post</h3>
              <Draft history={facts} rates={rates} data={data} before={now} placeholder={persona?.draft} />
            </div>
          </section>
          <footer className="small muted">OneOf never outputs a name or an identity guess, and never says “safe”. Ranges are estimates; tap “Show the math” for every source.</footer>
        </main>
      )}

      <Ledger open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </div>
  );
}
