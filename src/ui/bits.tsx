import { useEffect, useRef, useState, type ReactNode } from 'react';
import { humanCount } from '../lib/estimate';
import type { CrowdEstimate, Grade } from '../lib/types';

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, [string, string]> = {
    on_device: ['ON DEVICE', 'b-device'],
    in_cloud: ['IN CLOUD', 'b-cloud'],
    blocked: ['BLOCKED', 'b-blocked'],
    error: ['ERROR', 'b-blocked'],
    stopped: ['STOPPED', 'b-muted'],
    bundled: ['BUNDLED', 'b-muted'],
    cloud: ['GROUNDED', 'b-cloud'],
    cache: ['CACHED', 'b-muted'],
    replay: ['REPLAY', 'b-amber'],
  };
  const [label, cls] = map[source] ?? [source.toUpperCase(), 'b-muted'];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function GradeBadge({ grade }: { grade: Grade }) {
  const title = { A: 'Grade A: official table', B: 'Grade B: derived or reputable source', C: 'Grade C: rough estimate, widest range' }[grade];
  return <span className={`grade g-${grade}`} title={title} aria-label={title}>{grade}</span>;
}

export const BAND_COPY: Record<CrowdEstimate['band'], { title: string; line: string }> = {
  crowd: { title: 'A crowd', line: 'More people than a stadium could hold.' },
  neighbourhood: { title: 'A neighbourhood', line: 'A few streets’ worth of people.' },
  room: { title: 'A room', line: 'Few enough to check one by one.' },
  handful: { title: 'A handful', line: 'Few enough to name.' },
};

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A crowd count that ticks to its new value (log-space tween); jumps under reduced motion. */
export function Num({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    const from = cur.current;
    if (reduced() || from === value || typeof requestAnimationFrame === 'undefined') { cur.current = value; setShown(value); return; }
    let raf = 0;
    const t0 = performance.now(), dur = 700;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
      cur.current = Math.exp(Math.log(Math.max(1, from)) + (Math.log(Math.max(1, value)) - Math.log(Math.max(1, from))) * e);
      setShown(k < 1 ? cur.current : value);
      if (k < 1) raf = requestAnimationFrame(step); else cur.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{humanCount(shown)}</>;
}

/** Position on the meter's log scale, 1 to 100M. */
const pos = (n: number) => `${Math.min(100, Math.max(0, (Math.log10(Math.max(1, n)) / 8) * 100))}%`;

/** The P10–P90 bar: 1 to 100M on a log scale, a band-coloured range, a square P50 marker. */
export function Scale({ e }: { e: CrowdEstimate }) {
  return (
    <div className="scale" aria-hidden>
      <div className="scale-bar">
        <div className="scale-range" style={{ left: pos(e.p10), width: `calc(${pos(e.p90)} - ${pos(e.p10)})` }} />
        <div className="scale-mark" style={{ left: pos(e.p50) }} />
      </div>
      <div className="scale-ticks"><span>1</span><span>100</span><span>10k</span><span>1M</span><span>100M</span></div>
    </div>
  );
}

/**
 * The crowd numeral: "one of ~50", its P10–P90 range, the bits given away, the upper-bound tag,
 * and (unless compact) the meter and the band's one-line meaning.
 */
export function Meter({ e, label, compact, scale = !compact }: { e: CrowdEstimate; label?: ReactNode; compact?: boolean; scale?: boolean }) {
  return (
    <div className={`meter band-${e.band} ${compact ? 'compact' : ''}`}>
      {label && <div className="lbl meter-label">{label}</div>}
      <div className="meter-num" aria-label={`one of about ${humanCount(e.p50)}`}>
        <span className="one-of">one of</span>
        <span className="num"><span className="tilde">~</span><Num value={e.p50} /></span>
      </div>
      <div className="meter-cells">
        <span>range {humanCount(e.p10)}–{humanCount(e.p90)}</span>
        <span>{e.bits.toFixed(1)} bits given away</span>
        <span className="ub" title="OneOf can miss details an attacker would still find, so the real crowd is probably smaller.">upper bound</span>
      </div>
      {scale && <Scale e={e} />}
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

/** Theme: dark by default, light on request or when the system prefers it; the choice persists. */
export type Theme = 'dark' | 'light';
const THEME_KEY = 'oneof.theme';
export function storedTheme(): Theme | null {
  try { const t = localStorage.getItem(THEME_KEY); return t === 'dark' || t === 'light' ? t : null; } catch { return null; }
}
export function currentTheme(): Theme {
  return storedTheme() ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}
export function applyTheme(t: Theme | null) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [t, setT] = useState<Theme>(currentTheme);
  const next: Theme = t === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className={`theme-btn ${className}`} aria-label={`Switch to the ${next} theme`} title={`Switch to the ${next} theme`} onClick={() => {
      setT(next);
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable: the choice lasts this visit */ }
    }}>
      <span className="theme-ico" aria-hidden /><span className="lbl">{t === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
