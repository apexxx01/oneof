import { getGenerativeModel, InferenceMode, type GenerativeModel } from 'firebase/ai';
import { getFirebase } from './firebase';
import { FACT_BATCH_JSON_SCHEMA, FactBatchZ } from './schemas';
import {
  BASERATE_SYSTEM, BLUR_SYSTEM, EXTRACT_EXAMPLE_ASSISTANT, EXTRACT_EXAMPLE_USER, EXTRACT_SYSTEM, batchPrompt,
} from './prompts';
import { record, type Mode, type Task } from './ledger';
import type { BaseRate, Fact, Post } from './types';
import { rateKey } from './dossier';

export const CLOUD_MODEL = 'gemini-3.5-flash-lite';
/**
 * Hedged cloud chain. Flash-Lite is fast and cheap but has hung for minutes at a time; when it
 * doesn't answer within its budget we retry once on Flash. On-device calls never use this.
 */
export const CLOUD_CHAIN = [
  { model: CLOUD_MODEL, timeout: 12_000 },
  { model: 'gemini-3.5-flash', timeout: 45_000 },
] as const;

const RETRYABLE = /timeout|timed out|abort|fetch|network|429|quota|exhausted|50\d|overloaded|unavailable|deadline|internal/i;
/** Circuit breaker: a tier that just failed is skipped for a minute instead of costing every post a timeout. */
const BREAKER_MS = 60_000;
const trippedUntil = new Map<string, number>();

/** Runs a call down the cloud chain. make(tier) must return a model whose cloud side uses that tier. */
/**
 * Gemini Nano occasionally never resolves a prompt (seen live: one post stalled a 200-post scan).
 * The SDK exposes no abort for on-device calls, so we race a budget and move on; the call is
 * logged as an error and the next post gets a fresh session.
 */
export const ON_DEVICE_BUDGET_MS = 20_000;
export function withBudget<T>(p: Promise<T>, ms: number, what = 'on-device call', signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
    const onAbort = () => { clearTimeout(t); reject(new DOMException('Stopped', 'AbortError')); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); reject(new Error(`${what} timed out after ${ms / 1000}s`)); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    p.then((v) => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); resolve(v); }, (e) => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); reject(e); });
  });
}

async function hedged<T>(mode: Mode, make: (tier: (typeof CLOUD_CHAIN)[number], i: number) => GenerativeModel, run: (m: GenerativeModel) => Promise<T>, signal?: AbortSignal): Promise<{ value: T; model: string }> {
  if (mode === 'ONLY_ON_DEVICE') return { value: await withBudget(run(make(CLOUD_CHAIN[0], 0)), ON_DEVICE_BUDGET_MS, 'on-device call', signal), model: 'on-device' };
  if (mode === 'PREFER_ON_DEVICE' && (await onDeviceAvailability()) === 'available') {
    // Nano present: the SDK will route on-device, so the on-device budget applies. A stall is logged
    // as an error for that one post rather than silently re-sent to the cloud.
    return { value: await withBudget(run(make(CLOUD_CHAIN[0], 0)), ON_DEVICE_BUDGET_MS, 'on-device call', signal), model: 'on-device' };
  }
  const now = Date.now();
  const open = CLOUD_CHAIN.filter((t) => (trippedUntil.get(t.model) ?? 0) <= now);
  const tiers = open.length ? open : [...CLOUD_CHAIN];
  let last: unknown;
  for (const [i, tier] of tiers.entries()) {
    try {
      return { value: await run(make(tier, i)), model: tier.model };
    } catch (e) {
      last = e;
      if (signal?.aborted) throw e;
      const retryable = RETRYABLE.test(String((e as Error)?.message ?? e));
      if (retryable) trippedUntil.set(tier.model, Date.now() + BREAKER_MS);
      if (i === tiers.length - 1 || !retryable) throw e;
    }
  }
  throw last;
}

/** Whose data is this? Decides how far it may travel. */
export type DataKind = 'own' | 'synthetic';

export interface Route { mode: Mode; reason: string }

