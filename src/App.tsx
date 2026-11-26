import { useEffect, useMemo, useRef, useState } from 'react';
import { BlockedError, onDeviceAvailability, prepareOnDevice, type Availability, type DataKind } from './lib/ai';
import { appCheckMode, type AppCheckMode } from './lib/firebase';
import { buildDossier, crowdNow, crumbTrail, leftTheCrowd, minimumFix } from './lib/dossier';
import { estimate, humanCount } from './lib/estimate';
import { fromPaste, importFile } from './lib/importers';
import { loadRateCache, plannedLookups, refineRates, scan, type PlannedLookup, type ScanProgress } from './lib/run';
import { configProblems } from './lib/firebase';
import { record, resetLedger, subscribe, summary, type LedgerSummary } from './lib/ledger';
import type { BaseRate, Fact, Post } from './lib/types';
import { Meter, SourceBadge, ThemeToggle } from './ui/bits';
import { CrowdField } from './ui/CrowdField';
import { FIELD_N, fieldBase, litCount } from './ui/crowd';
import { plural } from './lib/text';
import { DossierList, Draft, Formula, Ledger } from './ui/Panels';
import { Trail } from './ui/Trail';
import { Story } from './ui/Story';
import { Rejoin } from './ui/Rejoin';
import { chromeVersion, downloadJson, playReplay, recheck, toReplay, type Replay } from './lib/replay';
import { isDemoExport } from './lib/demo';
import { watchAiRequests } from './lib/netwatch';

type Phase = 'home' | 'scan' | 'result';
interface Persona { handle: string; posts: Post[]; draft?: string }

/** The free cloud tier rate-limits after a few dozen calls; a live cloud demo reads the first posts only. */
const CLOUD_LIVE_LIMIT = 25;

/** Header pill: which App Check provider protects the AI Logic endpoint in this build. */
const APP_CHECK_LABEL: Record<Exclude<AppCheckMode, 'off'>, string> = {
  enterprise: 'reCAPTCHA Enterprise',
  'recaptcha-v3': 'reCAPTCHA',
  'debug-token': 'debug provider',
};

/** Mono category labels on fact chips. */
const CAT_LABEL: Record<string, string> = {
  home_location: 'lives in', work_location: 'works in', occupation: 'job', employer_type: 'employer', education: 'education',
  age: 'age', gender: 'gender', family: 'family', relationship: 'relationship', vehicle: 'vehicle', pet: 'pet',
  health: 'health', religion_community: 'community', language: 'language', dated_event: 'event', rare_hobby: 'hobby', other: 'other',
};

