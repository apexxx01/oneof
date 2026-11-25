import { useEffect, useMemo, useRef, useState } from 'react';
import { BlockedError, onDeviceAvailability, prepareOnDevice, type Availability, type DataKind } from './lib/ai';
import { appCheckMode } from './lib/firebase';
import { buildDossier, crowdNow, crumbTrail, leftTheCrowd, minimumFix } from './lib/dossier';
import { estimate, humanCount } from './lib/estimate';
import { fromPaste, importFile } from './lib/importers';
import { loadRateCache, plannedLookups, refineRates, scan, type PlannedLookup, type ScanProgress } from './lib/run';
import { configProblems } from './lib/firebase';
import { record, subscribe, summary } from './lib/ledger';
import type { BaseRate, Fact, Post } from './lib/types';
import { Meter, SourceBadge } from './ui/bits';
import { DossierList, Draft, Formula, Ledger } from './ui/Panels';
import { Trail } from './ui/Trail';
import { chromeVersion, downloadJson, playReplay, recheck, toReplay, type Replay } from './lib/replay';

type Phase = 'home' | 'scan' | 'result';
interface Persona { handle: string; posts: Post[]; draft?: string }

/** The free cloud tier rate-limits after a few dozen calls; a live cloud demo reads the first posts only. */
const CLOUD_LIVE_LIMIT = 25;