/** The router. Every call goes through here, and the reason is shown in the UI. */
export function route(task: Task, data: DataKind): Route {
  if (task === 'baserate') return { mode: 'ONLY_IN_CLOUD', reason: 'Needs current statistics from Google Search. Sends one generic attribute, never your words.' };
  if (data === 'own') return { mode: 'ONLY_ON_DEVICE', reason: 'Your own posts and drafts never leave this device.' };
  return { mode: 'PREFER_ON_DEVICE', reason: 'Synthetic demo data: runs on-device when available, cloud fallback allowed.' };
}

export class BlockedError extends Error {
  constructor() {
    super('This browser has no on-device model, and your own posts are never sent to the cloud.');
  }
}

// ---------- availability ----------
declare global {
  // eslint-disable-next-line no-var
  var LanguageModel: { availability: (o?: unknown) => Promise<string> } | undefined;
}
export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

export async function onDeviceAvailability(): Promise<Availability> {
  if (!globalThis.LanguageModel) return 'unsupported';
  try {
    return (await globalThis.LanguageModel.availability({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    })) as Availability;
  } catch {
    return 'unavailable';
  }
}

// ---------- models (cached per mode) ----------
const models = new Map<string, GenerativeModel>();

function extractModel(mode: Mode, tier: (typeof CLOUD_CHAIN)[number] = CLOUD_CHAIN[0]): GenerativeModel {
  const system = promptOverride ?? EXTRACT_SYSTEM;
  const key = `extract:${mode}:${tier.model}:${hash(system)}`;
  if (models.has(key)) return models.get(key)!;
  const { ai } = getFirebase();
  const m = getGenerativeModel(ai, {
    mode: InferenceMode[mode],
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [
          { role: 'system', content: [{ type: 'text', value: system }] },
          { role: 'user', content: [{ type: 'text', value: EXTRACT_EXAMPLE_USER }] },
          { role: 'assistant', content: [{ type: 'text', value: EXTRACT_EXAMPLE_ASSISTANT }] },
        ],
      },
      promptOptions: { responseConstraint: FACT_BATCH_JSON_SCHEMA },
    },
    inCloudParams: {
      model: tier.model,
      systemInstruction: `${system}\n\nExample input:\n${EXTRACT_EXAMPLE_USER}\n\nExample output:\n${EXTRACT_EXAMPLE_ASSISTANT}`,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: FACT_BATCH_JSON_SCHEMA, temperature: 0 },
    },
  }, { timeout: tier.timeout });
  models.set(key, m);
  return m;
}

/** Starts the on-device model download. Must be called from a user gesture. */
export async function prepareOnDevice(onProgress: (p: number) => void) {
  await extractModel('ONLY_ON_DEVICE').initializeDeviceModel(onProgress);
}

// ---------- extraction ----------
import { verify } from './verify';
export { verify };

export interface RawVerdict { cat: string; value: string; about_self: boolean; certainty: string; why: string }
export interface ExtractResult { facts: Fact[]; rejected: number; source: 'on_device' | 'in_cloud'; ms: number; raw: RawVerdict[] }

/**
 * Eval-only prompt override, so prompt variants can be compared on the SynthPAI dev split without
 * a deploy. Read only on the /?eval page; the product never reads it.
 */
let promptOverride: string | null = null;
export function setPromptOverride(p: string | null) { promptOverride = p && p.trim() ? p : null; }
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** Ledger text for a call the user stopped mid-flight. */
export const STOPPED_BY_YOU = 'Stopped by you';

/** Long posts are cut to stay well inside Gemini Nano's context (system prompt + example are re-sent per call). */
export const MAX_POST_CHARS = 2000;

