import { useEffect, useMemo, useRef, useState } from 'react';
import { onDeviceAvailability, prepareOnDevice, type Availability } from '../../../src/lib/ai';
import { buildDossier } from '../../../src/lib/dossier';
import { estimate } from '../../../src/lib/estimate';
import { fromPaste, importFile } from '../../../src/lib/importers';
import { getLedger, subscribe, summary, type LedgerEntry } from '../../../src/lib/ledger';
import type { ScanProgress } from '../../../src/lib/run';
import type { Fact, Post } from '../../../src/lib/types';
import { GradeBadge, Meter, SourceBadge, ThemeToggle } from '../../../src/ui/bits';
import { CrowdField } from '../../../src/ui/CrowdField';
import { fieldBase } from '../../../src/ui/crowd';
import { disableSite, enableSite, isBuiltIn, isBuiltInHost, listSites, siteOrigin, type SitesChrome } from '../shared/sites';
import { loadHistory, NO_HISTORY, saveHistory, type StoredHistory } from '../shared/history';
import { DraftEngine, MAX_HISTORY_POSTS, verdictFor, type DraftAnalysis } from './engine';
import { loadDemo } from './demo';
import { isPracticeHost } from '../shared/sites';
import { watchNetwork } from './netwatch';
import { connectEngine } from './port';

type Link = ReturnType<typeof connectEngine>;
interface Current { tabId: number; seq: number; host: string; text: string; a: DraftAnalysis }
interface BlurResult { forText: string; rewrite: string; removed: string[]; source: string }

const CAT_LABEL: Record<string, string> = {
  home_location: 'lives in', work_location: 'works in', occupation: 'job', employer_type: 'employer', education: 'education',
  age: 'age', gender: 'gender', family: 'family', relationship: 'relationship', vehicle: 'vehicle', pet: 'pet',
  health: 'health', religion_community: 'community', language: 'language', dated_event: 'event', rare_hobby: 'hobby', other: 'other',
};
const LOCAL_ONLY = new Set(['health', 'religion_community']);

