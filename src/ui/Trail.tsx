import { useEffect, useMemo, useRef, useState } from 'react';
import { humanCount } from '../lib/estimate';
import type { TrailPoint } from '../lib/dossier';

/** The crumb trail: crowd size over years of posting, log scale, with the moment you left the crowd. */
export function Trail({ points, left, threshold = 100, span }: { points: TrailPoint[]; left?: TrailPoint; threshold?: number; span?: [string, string] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real width so text stays readable on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = width, H = width < 500 ? 220 : 260, P = { l: 48, r: 12, t: 16, b: 30 };
  const geo = useMemo(() => {
    if (!points.length) return null;
    // The x-axis covers the whole posting history, not just the dates facts appeared.
    const t0 = Math.min(new Date(points[0].date).getTime(), span ? new Date(span[0]).getTime() : Infinity);
    const t1 = Math.max(t0 + 86400000, new Date(points[points.length - 1].date).getTime(), span ? new Date(span[1]).getTime() : 0);
    const x = (d: string) => P.l + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - P.l - P.r);
    const y = (k: number) => P.t + (1 - Math.log10(Math.max(1, k)) / 9) * (H - P.t - P.b);
    return { x, y, t0, t1 };
  }, [points, span, W, H]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!geo || !points.length) return <div className="empty">The trail appears once facts are found.</div>;
  const { x, y } = geo;
  let d50 = `M ${P.l} ${y(points[0].estimate.p50 * 1.0)}`;
  let band = '';
  const top: string[] = [], bot: string[] = [];
  points.forEach((p, i) => {
    const xi = x(p.date);
    if (i > 0) d50 += ` H ${xi}`;
    d50 += ` V ${y(p.estimate.p50)}`;
    top.push(`${xi},${y(p.estimate.p90)}`);
    bot.unshift(`${xi},${y(p.estimate.p10)}`);
  });
  d50 += ` H ${W - P.r}`;
  band = [...top, `${W - P.r},${y(points[points.length - 1].estimate.p90)}`, `${W - P.r},${y(points[points.length - 1].estimate.p10)}`, ...bot].join(' ');
  const y0 = new Date(geo.t0).getUTCFullYear(), y1 = new Date(geo.t1).getUTCFullYear();
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => String(y0 + i)).filter((yr) => {
    const xx = x(`${yr}-07-01`); return xx > P.l + 10 && xx < W - P.r - 10;
  }).filter((_, i, a) => W >= 500 || a.length <= 4 || i % 2 === 0);
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="trail" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Crowd size over time">
        {[1, 2, 4, 6, 8].map((e) => (
          <g key={e}>
            <line x1={P.l} x2={W - P.r} y1={y(10 ** e)} y2={y(10 ** e)} className="grid" />
            <text x={P.l - 8} y={y(10 ** e) + 4} className="axis" textAnchor="end">{humanCount(10 ** e)}</text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(threshold)} y2={y(threshold)} className="threshold" />
        <text x={W - P.r} y={y(threshold) - 6} className="axis warn" textAnchor="end">a room ({threshold})</text>
        <polygon points={band} className="trail-band" />
        <path d={d50} className="trail-line" />
        {years.map((yr) => (
          <text key={yr} x={x(`${yr}-07-01`)} y={H - 10} className="axis" textAnchor="middle">{yr}</text>
        ))}
        {left && (
          <g>
            <line x1={x(left.date)} x2={x(left.date)} y1={P.t} y2={H - P.b} className="left-line" />
            <text x={x(left.date) + (x(left.date) > W - 160 ? -6 : 6)} y={P.t + 12} className="axis danger" textAnchor={x(left.date) > W - 160 ? 'end' : 'start'}>
              {W < 500 ? 'left the crowd' : `you left the crowd · ${left.date.slice(0, 10)}`}
            </text>
          </g>
        )}
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)} style={{ cursor: 'pointer' }}>
            {/* Larger invisible target for fingers. */}
            <circle cx={x(p.date)} cy={y(p.estimate.p50)} r={14} fill="transparent" />
            <circle cx={x(p.date)} cy={y(p.estimate.p50)} r={hover === i ? 6 : 4} className="trail-pt" />
          </g>
        ))}
      </svg>
      <div className="trail-caption mono">
        {h ? <>{h.date.slice(0, 10)} · + {h.added[0]} → one of ~{humanCount(h.estimate.p50)}</> : 'Hover or tap a crumb to see what each post added.'}
      </div>
    </div>
  );
}
