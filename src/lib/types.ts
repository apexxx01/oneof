import type { Category } from './schemas';

/** One post or comment from the user's own export. */
export interface Post {
  id: string;
  date: string; // ISO
  text: string;
  where?: string; // subreddit / channel, shown but never sent anywhere
  permalink?: string;
}

/** A fact extracted on-device from one post, after verification. */
export interface Fact {
  id: string;
  postId: string;
  date: string;
  cat: Category;
  value: string;
  quote: string;
  certainty: 'stated' | 'implied';
  source: 'on_device' | 'in_cloud';
}

/** Evidence grade of a base-rate number. */
export type Grade = 'A' | 'B' | 'C';

export interface BaseRate {
  key: string; // e.g. "occupation:nurse"
  label: string; // "registered nurses"
  cat: Category;
  /** Fraction of the reference population that has this attribute. */
  low: number;
  high: number;
  grade: Grade;
  source: string; // human-readable citation
  url?: string;
  /** Where this number came from at runtime. */
  origin: 'bundled' | 'cache' | 'cloud' | 'fallback';
  /** Set when Gemini picked this bundled table for a phrase the tables didn't cover. The rate is the table's own. */
  matchedFrom?: string;
  /** Keys this one is a strict subset of (e.g. "occupation:icu_nurse" ⊂ "occupation:nurse"). */
  within?: string;
}

export interface Region {
  key: string;
  label: string;
  population: number;
  /** Share of the population aged 18+. Attributes are measured against adults. */
  adultShare: number;
  grade: Grade;
  source: string;
  url?: string;
}

/** An attribute in the dossier: a base rate plus the facts that support it. */
export interface Attribute {
  rate: BaseRate;
  facts: Fact[];
  firstSeen: string; // ISO date of the earliest supporting post
}

export interface CrowdEstimate {
  p10: number;
  p50: number;
  p90: number;
  band: 'crowd' | 'neighbourhood' | 'room' | 'handful';
  bits: number; // log2(population / p50)
}
