import { useEffect, useMemo, useRef, useState } from 'react';
import { liftFor, PACK } from '../data/baserates';
import { estimate, humanCount } from '../lib/estimate';
import { buildDossier, type Dossier } from '../lib/dossier';
import { BlockedError, blurDraft, extractFromPost } from '../lib/ai';
import { chromeVersion, type DraftRecording } from '../lib/replay';
import { subscribe, summary, type LedgerEntry } from '../lib/ledger';
import type { Attribute, BaseRate, CrowdEstimate, Fact, Post } from '../lib/types';
import { GradeBadge, Meter, Pct, SourceBadge } from './bits';
import { CrowdField } from './CrowdField';
import { plural } from '../lib/text';

/** Human label for a base-rate key, for the overlap note. */
function labelOf(key?: string) { return PACK.find((p) => p.key === key)?.label ?? key?.split(':')[1]?.replace(/_/g, ' ') ?? 'another fact'; }

/** The formula as a receipt: every factor, its range, its grade and its source. Nothing hidden. */
export function Formula({ d, e }: { d: Dossier; e: CrowdEstimate }) {
  const adults = d.region.population * (d.region.adultShare ?? 1);
  const seen: string[] = [];
  return (
    <div className="receipt">
      <table>
        <thead><tr><th>Factor</th><th>Share</th><th>Grade</th><th>Source</th></tr></thead>
        <tbody>
          <tr>
            <td>Adults in {d.region.label}</td>
            <td className="v">{humanCount(adults)}</td>
            <td><GradeBadge grade={d.region.grade} /></td>
            <td className="src">{d.region.url ? <a href={d.region.url} target="_blank" rel="noreferrer">{d.region.source}</a> : d.region.source}</td>
          </tr>
          {d.attributes.map((a) => {
            const lift = liftFor(a.rate.key, seen);
            seen.push(a.rate.key);
            return (
              <tr key={a.rate.key}>
                <td><span className="op">×</span>{a.rate.label}</td>
                <td className="v"><Pct x={a.rate.low} />–<Pct x={a.rate.high} />{lift.lift > 1 && <span className="lift" title={`Overlap with ${labelOf(lift.with)}: these often go together, so they narrow the crowd less than independent facts would`}>×{lift.lift.toFixed(1)} overlap with {labelOf(lift.with)}</span>}</td>
                <td><GradeBadge grade={a.rate.grade} /></td>
                <td className="src">
                  {a.rate.url ? <a href={a.rate.url} target="_blank" rel="noreferrer">{a.rate.source}</a> : a.rate.source}
                  {a.rate.origin === 'cloud' && <> <SourceBadge source="cloud" /></>}
                </td>
              </tr>
            );
          })}
          <tr className="total">
            <td><span className="op">=</span>People who match all of this</td>
            <td className="v"><span className="tot">{humanCount(e.p10)}–{humanCount(e.p90)}</span></td>
            <td />
            <td className="src">P10–P90 of 4,000 draws. Weak evidence widens the range. Known overlaps (e.g. 88% of nurses are women) are corrected; unknown ones get a deliberately cautious allowance, which is an assumption, not a measurement. Only bundled tables and cloud lookups that return a source are counted. OneOf runs on Firebase’s free plan, where Google Search grounding isn’t available, so live lookups come back unsourced and are shown but never counted.</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const CAT: Record<string, string> = {
  home_location: 'Lives in', work_location: 'Works in', occupation: 'Job', employer_type: 'Employer', education: 'Education',
  age: 'Age', gender: 'Gender', family: 'Family', relationship: 'Relationship', vehicle: 'Vehicle', pet: 'Pet',
  health: 'Health', religion_community: 'Community', language: 'Language', dated_event: 'Event', rare_hobby: 'Hobby', other: 'Other',
};

export function DossierList({ attrs, posts, onPick }: { attrs: Attribute[]; posts: Map<string, Post>; onPick?: (a: Attribute) => void }) {
  return (
    <ul className="dossier">
      {attrs.map((a) => (
        <li key={a.rate.key} onClick={() => onPick?.(a)}>
          <span className="d-cat">{CAT[a.rate.cat] ?? a.rate.cat}{a.facts.length > 1 ? ` ×${a.facts.length}` : ''}</span>
          <div className="d-top">
            <b>{a.rate.label}</b>
            <span className="d-frac"><Pct x={(a.rate.low + a.rate.high) / 2} /></span>
            <GradeBadge grade={a.rate.grade} />
          </div>
          {a.facts.slice(0, 2).map((f) => (
            <div className="d-quote" key={f.id}>
              <span className="d-date">{f.date.slice(0, 10)}</span>“…{highlight(posts.get(f.postId)?.text ?? f.quote, f.quote)}…” <SourceBadge source={f.source} />
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

export function Draft({ history, rates, before, base, placeholder, nano, recorded }: {
  history: Fact[]; rates: Map<string, BaseRate>; before: CrowdEstimate; placeholder?: string;
  /** Adults the crowd field starts from (fieldBase of the history's region). */
  base: number;
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

  const sample = recorded?.text ?? placeholder;
  const showAfter = nano || playingRecording || !text.trim();
  const shown = draftFacts.length ? after : before;
  return (
    <div className="draft">
      <textarea value={text} onChange={(e) => { setText(e.target.value); setBlur(null); }} placeholder="Write your next post here. OneOf checks it on this device before you share it." rows={4} aria-label="Your next post" />
      {sample && !playingRecording && text.trim() !== sample.trim() && <button className="link sample" onClick={() => setText(sample)}>{text ? 'Use the sample draft instead' : `Try a sample draft: “${sample.slice(0, 48)}…”`}</button>}
      <div className="draft-status" role="status">
        {playingRecording
          ? <><span className="tagx">REPLAY</span>Recorded on Gemini Nano in Chrome {chromeVersion(recorded!.userAgent)} on {recorded!.recordedAt.slice(0, 10)}. {draftSummary}</>
          : !nano
            ? (text.trim() ? 'Not checked: drafts are read only on this device, and this browser has no Gemini Nano' : 'Drafts are checked on this device only')
            : busy ? 'Reading on-device' : draftFacts.length ? `${draftSummary} in this draft` : text.trim() ? 'Nothing identifying found' : 'Nothing typed yet'}
        {err && nano && <span className="err"> {err}</span>}
      </div>
      {draftFacts.length > 0 && (
        <div className="chips">
          {draftAttrs.map((a) => <span key={a.rate.key} className="chip on new" title={a.facts.map((f) => f.value).join(', ')}>+ {a.rate.label} <SourceBadge source={a.facts[0].source} /></span>)}
          {draftFacts.length > draftCounted && <span className="chip dim" title="Found, but no cited base rate, so they don't narrow the crowd">+{draftFacts.length - draftCounted} not counted</span>}
        </div>
      )}
      <div className="draft-out">
        <figure className="field-fig draft-field">
          <div className="field-box"><CrowdField p50={before.p50} base={base} band={before.band} preview={showAfter && draftFacts.length ? after.p50 : null} /></div>
          <figcaption><span><i className="key lit" />lit now</span><span><i className="key pre" />darkened if you post it</span></figcaption>
        </figure>
        <div className="draft-nums">
          <Meter e={before} compact scale={false} label="Before this draft" />
          {!showAfter
            ? <div className="not-checked"><div className="lbl mut">If you post it</div><div className="num">not checked</div><p className="small mut">This draft wasn’t read: no Gemini Nano in this browser, and drafts never leave the device.</p></div>
            : <Meter e={shown} compact scale={false} label="If you post it" />}
        </div>
      </div>
      {worse && combines.length > 0 && (
        <div className="combines">
          <span className="lbl">Combines with your old posts</span>
          <div className="chips">{combines.map((a) => <span key={a.rate.key} className="chip">{a.rate.label} <span className="cat">{a.firstSeen.slice(0, 4)}</span></span>)}</div>
        </div>
      )}
      {!nano && <p className="small mut">{playingRecording ? 'Blur needs Gemini Nano (desktop Chrome): drafts never leave this device.' : 'Live draft checks and Blur need Gemini Nano (desktop Chrome): drafts never leave this device.'}{recorded && !playingRecording ? ' The sample draft plays a recorded on-device result.' : ''}</p>}
      <div className="row">
        <button className="ghost" disabled={!text || busy || !nano} title={nano ? 'Rewrite on this device' : 'Needs Gemini Nano: drafts never leave this device'} onClick={async () => {
          try { setBlur(await blurDraft(text, 'own')); } catch (e) { setErr(e instanceof BlockedError ? 'Blur runs on this device only, and this browser has no Gemini Nano.' : (e as Error).message); }
        }}>Blur it on this device</button>
        {blur && <button className="primary" onClick={() => { setText(blur.rewrite); setBlur(null); }}>Use the rewrite</button>}
      </div>
      {blur && <div className="blur"><div className="lbl">Rewrite <SourceBadge source={blur.source} /></div>{blur.rewrite}{blur.removed.length > 0 && <div className="small mut">Removed: {blur.removed.join(', ')}</div>}</div>}
    </div>
  );
}

/** Exactly what left the device, and every call's receipt. */
export function Ledger({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  useEffect(() => subscribe(setEntries), []);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
  const s = summary(entries);
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), summary: s, entries }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `oneof-receipts-${Date.now()}.json`;
    a.click();
  };
  const line = (label: string, v: number | string) => <div className="row2"><span>{label}</span><span className="dots" /><b>{v}</b></div>;
  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <aside className={`ledger ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="What the cloud saw">
        <div className="ledger-head">
          <h3>What the cloud saw</h3>
          <button ref={closeRef} className="ghost" onClick={onClose}>Close</button>
        </div>
        <div className="slip">
          {line(`Calls on device${s.replayed ? ` (${s.replayed} recorded)` : ''}`, s.onDevice)}
          {line('Calls to the cloud', s.cloud)}
          {line('Demo posts sent (synthetic persona)', `${s.demoPostBytesOut} B`)}
          {line('Generic attributes sent', `${s.attrBytesOut} B`)}
          {s.stopped > 0 && line('Calls stopped by you', s.stopped)}
          <div className="totals">
            <div><span className="lbl mut">Your posts sent</span><span className={`tbig ${s.ownPostBytesOut ? 'nz' : ''}`}>{s.ownPostBytesOut} B</span></div>
            <div><span className="lbl mut">Calls on device</span><span className="tbig fg">{s.onDevice}</span></div>
          </div>
        </div>
        <div className="ledger-body">
          {!entries.length && <p className="empty">Every model call will appear here: where it ran, why, and the exact text that left this device (if any).</p>}
          <button className="ghost" onClick={exportJson} disabled={!entries.length}>Export receipts.json</button>
          <ol className="ledger-list">
            {[...entries].reverse().map((e) => (
              <li key={e.id} className={e.decoy ? 'decoy' : ''}>
                <div className="l-top">
                  <SourceBadge source={e.source} />{e.replay && <SourceBadge source="replay" />}<span>{e.task}</span>{e.data === 'synthetic' && <span>demo data</span>}<span>{e.mode}</span><span>{Math.round(e.ms)} ms</span>{e.model && <span>{e.model}</span>}
                </div>
                <div className="l-reason">{e.reason}</div>
                {e.sentToCloud ? (
                  <>
                    {e.source === 'error' && <div className="small warn-text">Sent, then the call failed:</div>}
                    {e.source === 'stopped' && <div className="small mut">Sent, then you stopped it:</div>}
                    <pre className="payload">{e.sentToCloud}</pre>
                  </>
                ) : <div className="small mut">Nothing left the device.</div>}
                {e.error && <div className={`small ${e.source === 'stopped' ? 'mut' : 'err'}`}>{e.error}</div>}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </>
  );
}
