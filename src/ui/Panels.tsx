import { useEffect, useMemo, useRef, useState } from 'react';
import { liftFor, PACK } from '../data/baserates';
import { estimate, humanCount } from '../lib/estimate';
import { buildDossier, type Dossier } from '../lib/dossier';
import { BlockedError, blurDraft, extractFromPost } from '../lib/ai';
import { chromeVersion, type DraftRecording } from '../lib/replay';
import { subscribe, summary, type LedgerEntry } from '../lib/ledger';
import type { Attribute, BaseRate, CrowdEstimate, Fact, Post } from '../lib/types';
import { GradeBadge, Meter, Pct, SourceBadge } from './bits';
import { plural } from '../lib/text';

/** The formula, every factor with its source. Nothing hidden. */
/** Human label for a base-rate key, for the overlap note. */
function labelOf(key?: string) { return PACK.find((p) => p.key === key)?.label ?? key?.split(':')[1]?.replace(/_/g, ' ') ?? 'another fact'; }

export function Formula({ d, e }: { d: Dossier; e: CrowdEstimate }) {
  const adults = d.region.population * (d.region.adultShare ?? 1);
  const seen: string[] = [];
  return (
    <div className="formula">
      <div className="f-row f-head">
        <span>Adults in {d.region.label}</span>
        <span className="mono">{humanCount(adults)}</span>
        <GradeBadge grade={d.region.grade} />
        <span className="f-src">{d.region.url ? <a href={d.region.url} target="_blank" rel="noreferrer">{d.region.source}</a> : d.region.source}</span>
      </div>
      {d.attributes.map((a) => {
        const lift = liftFor(a.rate.key, seen);
        seen.push(a.rate.key);
        return (
          <div className="f-row" key={a.rate.key}>
            <span>× {a.rate.label}</span>
            <span className="mono"><Pct x={a.rate.low} /> – <Pct x={a.rate.high} />{lift.lift > 1 && <span className="lift" title={`Overlap with ${labelOf(lift.with)}: these often go together, so they narrow the crowd less than independent facts would`}> ×{lift.lift.toFixed(1)} overlap with {labelOf(lift.with)}</span>}</span>
            <GradeBadge grade={a.rate.grade} />
            <span className="f-src">
              {a.rate.url ? <a href={a.rate.url} target="_blank" rel="noreferrer">{a.rate.source}</a> : a.rate.source}
              {a.rate.origin === 'cloud' && <> <SourceBadge source="cloud" /></>}
            </span>
          </div>
        );
      })}
      <div className="f-row f-total">
        <span>= people who match all of this</span>
        <span className="mono">{humanCount(e.p10)} – {humanCount(e.p90)}</span>
        <span />
        <span className="f-src">P10–P90 of 4,000 draws. Weak evidence widens the range. Known overlaps (e.g. 88% of nurses are women) are corrected; unknown ones get a deliberately cautious allowance, which is an assumption, not a measurement. Only bundled tables and cloud lookups that return a source are counted. OneOf runs on Firebase’s free plan, where Google Search grounding isn’t available, so live lookups come back unsourced and are shown but never counted.</span>
      </div>
    </div>
  );
}

export function DossierList({ attrs, posts, onPick }: { attrs: Attribute[]; posts: Map<string, Post>; onPick?: (a: Attribute) => void }) {
  return (
    <ul className="dossier">
      {attrs.map((a) => (
        <li key={a.rate.key} onClick={() => onPick?.(a)}>
          <div className="d-top">
            <b>{a.rate.label}</b>
            <span className="mono d-frac"><Pct x={(a.rate.low + a.rate.high) / 2} /></span>
            <GradeBadge grade={a.rate.grade} />
          </div>
          {a.facts.slice(0, 2).map((f) => (
            <div className="d-quote" key={f.id}>
              <span className="mono d-date">{f.date.slice(0, 10)}</span> “…{highlight(posts.get(f.postId)?.text ?? f.quote, f.quote)}…” <SourceBadge source={f.source} />
            </div>
          ))}
          {a.facts.length > 2 && <div className="d-more">+{plural(a.facts.length - 2, 'more post')}</div>}
        </li>
      ))}
    </ul>
  );
}

function highlight(text: string, quote: string) {
  const i = text.toLowerCase().indexOf(quote.toLowerCase());
  if (i < 0) return quote;
  const s = Math.max(0, i - 30), e = Math.min(text.length, i + quote.length + 30);
  return <>{text.slice(s, i)}<mark>{text.slice(i, i + quote.length)}</mark>{text.slice(i + quote.length, e)}</>;
}

