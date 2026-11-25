import { useEffect, useMemo, useRef, useState } from 'react';
import { onDeviceAvailability, prepareOnDevice, type Availability } from '../../../src/lib/ai';
import { buildDossier } from '../../../src/lib/dossier';
import { estimate } from '../../../src/lib/estimate';
import { fromPaste, importFile } from '../../../src/lib/importers';
import { getLedger, subscribe, summary, type LedgerEntry } from '../../../src/lib/ledger';
import type { ScanProgress } from '../../../src/lib/run';
import type { Fact, Post } from '../../../src/lib/types';
import { GradeBadge, Meter, SourceBadge } from '../../../src/ui/bits';
import { loadHistory, NO_HISTORY, saveHistory, type StoredHistory } from '../shared/history';
import { DraftEngine, MAX_HISTORY_POSTS, verdictFor, type DraftAnalysis } from './engine';
import { loadDemo } from './demo';
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
    void loadHistory(chrome.storage.local).then((h) => { engine.setHistory(h.facts); setHistory(h); });
    const l = connectEngine((m) => {
      last.current = { tabId: m.tabId, seq: m.seq, host: m.host, text: m.text };
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

  return (
    <div className="xp">
      <header className="xp-top">
        <div className="brand"><span className="logo">OneOf</span><span className="xp-tag">check before you post</span></div>
        <NanoPill avail={avail} />
      </header>

      <NanoBanner avail={avail} dl={dl} onDownload={async () => {
        setDl(0);
        try { await prepareOnDevice((p) => setDl(p)); setAvail(await onDeviceAvailability()); } catch (e) { setMsg((e as Error).message); } finally { setDl(null); }
      }} />

      <section className="card xp-draft">
        <div className="eyebrow mono">This draft{cur ? ` · ${cur.host.replace(/^www\./, '')}` : ''} · read on this computer</div>
        {!cur && <p className="small muted">Start writing a comment or post on Reddit. When you pause, Gemini Nano reads it here, inside this panel, and the pill next to the box shows what it gives away.</p>}
        {cur && a && (
          <>
            <blockquote className="xp-text">{cur.text.length > 320 ? `${cur.text.slice(0, 320)}…` : cur.text}</blockquote>
            <div className="draft-status mono">
              {a.blocked ? 'not checked: drafts are read only on this device, and Gemini Nano isn’t ready'
                : a.pending ? `reading on-device… ${a.read}/${a.sentences} sentences`
                  : a.facts.length ? `${a.facts.length} detail${a.facts.length === 1 ? '' : 's'} found in ${a.sentences} sentence${a.sentences === 1 ? '' : 's'}` : 'no identifying details found'}
              {a.failed > 0 && <span className="warn-text"> · {a.failed} not read (model busy)</span>}
              {a.error && !a.blocked && <span className="err"> · {a.error}</span>}
            </div>
            <DetailChips a={a} />
            <div className="xp-meters">
              <Meter e={a.before} compact label={history.source === 'none' ? 'Before: all US adults' : 'Before this draft'} />
              <div className="arrow mono">↓</div>
              {a.blocked
                ? <div className="not-checked"><div className="eyebrow mono">If you post it</div><p className="mono">not checked</p></div>
                : <Meter e={a.after} compact label="If you post it" />}
            </div>
            {a.combines.length > 0 && (
              <div className="combines">Combines with your history: {a.combines.map((x) => <span key={x.rate.key} className="chip">{x.rate.label} · {x.firstSeen.slice(0, 4)}</span>)}</div>
            )}
            <div className="row">
              <button className="primary" disabled={blurBusy || a.blocked || avail !== 'available'} title="Rewrite on this device" onClick={async () => {
                setBlurBusy(true); setMsg(null);
                try { const r = await engine.blur(cur.text); setBlur({ forText: cur.text, ...r }); } catch (e) { setMsg((e as Error).message); } finally { setBlurBusy(false); }
              }}>{blurBusy ? 'Blurring on-device…' : 'Blur it (on-device)'}</button>
            </div>
            {blur && (
              <div className="blur">
                <div className="mono small">REWRITE · <SourceBadge source={blur.source} />{blur.forText !== cur.text && <span className="warn-text"> · for an earlier version of the draft</span>}</div>
                <p className="xp-rewrite">{blur.rewrite}</p>
                {blur.removed.length > 0 && <div className="small muted">blurred: {blur.removed.join(', ')}</div>}
                <div className="row">
                  <button onClick={() => link.current?.post({ kind: 'apply-rewrite', tabId: cur.tabId, text: blur.rewrite })}>Put it in the composer</button>
                  <button className="ghost" onClick={() => navigator.clipboard.writeText(blur.rewrite).then(() => setMsg('Copied.'), () => setMsg('Copy failed.'))}>Copy</button>
                </div>
              </div>
            )}
          </>
        )}
        {msg && <p className="small muted">{msg}</p>}
      </section>

      <section className="xp-ledger">
        <div className="mono xp-zero"><b>{ds.postBytesOut}</b> bytes of this draft left your computer</div>
        <div className="small muted mono">{all.onDevice} on-device call{all.onDevice === 1 ? '' : 's'} · {all.cloud} cloud · {net.length} network request{net.length === 1 ? '' : 's'} from this panel{all.total ? <> · <a href="#" onClick={(e) => { e.preventDefault(); exportReceipts(); }}>export receipts</a></> : null}</div>
        {net.length > 0 && <pre className="payload">{net.join('\n')}</pre>}
      </section>

      <section className="card">
        <div className="eyebrow mono">Compared against</div>
        <div className="xp-source">
          {history.source === 'demo' && <span className="tag">SYNTHETIC</span>}
          {history.source === 'pasted' && <span className="badge b-device">YOUR POSTS · ON DEVICE</span>}
          {history.source === 'none' && <span className="badge b-muted">NO HISTORY</span>}
          <span className="small">{history.label}</span>
        </div>
        {history.source !== 'none' && (
          <>
            <Meter e={before} compact label="Your crowd before any draft" />
            <div className="small muted mono">{history.facts.length} facts kept · {hd.attributes.length} counted · region {hd.region.label}</div>
            <div className="chips">
              {hd.attributes.map((x) => <span key={x.rate.key} className="chip" title={x.rate.source}>{x.rate.label} <GradeBadge grade={x.rate.grade} /></span>)}
            </div>
          </>
        )}
        <div className="xp-choices">
          <button className={history.source === 'demo' ? 'on' : ''} disabled={!!scan} onClick={async () => { try { await applyHistory(await loadDemo(chrome.runtime.getURL('demo/p1-demo.json'))); } catch (e) { setMsg(`Demo history failed to load: ${(e as Error).message}`); } }}>
            Use the demo history <span className="tag">SYNTHETIC</span>
          </button>
          <button className={pasteOpen || history.source === 'pasted' ? 'on' : ''} disabled={!!scan} onClick={() => setPasteOpen((x) => !x)}>Paste my posts</button>
          <button className={history.source === 'none' ? 'on' : ''} disabled={!!scan} onClick={() => applyHistory({ ...NO_HISTORY })}>No history</button>
        </div>
        {pasteOpen && (
          <div className="xp-paste">
            <textarea rows={6} value={paste} disabled={!!scan} onChange={(e) => { setPaste(e.target.value); setFilePosts(null); }} placeholder="Paste your old posts or comments here, separated by blank lines. They're read on this computer and never stored; only the details found are kept." />
            <label className="small muted xp-file">or choose your Reddit data export (.zip), a .json or a .csv
              <input type="file" accept=".zip,.json,.csv,.txt" disabled={!!scan} onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { const r = await importFile(f); setPaste(''); setFilePosts({ posts: r.posts, note: `${r.posts.length} posts from ${r.format}${r.skippedFiles.length ? ` · ${r.skippedFiles.length} other files listed, never opened` : ''}` }); } catch (err) { setMsg(`Couldn’t read that file: ${(err as Error).message}`); }
              }} />
            </label>
            {filePosts && <div className="small import-note">{filePosts.note}</div>}
            {!scan ? (
              <button className="primary" disabled={avail !== 'available' || (!paste.trim() && !filePosts)} onClick={() => runScan(filePosts?.posts ?? fromPaste(paste))}>
                Read on this device (up to {MAX_HISTORY_POSTS} posts)
              </button>
            ) : (
              <div>
                <div className="bar"><div style={{ width: `${(scan.done / Math.max(1, scan.considered)) * 100}%` }} /></div>
                <div className="small muted mono">{scan.done}/{scan.considered} read · {scan.facts.length} facts{scan.cooling ? ' · letting Gemini Nano cool down' : ''}{scan.paused ? ' · paused while hidden' : ''}</div>
                <button className="ghost" onClick={() => abort.current?.abort()}>Stop and keep what’s read</button>
              </div>
            )}
            {avail !== 'available' && <p className="small muted">Needs Gemini Nano: your posts are never sent anywhere else.</p>}
          </div>
        )}
      </section>

      <footer className="small muted">
        Ranges are estimates from bundled, cited tables (P10–P90), never a verdict. OneOf never outputs a name or an identity guess. Every model call here runs on Gemini Nano through Firebase AI Logic with <span className="mono">ONLY_ON_DEVICE</span>; this extension makes no cloud calls.
      </footer>
    </div>
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
      {a.region && <span className="chip new">+ {a.region.label} <GradeBadge grade={a.region.grade} /></span>}
      {!a.region && places.map((f) => <span key={f.id} className="chip dim" title="Your history already places you here, so it adds nothing new">{CAT_LABEL[f.cat]}: {f.value} · already known</span>)}
      {a.attrs.map((x) => <span key={x.rate.key} className="chip new" title={x.facts.map((f) => `“${f.quote}”`).join('\n')}>+ {x.rate.label} <SourceBadge source="on_device" /></span>)}
      {others.map((f: Fact) => (
        <span key={f.id} className="chip dim" title={LOCAL_ONLY.has(f.cat) ? 'Sensitive: kept on this device and never counted' : 'Found, but no cited base rate, so it doesn’t move the number'}>
          {CAT_LABEL[f.cat] ?? f.cat}: {f.value}
        </span>
      ))}
    </div>
  );
}

