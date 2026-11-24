import type { ReactNode } from 'react';
import { humanCount } from '../lib/estimate';
import type { CrowdEstimate, Grade } from '../lib/types';

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, [string, string]> = {
    on_device: ['ON DEVICE', 'b-device'],
    in_cloud: ['IN CLOUD', 'b-cloud'],
    blocked: ['BLOCKED', 'b-blocked'],
    error: ['ERROR', 'b-blocked'],
    bundled: ['BUNDLED', 'b-muted'],
    cloud: ['GROUNDED', 'b-cloud'],
    cache: ['CACHED', 'b-muted'],
  };
  const [label, cls] = map[source] ?? [source.toUpperCase(), 'b-muted'];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function GradeBadge({ grade }: { grade: Grade }) {
  const title = { A: 'Official table', B: 'Derived / reputable source', C: 'Rough estimate: widest range' }[grade];
  return <span className={`grade g-${grade}`} title={title}>{grade}</span>;
}

export const BAND_COPY: Record<CrowdEstimate['band'], { title: string; line: string }> = {
  crowd: { title: 'A crowd', line: 'More people than a stadium could hold.' },
  neighbourhood: { title: 'A neighbourhood', line: 'A few streets’ worth of people.' },
  room: { title: 'A room', line: 'Few enough to check one by one.' },
  handful: { title: 'A handful', line: 'Few enough to name.' },
};

export function Meter({ e, label, compact }: { e: CrowdEstimate; label?: ReactNode; compact?: boolean }) {
  // Position on a log scale from 1 to 100M.
  const pos = (n: number) => `${Math.min(100, Math.max(0, (Math.log10(n) / 8) * 100))}%`;
  return (
    <div className={`meter band-${e.band} ${compact ? 'compact' : ''}`}>
      {label && <div className="meter-label">{label}</div>}
      <div className="meter-num">
        <span className="one-of">one of</span> <span className="tilde">~</span>{humanCount(e.p50)}
      </div>
      <div className="meter-range mono">range {humanCount(e.p10)} – {humanCount(e.p90)} · {e.bits.toFixed(1)} bits given away</div>
      <div className="meter-track" aria-hidden>
        <div className="meter-band" style={{ left: pos(e.p10), width: `calc(${pos(e.p90)} - ${pos(e.p10)})` }} />
        <div className="meter-dot" style={{ left: pos(e.p50) }} />
        <div className="meter-ticks mono"><span>1</span><span>100</span><span>10k</span><span>1M</span><span>100M</span></div>
      </div>
      {!compact && <div className="meter-band-copy"><b>{BAND_COPY[e.band].title}.</b> {BAND_COPY[e.band].line}</div>}
    </div>
  );
}

export function Pct({ x }: { x: number }) {
  if (x >= 0.1) return <>{(x * 100).toFixed(0)}%</>;
  if (x >= 0.01) return <>{(x * 100).toFixed(1)}%</>;
  if (x >= 0.001) return <>{(x * 100).toFixed(2)}%</>;
  return <>1 in {humanCount(1 / x)}</>;
}