/** Live draft check: every sentence is read on-device as you type. */
/** Stable id for a sentence (two sentences with the same opening must not collide). */
function hashText(t: string) { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

export function Draft({ history, rates, before, placeholder, nano, recorded }: {
  history: Fact[]; rates: Map<string, BaseRate>; before: CrowdEstimate; placeholder?: string;
  /** Gemini Nano is ready in this browser. Drafts are never checked anywhere else. */
  nano: boolean;
  /** A real Nano run of the sample draft, played back when this browser has no Nano. */
  recorded?: DraftRecording;
}) {
  const [text, setText] = useState('');
  const [facts, setFacts] = useState<Map<string, Fact[]>>(new Map());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blur, setBlur] = useState<{ rewrite: string; removed: string[]; source: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const sentences = useMemo(() => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8), [text]);
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;

  // One extraction loop at a time: the SDK destroys the previous on-device session when a new
  // one starts, so overlapping loops would cancel each other. Facts live in a ref so a later
  // loop never overwrites an earlier one's results with a stale copy.
  const factsRef = useRef(facts);
  const msRef = useRef(new Map<string, number>());
  const playingRecording = !nano && !!recorded && text.trim() === recorded.text.trim();
  const running = useRef(false);
  const rerun = useRef(false);
  useEffect(() => {
    window.clearTimeout(timer.current);
    const go = async () => {
      if (!nano) return; // never sent anywhere else; the recorded sample is handled below
      if (running.current) { rerun.current = true; return; }
      running.current = true;
      setErr(null);
      try {
        for (;;) {
          rerun.current = false;
          const todo = sentencesRef.current.filter((x) => !factsRef.current.has(x));
          if (!todo.length) break;
          setBusy(true);
          for (const s of todo) {
            if (rerun.current) break;
            try {
              // Drafts are always the user's own words: ONLY_ON_DEVICE, whatever data the scan used.
              const r = await extractFromPost({ id: `draft:${hashText(s)}`, date: new Date().toISOString(), text: s }, 'own', 'draft');
              factsRef.current = new Map(factsRef.current).set(s, r.facts);
              msRef.current.set(s, Math.round(r.ms));
              setFacts(factsRef.current);
            } catch (e) {
              setErr(e instanceof BlockedError ? 'Drafts are checked on this device only, and this browser has no Gemini Nano. Open OneOf in desktop Chrome to check drafts.' : 'The on-device model is busy. Keep typing; it will catch up.');
              rerun.current = false;
              break;
            }
          }
          if (!rerun.current) break;
        }
      } finally {
        running.current = false;
        setBusy(false);
        // Lets a maintainer record the sample draft for browsers without Nano.
        (window as unknown as { __oneofDraft?: DraftRecording }).__oneofDraft = {
          text: sentencesRef.current.join(' '), recordedAt: new Date().toISOString(), userAgent: navigator.userAgent,
          sentences: sentencesRef.current.map((x) => ({ text: x, ms: msRef.current.get(x) ?? 0, facts: factsRef.current.get(x) ?? [] })),
        };
      }
    };
    timer.current = window.setTimeout(go, 650);
    return () => window.clearTimeout(timer.current);
  }, [sentences, nano]);

  const draftFacts = playingRecording
    ? recorded!.sentences.flatMap((x) => x.facts.map((f) => ({ ...f, postId: f.postId.startsWith('draft') ? f.postId : `draft:${f.postId}` })))
    : sentences.flatMap((s) => facts.get(s) ?? []);
  const d = buildDossier([...history, ...draftFacts], rates);
  const after = estimate(d.region, d.attributes);
  const draftAttrs = buildDossier(draftFacts, rates).attributes;
  const draftCounted = draftAttrs.reduce((n, a) => n + a.facts.length, 0);
  // Several facts can be one detail ("ICU nurse" and "nurse"), so say both counts when they differ.
  const draftSummary = draftFacts.length === draftAttrs.length
    ? plural(draftFacts.length, 'new detail')
    : `${plural(draftFacts.length, 'fact')} → ${plural(draftAttrs.length, 'detail')}`;
  const newKeys = new Set(draftAttrs.map((a) => a.rate.key));
  const combines = d.attributes.filter((a) => !newKeys.has(a.rate.key) && a.facts.some((f) => !f.postId.startsWith('draft'))).slice(0, 3);
  const worse = draftFacts.length > 0 && after.p50 < before.p50 * 0.8;

  return (
    <div className="draft">
      <div className="draft-edit">
        <textarea value={text} onChange={(e) => { setText(e.target.value); setBlur(null); }} placeholder="Write your next post here. OneOf checks it on this device before you share it." rows={4} />
        {placeholder && !playingRecording && text.trim() !== (recorded?.text ?? placeholder).trim() && <button className="ghost small" onClick={() => setText(recorded?.text ?? placeholder)}>{text ? 'Use the sample draft instead' : `Try a sample draft: “${(recorded?.text ?? placeholder).slice(0, 48)}…”`}</button>}
        {!nano && <p className="small muted">{playingRecording ? 'Blur needs Gemini Nano (desktop Chrome): drafts never leave this device.' : 'Live draft checks and Blur need Gemini Nano (desktop Chrome): drafts never leave this device.'}{recorded && !playingRecording ? ' The sample draft plays a recorded on-device result.' : ''}</p>}
        <div className="draft-status mono">
          {playingRecording
            ? `REPLAY · recorded on Gemini Nano in Chrome ${chromeVersion(recorded!.userAgent)} on ${recorded!.recordedAt.slice(0, 10)} · ${draftSummary}`
            : !nano
              ? (text.trim() ? 'not checked: drafts are read only on this device, and this browser has no Gemini Nano' : 'drafts are checked on this device only')
              : busy ? 'reading on-device…' : draftFacts.length ? `${draftSummary} in this draft` : text.trim() ? 'nothing identifying found' : 'nothing typed yet'}
          {err && nano && <span className="err"> · {err}</span>}
        </div>
        {draftFacts.length > 0 && (
          <div className="chips">
            {draftAttrs.map((a) => <span key={a.rate.key} className="chip new" title={a.facts.map((f) => f.value).join(', ')}>+ {a.rate.label} <SourceBadge source={a.facts[0].source} /></span>)}
            {draftFacts.length > draftCounted && <span className="chip dim" title="Found, but no cited base rate, so they don't narrow the crowd">+{draftFacts.length - draftCounted} not counted</span>}
          </div>
        )}
        {worse && (
          <div className="combines">
            Combines with your old posts:
            {combines.map((a) => <span key={a.rate.key} className="chip">{a.rate.label} · {a.firstSeen.slice(0, 4)}</span>)}
          </div>
        )}
        <div className="row">
          <button disabled={!text || busy || !nano} title={nano ? 'Rewrite on this device' : 'Needs Gemini Nano: drafts never leave this device'} onClick={async () => {
            try { setBlur(await blurDraft(text, 'own')); } catch (e) { setErr(e instanceof BlockedError ? 'Blur runs on this device only, and this browser has no Gemini Nano.' : (e as Error).message); }
          }}>Blur it (on-device)</button>
          {blur && <button className="ghost" onClick={() => { setText(blur.rewrite); setBlur(null); }}>Use rewrite</button>}
        </div>
        {blur && <div className="blur"><div className="mono small">REWRITE · <SourceBadge source={blur.source} /></div>{blur.rewrite}{blur.removed.length > 0 && <div className="small">removed: {blur.removed.join(', ')}</div>}</div>}
      </div>
      <div className="draft-meter">
        <Meter e={before} compact label="Before this draft" />
        <div className="arrow">→</div>
        {!nano && !playingRecording && text.trim()
          ? <div className="not-checked"><div className="eyebrow mono">If you post it</div><p className="mono">not checked</p><p className="small muted">This draft wasn’t read: no Gemini Nano in this browser, and drafts never leave the device.</p></div>
          : <Meter e={draftFacts.length ? after : before} compact label="If you post it" />}
      </div>
    </div>
  );
}

