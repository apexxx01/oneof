import { prefilter } from './prefilter';
import { BlockedError, extractFromPost, lookupBaseRate, type DataKind } from './ai';
import { buildDossier, rateKey } from './dossier';
import type { BaseRate, Fact, Post } from './types';
import type { RunLogEntry } from './replay';

export interface ScanProgress {
  total: number;
  considered: number;
  /** Posts with a life-detail cue; scanned first so the crowd estimate moves early. */
  fastPass: number;
  done: number;
  facts: Fact[];
  rejected: number;
  onDevice: number;
  inCloud: number;
  lastMs: number;
  /** Per-post record of the run; exported as a replay. */
  log: RunLogEntry[];
  current?: Post;
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
): Promise<ScanProgress> {
  const verdicts = posts.map((p) => ({ p, v: prefilter(p.text) }));
  const scannable = verdicts.filter(({ v }) => v.reason !== 'too_short' && v.reason !== 'link_only');
  const fast = scannable.filter(({ v }) => v.keep).map(({ p }) => p);
  const deep = scannable.filter(({ v }) => !v.keep).map(({ p }) => p);
  const considered = [...fast, ...deep];
  const st: ScanProgress = { total: posts.length, considered: considered.length, fastPass: fast.length, done: 0, facts: [], rejected: 0, onDevice: 0, inCloud: 0, lastMs: 0, log: [] };
  onUpdate({ ...st });
  for (const post of considered) {
    if (signal?.aborted) break;
    st.current = post;
    try {
      const r = await extractFromPost(post, data);
      st.facts.push(...r.facts);
      st.rejected += r.rejected;
      st.lastMs = r.ms;
      st.log.push({ postId: post.id, ms: Math.round(r.ms), source: r.source, facts: r.facts });
      if (r.source === 'on_device') st.onDevice++;
      else st.inCloud++;
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      st.log.push({ postId: post.id, ms: 0, source: 'error', facts: [] });
      // A single failed call shouldn't kill a 10-minute scan.
    }
    st.done++;
    onUpdate({ ...st, facts: [...st.facts] });
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
export async function refineRates(facts: Fact[], country: string, onUpdate: (rates: Map<string, BaseRate>) => void) {
  const cache = loadRateCache();
  const d = buildDossier(facts, cache);
  const LOOKUP_CATS = new Set(['occupation', 'employer_type', 'education', 'family', 'relationship', 'vehicle', 'pet', 'rare_hobby', 'language', 'age']);
  const wanted: Fact[] = [
    ...d.unresolved.filter((f) => LOOKUP_CATS.has(f.cat)),
    ...d.attributes.filter((a) => a.rate.grade === 'C' && a.rate.origin === 'bundled').map((a) => a.facts[0]),
  ];
  const seen = new Set<string>();
  for (const f of wanted) {
    const k = rateKey(f);
    if (seen.has(k) || cache.has(k)) continue;
    seen.add(k);
    if (!navigator.onLine) break;
    const r = await lookupBaseRate(f, country);
    if (r) {
      cache.set(k, r);
      saveRateCache(cache);
      onUpdate(new Map(cache));
    }
  }
  onUpdate(new Map(cache));
}
