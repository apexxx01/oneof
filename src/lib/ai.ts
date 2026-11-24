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

function extractModel(mode: Mode): GenerativeModel {
  const key = `extract:${mode}`;
  if (models.has(key)) return models.get(key)!;
  const { ai } = getFirebase();
  const m = getGenerativeModel(ai, {
    mode: InferenceMode[mode],
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [
          { role: 'system', content: [{ type: 'text', value: EXTRACT_SYSTEM }] },
          { role: 'user', content: [{ type: 'text', value: EXTRACT_EXAMPLE_USER }] },
          { role: 'assistant', content: [{ type: 'text', value: EXTRACT_EXAMPLE_ASSISTANT }] },
        ],
      },
      promptOptions: { responseConstraint: FACT_BATCH_JSON_SCHEMA },
    },
    inCloudParams: {
      model: CLOUD_MODEL,
      systemInstruction: `${EXTRACT_SYSTEM}\n\nExample input:\n${EXTRACT_EXAMPLE_USER}\n\nExample output:\n${EXTRACT_EXAMPLE_ASSISTANT}`,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: FACT_BATCH_JSON_SCHEMA, temperature: 0 },
    },
  });
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

export interface ExtractResult { facts: Fact[]; rejected: number; source: 'on_device' | 'in_cloud'; ms: number }

export async function extractFromPost(post: Post, data: DataKind, task: 'extract' | 'draft' = 'extract', forceMode?: Mode): Promise<ExtractResult> {
  // forceMode exists only for the eval page's cloud baseline on synthetic data; own data can never be forced.
  const base = route(task, data);
  const r = forceMode && data === 'synthetic' ? { mode: forceMode, reason: `Eval baseline on synthetic data: ${forceMode}` } : base;
  if (r.mode === 'ONLY_ON_DEVICE' && (await onDeviceAvailability()) !== 'available') {
    record({ task, mode: r.mode, reason: r.reason, source: 'blocked', ms: 0, sentToCloud: '' });
    throw new BlockedError();
  }
  const t0 = performance.now();
  const prompt = batchPrompt([post.text]);
  try {
    const res = await extractModel(r.mode).generateContent(prompt);
    const ms = performance.now() - t0;
    const source = res.response.inferenceSource === 'in_cloud' ? 'in_cloud' : 'on_device';
    record({ task, mode: r.mode, reason: r.reason, source, ms, sentToCloud: source === 'in_cloud' ? prompt : '' });
    const parsed = FactBatchZ.safeParse(JSON.parse(res.response.text()));
    if (!parsed.success) return { facts: [], rejected: 0, source, ms };
    let rejected = 0;
    const facts: Fact[] = [];
    for (const f of parsed.data.facts) {
      if (f.p !== 0) continue;
      if (!verify(f, post).ok) { rejected++; continue; }
      facts.push({
        id: `${post.id}:${facts.length}`, postId: post.id, date: post.date, cat: f.cat, value: f.value.slice(0, 60),
        quote: f.quote.slice(0, 160), certainty: f.certainty, source,
      });
    }
    return { facts, rejected, source, ms };
  } catch (e) {
    const ms = performance.now() - t0;
    record({ task, mode: r.mode, reason: r.reason, source: 'error', ms, sentToCloud: '', error: String((e as Error).message ?? e).slice(0, 200) });
    throw e;
  }
}

// ---------- base rates (cloud + Google Search grounding) ----------
const DECOYS = [
  'occupation: dental hygienist', 'pet: owns a parrot', 'hobby: plays pickleball', 'vehicle: drives a pickup truck',
  'occupation: electrician', 'family: has three children', 'hobby: amateur astronomer', 'occupation: pharmacist',
  'vehicle: rides a motorcycle', 'hobby: plays chess competitively',
];

function generalize(f: Fact) {
  // One rung up and stripped of anything personal: the category plus a short generic noun phrase.
  return `${f.cat.replace(/_/g, ' ')}: ${f.value.toLowerCase().replace(/\b(my|our|his|her)\b/g, '').replace(/\s+/g, ' ').trim()}`;
}

let groundingDisabled = false;

export async function lookupBaseRate(f: Fact, country: string, decoys = 1): Promise<BaseRate | undefined> {
  const r = route('baserate', 'own');
  const { ai } = getFirebase();
  // The router's decision is enforced, not just displayed: ONLY_IN_CLOUD via the hybrid API.
  const grounded = getGenerativeModel(ai, {
    mode: InferenceMode[r.mode],
    inCloudParams: { model: CLOUD_MODEL, systemInstruction: BASERATE_SYSTEM, tools: [{ googleSearch: {} }] },
  });
  const plain = getGenerativeModel(ai, {
    mode: InferenceMode[r.mode],
    inCloudParams: { model: CLOUD_MODEL, systemInstruction: BASERATE_SYSTEM.replace('using Google Search for current official statistics', 'from your knowledge of official statistics') },
  });
  const ask = async (attribute: string, decoy: boolean) => {
    const payload = `Attribute: ${attribute}\nCountry: ${country}`;
    const t0 = performance.now();
    try {
      // Grounded first. Search grounding has no free-tier quota, so on 429 fall back to an
      // ungrounded estimate, which is graded C and labelled "model estimate, no source".
      let res;
      try {
        if (groundingDisabled) throw new Error('grounding disabled');
        res = await grounded.generateContent(payload);
      } catch (e) {
        if (/429|quota|grounding disabled/i.test(String((e as Error).message))) {
          groundingDisabled = true;
          res = await plain.generateContent(payload);
        } else throw e;
      }
      record({ task: 'baserate', mode: r.mode, reason: r.reason, source: 'in_cloud', ms: performance.now() - t0, sentToCloud: payload, decoy });
      return res;
    } catch (e) {
      record({ task: 'baserate', mode: r.mode, reason: r.reason, source: 'error', ms: performance.now() - t0, sentToCloud: payload, decoy, error: String((e as Error).message).slice(0, 200) });
      return undefined;
    }
  };
  // Decoys go out in random order around the real query, so no single request stands out.
  const attribute = generalize(f);
  const decoyList = [...DECOYS].sort(() => Math.random() - 0.5).slice(0, decoys);
  const order = [...decoyList.map((d) => ({ d, decoy: true })), { d: attribute, decoy: false }].sort(() => Math.random() - 0.5);
  let real: Awaited<ReturnType<typeof ask>>;
  for (const o of order) {
    const res = await ask(o.d, o.decoy);
    if (!o.decoy) real = res;
  }
  if (!real!) return undefined;
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
  const key = `blur:${r.mode}`;
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
      inCloudParams: { model: CLOUD_MODEL, systemInstruction: BLUR_SYSTEM, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: BLUR_SCHEMA } },
    }));
  }
  const t0 = performance.now();
  const res = await models.get(key)!.generateContent(draft);
  const source = res.response.inferenceSource === 'in_cloud' ? 'in_cloud' : 'on_device';
  record({ task: 'blur', mode: r.mode, reason: r.reason, source, ms: performance.now() - t0, sentToCloud: source === 'in_cloud' ? draft : '' });
  const j = JSON.parse(res.response.text()) as { rewrite: string; removed: string[] };
  return { ...j, source };
}