export function App() {
  const engine = useMemo(() => new DraftEngine(), []);
  const [avail, setAvail] = useState<Availability | 'checking'>('checking');
  const [dl, setDl] = useState<number | null>(null);
  const [history, setHistory] = useState<StoredHistory>(NO_HISTORY);
  const [cur, setCur] = useState<Current | null>(null);
  const [blur, setBlur] = useState<BlurResult | null>(null);
  const [blurBusy, setBlurBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [net, setNet] = useState<string[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [filePosts, setFilePosts] = useState<{ posts: Post[]; note: string } | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const link = useRef<Link | null>(null);
  const last = useRef<Omit<Current, 'a'> | null>(null);
  const histRef = useRef<StoredHistory>(NO_HISTORY);
  const autoDemo = useRef(false);

  // Push an analysis to the panel and to the pill of the tab it came from.
  const deliver = (m: Omit<Current, 'a'>) => (a: DraftAnalysis) => {
    if (last.current?.seq !== m.seq || last.current.tabId !== m.tabId) return;
    setCur({ ...m, a });
    link.current?.post({ kind: 'verdict', tabId: m.tabId, seq: m.seq, verdict: verdictFor(a, { scanning: engine.scanning }) });
  };

  useEffect(() => {
    let stop = false;
    const check = async () => { const a = await onDeviceAvailability(); if (!stop) setAvail(a); return a; };
    void check();
    // Re-check while the model downloads or until it appears.
    const t = setInterval(() => { void check(); }, 5000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    void loadHistory(chrome.storage.local).then((h) => { engine.setHistory(h.facts); histRef.current = h; setHistory(h); });
    const l = connectEngine((m) => {
      last.current = { tabId: m.tabId, seq: m.seq, host: m.host, text: m.text };
      // The practice page is a made-up thread for trying OneOf: if no history is chosen yet, compare
      // against the synthetic demo persona once, clearly labelled. Never on any other site.
      if (isPracticeHost(m.host) && histRef.current.source === 'none' && !autoDemo.current) {
        autoDemo.current = true;
        void loadDemo(chrome.runtime.getURL('demo/p1-demo.json'))
          .then((h) => applyHistory({ ...h, label: `Practice page: ${h.label}` }))
          .catch(() => engine.submit(m.text, deliver(last.current!)));
        return;
      }
      engine.submit(m.text, deliver(last.current));
    });
    link.current = l;
    const unsub = subscribe(setLedger);
    const unwatch = watchNetwork(setNet);
    return () => { l.close(); unsub(); unwatch(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyHistory = async (h: StoredHistory) => {
    await saveHistory(chrome.storage.local, h);
    engine.setHistory(h.facts);
    histRef.current = h;
    setHistory(h);
    // Re-score the open draft against the new history (cached sentences: no model call).
    if (last.current) { last.current = { ...last.current }; engine.submit(last.current.text, deliver(last.current)); }
  };

  const runScan = async (posts: Post[]) => {
    if (!posts.length) { setMsg('No posts found in that text.'); return; }
    setMsg(null);
    abort.current = new AbortController();
    try {
      const res = await engine.scanHistory(posts, (p) => setScan({ ...p }), abort.current.signal);
      await applyHistory({
        v: 1, source: 'pasted', facts: res.facts, posts: posts.length, read: res.done, savedAt: new Date().toISOString(),
        label: `Your posts: ${res.done} of ${posts.length} read on this device${posts.length > MAX_HISTORY_POSTS ? ` (the ${MAX_HISTORY_POSTS} most revealing first)` : ''}`,
      });
      setPasteOpen(false); setPaste(''); setFilePosts(null);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setScan(null);
      abort.current = null;
    }
  };

  const a = cur?.a;
  // Same numbers as engine.before(): the dossier and crowd from history alone.
  const hd = useMemo(() => buildDossier(history.facts), [history]);
  const before = useMemo(() => estimate(hd.region, hd.attributes), [hd]);
  const draftLedger = ledger.filter((e) => e.task === 'draft' || e.task === 'blur');
  const ds = summary(draftLedger);
  const all = summary(ledger);
  const exportReceipts = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), summary: all, networkRequestsFromPanel: net, entries: getLedger() }, null, 2)], { type: 'application/json' });
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob);
    el.download = `oneof-extension-receipts-${Date.now()}.json`;
    el.click();
  };

  const base = fieldBase(hd.region);
  const shrinks = !!a && !a.blocked && a.after.p50 < a.before.p50;
  const fieldNow = a ? a.before : before;
  const host = cur?.host.replace(/^www\./, '');

  return (
    <div className="xp">
      <header className="top xp-top">
        <div className="brand" aria-label="OneOf"><span className="mark" aria-hidden>1/</span><span className="word">OneOf</span></div>
        <div className="top-fill" />
        <NanoCell avail={avail} />
        <ThemeToggle />
      </header>

      <NanoBanner avail={avail} dl={dl} onDownload={async () => {
        setDl(0);
        try { await prepareOnDevice((p) => setDl(p)); setAvail(await onDeviceAvailability()); } catch (e) { setMsg((e as Error).message); } finally { setDl(null); }
      }} />

      <section className="card primary xp-draft">
        <div className="card-k"><span className="lbl">This draft{host ? ` on ${host}` : ''}</span><SourceBadge source="on_device" /></div>
        {!cur && <p className="small">Start writing a post or comment on Reddit, the practice page, or a site you turned on below. When you pause, Gemini Nano reads it here, inside this panel, and the pill next to the box shows what it gives away.</p>}
        {cur && a && (
          <>
            <blockquote className="xp-text">{cur.text.length > 320 ? `${cur.text.slice(0, 320)}…` : cur.text}</blockquote>
            <div className="draft-status">
              {a.blocked ? 'Not checked: drafts are read only on this device, and Gemini Nano isn’t ready'
                : a.pending ? `Reading on-device: ${a.read} of ${a.sentences} sentences`
                  : a.facts.length ? `${a.facts.length} detail${a.facts.length === 1 ? '' : 's'} found in ${a.sentences} sentence${a.sentences === 1 ? '' : 's'}` : 'No identifying details found'}
              {a.failed > 0 && <span className="warn-text"> {a.failed} not read (model busy)</span>}
              {a.error && !a.blocked && <span className="err"> {a.error}</span>}
            </div>
            <DetailChips a={a} />
          </>
        )}
        <figure className="field-fig xp-field">
          <div className="field-box"><CrowdField p50={fieldNow.p50} base={base} band={fieldNow.band} preview={shrinks ? a!.after.p50 : null} /></div>
          {shrinks && <figcaption><span><i className="key pre" />darkened if you post it</span></figcaption>}
        </figure>
        <div className="xp-meters">
          <Meter e={fieldNow} compact scale={false} label={history.source === 'none' ? 'All US adults' : 'Before this draft'} />
          {a && (a.blocked
            ? <div className="not-checked"><div className="lbl mut">If you post it</div><div className="num">not checked</div></div>
            : <Meter e={a.after} compact scale={false} label="If you post it" />)}
        </div>
        {a && a.combines.length > 0 && (
          <div className="combines"><span className="lbl">Combines with your history</span><div className="chips">{a.combines.map((x) => <span key={x.rate.key} className="chip">{x.rate.label} <span className="cat">{x.firstSeen.slice(0, 4)}</span></span>)}</div></div>
        )}
        {cur && a && (
          <div className="row">
            <button className="primary" disabled={blurBusy || a.blocked || avail !== 'available'} title="Rewrite on this device" onClick={async () => {
              setBlurBusy(true); setMsg(null);
              try { const r = await engine.blur(cur.text); setBlur({ forText: cur.text, ...r }); } catch (e) { setMsg((e as Error).message); } finally { setBlurBusy(false); }
            }}>{blurBusy ? 'Blurring on this device' : 'Blur it on this device'}</button>
          </div>
        )}
        {cur && blur && (
          <div className="blur">
            <div className="lbl">Rewrite <SourceBadge source={blur.source} />{blur.forText !== cur.text && <span className="warn-text"> for an earlier version of the draft</span>}</div>
            <p className="xp-rewrite">{blur.rewrite}</p>
            {blur.removed.length > 0 && <div className="small mut">Blurred: {blur.removed.join(', ')}</div>}
            <div className="row">
              <button className="ghost" onClick={() => link.current?.post({ kind: 'apply-rewrite', tabId: cur.tabId, text: blur.rewrite })}>Put it in the composer</button>
              <button className="ghost" onClick={() => navigator.clipboard.writeText(blur.rewrite).then(() => setMsg('Copied.'), () => setMsg('Copy failed.'))}>Copy</button>
            </div>
          </div>
        )}
        {msg && <p className="small mut">{msg}</p>}
      </section>

      <section className="xp-slip">
        <div className="xp-zero"><span className="tbig">{ds.postBytesOut} B</span><span className="lbl">of this draft left your computer</span></div>
        <div className="slip-rows">
          <div className="row2"><span>On-device calls</span><span className="dots" /><b>{all.onDevice}</b></div>
          <div className="row2"><span>Cloud calls</span><span className="dots" /><b>{all.cloud}</b></div>
          <div className="row2"><span>Network requests from this panel</span><span className="dots" /><b>{net.length}</b></div>
        </div>
        {net.length > 0 && <pre className="payload">{net.join('\n')}</pre>}
        {all.total > 0 && <button className="link small" onClick={exportReceipts}>Export receipts</button>}
      </section>

      <Sites />

      <section className="card">
        <div className="card-k"><span className="lbl">Compared against</span>
          {history.source === 'demo' && <span className="tag">Synthetic</span>}
          {history.source === 'pasted' && <SourceBadge source="on_device" />}
        </div>
        <p className="small">{history.label}</p>
        {history.source !== 'none' && (
          <>
            <Meter e={before} compact scale label="Your crowd before any draft" />
            <div className="small mut mono">{history.facts.length} facts kept, {hd.attributes.length} counted. Region: {hd.region.label}.</div>
            <div className="chips">
              {hd.attributes.map((x) => <span key={x.rate.key} className="chip" title={x.rate.source}>{x.rate.label} <GradeBadge grade={x.rate.grade} /></span>)}
            </div>
          </>
        )}
        <div className="xp-choices" role="group" aria-label="History to compare against">
          <button className={history.source === 'demo' ? 'on' : ''} aria-pressed={history.source === 'demo'} disabled={!!scan} onClick={async () => { try { await applyHistory(await loadDemo(chrome.runtime.getURL('demo/p1-demo.json'))); } catch (e) { setMsg(`Demo history failed to load: ${(e as Error).message}`); } }}>
            Use the demo history <span className="tag">Synthetic</span>
          </button>
          <button className={pasteOpen || history.source === 'pasted' ? 'on' : ''} aria-pressed={history.source === 'pasted'} disabled={!!scan} onClick={() => setPasteOpen((x) => !x)}>Paste my posts</button>
          <button className={history.source === 'none' ? 'on' : ''} aria-pressed={history.source === 'none'} disabled={!!scan} onClick={() => applyHistory({ ...NO_HISTORY })}>No history</button>
        </div>
        {pasteOpen && (
          <div className="xp-paste">
            <textarea rows={6} value={paste} disabled={!!scan} onChange={(e) => { setPaste(e.target.value); setFilePosts(null); }} placeholder="Paste your old posts or comments here, separated by blank lines. They're read on this computer and never stored; only the details found are kept." />
            <label className="small mut xp-file">Or choose your Reddit data export (.zip), a .json or a .csv
              <input type="file" accept=".zip,.json,.csv,.txt" disabled={!!scan} onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { const r = await importFile(f); setPaste(''); setFilePosts({ posts: r.posts, note: `${r.posts.length} posts from ${r.format}${r.skippedFiles.length ? `. ${r.skippedFiles.length} other files listed, never opened` : ''}` }); } catch (err) { setMsg(`Couldn’t read that file: ${(err as Error).message}`); }
              }} />
            </label>
            {filePosts && <div className="import-note">{filePosts.note}</div>}
            {!scan ? (
              <button className="primary" disabled={avail !== 'available' || (!paste.trim() && !filePosts)} onClick={() => runScan(filePosts?.posts ?? fromPaste(paste))}>
                Read up to {MAX_HISTORY_POSTS} posts on this device
              </button>
            ) : (
              <div className="stack">
                <div className="bar"><div style={{ width: `${(scan.done / Math.max(1, scan.considered)) * 100}%` }} /></div>
                <div className="note">{scan.done} of {scan.considered} read, {scan.facts.length} facts.{scan.cooling ? ' Letting Gemini Nano cool down.' : ''}{scan.paused ? ' Paused while hidden.' : ''}</div>
                <button className="ghost" onClick={() => abort.current?.abort()}>Stop and keep what’s read</button>
              </div>
            )}
            {avail !== 'available' && <p className="small mut">Needs Gemini Nano: your posts are never sent anywhere else.</p>}
          </div>
        )}
      </section>

      <footer className="small mut xp-foot">
        Ranges are estimates from bundled, cited tables (P10–P90), never a verdict. OneOf never outputs a name or an identity guess. Every model call here runs on Gemini Nano through Firebase AI Logic with <span className="mono">ONLY_ON_DEVICE</span>; this extension makes no cloud calls.
      </footer>
    </div>
  );
}

