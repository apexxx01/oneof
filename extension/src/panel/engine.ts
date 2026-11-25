/**
 * The draft engine. Lives in the side panel because that's where Chrome exposes the Prompt API
 * to extensions (see ARCHITECTURE.md). It reuses the web core unchanged:
 *   extractFromPost(post, 'own', 'draft')  -> route('draft','own') = ONLY_ON_DEVICE via Firebase AI Logic
 *   blurDraft(text, 'own')                 -> route('blur','own')  = ONLY_ON_DEVICE
 *   scan(posts, 'own', ...)                -> route('extract','own') = ONLY_ON_DEVICE
 *   buildDossier / estimate                -> pure code, no model
 * The extension never passes 'synthetic' data to a model, so PREFER_ON_DEVICE (the only
 * route with a cloud fallback) is unreachable from here; lookupBaseRate is never imported.
 */
import { BlockedError, blurDraft as coreBlur, extractFromPost } from '../../../src/lib/ai';
import { buildDossier } from '../../../src/lib/dossier';
import { estimate, humanCount } from '../../../src/lib/estimate';
import { scan as coreScan, type ScanProgress } from '../../../src/lib/run';
import type { Attribute, CrowdEstimate, Fact, Post, Region } from '../../../src/lib/types';
import { toneFor, type Verdict } from '../shared/messages';
import { assertOnDevice } from './guard';

export const MAX_HISTORY_POSTS = 50;

export interface Deps {
  extract: typeof extractFromPost;
  blur: typeof coreBlur;
  scan: typeof coreScan;
}
const REAL: Deps = { extract: extractFromPost, blur: coreBlur, scan: coreScan };

/** Same sentence split as the web app's Draft panel: each sentence is read once and cached. */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8);
}

function hashText(t: string) { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

export interface DraftAnalysis {
  text: string;
  sentences: number;
  read: number;
  pending: boolean;
  blocked: boolean;
  error?: string;
  /** Sentences the model failed on (timeouts); they don't count toward the estimate. */
  failed: number;
  facts: Fact[];
  /** Attributes the draft adds that have a cited base rate (they move the number). */
  attrs: Attribute[];
  /** The draft names a place that narrows the region. */
  region?: Region;
  /** Found but no cited base rate: shown, never counted. */
  uncounted: number;
  /** Ids of draft facts that move the estimate (attributes and region). */
  countedIds: string[];
  before: CrowdEstimate;
  after: CrowdEstimate;
  /** Old attributes this draft combines with, when it makes the crowd noticeably smaller. */
  combines: Attribute[];
}

/** One model call at a time: the SDK destroys the previous on-device session when a new one starts. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  busy = false;
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => { this.busy = true; try { return await fn(); } finally { this.busy = false; } });
    this.tail = next.catch(() => undefined);
    return next;
  }
}

type Listener = (a: DraftAnalysis) => void;

export class DraftEngine {
  private cache = new Map<string, Fact[]>();
  private failed = new Set<string>();
  private history: Fact[] = [];
  private beforeCache: CrowdEstimate | null = null;
  private lock = new Mutex();
  private latest: { text: string; cb: Listener } | null = null;
  private looping = false;
  private blocked = false;
  scanning = false;

  constructor(private deps: Deps = REAL) {}

  setHistory(facts: Fact[]) { this.history = facts; this.beforeCache = null; }
  /** The crowd from history alone ("before this draft"). */
  before(): CrowdEstimate {
    if (!this.beforeCache) { const d = buildDossier(this.history); this.beforeCache = estimate(d.region, d.attributes); }
    return this.beforeCache;
  }

  /** Re-score a draft from cached sentences only (no model call). */
  summarize(text: string, extra: Partial<Pick<DraftAnalysis, 'pending' | 'blocked' | 'error'>> = {}): DraftAnalysis {
    const sentences = splitSentences(text);
    const facts = sentences.flatMap((s) => this.cache.get(s) ?? []);
    const before = this.before();
    const hist = buildDossier(this.history);
    const full = buildDossier([...this.history, ...facts]);
    const after = facts.length ? estimate(full.region, full.attributes) : before;
    const own = buildDossier(facts);
    const counted = own.attributes.reduce((n, a) => n + a.facts.length, 0) + own.regionFacts.length;
    const newKeys = new Set(own.attributes.map((a) => a.rate.key));
    const combines = after.p50 < before.p50 * 0.8
      ? full.attributes.filter((a) => !newKeys.has(a.rate.key) && a.facts.some((f) => !f.postId.startsWith('draft'))).slice(0, 3)
      : [];
    return {
      text, sentences: sentences.length, read: sentences.filter((s) => this.cache.has(s)).length,
      pending: false, blocked: this.blocked, failed: sentences.filter((s) => this.failed.has(s)).length,
      facts, attrs: own.attributes, region: own.regionFacts.length && full.region.key !== hist.region.key ? full.region : undefined,
      uncounted: Math.max(0, facts.length - counted), before, after, combines,
      countedIds: [...own.attributes.flatMap((a) => a.facts.map((f) => f.id)), ...own.regionFacts.map((f) => f.id)],
      ...extra,
    };
  }

  /**
   * Check a draft. Newer text supersedes older text between sentences; `cb` gets a pending
   * analysis straight away, progress after each sentence, and the final result.
   */
  submit(text: string, cb: Listener) {
    if (this.latest?.text !== text) this.failed.clear();
    this.latest = { text, cb };
    if (!this.looping) void this.loop();
  }

  private async loop() {
    this.looping = true;
    try {
      while (this.latest) {
        const job = this.latest;
        const todo = splitSentences(job.text).filter((s) => !this.cache.has(s) && !this.failed.has(s));
        if (!todo.length) {
          if (this.latest === job) this.latest = null;
          job.cb(this.summarize(job.text));
          continue;
        }
        job.cb(this.summarize(job.text, { pending: true }));
        let stop: string | undefined;
        await this.lock.run(async () => {
          for (const s of todo) {
            if (this.latest !== job) return; // superseded: re-plan with the newest text
            try {
              assertOnDevice('draft');
              const r = await this.deps.extract({ id: `draft:${hashText(s)}`, date: new Date().toISOString(), text: s }, 'own', 'draft');
              this.blocked = false;
              this.cache.set(s, r.facts);
            } catch (e) {
              if (e instanceof BlockedError) { this.blocked = true; stop = e.message; return; }
              this.failed.add(s);
              stop = 'The on-device model is busy. Keep typing; it will catch up.';
            }
            if (this.latest === job) job.cb(this.summarize(job.text, { pending: true }));
          }
        });
        if (this.latest === job) {
          this.latest = null;
          job.cb(this.summarize(job.text, stop ? { error: stop } : {}));
        }
      }
    } finally {
      this.looping = false;
    }
  }

  async blur(text: string) {
    assertOnDevice('blur');
    return this.lock.run(() => this.deps.blur(text, 'own'));
  }

  /** Reads pasted posts on-device, capped at MAX_HISTORY_POSTS (most revealing first). */
  async scanHistory(posts: Post[], onUpdate: (p: ScanProgress) => void, signal?: AbortSignal) {
    assertOnDevice('extract');
    this.scanning = true;
    try {
      return await this.lock.run(() => this.deps.scan(posts, 'own', onUpdate, signal, { maxPosts: MAX_HISTORY_POSTS }));
    } finally {
      this.scanning = false;
    }
  }

  get busy() { return this.lock.busy; }
}