export async function extractFromPost(post: Post, data: DataKind, task: 'extract' | 'draft' = 'extract', forceMode?: Mode, signal?: AbortSignal): Promise<ExtractResult> {
  // forceMode exists only for the eval page's cloud baseline on synthetic data; own data can never be forced.
  const base = route(task, data);
  const r = forceMode && data === 'synthetic' ? { mode: forceMode, reason: `Eval baseline on synthetic data: ${forceMode}` } : base;
  if (r.mode === 'ONLY_ON_DEVICE' && (await onDeviceAvailability()) !== 'available') {
    record({ task, mode: r.mode, reason: r.reason, source: 'blocked', ms: 0, sentToCloud: '', data });
    throw new BlockedError();
  }
  const t0 = performance.now();
  const prompt = batchPrompt([post.text.length > MAX_POST_CHARS ? post.text.slice(0, MAX_POST_CHARS) : post.text]);
  // Set once a request has actually been handed to the SDK; a stop before that sent nothing.
  let dispatched = false;
  try {
    const { value: res, model } = await hedged(r.mode, (tier) => extractModel(r.mode, tier), (m) => {
      if (!signal?.aborted) dispatched = true;
      return m.generateContent(prompt, { signal });
    }, signal);
    const ms = performance.now() - t0;
    const source = res.response.inferenceSource === 'in_cloud' ? 'in_cloud' : 'on_device';
    record({ task, mode: r.mode, reason: r.reason, source, ms, sentToCloud: source === 'in_cloud' ? prompt : '', model: source === 'in_cloud' ? model : undefined, data });
    const parsed = FactBatchZ.safeParse(JSON.parse(res.response.text()));
    if (!parsed.success) return { facts: [], rejected: 0, source, ms, raw: [] };
    let rejected = 0;
    const facts: Fact[] = [];
    const raw: RawVerdict[] = [];
    for (const f of parsed.data.facts) {
      if (f.p !== 0) continue;
      const v = verify(f, post);
      raw.push({ cat: f.cat, value: f.value.slice(0, 60), about_self: f.about_self, certainty: f.certainty, why: v.ok ? 'ok' : v.why ?? 'rejected' });
      if (!v.ok) { rejected++; continue; }
      facts.push({
        id: `${post.id}:${facts.length}`, postId: post.id, date: post.date, cat: f.cat, value: f.value.slice(0, 60),
        quote: f.quote.slice(0, 160), certainty: f.certainty, source,
      });
    }
    return { facts, rejected, source, ms, raw };
  } catch (e) {
    const ms = performance.now() - t0;
    // A failed or stopped cloud call still sent the prompt once it was dispatched; the ledger must say so.
    const cloudBound = r.mode === 'ONLY_IN_CLOUD' || (r.mode === 'PREFER_ON_DEVICE' && (await onDeviceAvailability()) !== 'available');
    const sentToCloud = cloudBound && dispatched ? prompt : '';
    if (signal?.aborted) {
      // The user pressed Stop: a choice, not a failure.
      record({ task, mode: r.mode, reason: r.reason, source: 'stopped', ms, sentToCloud, error: STOPPED_BY_YOU, data });
    } else {
      record({ task, mode: r.mode, reason: r.reason, source: 'error', ms, sentToCloud, error: String((e as Error).message ?? e).slice(0, 200), data });
    }
    throw e;
  }
}

// ---------- base rates (cloud + Google Search grounding) ----------
import { cloudSafeAttribute } from './attribute';
export { cloudSafeAttribute };

/** After a 429 we stop asking for grounding for 10 minutes rather than for the whole session. */
let groundingOffUntil = 0;

/**
 * One cloud call per attribute, and only for attributes cloudSafeAttribute() allows. No decoys:
 * a fixed decoy list published in this repo would be trivially filtered, so it added cost, not privacy.
 */