function NanoPill({ avail }: { avail: Availability | 'checking' }) {
  if (avail === 'available') return <span className="pill ok mono">Gemini Nano · on device</span>;
  if (avail === 'checking') return <span className="pill mono">checking…</span>;
  if (avail === 'downloadable' || avail === 'downloading') return <span className="pill warn mono">Nano {avail}</span>;
  return <span className="pill off mono">no on-device model</span>;
}

function NanoBanner({ avail, dl, onDownload }: { avail: Availability | 'checking'; dl: number | null; onDownload: () => void }) {
  if (avail === 'available' || avail === 'checking') return null;
  if (avail === 'downloadable' || avail === 'downloading') {
    return (
      <div className="banner warn">
        Gemini Nano isn’t on this computer yet. OneOf reads drafts only on-device, so it needs the model first (a one-time download by Chrome).
        <div className="row">
          <button className="primary" disabled={dl !== null} onClick={onDownload}>{dl !== null ? `Downloading… ${Math.round(dl * 100)}%` : 'Download Gemini Nano'}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="banner err">
      {avail === 'unsupported'
        ? 'This Chrome has no built-in Prompt API. OneOf needs desktop Chrome (138 or later) with Gemini Nano.'
        : 'Gemini Nano can’t run on this computer (Chrome reports it unavailable: hardware, disk space or policy).'}
      {' '}Drafts are never sent anywhere else, so they won’t be checked. Requirements: <a href="https://developer.chrome.com/docs/ai/get-started" target="_blank" rel="noreferrer">Chrome built-in AI</a>.
    </div>
  );
}

