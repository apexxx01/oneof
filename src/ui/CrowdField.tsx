import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CrowdEstimate } from '../lib/types';
import { FIELD_N, gridFor, litCount, litRank } from './crowd';

/**
 * The crowd field: 1600 square dots, each a slice of the crowd you could be. Lit dots are the
 * people you could still be; every counted detail darkens more of them, in a fixed order, so the
 * field thins as the crowd shrinks. Canvas, devicePixelRatio aware, redrawn on resize and theme
 * change. Thinning animates with requestAnimationFrame unless the user prefers reduced motion.
 *
 * `preview` is the crowd after a draft: dots lit now that the draft would darken are outlined in
 * the signal colour.
 */
export function CrowdField({ p50, base, band, preview, from, label, className = '' }: {
  p50: number;
  /** Adults in the starting population (all lit). See fieldBase(). */
  base: number;
  band: CrowdEstimate['band'];
  /** p50 if the draft is posted. */
  preview?: number | null;
  /** Lit count to animate from on first paint (e.g. FIELD_N on the home page). */
  from?: number;
  label?: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = litCount(p50, base);
  const after = preview != null ? Math.min(target, litCount(preview, base)) : target;
  const shown = useRef<number>(from ?? target);
  const state = useRef({ target, after, band });
  useLayoutEffect(() => { state.current = { target, after, band }; }, [target, after, band]);
  const draw = useRef<() => void>(() => undefined);

  // Painting: reads colours from CSS custom properties so both themes just work.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const rank = litRank();
    draw.current = () => {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (el.width !== W || el.height !== H) { el.width = W; el.height = H; }
      const css = getComputedStyle(el);
      const v = (n: string) => css.getPropertyValue(n).trim();
      const { band: b, after: aft, target: tgt } = state.current;
      const previewing = aft < tgt;
      const lit = b === 'crowd' ? v('--fg') : b === 'neighbourhood' ? v('--amber') : v('--signal');
      const off = v('--line'), sig = v('--signal');
      const { cols, rows } = gridFor(w, h);
      const cell = Math.min(W / cols, H / rows);
      const size = Math.max(1, Math.floor(cell * 0.62));
      const ox = Math.floor((W - cell * cols) / 2), oy = Math.floor((H - cell * rows) / 2);
      const n = Math.round(shown.current);
      ctx.clearRect(0, 0, W, H);
      const outline: Array<[number, number]> = [];
      for (let i = 0; i < FIELD_N; i++) {
        const x = Math.round(ox + (i % cols) * cell), y = Math.round(oy + Math.floor(i / cols) * cell);
        const r = rank[i];
        const pre = previewing && r < n && r >= aft;
        ctx.fillStyle = r < n && !pre ? lit : off;
        if (pre) outline.push([x, y]);
        ctx.fillRect(x, y, size, size);
      }
      if (outline.length) {
        const lw = Math.max(1, Math.round(size * 0.2));
        ctx.strokeStyle = sig;
        ctx.lineWidth = lw;
        for (const [x, y] of outline) ctx.strokeRect(x + lw / 2, y + lw / 2, size - lw, size - lw);
      }
    };
    draw.current();
    const ro = new ResizeObserver(() => draw.current());
    ro.observe(el);
    const mo = new MutationObserver(() => draw.current());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onScheme = () => draw.current();
    mq.addEventListener?.('change', onScheme);
    return () => { ro.disconnect(); mo.disconnect(); mq.removeEventListener?.('change', onScheme); };
  }, []);

  // Thinning: tween the lit count toward the target.
  useEffect(() => {
    const start = shown.current;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || start === target) { shown.current = target; draw.current(); return; }
    let raf = 0;
    const t0 = performance.now();
    // Longer for bigger jumps, in log space, so 1600 → 7 reads as a slow fade-out.
    const dur = Math.min(1800, 500 + 260 * Math.abs(Math.log2(Math.max(1, start) / Math.max(1, target))));
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      shown.current = Math.exp(Math.log(Math.max(1, start)) + (Math.log(Math.max(1, target)) - Math.log(Math.max(1, start))) * e);
      draw.current();
      if (k < 1) raf = requestAnimationFrame(step);
      else shown.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  useEffect(() => { draw.current(); }, [after, band]);

  const aria = label ?? `${target} of ${FIELD_N} dots lit${after < target ? `; this draft would leave ${after}` : ''}.`;
  return <canvas ref={canvas} className={`field ${className}`} role="img" aria-label={aria} data-lit={target} data-after={after} />;
}