const NANO_LABEL: Record<Availability, string> = {
  available: 'Gemini Nano: on this device',
  downloadable: 'Gemini Nano: not downloaded',
  downloading: 'Gemini Nano: downloading',
  unavailable: 'Gemini Nano: not available here',
  unsupported: 'Gemini Nano: not in this browser',
};

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
  const [cloudCount, setCloudCount] = useState({ onDevice: 0, cloud: 0, postBytesOut: 0, attrBytesOut: 0 });
  // Base-rate lookups for the user's own data wait for consent; the exact strings are shown first.
  const [pendingLookups, setPendingLookups] = useState<PlannedLookup[] | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'running' | 'done' | 'declined'>('idle');
  const abort = useRef<AbortController | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [lastRun, setLastRun] = useState<ScanProgress | null>(null);
  const REPLAY_SPEED = 25;
  const forceReplay = new URLSearchParams(location.search).has('replay');
  // Phones and tablets can't run Gemini Nano in Chrome; don't offer a download there.
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const skipReplay = useRef(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const problems = useMemo(configProblems, []);

  useEffect(() => { onDeviceAvailability().then(setAvail); }, []);
  // Browser Back from a scan or result returns to the home page instead of leaving the site.
  useEffect(() => {
    if (phase !== 'home' && history.state?.phase !== phase) history.pushState({ phase }, '');
  }, [phase]);
  useEffect(() => {
    const onPop = () => { abort.current?.abort('leave'); setPhase('home'); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // A recorded Gemini Nano run of the synthetic persona, for browsers without on-device AI.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}personas/p1-replay.json`).then((r) => (r.ok ? r.json() : null)).then((j) => j && setReplay(j as Replay)).catch(() => undefined);
  }, []);
  // Dev-only visual QA: /?fixture renders the result screen from the persona's answer key,
  // so layouts can be checked without a model. Stripped from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('fixture')) return;
    (async () => {
      const p = (await (await fetch(`${import.meta.env.BASE_URL}personas/p1.json`)).json()) as Persona & { truth: Array<{ postId: string; cat: Fact['cat']; value: string; quote: string }> };
      const dates = new Map(p.posts.map((x) => [x.id, x.date]));
      setPersona(p); setPosts(p.posts); setData('synthetic');
      setFacts(p.truth.map((t, i) => ({ id: `fx${i}`, postId: t.postId, date: dates.get(t.postId) ?? '', cat: t.cat, value: t.value, quote: t.quote, certainty: 'stated', source: 'on_device' })));
      setPhase('result');
    })();
  }, []);
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
  const countedIds = useMemo(() => new Set(dossier.attributes.flatMap((a) => a.facts.map((f) => f.id))), [dossier]);
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
      // initializeDeviceModel starts the download and returns; poll until Chrome reports it ready.
      for (let i = 0; i < 600; i++) {
        const a = await onDeviceAvailability();
        if (a !== 'downloading' && a !== 'downloadable') { setAvail(a); return; }
        await new Promise((r) => setTimeout(r, 2000));
      }
      setAvail(await onDeviceAvailability());
    } catch (e) {
      setError('Chrome couldn’t download Gemini Nano here. It needs desktop Chrome with built-in AI enabled and about 22 GB free. You can still watch the recorded run.');
      setAvail('unavailable');
    }
  }

  async function start(list: Post[], kind: DataKind, maxPosts?: number) {
    setError(null);
    setPosts(list);
    setData(kind);
    setFacts([]);
    setReplaying(false);
    setLastRun(null);
    setPhase('scan');
    abort.current = new AbortController();
    try {
      const signal = abort.current.signal;
      const res = await scan(list, kind, (p) => { setProgress(p); setFacts(p.facts); }, signal, { maxPosts });
      // Leaving via the logo aborts the scan; don't yank the user back to a result page.
      if (signal.aborted && signal.reason === 'leave') return;
      setFacts(res.facts);
      setLastRun(res);
      (window as unknown as { __oneofRun?: Replay }).__oneofRun = toReplay(res, kind === 'synthetic' ? 'quietnight_rn' : 'own');
      setPhase('result');
      const plan = plannedLookups(res.facts);
      const country = buildDossier(res.facts, rates).region.key.startsWith('in:') ? 'India' : 'United States';
      setLookupState('idle');
      if (kind === 'synthetic') {
        setPendingLookups(null);
        if (navigator.onLine && plan.length) refineRates(plan, country, setRates).catch(() => undefined);
      } else {
        setPendingLookups(plan.length ? plan : null);
      }
    } catch (e) {
      setPhase('home');
      setError(e instanceof BlockedError
        ? 'Your own posts only ever run on this device, and this browser has no on-device model. Use desktop Chrome with Gemini Nano (we test on Chrome 158), or try the synthetic persona.'
        : `Scan failed: ${(e as Error).message}`);
    }
  }

  async function watchReplay() {
    if (!replay) return;
    const p = await loadPersona();
    setError(null); setPosts(p.posts); setData('synthetic'); setFacts([]); setLastRun(null);
    setReplaying(true); setPhase('scan');
    skipReplay.current = false;
    abort.current = new AbortController();
    const postIndex = new Map(p.posts.map((x) => [x.id, x]));
    const res = await playReplay(replay, REPLAY_SPEED, (x) => { setProgress(x); setFacts(x.facts); }, abort.current.signal, postIndex);
    // "Skip to the result" shows the whole recorded run, not a partial one, receipts included.
    if (skipReplay.current) {
      for (const e of replay.log.slice(res.done)) {
        record({ task: 'extract', mode: 'PREFER_ON_DEVICE', reason: 'Recorded Gemini Nano run, played back', source: e.source === 'in_cloud' ? 'in_cloud' : e.source === 'error' ? 'error' : 'on_device', ms: e.ms, sentToCloud: '', replay: true });
      }
    }
    setFacts(skipReplay.current ? recheck(replay.log.flatMap((e) => e.facts), postIndex) : res.facts);
    setPhase('result');
  }

  async function loadPersona() {
    const p = (await (await fetch(`${import.meta.env.BASE_URL}personas/p1.json`)).json()) as Persona;
    setPersona(p);
    return p;
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand" role="link" tabIndex={0} title="Home" onKeyDown={(e) => { if (e.key === 'Enter') { abort.current?.abort('leave'); setPhase('home'); } }} onClick={() => { abort.current?.abort('leave'); setPhase('home'); }}><span className="logo">1/</span>OneOf</div>
        <div className="top-right mono">
          <span className={`pill nano ${avail === 'available' ? 'ok' : 'warn'}`} title="Gemini Nano via Chrome built-in AI">
            <span className="long">Gemini </span>{NANO_LABEL[avail === 'downloading' && dl !== null ? 'downloading' : avail].replace('Gemini ', '')}{avail === 'downloading' && dl !== null ? ` ${Math.round(dl * 100)}%` : ''}
          </span>
          <span className={`pill net ${online ? '' : 'off'}`}>{online ? 'online' : 'offline'}</span>
          {appCheckMode() !== 'off' && <span className="pill ok ac" title="Firebase App Check protects the AI Logic endpoint">App Check on</span>}
          <button className="ghost cloud-btn" onClick={() => setLedgerOpen(true)}>
            <span className="long">What the cloud saw · </span><b>{cloudCount.postBytesOut}</b> B<span className="long"> of posts</span> sent{cloudCount.attrBytesOut > 0 && <span className="long"> · {cloudCount.attrBytesOut} B of attributes</span>}
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
              AI agents can now <b>unmask pseudonymous accounts</b> by stitching together harmless details across years of posts.
              OneOf builds that dossier first, <b>on your own device</b>, and shows how small a crowd you’re really hiding in.
            </p>
            <p className="cite small">English only for now. Lermen et al., “Large-scale online deanonymization with LLMs”, USENIX Security ’26: LLM agents re-identified 25–67% of Hacker News and Reddit users at 70–90% precision.</p>
          </section>

          <section className="start">
            <div className="card">
              <h3>Try it with a synthetic person</h3>
              <p>“quietnight_rn”: six years of posts by a night-shift nurse. <span className="tag nowrap">SYNTHETIC, NOT A REAL PERSON</span></p>
              {replay && (avail !== 'available' || forceReplay) ? (
                <>
                  <button className="primary" onClick={watchReplay}>Watch a recorded on-device run</button>
                  <p className="small muted">{avail === 'available' ? 'You’ll see' : 'Gemini Nano isn’t ready in this browser, so you’ll see'} a real run recorded in Chrome {chromeVersion(replay.userAgent)} on {replay.recordedAt.slice(0, 10)}, played {REPLAY_SPEED}× faster. Every fact and timing is from that run.</p>
                  <button className="ghost" onClick={async () => start((await loadPersona()).posts, 'synthetic', CLOUD_LIVE_LIMIT)}>Or run {CLOUD_LIVE_LIMIT} posts live through the cloud (free tier, rate-limited)</button>
                </>
              ) : (
                <>
                  <button className="primary" onClick={async () => start((await loadPersona()).posts, 'synthetic')}>Scan quietnight_rn</button>
                  <p className="small muted">Runs on-device when available; this demo data may fall back to the cloud.</p>
                </>
              )}
            </div>
            <div className="card">
              <h3>Check your own history</h3>
              {avail !== 'available' && <p className="small warn-text mono">Needs Gemini Nano (desktop Chrome). Your posts are never sent to the cloud, so without it this stays locked.</p>}
              <p>Drop your Reddit data export (.zip), a JSON/CSV of posts, or paste text. <b>Your posts never leave this device.</b> We never open IP logs or messages.</p>
              <label className="drop">
                <input type="file" accept=".zip,.json,.csv,.txt" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  try {
                    const r = await importFile(f);
                    setImportNote(`${r.format}: read ${r.posts.length} posts${r.skippedFiles.length ? ` · never opened: ${r.skippedFiles.join(', ')}` : ''}`);
                    start(r.posts, 'own');
                  } catch (err) { setError(`Couldn’t read that file: ${(err as Error).message}`); }
                }} />
                Choose a file
              </label>
              {importNote && <p className="small mono import-note">{importNote}</p>}
              <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste posts here, one per paragraph" />
              <button disabled={!paste.trim()} onClick={() => start(fromPaste(paste), 'own')}>Scan pasted posts</button>
            </div>
            <div className="card">
              <h3>On-device model</h3>
              <p className="mono">{NANO_LABEL[avail]}</p>
              {(avail === 'downloadable' || avail === 'downloading') && !coarse && <button onClick={prepare} disabled={avail === 'downloading'}>{avail === 'downloading' ? 'Downloading…' : 'Download Gemini Nano (one time)'}</button>}
              {avail === 'unsupported' && <p className="small">This browser has no built-in AI. Use desktop Chrome with Gemini Nano for on-device mode (we test on Chrome 158). The synthetic demo still works here as a recorded replay or through cloud fallback.</p>}
              <p className="small muted">Uses Firebase AI Logic hybrid inference: on-device first, cloud only where the router allows it.</p>
            </div>
          </section>
        </main>
      )}

      {phase === 'scan' && progress && (
        <main className="scan">
          {replaying && replay && <div className="banner warn mono">REPLAY · recorded with Gemini Nano in Chrome {chromeVersion(replay.userAgent)} on {replay.recordedAt.slice(0, 10)}{replay.promptVersion ? ` · prompt ${replay.promptVersion}` : ''} · {REPLAY_SPEED}× speed · real timings · facts re-checked by today’s checker</div>}
          <h2>Reading {progress.total} posts like an attacker would</h2>
          <div className="scan-stats mono">
            <span>{progress.done} / {progress.considered} posts read</span>
            <span>{progress.done < progress.fastPass ? `fast pass · ${progress.fastPass} posts with life-detail cues first` : `deep pass · the other ${Math.max(0, progress.considered - progress.fastPass)}`}</span>
            {!!progress.empty && <span>{progress.empty} empty or link-only</span>}
            {!!progress.limited && <span>{progress.limited} not read (demo limit)</span>}
            <span><SourceBadge source="on_device" /> {progress.onDevice}</span>
            <span><SourceBadge source="in_cloud" /> {progress.inCloud}</span>
            <span><b>{cloudCount.postBytesOut}</b> bytes of your posts sent</span>
          </div>
          <div className="bar"><div style={{ width: `${(progress.done / Math.max(1, progress.considered)) * 100}%` }} /></div>
          <div className="row scan-actions">
            {replaying
            ? <button className="primary" onClick={() => { skipReplay.current = true; abort.current?.abort(); }}>Skip to the result</button>
              : <button className="ghost" onClick={() => abort.current?.abort()}>Stop and show results</button>}
          </div>
          {!replaying && progress.onDevice >= progress.inCloud && <p className="small muted">Keep this tab in front: Chrome can pause on-device AI in background tabs.</p>}
          {progress.paused && <p className="small mono warn-text">Paused: this tab is in the background, and Chrome pauses on-device AI there. Come back to continue.</p>}
          {progress.cooling && <p className="small mono warn-text">{progress.inCloud > progress.onDevice
            ? 'The cloud is rate-limiting free requests, so we’re pausing 20 s. Skipped posts get retried at the end.'
            : 'Gemini Nano is slowing down, so we’re pausing 20 s to let it recover. Skipped posts get retried at the end.'}</p>}
          {!progress.cooling && progress.retried ? <p className="small mono muted">Retrying {progress.retried} posts that timed out.</p> : null}
          {progress.current && <div className="current mono">“{progress.current.text.slice(0, 120)}”</div>}
          <div className="live">
            <Meter e={estimate(dossier.region, dossier.attributes)} label="Crowd so far" />
            <div className="chips">
              {facts.slice().reverse().map((f) => (
                <span key={f.id} className={`chip ${countedIds.has(f.id) ? '' : 'dim'}`} title={countedIds.has(f.id) ? 'Counted: has a cited base rate' : 'Found, but not counted: no cited base rate, so it doesn’t narrow the crowd'}>
                  {f.value} <SourceBadge source={f.source} />
                </span>
              ))}
            </div>
          </div>
        </main>
      )}

      {phase === 'result' && (
        <main className="result">
          <section className="r-hero">
            <div>
              <div className="eyebrow mono">{persona && data === 'synthetic' ? `u/${persona.handle} · SYNTHETIC` : 'your history'} · {posts.length} posts · {facts.length} facts found · {dossier.attributes.length} counted · {dossier.region.label}</div>
              <Meter e={now} />
              <p className="small muted">OneOf can miss details an attacker would still find (on held-out data the on-device model caught about 4 in 10 labelled attributes), so treat this as an upper bound: your real crowd is probably smaller.</p>
              <div className="row">
                <button className="ghost" onClick={() => setFormulaOpen((v) => !v)}>{formulaOpen ? 'Hide' : 'Show'} the math</button>
                <button className="ghost" onClick={() => { abort.current?.abort('leave'); setPhase('home'); }}>Start over</button>
              </div>
              {replaying && replay && <p className="small muted mono">Replay of a recorded on-device run ({replay.recordedAt.slice(0, 10)}).</p>}
              {lastRun && data === 'synthetic' && lastRun.onDevice > 0 && (
                <button className="ghost" onClick={() => downloadJson('p1-replay.json', toReplay(lastRun, persona?.handle ?? 'quietnight_rn'))}>Export this run as a replay</button>
              )}
            </div>
            <div className="r-trail">
              <h3>Your crumb trail</h3>
              <p className="small muted">{left ? 'No single post gave you away. Together, they did.' : 'Each step down is a post that narrowed the crowd.'}</p>
              <Trail points={trail} left={left} span={posts.length ? [posts.reduce((m, p) => (p.date < m ? p.date : m), posts[0].date), posts.reduce((m, p) => (p.date > m ? p.date : m), posts[0].date)] : undefined} />
            </div>
          </section>
          {formulaOpen && <Formula d={dossier} e={now} />}

          <section className="r-grid">
            <div>
              <h3>The dossier an attacker would build</h3>
              <p className="small muted">Built on this device from your own words. Never a name, never a verdict, just the evidence.</p>
              <DossierList attrs={dossier.attributes} posts={postMap} />
              {facts.length > dossier.attributes.length && <p className="small muted">{facts.length} details were found; {dossier.attributes.length} have a bundled or cited base rate and are counted. The rest (weekdays, hobbies, group chats) don’t narrow the crowd, so they don’t change the number.</p>}
              {dossier.localOnly.length > 0 && <p className="small">{dossier.localOnly.length} sensitive facts (health, religion) stay on this device and aren’t counted.</p>}
              {data === 'own' && pendingLookups && lookupState !== 'declined' && (
                <div className="consent">
                  <h4>Sharpen the estimate?</h4>
                  {lookupState === 'done' ? (
                    <p className="small">Done. Sources and grades are in “Show the math”, and every request is in “What the cloud saw”.</p>
                  ) : (
                    <>
                      <p className="small">{pendingLookups.length} of your attributes have no bundled statistic. OneOf can ask the cloud how common each one is. It would send exactly these strings, one per request, and nothing else:</p>
                      <div className="chips">{pendingLookups.map((l) => <span key={l.attribute} className="chip mono">{l.attribute}</span>)}</div>
                      <p className="small muted">Names, numbers, places, health and dated events are never sent.</p>
                      <div className="row">
                        <button disabled={lookupState === 'running'} onClick={async () => {
                          setLookupState('running');
                          await refineRates(pendingLookups, dossier.region.key.startsWith('in:') ? 'India' : 'United States', setRates).catch(() => undefined);
                          setLookupState('done');
                        }}>{lookupState === 'running' ? 'Asking…' : `Send these ${pendingLookups.length}`}</button>
                        <button className="ghost" onClick={() => setLookupState('declined')}>Keep everything on this device</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div>
              <h3>Rejoin the crowd</h3>
              {fix.length ? (
                <>
                  <p>Edit or delete <b>{new Set(fix.flatMap((a) => a.facts.map((f) => f.postId))).size} posts</b> and you’re back to one of ~<b>{humanCount(fixed.p50)}</b>.</p>
                  <ul className="fix">
                    {fix.map((a) => a.facts.map((f) => {
                      const p = postMap.get(f.postId);
                      return <li key={f.id}><span className="mono">{f.date.slice(0, 10)}</span> “{p?.text.slice(0, 90) ?? f.quote}” {p?.permalink && /^\/r\/[\w/-]+$/.test(p.permalink) && <a href={`https://www.reddit.com${p.permalink}`} target="_blank" rel="noreferrer">open</a>}</li>;
                    }))}
                  </ul>
                </>
              ) : <p>You’re already hiding in a crowd of 1,000+.</p>}
              <h3>Before your next post</h3>
              <Draft history={facts} rates={rates} before={now} placeholder={persona?.draft} nano={avail === 'available'} recorded={data === 'synthetic' ? replay?.draft : undefined} />
            </div>
          </section>
          <footer className="small muted">OneOf never outputs a name or an identity guess, and never says “safe”. Ranges are estimates; tap “Show the math” for every source. · Built entirely on Firebase’s free plan: reading your history happens on your device, so it costs $0 and has no limit. · <a href="https://github.com/apexxx01/oneof" target="_blank" rel="noreferrer">Source on GitHub</a></footer>
        </main>
      )}

      <Ledger open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </div>
  );
}