const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The pill's text for an analysis. Never claims the draft is harmless: it reports a range. */
export function verdictFor(a: DraftAnalysis, opts: { scanning?: boolean } = {}): Verdict {
  const before = humanCount(a.before.p50);
  const after = humanCount(a.after.p50);
  const range = `range ${humanCount(a.after.p10)}–${humanCount(a.after.p90)}`;
  if (a.blocked) {
    return { state: 'blocked', text: 'not checked · no on-device model', tone: 'muted', detail: 'Drafts are read only by Gemini Nano on this computer, and it isn’t ready. Open the OneOf panel for details. Nothing was sent anywhere.' };
  }
  if (a.pending && a.read === 0) {
    return opts.scanning
      ? { state: 'busy', text: 'reading your history first…', tone: 'muted', detail: 'OneOf is reading your pasted posts on this computer. Your draft is next.' }
      : { state: 'checking', text: 'reading on-device…', tone: 'device', detail: 'Gemini Nano is reading this draft on this computer.' };
  }
  const changed = a.attrs.length > 0 || !!a.region;
  if (changed && a.after.p50 < a.before.p50) {
    const adds = [...(a.region ? [a.region.label] : []), ...a.attrs.map((x) => x.rate.label)];
    return {
      state: a.pending ? 'checking' : 'result',
      text: `one of ~${before} → ~${after} if you post this`,
      tone: toneFor(a.after.band),
      detail: `This draft adds: ${adds.join(', ')}. With your history that leaves about ${after} people (${range}). Read on this computer; 0 bytes sent.`,
    };
  }
  if (a.facts.length > 0) {
    return { state: a.pending ? 'checking' : 'result', text: `one of ~${before} · ${s(a.facts.length, 'detail')} found, not counted`, tone: 'amber', detail: 'OneOf found details in this draft but has no cited base rate for them, so they don’t move the number. Open the panel to see them.' };
  }
  if (a.error) return { state: 'error', text: `one of ~${before} · not fully read`, tone: 'muted', detail: a.error };
  return { state: a.pending ? 'checking' : 'result', text: `one of ~${before} · no identifying details found`, tone: toneFor(a.before.band), detail: `Nothing in this draft narrows the crowd that OneOf can count. Estimates, not guarantees (${range}).` };
}