export async function lookupBaseRate(f: Fact, country: string, data: DataKind = 'own'): Promise<BaseRate | undefined> {
  const safe = cloudSafeAttribute(f);
  if (!safe.ok) return undefined;
  const r = route('baserate', 'own');
  const { ai } = getFirebase();
  // The router's decision is enforced, not just displayed: ONLY_IN_CLOUD via the hybrid API.
  const groundedAt = (t: (typeof CLOUD_CHAIN)[number]) => getGenerativeModel(ai, {
    mode: InferenceMode[r.mode],
    inCloudParams: { model: t.model, systemInstruction: BASERATE_SYSTEM, tools: [{ googleSearch: {} }] },
  }, { timeout: t.timeout });
  const plainAt = (t: (typeof CLOUD_CHAIN)[number]) => getGenerativeModel(ai, {
    mode: InferenceMode[r.mode],
    inCloudParams: { model: t.model, systemInstruction: BASERATE_SYSTEM.replace('using Google Search for current official statistics', 'from your knowledge of official statistics') },
  }, { timeout: t.timeout });
  const ask = async (attribute: string, decoy: boolean) => {
    const payload = `Attribute: ${attribute}\nCountry: ${country}`;
    const t0 = performance.now();
    try {
      // Grounded first. Search grounding has no free-tier quota, so on 429 fall back to an
      // ungrounded estimate, which is graded C and labelled "model estimate, no source".
      let res;
      try {
        if (Date.now() < groundingOffUntil) throw new Error('grounding disabled');
        res = (await hedged(r.mode, groundedAt, (m) => m.generateContent(payload))).value;
      } catch (e) {
        if (/429|quota|grounding disabled/i.test(String((e as Error).message))) {
          groundingOffUntil = Date.now() + 10 * 60_000;
          res = (await hedged(r.mode, plainAt, (m) => m.generateContent(payload))).value;
        } else throw e;
      }
      record({ task: 'baserate', mode: r.mode, reason: r.reason, source: 'in_cloud', ms: performance.now() - t0, sentToCloud: payload, decoy, data });
      return res;
    } catch (e) {
      record({ task: 'baserate', mode: r.mode, reason: r.reason, source: 'error', ms: performance.now() - t0, sentToCloud: payload, decoy, data, error: String((e as Error).message).slice(0, 200) });
      return undefined;
    }
  };
  const real = await ask(safe.attribute, false);
  if (!real) return undefined;
  const text = real.response.text().replace(/```json|```/g, '').trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try {
    const j = JSON.parse(m[0]) as { low: number; high: number; basis: string };
    const low = Math.max(1e-7, Math.min(1, Number(j.low)));
    const high = Math.max(low, Math.min(1, Number(j.high)));
    if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
    const chunk = real.response.candidates?.[0]?.groundingMetadata?.groundingChunks?.find((c) => c.web?.uri);
    return {
      key: rateKey(f), label: f.value, cat: f.cat, low, high, grade: chunk ? 'B' : 'C',
      source: chunk ? (j.basis?.slice(0, 200) ?? 'Gemini + Google Search') : `Model estimate, no source: ${j.basis?.slice(0, 160) ?? ''}`,
      url: chunk?.web?.uri, origin: 'cloud',
    };
  } catch {
    return undefined;
  }
}

// ---------- Blur: on-device rewrite of the draft ----------
const BLUR_SCHEMA = {
  type: 'object',
  properties: { rewrite: { type: 'string' }, removed: { type: 'array', items: { type: 'string' } } },
  required: ['rewrite', 'removed'],
} as const;

export async function blurDraft(draft: string, data: DataKind): Promise<{ rewrite: string; removed: string[]; source: string }> {
  const r = route('blur', data);
  if (r.mode === 'ONLY_ON_DEVICE' && (await onDeviceAvailability()) !== 'available') throw new BlockedError();
  const blurModel = (tier: (typeof CLOUD_CHAIN)[number]) => {
  const key = `blur:${r.mode}:${tier.model}`;
  if (!models.has(key)) {
    const { ai } = getFirebase();
    models.set(key, getGenerativeModel(ai, {
      mode: InferenceMode[r.mode],
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          initialPrompts: [{ role: 'system', content: [{ type: 'text', value: BLUR_SYSTEM }] }],
        },
        promptOptions: { responseConstraint: BLUR_SCHEMA },
      },
      inCloudParams: { model: tier.model, systemInstruction: BLUR_SYSTEM, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: BLUR_SCHEMA } },
    }, { timeout: tier.timeout }));
  }
  return models.get(key)!;
  };
  const t0 = performance.now();
  try {
    const { value: res } = await hedged(r.mode, blurModel, (m) => m.generateContent(draft));
    const source = res.response.inferenceSource === 'in_cloud' ? 'in_cloud' : 'on_device';
    record({ task: 'blur', mode: r.mode, reason: r.reason, source, ms: performance.now() - t0, sentToCloud: source === 'in_cloud' ? draft : '', data });
    const j = JSON.parse(res.response.text()) as { rewrite?: unknown; removed?: unknown };
    if (typeof j.rewrite !== 'string' || !j.rewrite.trim()) throw new Error('The model returned no rewrite. Try again.');
    const removed = Array.isArray(j.removed) ? j.removed.filter((x): x is string => typeof x === 'string') : [];
    return { rewrite: j.rewrite, removed, source };
  } catch (e) {
    if (e instanceof SyntaxError) e = new Error('The model returned malformed output. Try again.');
    record({ task: 'blur', mode: r.mode, reason: r.reason, source: 'error', ms: performance.now() - t0, sentToCloud: '', error: String((e as Error).message).slice(0, 200), data });
    throw e;
  }
}
