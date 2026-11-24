import { DEFAULT_REGION, LOCAL_ONLY_CATS, matchPack, matchRegion, REGIONS } from '../data/baserates';
import { estimate } from './estimate';
import type { Attribute, BaseRate, CrowdEstimate, Fact, Region } from './types';

const LOCATION_CATS = new Set(['home_location', 'work_location']);
export const NOT_IDENTIFYING = 0.15;

export interface Dossier {
  region: Region;
  regionFacts: Fact[];
  attributes: Attribute[];
  /** Facts with no bundled base rate yet: candidates for a cloud lookup. */
  unresolved: Fact[];
  /** Facts that stay on this device entirely (sensitive categories). */
  localOnly: Fact[];
}

/**
 * Turns verified facts into a dossier. `extraRates` holds base rates fetched from the
 * cloud or cache, keyed by `${cat}:${normalized value}`.
 */
export function buildDossier(facts: Fact[], extraRates: Map<string, BaseRate> = new Map()): Dossier {
  // 1. Region: the smallest-population place the facts mention.
  let region: Region = DEFAULT_REGION;
  const regionFacts: Fact[] = [];
  for (const f of facts) {
    if (!LOCATION_CATS.has(f.cat)) continue;
    const r = matchRegion(`${f.value} ${f.quote}`);
    if (!r) continue;
    regionFacts.push(f);
    if (r.population < region.population) region = r;
  }
  // Mentioning a district implies its state; keep the region facts that support the chosen region.
  const regionLabel = REGIONS.find((r) => r.key === region.key);

  // 2. Attributes.
  const byKey = new Map<string, Attribute>();
  const unresolved: Fact[] = [];
  const localOnly: Fact[] = [];
  for (const f of facts) {
    if (LOCAL_ONLY_CATS.has(f.cat)) { localOnly.push(f); continue; }
    if (f.cat === 'other') continue;
    if (LOCATION_CATS.has(f.cat) && matchRegion(`${f.value} ${f.quote}`)) continue;
    const pack = matchPack(f.cat, f.value, f.quote);
    const live = extraRates.get(rateKey(f));
    let rate: BaseRate | undefined;
    if (pack) {
      const { aliases: _a, ...p } = pack;
      void _a;
      // A live, grounded number beats a rough bundled guess (grade C); official tables stay.
      rate = live && pack.grade === 'C'
        ? { ...p, low: live.low, high: live.high, grade: live.grade, source: live.source, url: live.url, origin: live.origin }
        : { ...p, origin: 'bundled' };
    } else {
      rate = live;
    }
    if (!rate) { unresolved.push(f); continue; }
    // A fraction of the population that lives *in* the region isn't new information.
    if (rate.cat === 'home_location') continue;
    // Anything true of more than 15% of adults can't narrow anyone down: it never moves the meter,
    // which also keeps stray low-value facts from shrinking the crowd.
    if (rate.low > NOT_IDENTIFYING) continue;
    const cur = byKey.get(rate.key);
    if (cur) {
      cur.facts.push(f);
      if (f.date < cur.firstSeen) cur.firstSeen = f.date;
    } else {
      byKey.set(rate.key, { rate, facts: [f], firstSeen: f.date });
    }
  }
  // 3. Nested attributes ("ICU nurse", "BSN" and "nurse" are all the same nurse): within one
  //    family, keep only the most specific attribute and pool the evidence.
  const families = new Map<string, Attribute[]>();
  for (const a of byKey.values()) {
    const root = a.rate.within ?? a.rate.key;
    families.set(root, [...(families.get(root) ?? []), a]);
  }
  byKey.clear();
  for (const members of families.values()) {
    members.sort((x, y) => x.rate.high - y.rate.high);
    const keep = members[0];
    for (const m of members.slice(1)) {
      keep.facts.push(...m.facts);
      if (m.firstSeen < keep.firstSeen) keep.firstSeen = m.firstSeen;
    }
    byKey.set(keep.rate.key, keep);
  }
  const attributes = [...byKey.values()].sort((a, b) => a.rate.high - b.rate.high);
  return { region: regionLabel ?? region, regionFacts, attributes, unresolved, localOnly };
}

export function rateKey(f: Pick<Fact, 'cat' | 'value'>) {
  return `${f.cat}:${f.value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

export function crowdNow(d: Dossier, seed = 7): CrowdEstimate {
  return estimate(d.region, d.attributes, seed);
}

export interface TrailPoint {
  date: string;
  estimate: CrowdEstimate;
  added: string[]; // attribute labels that entered at this point
}

/**
 * The crumb trail: the crowd estimate after each new attribute appears, in posting order.
 * Region facts count from the date they were first posted.
 */
export function crumbTrail(d: Dossier, seed = 7): TrailPoint[] {
  const regionDate = d.regionFacts.map((f) => f.date).sort()[0];
  const events: Array<{ date: string; label: string; attr?: Attribute }> = [];
  if (regionDate && d.region.key !== DEFAULT_REGION.key) events.push({ date: regionDate, label: d.region.label });
  for (const a of d.attributes) events.push({ date: a.firstSeen, label: a.rate.label, attr: a });
  events.sort((x, y) => x.date.localeCompare(y.date));
  const points: TrailPoint[] = [];
  let regionOn = false;
  const on: Attribute[] = [];
  for (const e of events) {
    if (e.attr) on.push(e.attr);
    else regionOn = true;
    const region = regionOn ? d.region : DEFAULT_REGION;
    points.push({ date: e.date, estimate: estimate(region, [...on], seed), added: [e.label] });
  }
  return points;
}

/** The first point where the median crowd drops below `threshold`: "here you left the crowd". */
export function leftTheCrowd(trail: TrailPoint[], threshold = 100): TrailPoint | undefined {
  return trail.find((p) => p.estimate.p50 < threshold);
}

/**
 * Minimum set of attributes whose removal brings the median crowd back above `target`.
 * Greedy over attributes ordered by identifying power; returns the facts (posts) to edit.
 */
export function minimumFix(d: Dossier, target = 1000, seed = 7): Attribute[] {
  const remaining = [...d.attributes];
  const removed: Attribute[] = [];
  while (remaining.length && estimate(d.region, remaining, seed).p50 < target) {
    // Remove the attribute with the smallest fraction (most identifying).
    remaining.sort((a, b) => a.rate.high - b.rate.high);
    removed.push(remaining.shift()!);
  }
  return removed;
}