const SUGGESTED = ['news.ycombinator.com', 'x.com', 'www.linkedin.com', 'github.com', 'discord.com', 'mail.google.com'];

/** Where drafts are checked: built-in hosts, sites the user turned on, and the open tab. */
function Sites() {
  const c = chrome as unknown as SitesChrome;
  const [tab, setTab] = useState<{ id?: number; url?: string } | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const getTab = async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t ? { id: t.id, url: t.url } : undefined;
  };
  const refresh = () => { void getTab().then((t) => setTab(t ?? null)); void listSites(c).then(setList).catch(() => undefined); };
  useEffect(() => {
    refresh();
    const onAct = () => refresh();
    const onUpd = (_: number, info: { status?: string; url?: string }) => { if (info.status === 'complete' || info.url) refresh(); };
    chrome.tabs.onActivated.addListener(onAct);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.permissions.onAdded.addListener(onAct);
    chrome.permissions.onRemoved.addListener(onAct);
    return () => {
      chrome.tabs.onActivated.removeListener(onAct); chrome.tabs.onUpdated.removeListener(onUpd);
      chrome.permissions.onAdded.removeListener(onAct); chrome.permissions.onRemoved.removeListener(onAct);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const here = siteOrigin(tab?.url);
  const builtIn = isBuiltIn(tab?.url);
  const typedOrigin = siteOrigin(typed);
  const target = here && !builtIn ? here : typedOrigin && !isBuiltInHost(typedOrigin) ? typedOrigin : null;
  const on = !!here && list.includes(here);
  const hostOf = (o: string) => new URL(o).host;
  return (
    <section className="card xp-sites">
      <div className="card-k"><span className="lbl">Where drafts are checked</span></div>
      <ul className="site-list">
        <li><span>reddit.com</span><span className="lbl mut">Built in</span></li>
        <li><span>OneOf practice page</span><span className="lbl mut">Built in</span></li>
        {list.map((o) => (
          <li key={o}><span>{hostOf(o)}</span><button className="link" onClick={async () => { await disableSite(c, o); setNote(`Stopped checking ${hostOf(o)}. Its permission was handed back.`); refresh(); }}>Remove</button></li>
        ))}
      </ul>
      <div className="site-here">
        <span className="lbl mut">This tab</span>
        {builtIn ? <p className="small">{tab?.url ? new URL(tab.url).host : ''}: built in, drafts here are checked.</p>
          : on ? <p className="small">{here && hostOf(here)}: drafts here are checked.</p>
            : here ? <p className="small"><b>{hostOf(here)}</b> isn’t turned on.</p>
              : (
                <>
                  <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Site address, e.g. news.ycombinator.com" aria-label="Site address" spellCheck={false} />
                  <div className="chips">{SUGGESTED.map((h) => <button key={h} className="chip" onClick={() => setTyped(h)}>{h}</button>)}</div>
                </>
              )}
        {!builtIn && !on && (
          <button className="primary" disabled={!target} onClick={() => {
            if (!target) return;
            // permissions.request runs first, synchronously inside this click (Chrome needs the gesture).
            void enableSite(c, target, getTab).then((r) => {
              setNote(!r.granted ? 'Not turned on: Chrome’s permission was declined.'
                : r.error ? `Permission granted, but the script couldn’t be registered: ${r.error}`
                  : `Checking drafts on ${hostOf(target)}${r.injected ? ', starting with this tab.' : '. Reload its tab if it was already open.'}`);
              setTyped('');
              refresh();
            });
          }}>Check drafts on this site</button>
        )}
        {note && <p className="note">{note}</p>}
        <p className="small mut">Chrome asks you first. OneOf only reads the box you type in, on the sites listed here, and sends nothing anywhere.</p>
      </div>
    </section>
  );
}

function DetailChips({ a }: { a: DraftAnalysis }) {
  if (!a.facts.length && !a.region) return null;
  const counted = new Set(a.countedIds);
  const inAttrs = new Set(a.attrs.flatMap((x) => x.facts.map((f) => f.id)));
  const places = a.facts.filter((f) => counted.has(f.id) && !inAttrs.has(f.id));
  const others = a.facts.filter((f) => !counted.has(f.id));
  return (
    <div className="chips">
      {a.region && <span className="chip on new">+ {a.region.label} <GradeBadge grade={a.region.grade} /></span>}
      {!a.region && places.map((f) => <span key={f.id} className="chip dim" title="Your history already places you here, so it adds nothing new">{CAT_LABEL[f.cat]}: {f.value} · already known</span>)}
      {a.attrs.map((x) => <span key={x.rate.key} className="chip on new" title={x.facts.map((f) => `“${f.quote}”`).join('\n')}>+ {x.rate.label} <SourceBadge source="on_device" /></span>)}
      {others.map((f: Fact) => (
        <span key={f.id} className="chip dim" title={LOCAL_ONLY.has(f.cat) ? 'Sensitive: kept on this device and never counted' : 'Found, but no cited base rate, so it doesn’t move the number'}>
          {CAT_LABEL[f.cat] ?? f.cat}: {f.value}
        </span>
      ))}
    </div>
  );
}

function NanoCell({ avail }: { avail: Availability | 'checking' }) {
  const [sq, label] = avail === 'available' ? ['ok', 'on device'] : avail === 'checking' ? ['', 'checking'] : avail === 'downloadable' || avail === 'downloading' ? ['warn', avail === 'downloading' ? 'downloading' : 'not downloaded'] : ['bad', 'not here'];
  return <span className="cell" title="Gemini Nano via Chrome built-in AI"><i className={`sq ${sq}`} aria-hidden /><span className="k">Nano</span><b>{label}</b></span>;
}

function NanoBanner({ avail, dl, onDownload }: { avail: Availability | 'checking'; dl: number | null; onDownload: () => void }) {
  if (avail === 'available' || avail === 'checking') return null;
  if (avail === 'downloadable' || avail === 'downloading') {
    return (
      <div className="notice warn">
        Gemini Nano isn’t on this computer yet. OneOf reads drafts only on-device, so it needs the model first (a one-time download by Chrome).
        <div className="row">
          <button className="primary" disabled={dl !== null} onClick={onDownload}>{dl !== null ? `Downloading ${Math.round(dl * 100)}%` : 'Download Gemini Nano'}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="notice err">
      {avail === 'unsupported'
        ? 'This Chrome has no built-in Prompt API. OneOf needs desktop Chrome (138 or later) with Gemini Nano.'
        : 'Gemini Nano can’t run on this computer (Chrome reports it unavailable: hardware, disk space or policy).'}
      {' '}Drafts are never sent anywhere else, so they won’t be checked. Requirements: <a href="https://developer.chrome.com/docs/ai/get-started" target="_blank" rel="noreferrer">Chrome built-in AI</a>.
    </div>
  );
}