/** Exactly what left the device, and every call's receipt. */
export function Ledger({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  useEffect(() => subscribe(setEntries), []);
  const s = summary(entries);
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), summary: s, entries }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `oneof-receipts-${Date.now()}.json`;
    a.click();
  };
  return (
    <aside className={`ledger ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="ledger-head">
        <h3>What the cloud saw</h3>
        <button className="ghost" onClick={onClose}>Close (Esc)</button>
      </div>
      <div className="ledger-sum mono">
        <div><b>{s.onDevice}</b> {s.onDevice === 1 ? 'call' : 'calls'} on device{s.replayed ? ` (${s.replayed} from a recorded run)` : ''}</div>
        <div><b>{s.cloud}</b> {s.cloud === 1 ? 'call' : 'calls'} to the cloud</div>
        <div><b>{s.ownPostBytesOut}</b> bytes of your posts sent</div>
        <div><b>{s.demoPostBytesOut}</b> bytes of demo posts sent <span className="muted">(synthetic persona)</span></div>
        <div><b>{s.attrBytesOut}</b> bytes of generic attributes sent</div>
        {s.stopped > 0 && <div><b>{s.stopped}</b> {s.stopped === 1 ? 'call' : 'calls'} stopped by you</div>}
      </div>
      {!entries.length && <p className="small muted">Every model call will appear here: where it ran, why, and the exact text that left this device (if any).</p>}
      <button onClick={exportJson} disabled={!entries.length}>Export receipts.json</button>
      <ol className="ledger-list">
        {[...entries].reverse().map((e) => (
          <li key={e.id} className={e.decoy ? 'decoy' : ''}>
            <div className="l-top mono">
              <SourceBadge source={e.source} /> {e.task}{e.replay && <span className="replay-tag"> · replay</span>}{e.data === 'synthetic' && <span className="data-tag"> · demo data</span>} · {e.mode} · {Math.round(e.ms)} ms{e.model ? ` · ${e.model}` : ''}
            </div>
            <div className="l-reason small muted">{e.reason}</div>
            {e.sentToCloud ? (
              <>
                {e.source === 'error' && <div className="small warn-text">Sent, then the call failed:</div>}
                {e.source === 'stopped' && <div className="small muted">Sent, then you stopped it:</div>}
                <pre className="payload">{e.sentToCloud}</pre>
              </>
            ) : <div className="small muted">Nothing left the device.</div>}
            {e.error && <div className={`small ${e.source === 'stopped' ? 'muted' : 'err'}`}>{e.error}</div>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
