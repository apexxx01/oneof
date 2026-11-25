/**
 * The history dossier the draft is compared against, kept in chrome.storage.local on this
 * computer. Only extracted facts (category, short value, short quote, date) are stored; pasted
 * post text is never written to storage.
 */
import type { Fact } from '../../../src/lib/types';

export type HistorySource = 'none' | 'demo' | 'pasted';

export interface StoredHistory {
  v: 1;
  source: HistorySource;
  facts: Fact[];
  /** Human label of the source, shown in the panel. */
  label: string;
  posts: number;
  read: number;
  savedAt: string;
}

export const HISTORY_KEY = 'oneof.history.v1';

export const NO_HISTORY: StoredHistory = { v: 1, source: 'none', facts: [], label: 'No history: this draft alone, against all US adults', posts: 0, read: 0, savedAt: '' };

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export async function loadHistory(store: StorageArea): Promise<StoredHistory> {
  try {
    const h = (await store.get(HISTORY_KEY))[HISTORY_KEY] as StoredHistory | undefined;
    if (h && h.v === 1 && Array.isArray(h.facts) && ['none', 'demo', 'pasted'].includes(h.source)) return h;
  } catch { /* storage unavailable: fall through */ }
  return NO_HISTORY;
}

export async function saveHistory(store: StorageArea, h: StoredHistory): Promise<void> {
  // Strip anything beyond the Fact fields, so a future change can't smuggle post text in.
  const facts = h.facts.map(({ id, postId, date, cat, value, quote, certainty, source }) => ({ id, postId, date, cat, value: value.slice(0, 60), quote: quote.slice(0, 160), certainty, source }));
  await store.set({ [HISTORY_KEY]: { ...h, facts } });
}
