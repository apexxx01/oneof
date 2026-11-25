import { prefilter } from './prefilter';
import { BlockedError, extractFromPost, lookupBaseRate, type DataKind } from './ai';
import { cloudSafeAttribute } from './attribute';
import { buildDossier, rateKey } from './dossier';
import type { BaseRate, Fact, Post } from './types';
import type { RunLogEntry } from './replay';

export interface ScanProgress {
  total: number;
  considered: number;
  /** Posts with a life-detail cue; scanned first so the crowd estimate moves early. */
  fastPass: number;
  /** Empty or link-only posts that were never sent to a model. */
  empty?: number;
  /** Posts left unread because of a demo limit. */
  limited?: number;
  done: number;
  facts: Fact[];
  rejected: number;
  onDevice: number;
  inCloud: number;
  lastMs: number;
  /** Per-post record of the run; exported as a replay. */
  log: RunLogEntry[];
  current?: Post;
  /** Set while the scan pauses to let Gemini Nano recover after repeated timeouts. */
  cooling?: boolean;
  retried?: number;
  /** True while the tab is hidden and the scan is waiting for it to come back. */
  paused?: boolean;
}

/**
 * Which posts a scan reads, in what order. Empty and link-only posts are dropped; posts with a
 * life-detail cue go first. With a limit (the live cloud demo), the sample is spread evenly across
 * the whole timeline: the history is cut into `maxPosts` equal slices by date and each slice gives
 * one post, a cue post when it has one. Reading only the first N posts would show one year of a
 * six-year history and misrepresent how a dossier builds up.
 */
export function planScan(posts: Post[], maxPosts?: number): { considered: Post[]; fastPass: number; scannable: number } {
  const verdicts = posts.map((p) => ({ p, cue: prefilter(p.text) }));
  const scannable = verdicts.filter(({ cue }) => cue.reason !== 'too_short' && cue.reason !== 'link_only').map(({ p, cue }) => ({ p, cue: cue.keep }));
  let picked = scannable;
  if (maxPosts !== undefined && maxPosts < scannable.length) {
    const byDate = scannable.map((x, i) => ({ ...x, i })).sort((a, b) => (a.p.date < b.p.date ? -1 : a.p.date > b.p.date ? 1 : a.i - b.i));
    const n = Math.max(0, Math.floor(maxPosts));
    picked = [];
    for (let k = 0; k < n; k++) {
      const slice = byDate.slice(Math.floor((k * byDate.length) / n), Math.floor(((k + 1) * byDate.length) / n));
      if (slice.length) picked.push(slice.find((x) => x.cue) ?? slice[Math.floor(slice.length / 2)]);
    }
  }
  const fast = picked.filter((x) => x.cue).map((x) => x.p);
  const deep = picked.filter((x) => !x.cue).map((x) => x.p);
  return { considered: [...fast, ...deep], fastPass: fast.length, scannable: scannable.length };
}

/**
 * Scan posts one at a time (batch 1 measured best in spike S1).
 * The prefilter only orders the work: on held-out SynthPAI a keyword gate kept just 51% of
 * revealing comments, so it no longer excludes anything except empty and link-only posts.
 * Fast pass = posts with a cue, deep pass = everything else. Stopping early is always allowed.
 */
