import { useMemo, useState } from 'react';
import { DEFAULT_REGION } from '../data/baserates';
import type { Dossier } from '../lib/dossier';
import { estimate, humanCount } from '../lib/estimate';
import { plural } from '../lib/text';
import type { Attribute, Post } from '../lib/types';
import { CrowdField } from './CrowdField';

/**
 * "Rejoin the crowd", interactive: every post that carries a counted detail gets a switch. Turning
 * posts off re-runs the same estimator without the details only those posts carry, and the crowd
 * field relights. Pure code on this device; nothing is edited anywhere.
 */
export function Rejoin({ d, posts, fix, base }: { d: Dossier; posts: Map<string, Post>; fix: Attribute[]; base: number }) {
  const rows = useMemo(() => {
    const byPost = new Map<string, { post?: Post; postId: string; date: string; labels: string[] }>();
    const add = (postId: string, date: string, label: string) => {
      const r = byPost.get(postId) ?? { post: posts.get(postId), postId, date, labels: [] };
      if (!r.labels.includes(label)) r.labels.push(label);
      byPost.set(postId, r);
    };
    for (const a of d.attributes) for (const f of a.facts) add(f.postId, f.date, a.rate.label);
    for (const f of d.regionFacts) add(f.postId, f.date, d.region.label);
    return [...byPost.values()].sort((x, y) => x.date.localeCompare(y.date));
  }, [d, posts]);
  const suggested = useMemo(() => new Set(fix.flatMap((a) => a.facts.map((f) => f.postId))), [fix]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const after = useMemo(() => {
    const attrs = d.attributes.filter((a) => a.facts.some((f) => !off.has(f.postId)));
    const regionKept = d.regionFacts.length === 0 || d.regionFacts.some((f) => !off.has(f.postId));
    return estimate(regionKept ? d.region : DEFAULT_REGION, attrs);
  }, [d, off]);
  const now = useMemo(() => estimate(d.region, d.attributes), [d]);
  if (!rows.length) return <p className="rejoin">You’re already hiding in a crowd of 1,000+.</p>;
  const toggle = (id: string) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="rj">
      <div className="rj-out" aria-live="polite">
        <div>
          <span className="lbl mut">{off.size ? `With ${plural(off.size, 'post')} edited` : 'As posted'}</span>
          <b className={`rj-num band-${after.band}`}>~{humanCount(after.p50)}</b>
          <span className="lbl mut">{off.size ? `was ~${humanCount(now.p50)}` : 'turn posts off to see the crowd come back'}</span>
        </div>
        <div className="field-box rj-field"><CrowdField p50={after.p50} base={base} band={after.band} /></div>
      </div>
      <div className="row">
        <button type="button" className="ghost" onClick={() => setOff(new Set(suggested))} disabled={!suggested.size}>Apply the smallest fix ({plural(suggested.size, 'post')})</button>
        {off.size > 0 && <button type="button" className="link" onClick={() => setOff(new Set())}>Reset</button>}
      </div>
      <ul className="rj-list">
        {rows.map((r) => {
          const isOff = off.has(r.postId);
          return (
            <li key={r.postId} className={isOff ? 'off' : ''}>
              <label>
                <input type="checkbox" checked={!isOff} onChange={() => toggle(r.postId)} aria-label={`Keep the ${r.date.slice(0, 10)} post`} />
                <span className="mono small">{r.date.slice(0, 10)}</span>
                <span className="rj-text">“{(r.post?.text ?? '').slice(0, 110)}{(r.post?.text.length ?? 0) > 110 ? '…' : ''}”</span>
                <span className="rj-tags">{r.labels.map((l) => <span key={l} className="chip on">{l}</span>)}{suggested.has(r.postId) && <span className="lbl sig">suggested</span>}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="small mut">This only recalculates here. To actually rejoin the crowd, edit or delete those posts where you wrote them.</p>
    </div>
  );
}