/** Phone header: the same states in fewer characters. */
const NANO_SHORT: Record<Availability, string> = {
  available: 'on device', downloadable: 'not downloaded', downloading: 'downloading', unavailable: 'unavailable', unsupported: 'not here',
};

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
  const [cloudCount, setCloudCount] = useState<LedgerSummary>(() => summary([]));
  // Model requests the browser itself saw go over the network since the scan started.
  const [aiNet, setAiNet] = useState<{ since: number; n: number } | null>(null);
  // Base-rate lookups for the user's own data wait for consent; the exact strings are shown first.
  const [pendingLookups, setPendingLookups] = useState<PlannedLookup[] | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'running' | 'done' | 'declined'>('idle');
  const abort = useRef<AbortController | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayState, setReplayState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [replaying, setReplaying] = useState(false);
  const [lastRun, setLastRun] = useState<ScanProgress | null>(null);
  const REPLAY_SPEED = 25;
  const forceReplay = new URLSearchParams(location.search).has('replay');
  // Phones and tablets can't run Gemini Nano in Chrome; don't offer a download there.
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const skipReplay = useRef(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  // Own history picked without Gemini Nano: nothing is scanned or sent; the card says so.
  const [ownBlocked, setOwnBlocked] = useState<{ demo: boolean } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const problems = useMemo(configProblems, []);

  // Phones and tablets can't run Gemini Nano in Chrome: say so up front instead of offering a download.
  useEffect(() => { onDeviceAvailability().then((a) => setAvail(coarse && (a === 'downloadable' || a === 'downloading') ? 'unavailable' : a)); }, [coarse]);
  // Browser Back from a scan or result returns to the home page instead of leaving the site.
  useEffect(() => {
    if (phase !== 'home' && history.state?.phase !== phase) history.pushState({ phase }, '');
  }, [phase]);
  // A new screen starts at its top, not wherever the previous one was scrolled to.
  useEffect(() => { window.scrollTo(0, 0); }, [phase]);
  useEffect(() => {
    const onPop = () => { abort.current?.abort('leave'); setPhase('home'); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // A recorded Gemini Nano run of the synthetic persona, for browsers without on-device AI.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}personas/p1-replay.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { setReplay(j as Replay); setReplayState('ready'); } else setReplayState('failed'); })
      .catch(() => setReplayState('failed'));
  }, []);
  // An error can appear while the user is scrolled down a card; bring it into view.
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [error]);
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
    if (phase !== 'scan' || !aiNet) return;
    const since = aiNet.since;
    return watchAiRequests(since, (n) => setAiNet((v) => (v && v.since === since && v.n !== n ? { since, n } : v)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, aiNet?.since]);
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
  // What the full recorded on-device run ends at, quoted under the capped cloud demo.
  const fullRunDossier = useMemo(() => (replay ? buildDossier(replay.log.flatMap((e) => e.facts), rates) : null), [replay, rates]);
  const fullRunEst = useMemo(() => (fullRunDossier ? crowdNow(fullRunDossier) : { p10: 7, p50: 50, p90: 330, band: 'room' as const, bits: 14.3 }), [fullRunDossier]);
  const fullRunBase = fullRunDossier ? fieldBase(fullRunDossier.region) : fieldBase(dossier.region);
  const fullRunCrowd = humanCount(fullRunEst.p50);

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
    // Without Gemini Nano a synthetic scan goes to the free cloud tier: always capped.
    if (kind === 'synthetic' && avail !== 'available') maxPosts = Math.min(maxPosts ?? CLOUD_LIVE_LIMIT, CLOUD_LIVE_LIMIT);
    setError(null);
    setOwnBlocked(null);
    resetLedger();
    setPosts(list);
    setData(kind);
    setFacts([]);
    setReplaying(false);
    setLastRun(null);
    setPhase('scan');
    setAiNet({ since: performance.now(), n: 0 });
    abort.current = new AbortController();
    try {
      const signal = abort.current.signal;
      // A capped synthetic demo reads the posts the recorded on-device run found details in first.
      const prefer = kind === 'synthetic' && maxPosts !== undefined && fullRunDossier
        ? new Set([...fullRunDossier.attributes.flatMap((x) => x.facts), ...fullRunDossier.regionFacts].map((f) => f.postId).concat(replay ? replay.log.filter((e) => e.facts.length).map((e) => e.postId) : []))
        : undefined;
      const res = await scan(list, kind, (p) => { setProgress(p); setFacts(p.facts); }, signal, { maxPosts, prefer });
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
        if (navigator.onLine && plan.length) refineRates(plan, country, setRates, 'synthetic').catch(() => undefined);
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
    // Each run gets its own receipts: a second replay must not stack on the first.
    resetLedger();
    setError(null); setOwnBlocked(null); setPosts(p.posts); setData('synthetic'); setFacts([]); setLastRun(null);
    setReplaying(true); setPhase('scan'); setAiNet({ since: performance.now(), n: 0 });
    skipReplay.current = false;
    abort.current = new AbortController();
    const postIndex = new Map(p.posts.map((x) => [x.id, x]));
    const res = await playReplay(replay, REPLAY_SPEED, (x) => { setProgress(x); setFacts(x.facts); }, abort.current.signal, postIndex);
    // "Skip to the result" shows the whole recorded run, not a partial one, receipts included.
    if (skipReplay.current) {
      for (const e of replay.log.slice(res.done)) {
        record({ task: 'extract', mode: 'PREFER_ON_DEVICE', reason: 'Recorded Gemini Nano run, played back', source: e.source === 'in_cloud' ? 'in_cloud' : e.source === 'error' ? 'error' : 'on_device', ms: e.ms, sentToCloud: '', replay: true, data: 'synthetic' });
      }
    }
    setFacts(skipReplay.current ? recheck(replay.log.flatMap((e) => e.facts), postIndex) : res.facts);
    setPhase('result');
  }

  /** Own posts are only ever read on this device. Without Nano: say so, send nothing, never call start(). */
  async function scanOwn(list: Post[]) {
    if (avail === 'available') { start(list, 'own'); return; }
    setError(null);
    let demo = isDemoExport(list);
    if (!demo) { try { demo = isDemoExport(list, (await loadPersona()).posts); } catch { /* persona unavailable: treat as real */ } }
    setOwnBlocked({ demo });
  }

  async function loadPersona() {
    const p = (await (await fetch(`${import.meta.env.BASE_URL}personas/p1.json`)).json()) as Persona;
    setPersona(p);
    return p;
  }

  const goHome = () => { abort.current?.abort('leave'); setPhase('home'); };
  const scrollToTry = () => actionRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const acMode = appCheckMode();
  const liveEst = estimate(dossier.region, dossier.attributes);
  const base = fieldBase(dossier.region);
  const sentLabel = `${cloudCount.ownPostBytesOut} B`;
  const ticker: Array<{ t: string; s?: boolean }> = phase === 'scan' && progress
    ? [
      { t: `${progress.done} of ${progress.considered} posts read` },
      { t: `${progress.onDevice} read on-device` },
      { t: `${progress.inCloud} in the cloud` },
      { t: `${plural(facts.length, 'fact')} found` },
      { t: `one of ~${humanCount(liveEst.p50)} so far`, s: true },
      { t: `${sentLabel} of your posts sent` },
    ]
    : phase === 'result'
      ? [
        { t: progress?.limited ? `${progress.done} of ${plural(posts.length, 'post')} read` : `${plural(posts.length, 'post')} read` },
        { t: `${plural(facts.length, 'fact')} found` },
        { t: `${dossier.attributes.length + (dossier.region.key !== 'us' ? 1 : 0)} counted` },
        { t: `one of ~${humanCount(now.p50)}`, s: true },
        { t: `range ${humanCount(now.p10)}–${humanCount(now.p90)}` },
        { t: `${sentLabel} of your posts sent` },
        { t: 'never a name, never a verdict' },
      ]
      : [
        { t: `recorded run: ${replay?.postsTotal ?? 200} posts read on-device` },
        { t: `${sentLabel} of your posts sent` },
        { t: `quietnight_rn: one of ~${fullRunCrowd}`, s: true },
        { t: NANO_LABEL[avail] },
        { t: 'LLM agents re-identified 25–67% of pseudonymous users (USENIX Security ’26)' },
        { t: 'never a name, never a verdict' },
      ];

  return (
    <div className="app">
      <header className="top">
        <button className="brand" title="OneOf home" aria-label="OneOf home" onClick={goHome}><span className="mark" aria-hidden>1/</span><span className="word">OneOf</span></button>
        <div className="top-fill" />
        <span className="cell" title="Gemini Nano via Chrome built-in AI">
          <i className={`sq ${avail === 'available' ? 'ok' : avail === 'downloading' || avail === 'downloadable' ? 'warn' : 'bad'}`} aria-hidden />
          <span className="k long">Gemini Nano</span><span className="k short">Nano</span>
          <b><span className="long">{NANO_SHORT[avail]}</span><span className="short">{avail === 'available' ? 'on' : avail === 'downloading' ? 'dl' : 'off'}</span>{avail === 'downloading' && dl !== null ? ` ${Math.round(dl * 100)}%` : ''}</b>
        </span>
        {acMode !== 'off' && (
          <span className="cell ac" title={acMode === 'debug-token' ? 'Firebase App Check protects the AI Logic endpoint with the debug provider (a registered debug token), not reCAPTCHA attestation' : 'Firebase App Check protects the AI Logic endpoint'}>
            <i className={`sq ${acMode === 'debug-token' ? 'warn' : 'ok'}`} aria-hidden /><span className="k">App Check</span><b>{APP_CHECK_LABEL[acMode]}</b>
          </span>
        )}
        {!online && <span className="cell"><i className="sq bad" aria-hidden /><b>offline</b></span>}
        <button className="cell bytes" onClick={() => setLedgerOpen(true)} title="Open the receipts: every model call, where it ran, and the exact text that left this device">
          <b>{sentLabel}</b><span className="k"><span className="long">of your posts </span>sent</span>
        </button>
        <ThemeToggle />
      </header>
      {phase !== 'home' && <Ticker items={ticker} />}

      {problems.length > 0 && <div className="notice warn">{problems.join(' ')}</div>}
      {error && <div className="notice err" ref={errorRef} role="alert">{error}</div>}

      {phase === 'home' && (
        <main className="home">
          <section className="front">
            <div className="front-copy">
              <h1>How many people could <em>you</em> be?</h1>
              <p className="lede">
                AI agents can now <b>unmask pseudonymous accounts</b> by stitching together harmless details across years of posts.
                OneOf builds that dossier first, <b>on your own device</b>, and shows how small a crowd you’re really hiding in.
              </p>
              <div className="hero-cta">
                {avail === 'available' && !forceReplay
                  ? <button className="primary" onClick={async () => start((await loadPersona()).posts, 'synthetic')}>Scan the demo person live</button>
                  : <button className="primary" disabled={!replay} onClick={watchReplay}>Watch a recorded on-device scan</button>}
                <a className="ghost-a" href="#story">See how a stranger finds her</a>
                <a className="hero-own" href="#try" onClick={(e) => { e.preventDefault(); scrollToTry(); }}>Check your own posts</a>
              </div>
              <div className="hero-facts">
                <div><b>Web</b><span>try it right here; there’s also a Chrome extension and an iPhone app</span></div>
                <div><b className="dev">0 B</b><span>of your posts ever sent</span></div>
                <div><b>1</b><span>generic phrase to the cloud, after you say yes</span></div>
              </div>
            </div>
            <figure className="front-side field-fig">
              <div className="field-box"><CrowdField p50={fullRunEst.p50} base={fullRunBase} band={fullRunEst.band} from={FIELD_N} label={`A field of ${FIELD_N} dots on a log scale; all lit would be all US adults. After six years of posts, ${litCount(fullRunEst.p50, fullRunBase)} stay lit: one of about ${fullRunCrowd}.`} /></div>
              <figcaption className="field-cap">
                <div><span className="lbl">Start: all US adults</span><b>{humanCount(fullRunBase)}</b></div>
                <div className="s"><span className="lbl">quietnight_rn after 200 posts</span><b>one of ~{fullRunCrowd}</b></div>
                <div><span className="lbl">Scale</span><span className="lbl">Log. All {FIELD_N.toLocaleString('en-US')} lit = all US adults</span></div>
              </figcaption>
            </figure>
          </section>

          <Story dossier={fullRunDossier} replay={replay} onTry={scrollToTry} />
          <header className="x-head try-head" id="try-head">
            <span className="x-k lbl">Your turn</span>
            <h2>Find out how many people you could be</h2>
            <p>Start with the synthetic nurse to see it work, then check your own history. Your posts never leave this device.</p>
          </header>
          <section className="start" id="try" ref={actionRef}>
            <article className="card primary">
              <div className="card-k"><span className="lbl">Demo</span><span className="tag">Synthetic, not a real person</span></div>
              <h3>Try it with a synthetic person</h3>
              <p>quietnight_rn: six years of posts by a night-shift nurse.</p>
              {avail === 'available' && !forceReplay ? (
                <>
                  <button className="primary" onClick={async () => start((await loadPersona()).posts, 'synthetic')}>Scan all {replay?.postsTotal ?? 200} posts</button>
                  <p className="small mut">Runs on this device with Gemini Nano. About 10 minutes.</p>
                </>
              ) : replayState === 'loading' ? (
                <button className="primary" disabled>Loading the recorded run</button>
              ) : (
                <>
                  {replay ? (
                    <>
                      <button className="primary" onClick={watchReplay}>Watch a recorded on-device run</button>
                      <p className="small mut">{avail === 'available' ? 'You’ll see' : 'Gemini Nano isn’t ready in this browser, so you’ll see'} a real run recorded in Chrome {chromeVersion(replay.userAgent)} on {replay.recordedAt.slice(0, 10)}, played {REPLAY_SPEED}× faster. Every fact and timing is from that run.</p>
                    </>
                  ) : <p className="locked">The recorded run didn’t load. You can still run a short live demo.</p>}
                  <button className={replay ? 'ghost' : 'primary'} onClick={async () => start((await loadPersona()).posts, 'synthetic', CLOUD_LIVE_LIMIT)}>{replay ? 'Or run' : 'Run'} {CLOUD_LIVE_LIMIT} posts live through the cloud</button>
                  <p className="small mut">Free tier, rate-limited. Reads {CLOUD_LIVE_LIMIT} of {replay?.postsTotal ?? 200} posts: {replay ? 'the ones where the recorded on-device run found details' : 'ones with life details, spread across six years'}. A different model may still find less. The full on-device run reaches ~{fullRunCrowd}.</p>
                </>
              )}
            </article>
            <article className="card">
              <div className="card-k"><span className="lbl">Your data</span><SourceBadge source="on_device" /></div>
              <h3>Check your own history</h3>
              {avail !== 'available' && <p className="locked">Needs Gemini Nano (desktop Chrome). Your posts are never sent to the cloud, so without it this stays locked.</p>}
              <p>Drop your Reddit data export (.zip), a JSON or CSV of posts, or paste text. <b>Your posts never leave this device.</b> We never open IP logs or messages.</p>
              <label className="drop">
                <input type="file" accept=".zip,.json,.csv,.txt" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  try {
                    const r = await importFile(f);
                    setImportNote(`${r.format}: read ${plural(r.posts.length, 'post')}${r.skippedFiles.length ? `. Never opened: ${r.skippedFiles.join(', ')}` : ''}`);
                    e.target.value = '';
                    scanOwn(r.posts);
                  } catch (err) { setError(`Couldn’t read that file: ${(err as Error).message}`); }
                }} />
                Choose a file
              </label>
              {importNote && <p className="import-note">{importNote}</p>}
              {ownBlocked && (
                <div className="own-blocked">
                  <p className="locked">Scanning your own posts needs Gemini Nano. Nothing was sent.</p>
                  {ownBlocked.demo && (replay
                    ? <button className="primary" onClick={watchReplay}>This is the demo export: watch its recorded on-device run</button>
                    : <p className="small mut">This is the demo export. Use “Try it with a synthetic person” to see it scanned.</p>)}
                </div>
              )}
              <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Or paste posts here, one per paragraph" aria-label="Paste posts, one per paragraph" />
              <button className="ghost" disabled={!paste.trim()} onClick={() => { setImportNote(`Pasted text: ${plural(fromPaste(paste).length, 'post')}`); scanOwn(fromPaste(paste)); }}>Scan pasted posts</button>
            </article>
            <article className="card">
              <div className="card-k"><span className="lbl">Model</span></div>
              <h3>On-device model</h3>
              <p className="mono small"><i className={`sq inl ${avail === 'available' ? 'ok' : 'warn'}`} aria-hidden />{NANO_LABEL[avail]}</p>
              {(avail === 'downloadable' || avail === 'downloading') && !coarse && <button className="ghost" onClick={prepare} disabled={avail === 'downloading'}>{avail === 'downloading' ? 'Downloading Gemini Nano' : 'Download Gemini Nano (one time)'}</button>}
              {avail === 'unsupported' && <p className="small">This browser has no built-in AI. Use desktop Chrome with Gemini Nano for on-device mode (we test on Chrome 158). The synthetic demo still works here as a recorded replay or through cloud fallback.</p>}
              <p className="small mut">Firebase AI Logic hybrid inference: on-device first, cloud only where the router allows it.</p>
            </article>
          </section>
          <Footer />
        </main>
      )}

      {phase === 'scan' && progress && (
        <main className="scan">
          {data === 'synthetic' && (
            <div className={`stripe ${replaying ? 'amber' : ''}`}>
              {replaying && replay
                ? <><span className="tagx">REPLAY</span><span>Recorded with Gemini Nano in Chrome {chromeVersion(replay.userAgent)} on {replay.recordedAt.slice(0, 10)}{replay.promptVersion ? `, prompt ${replay.promptVersion}` : ''}. Played {REPLAY_SPEED}× faster with real timings; facts re-checked by today’s checker. quietnight_rn is synthetic, not a real person.</span></>
                : <><span className="tagx">SYNTHETIC</span><span>quietnight_rn is not a real person.</span></>}
            </div>
          )}
          <div className="scan-grid">
            <section className="scan-left">
              <h2>Reading {progress.total} posts like an attacker would</h2>
              <div className="stats">
                <div className="stat"><span className="lbl mut">Posts read</span><span className="v">{progress.done}<span className="mut">/{progress.considered}</span></span></div>
                <div className="stat"><span className="lbl mut">On device</span><span className="v device">{progress.onDevice}</span></div>
                <div className="stat"><span className="lbl mut">In cloud</span><span className="v cloud">{progress.inCloud}</span></div>
                <div className="stat"><span className="lbl mut">{data === 'synthetic' ? 'Demo bytes sent' : 'Your bytes sent'}</span><span className="v">{data === 'synthetic' ? cloudCount.demoPostBytesOut : cloudCount.ownPostBytesOut}</span></div>
                {aiNet && <div className="stat" title="Counted by your browser (Resource Timing), not by OneOf's own ledger: requests to the Gemini / Firebase AI Logic endpoints since this scan started"><span className="lbl mut">Model requests on the network</span><span className={`v ${aiNet.n ? 'cloud' : 'device'}`}>{aiNet.n}</span></div>}
              </div>
              <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.considered} aria-valuenow={progress.done}><div style={{ width: `${(progress.done / Math.max(1, progress.considered)) * 100}%` }} /></div>
              <p className="note">
                {progress.done < progress.fastPass ? `Fast pass: the ${progress.fastPass} posts with life-detail cues first.` : `Deep pass: the other ${Math.max(0, progress.considered - progress.fastPass)}.`}
                {!!progress.empty && ` ${progress.empty} empty or link-only.`}
                {!!progress.limited && ` ${progress.limited} not read (demo limit, sample spread across the timeline).`}
                {data === 'synthetic' && ` ${cloudCount.ownPostBytesOut} bytes of your posts sent.`}
              </p>
              <div className="row">
                {replaying
                  ? <button className="primary" onClick={() => { skipReplay.current = true; abort.current?.abort(); }}>Skip to the result</button>
                  : <button className="ghost" onClick={() => abort.current?.abort()}>Stop and show results</button>}
              </div>
              {!replaying && progress.onDevice >= progress.inCloud && <p className="note">Keep this tab in front: Chrome can pause on-device AI in background tabs.</p>}
              {progress.paused && <p className="note warn">Paused: this tab is in the background, and Chrome pauses on-device AI there. Come back to continue.</p>}
              {progress.cooling && <p className="note warn">{progress.inCloud > progress.onDevice
                ? 'The cloud is rate-limiting free requests, so we’re pausing 20 s. Skipped posts get retried at the end.'
                : 'Gemini Nano is slowing down, so we’re pausing 20 s to let it recover. Skipped posts get retried at the end.'}</p>}
              {!progress.cooling && progress.retried ? <p className="note">Retrying {plural(progress.retried, 'post')} that timed out.</p> : null}
              {progress.current && <div className="current">“{progress.current.text.slice(0, 140)}”</div>}
            </section>
            <section className="scan-right">
              <Meter e={liveEst} label="Crowd so far" compact scale />
              <figure className="field-fig scan-field">
                <div className="field-box"><CrowdField p50={liveEst.p50} base={base} band={liveEst.band} /></div>
              </figure>
              <span className="lbl">Counted: narrows the crowd</span>
              <div className="chips">
                {dossier.regionFacts.length > 0 && (
                  <span className="chip new on" title="Counted: the region's adult population">
                    <span className="cat">lives in</span>{dossier.region.label}{dossier.regionFacts.length > 1 && <span className="x3">×{dossier.regionFacts.length}</span>} <SourceBadge source={dossier.regionFacts[0].source} />
                  </span>
                )}
                {dossier.attributes.map((a) => (
                  <span key={a.rate.key} className="chip new on" title={`Counted: ${a.rate.label}, grade ${a.rate.grade}. Found in ${plural(new Set(a.facts.map((f) => f.postId)).size, 'post')}.`}>
                    <span className="cat">{CAT_LABEL[a.rate.cat] ?? a.rate.cat}</span>{a.rate.label}{new Set(a.facts.map((f) => f.postId)).size > 1 && <span className="x3">×{new Set(a.facts.map((f) => f.postId)).size} posts</span>} <SourceBadge source={a.facts[0].source} />
                  </span>
                ))}
              </div>
              {(() => {
                const rest = facts.filter((f) => !countedIds.has(f.id) && !dossier.regionFacts.some((r) => r.id === f.id));
                return rest.length > 0 && (
                  <details className="uncounted">
                    <summary className="lbl mut">{plural(rest.length, 'other detail')} found, not counted (no cited base rate, or too common to matter)</summary>
                    <div className="chips">{rest.slice().reverse().map((f) => <span key={f.id} className="chip dim"><span className="cat">{CAT_LABEL[f.cat] ?? f.cat}</span>{f.value}</span>)}</div>
                  </details>
                );
              })()}
            </section>
          </div>
        </main>
      )}

      {phase === 'result' && (
        <main className="result">
          {data === 'synthetic' && (
            <div className="stripe">
              <span className="tagx">{replaying ? 'REPLAY' : 'SYNTHETIC'}</span>
              <span>{replaying && replay ? `Recorded on-device run, ${replay.recordedAt.slice(0, 10)}. quietnight_rn is not a real person.` : 'quietnight_rn is not a real person.'}</span>
            </div>
          )}
          <section className="r-hero">
            <div className="r-num">
              <div className="eyecells">
                <span className="inv">{persona && data === 'synthetic' ? `u/${persona.handle}` : 'Your history'}</span>
                <span>{progress?.limited ? `${progress.done} of ${posts.length} posts read` : plural(posts.length, 'post')}</span>
                <span>{plural(facts.length, 'fact')} found</span>
                <span>{dossier.attributes.length + (dossier.region.key !== 'us' ? 1 : 0)} counted</span>
                <span>{dossier.region.label}</span>
              </div>
              <Meter e={now} />
              <p className="upper"><b>This is an upper bound.</b> OneOf can miss details an attacker would still find (on held-out data the on-device model caught about 4 in 10 labelled attributes), so your real crowd is probably smaller.</p>
              <div className="row">
                <button className={formulaOpen ? 'primary' : 'ghost'} aria-expanded={formulaOpen} aria-controls="math" onClick={() => { const open = !formulaOpen; setFormulaOpen(open); if (open) requestAnimationFrame(() => document.getElementById('math')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })); }}>{formulaOpen ? 'Hide' : 'Show'} the math</button>
                <button className="ghost" onClick={goHome}>Start over</button>
                {lastRun && data === 'synthetic' && lastRun.onDevice > 0 && (
                  <button className="ghost" onClick={() => downloadJson('p1-replay.json', toReplay(lastRun, persona?.handle ?? 'quietnight_rn'))}>Export this run as a replay</button>
                )}
              </div>
            </div>
            <figure className="r-field field-fig">
              <div className="field-box"><CrowdField p50={now.p50} base={base} band={now.band} from={FIELD_N} /></div>
              <figcaption className="field-cap">
                <div><span className="lbl">Lit</span><b>{litCount(now.p50, base)} of {FIELD_N}</b></div>
                <div><span className="lbl">Scale</span><span className="lbl">Log. All {FIELD_N.toLocaleString('en-US')} lit = all {dossier.region.key.startsWith('us') ? 'US ' : ''}adults</span></div>
              </figcaption>
            </figure>
          </section>
          {formulaOpen && (
            <section className="sec" id="math">
              <div className="sec-head"><h2>The math</h2><p>Every factor, its range and its source. Nothing hidden.</p></div>
              <Formula d={dossier} e={now} />
            </section>
          )}
          <section className="sec">
            <div className="sec-head"><h2>Your crumb trail</h2><p>{left ? 'No single post gave you away. Together, they did.' : 'Each step down is a post that narrowed the crowd.'}</p></div>
            <div className="trail-wrap">
              <Trail points={trail} left={left} span={posts.length ? [posts.reduce((m, p) => (p.date < m ? p.date : m), posts[0].date), posts.reduce((m, p) => (p.date > m ? p.date : m), posts[0].date)] : undefined} />
            </div>
          </section>

          <section className="r-grid">
            <div>
              <div className="col-head"><h2>What a stranger learns</h2><p>Built on this device from your own words. Never a name, never a verdict, just the evidence.</p></div>
              <div className="col-body">
                <DossierList attrs={dossier.attributes} posts={postMap} />
                {facts.length > dossier.attributes.length && <p className="small mut">{plural(facts.length, 'detail')} {facts.length === 1 ? 'was' : 'were'} found; {dossier.attributes.length} {dossier.attributes.length === 1 ? 'has' : 'have'} a bundled or cited base rate and {dossier.attributes.length === 1 ? 'is' : 'are'} counted. The rest (weekdays, hobbies, group chats) don’t narrow the crowd, so they don’t change the number.</p>}
                {dossier.localOnly.length > 0 && <p className="small">{plural(dossier.localOnly.length, 'sensitive fact')} (health, religion) {dossier.localOnly.length === 1 ? 'stays' : 'stay'} on this device and {dossier.localOnly.length === 1 ? 'isn’t' : 'aren’t'} counted.</p>}
                {data === 'own' && pendingLookups && lookupState !== 'declined' && (
                  <div className="consent">
                    <h4>Sharpen the estimate?</h4>
                    {lookupState === 'done' ? (
                      <p className="small">Done. Sources and grades are in “Show the math”, and every request is in the receipts.</p>
                    ) : (
                      <>
                        <p className="small">{pendingLookups.length} of your attributes have no bundled statistic. OneOf can ask the cloud which public table each one belongs to (the number then comes from that table, never from the model), or, if none fits, for a rough estimate that is shown but not counted. It would send exactly these strings, one per request, and nothing else:</p>
                        <div className="chips">{pendingLookups.map((l) => <span key={l.attribute} className="chip mono">{l.attribute}</span>)}</div>
                        <p className="small mut">Names, numbers, places, health and dated events are never sent.</p>
                        <div className="row">
                          <button className="primary" disabled={lookupState === 'running'} onClick={async () => {
                            setLookupState('running');
                            await refineRates(pendingLookups, dossier.region.key.startsWith('in:') ? 'India' : 'United States', setRates).catch(() => undefined);
                            setLookupState('done');
                          }}>{lookupState === 'running' ? 'Asking' : `Send these ${pendingLookups.length}`}</button>
                          <button className="ghost" onClick={() => setLookupState('declined')}>Keep everything on this device</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="col-head"><h2>Rejoin the crowd</h2></div>
              <div className="col-body">
                {fix.length > 0 && <p className="rejoin">Edit or delete <b>{plural(new Set(fix.flatMap((a) => a.facts.map((f) => f.postId))).size, 'post')}</b> and you’re back to one of ~<b>{humanCount(fixed.p50)}</b>. Try it: switch posts off below.</p>}
                <Rejoin d={dossier} posts={postMap} fix={fix} base={base} />
              </div>
              <div className="col-head"><h2>Before your next post</h2></div>
              <div className="col-body">
                <Draft history={facts} rates={rates} before={now} base={base} placeholder={persona?.draft} nano={avail === 'available'} recorded={data === 'synthetic' ? replay?.draft : undefined} />
              </div>
            </div>
          </section>
          <Footer />
        </main>
      )}

      <Ledger open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </div>
  );
}

/** The ticker: live facts in a slow marquee. Pauses on hover; static under reduced motion. */
function Ticker({ items }: { items: Array<{ t: string; s?: boolean }> }) {
  // Everything in it is also on the page, so screen readers skip it instead of hearing it scroll.
  const row = (dup: boolean) => items.map((x, i) => <span key={`${dup ? 'd' : 'v'}${i}`} className={`${x.s ? 's' : ''}${dup ? ' dup' : ''}`}>{x.t}</span>);
  return (
    <div className="ticker" aria-hidden="true">
      <div className="track">{row(false)}{row(true)}</div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div><span className="lbl">Honesty</span>OneOf never outputs a name or an identity guess, and never calls you safe. Ranges are estimates; “Show the math” lists every source.</div>
      <div><span className="lbl">Cost</span>Built entirely on Firebase’s free plan. Reading your history happens on your device, so it costs nothing and has no limit.</div>
      <div><span className="lbl">Source</span><a href="https://github.com/apexxx01/oneof" target="_blank" rel="noreferrer">github.com/apexxx01/oneof</a>. Held-out results at <a href="?eval">/?eval</a>.</div>
    </footer>
  );
}