export async function scan(
  posts: Post[],
  data: DataKind,
  onUpdate: (p: ScanProgress) => void,
  signal?: AbortSignal,
  opts: { coolMs?: number; maxPosts?: number } = {},
): Promise<ScanProgress> {
  const { considered, fastPass, scannable } = planScan(posts, opts.maxPosts);
  const st: ScanProgress = { total: posts.length, considered: considered.length, fastPass, empty: posts.length - scannable, limited: scannable - considered.length, done: 0, facts: [], rejected: 0, onDevice: 0, inCloud: 0, lastMs: 0, log: [] };
  onUpdate({ ...st });
  // Gemini Nano slows down or stalls under long sustained load (seen live after ~100 prompts).
  // Two failures in a row trigger a cool-down; failed posts get one retry at the end.
  const COOL_MS = opts.coolMs ?? 20_000;
  const failed: Post[] = [];
  let streak = 0;
  const readOne = async (post: Post, retry: boolean) => {
    st.current = post;
    try {
      const r = await extractFromPost(post, data, 'extract', undefined, signal);
      st.facts.push(...r.facts);
      st.rejected += r.rejected;
      st.lastMs = r.ms;
      st.log.push({ postId: post.id, ms: Math.round(r.ms), source: r.source, facts: r.facts });
      if (r.source === 'on_device') st.onDevice++;
      else st.inCloud++;
      streak = 0;
      return true;
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      if (signal?.aborted) return false;
      if (!retry) failed.push(post);
      else st.log.push({ postId: post.id, ms: 0, source: 'error', facts: [] });
      streak++;
      return false;
    }
  };
  const coolDown = async () => {
    st.cooling = true; onUpdate({ ...st, facts: [...st.facts] });
    await new Promise<void>((res) => { const t = setTimeout(res, COOL_MS); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });
    st.cooling = false; streak = 0;
  };
  // Chrome pauses on-device AI in background tabs; wait for the tab to come back rather than
  // burning a 20 s timeout per post.
  const whileHidden = () => new Promise<void>((res) => {
    if (typeof document === 'undefined' || !document.hidden) return res();
    const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); res(); } };
    document.addEventListener('visibilitychange', on);
    signal?.addEventListener('abort', () => { document.removeEventListener('visibilitychange', on); res(); }, { once: true });
  });
  for (const post of considered) {
    if (signal?.aborted) break;
    { st.paused = typeof document !== 'undefined' && document.hidden; if (st.paused) onUpdate({ ...st, facts: [...st.facts] }); await whileHidden(); st.paused = false; }
    if (signal?.aborted) break;
    await readOne(post, false);
    st.done++;
    onUpdate({ ...st, facts: [...st.facts] });
    if (streak >= 2) await coolDown();
  }
  if (failed.length && !signal?.aborted) {
    st.retried = failed.length;
    await coolDown();
    for (const post of failed) {
      if (signal?.aborted) break;
      await readOne(post, true);
      onUpdate({ ...st, facts: [...st.facts] });
    }
  }
  st.current = undefined;
  onUpdate({ ...st });
  return st;
}

const CACHE_KEY = 'oneof.baserates.v1';

export function loadRateCache(): Map<string, BaseRate> {
  try {
    return new Map(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]'));
  } catch {
    return new Map();
  }
}

function saveRateCache(m: Map<string, BaseRate>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...m]));
  } catch {
    /* storage can be unavailable; the cache is a convenience */
  }
}

/**
 * Hybrid step: attributes with no bundled table (unresolved) or only a rough guess (grade C)
 * get a live, grounded base rate from the cloud, one generic attribute per request.
 * Offline, the bundled ranges stand (wider, amber).
 */
const LOOKUP_CATS = new Set(['occupation', 'employer_type', 'education', 'family', 'relationship', 'vehicle', 'pet', 'rare_hobby', 'language', 'age']);

export interface PlannedLookup { fact: Fact; attribute: string }

/**
 * Exactly what a base-rate refresh would send, one generic attribute per call. Values that look
 * like names, numbers or long phrases are filtered out by cloudSafeAttribute() and stay local.
 * For the user's own data the UI shows this list and asks before sending anything.
 */
export function plannedLookups(facts: Fact[]): PlannedLookup[] {
  const cache = loadRateCache();
  const d = buildDossier(facts, cache);
  const wanted: Fact[] = [
    ...d.unresolved.filter((f) => LOOKUP_CATS.has(f.cat)),
    ...d.attributes.filter((a) => a.rate.grade === 'C' && a.rate.origin === 'bundled').map((a) => a.facts[0]),
  ];
  const seen = new Set<string>();
  const out: PlannedLookup[] = [];
  for (const f of wanted) {
    const k = rateKey(f);
    if (seen.has(k) || cache.has(k)) continue;
    seen.add(k);
    const safe = cloudSafeAttribute(f);
    if (safe.ok) out.push({ fact: f, attribute: safe.attribute });
  }
  return out;
}

export async function refineRates(plan: PlannedLookup[], country: string, onUpdate: (rates: Map<string, BaseRate>) => void, data: DataKind = 'own') {
  const cache = loadRateCache();
  for (const { fact } of plan) {
    if (!navigator.onLine) break;
    const r = await lookupBaseRate(fact, country, data);
    if (r) {
      cache.set(rateKey(fact), r);
      saveRateCache(cache);
      onUpdate(new Map(cache));
    }
  }
  onUpdate(new Map(cache));
}
