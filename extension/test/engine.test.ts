/**
 * The extension's privacy contract, asserted at the Firebase AI Logic boundary:
 * every model the extension creates is ONLY_ON_DEVICE, and nothing is recorded as sent.
 * getGenerativeModel is spied (real InferenceMode, real router, real extractFromPost,
 * blurDraft and scan from src/lib) and a fake Gemini Nano answers on "device".
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ modes: [] as string[], prompts: [] as string[], everMode: [] as string[] }));

vi.mock('firebase/ai', async (orig) => {
  const real = await orig<typeof import('firebase/ai')>();
  return {
    ...real,
    getGenerativeModel: (_ai: unknown, params: { mode?: string; onDeviceParams?: { promptOptions?: { responseConstraint?: { properties?: Record<string, unknown> } } } }) => {
      calls.modes.push(String(params.mode));
      calls.everMode.push(String(params.mode));
      const isBlur = !!params.onDeviceParams?.promptOptions?.responseConstraint?.properties?.rewrite;
      return {
        initializeDeviceModel: async () => undefined,
        generateContent: async (prompt: string) => {
          calls.prompts.push(prompt);
          return { response: { inferenceSource: 'on_device', text: () => JSON.stringify(isBlur ? blurAnswer(prompt) : factsFor(prompt)) } };
        },
      };
    },
  };
});
// Same substitution the extension build makes (vite.config.ts): App Check is compiled out.
vi.mock('firebase/app-check', () => import('../src/panel/app-check-off'));

import { route } from '../../src/lib/ai';
import { getLedger, resetLedger } from '../../src/lib/ledger';
import { fromPaste } from '../../src/lib/importers';
import { DraftEngine, MAX_HISTORY_POSTS, splitSentences, verdictFor, type DraftAnalysis } from '../src/panel/engine';
import { assertOnDevice } from '../src/panel/guard';
import { demoHistory, type DemoFile } from '../src/panel/demo';
import { demoFile } from '../scripts/demo-file';

/** A deterministic stand-in for Gemini Nano's fact extraction. */
function factsFor(prompt: string) {
  const text = prompt.replace(/^Posts:\n\[0\] /, '');
  const facts: object[] = [];
  const add = (cat: string, value: string, quote: string) => { if (text.includes(quote)) facts.push({ p: 0, cat, value, quote, about_self: true, certainty: 'stated' }); };
  add('occupation', 'ICU nurse', 'ICU nurse');
  add('home_location', 'Columbus', 'in Columbus');
  add('family', 'single mom of twins', 'single mom of twins');
  add('vehicle', 'red truck', 'red truck');
  return { facts };
}
function blurAnswer(draft: string) { return { rewrite: draft.replace(/ICU nurse/g, 'healthcare worker').replace(/ in Columbus/g, ''), removed: ['ICU nurse', 'Columbus'] }; }

const done = (e: DraftEngine, text: string) => new Promise<DraftAnalysis>((res) => e.submit(text, (a) => { if (!a.pending) res(a); }));

beforeAll(() => { vi.stubEnv('VITE_APPCHECK', 'off'); });
beforeEach(() => {
  calls.modes.length = 0; calls.prompts.length = 0;
  resetLedger();
  (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability: async () => 'available' };
});
afterEach(() => { delete (globalThis as { LanguageModel?: unknown }).LanguageModel; });

describe('router', () => {
  it('routes every task the extension runs on the user’s words to ONLY_ON_DEVICE', () => {
    for (const t of ['draft', 'blur', 'extract'] as const) {
      expect(route(t, 'own').mode).toBe('ONLY_ON_DEVICE');
      expect(assertOnDevice(t).mode).toBe('ONLY_ON_DEVICE');
    }
  });
});

describe('draft check', () => {
  it('reads each sentence on-device, never in the cloud, and sends 0 bytes', async () => {
    const e = new DraftEngine();
    const a = await done(e, 'I work nights as an ICU nurse in Columbus. Honestly the commute is fine.');
    expect(calls.modes.length).toBeGreaterThan(0);
    expect(new Set(calls.modes)).toEqual(new Set(['only_on_device']));
    expect(calls.prompts).toHaveLength(2); // two sentences, one call each
    expect(a.facts.map((f) => f.cat).sort()).toEqual(['home_location', 'occupation']);
    expect(a.region?.label).toContain('Columbus');
    expect(a.after.p50).toBeLessThan(a.before.p50);
    const led = getLedger();
    expect(led.every((x) => x.mode === 'ONLY_ON_DEVICE' && x.source === 'on_device' && x.sentToCloud === '')).toBe(true);
    expect(led.map((x) => x.task)).toEqual(['draft', 'draft']);
  });

  it('caches sentences: re-typing only reads the new one', async () => {
    const e = new DraftEngine();
    await done(e, 'I work nights as an ICU nurse in Columbus.');
    await done(e, 'I work nights as an ICU nurse in Columbus. I drive a red truck to work.');
    expect(calls.prompts).toHaveLength(2);
  });

  it('newer text supersedes older text between sentences', async () => {
    const e = new DraftEngine();
    const seen: string[] = [];
    e.submit('First sentence about nothing much. Second sentence about nothing else.', (a) => { if (!a.pending) seen.push(a.text); });
    e.submit('I work nights as an ICU nurse in Columbus.', (a) => { if (!a.pending) seen.push(a.text); });
    await vi.waitFor(() => expect(seen).toContain('I work nights as an ICU nurse in Columbus.'));
    expect(seen).not.toContain('First sentence about nothing much. Second sentence about nothing else.');
  });

  it('compares against the history dossier: same draft, smaller crowd with the demo history', async () => {
    const e = new DraftEngine();
    const alone = await done(e, 'I work nights as an ICU nurse in Columbus.');
    e.setHistory(demoHistory(demoFile() as DemoFile).facts);
    const withHistory = await done(e, 'I work nights as an ICU nurse in Columbus.');
    expect(withHistory.before.p50).toBeLessThan(alone.before.p50);
    expect(withHistory.after.p50).toBeLessThanOrEqual(withHistory.before.p50);
  });

  it('blocks (and sends nothing) when this browser has no on-device model', async () => {
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    const e = new DraftEngine();
    const a = await done(e, 'I work nights as an ICU nurse in Columbus.');
    expect(a.blocked).toBe(true);
    expect(calls.modes).toHaveLength(0); // never even built a model
    expect(verdictFor(a).text).toBe('not checked · no on-device model');
    expect(getLedger().every((x) => x.source === 'blocked' && x.sentToCloud === '')).toBe(true);
  });

  it('without a model, only the practice page plays the recorded sample draft, labelled', async () => {
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    const file = demoFile() as DemoFile;
    expect(file.draft?.sentences.length).toBeGreaterThan(0);
    const e = new DraftEngine();
    e.setHistory(demoHistory(file).facts);
    e.seedRecordings(file.draft!.sentences);
    // Anywhere else: still blocked, even for the exact sample sentence.
    const elsewhere = await done(e, file.draft!.text);
    expect(elsewhere.blocked).toBe(true);
    e.useRecordings = true;
    const sample = await done(e, file.draft!.text);
    expect(sample.blocked).toBe(false);
    expect(sample.recorded).toBe(true);
    expect(sample.after.p50).toBeLessThan(sample.before.p50);
    expect(verdictFor(sample).text).toMatch(/^recorded · one of ~/);
    expect(calls.modes).toHaveLength(0);
    // Your own words on the practice page are not faked.
    const own = await done(e, 'I live in Duluth and I teach high school chemistry.');
    expect(own.blocked).toBe(true);
    expect(own.recorded).toBe(false);
  });
});

describe('blur and history scan', () => {
  it('Blur rewrites on-device', async () => {
    const r = await new DraftEngine().blur('I am an ICU nurse in Columbus.');
    expect(r.rewrite).toBe('I am an healthcare worker.');
    expect(r.source).toBe('on_device');
    expect(new Set(calls.modes)).toEqual(new Set(['only_on_device']));
  });

  it(`scans pasted posts on-device, at most ${MAX_HISTORY_POSTS}`, async () => {
    const posts = fromPaste(Array.from({ length: 80 }, (_, i) => (i % 10 === 0 ? `Post ${i}: I'm a single mom of twins and it's a lot.` : `Post ${i}: the weather was grey again today, nothing new.`)).join('\n\n'));
    expect(posts).toHaveLength(80);
    const res = await new DraftEngine().scanHistory(posts, () => undefined);
    expect(res.considered).toBe(MAX_HISTORY_POSTS);
    expect(res.done).toBe(MAX_HISTORY_POSTS);
    expect(calls.prompts).toHaveLength(MAX_HISTORY_POSTS);
    expect(res.facts.filter((f) => f.cat === 'family')).toHaveLength(8);
    expect(calls.modes.every((m) => m === 'only_on_device')).toBe(true); // models are cached per mode
    expect(getLedger().every((x) => x.mode === 'ONLY_ON_DEVICE' && x.sentToCloud === '')).toBe(true);
  });
});

describe('pill copy', () => {
  it('reads like "one of ~X → ~Y if you post this", and never calls a draft "safe"', async () => {
    const e = new DraftEngine();
    e.setHistory(demoHistory(demoFile() as DemoFile).facts);
    const a = await done(e, 'I work nights as an ICU nurse in Columbus.');
    expect(verdictFor(a).text).toMatch(/^one of ~[\d.,kMB]+ → ~[\d.,kMB]+ if you post this$/);
    const quiet = await done(e, 'Honestly the weather is grey again.');
    const all = [verdictFor(a), verdictFor(quiet), verdictFor({ ...a, pending: true, read: 0 }), verdictFor({ ...a, pending: true, read: 0 }, { scanning: true }), verdictFor({ ...a, blocked: true }), verdictFor({ ...quiet, error: 'busy' })];
    for (const v of all) expect(`${v.text} ${v.detail ?? ''}`).not.toMatch(/\bsafe/i);
  });

  it('splits sentences like the web app’s Draft panel', () => {
    expect(splitSentences('Hi. I am a nurse in Columbus!\nMy twins are 4? ok')).toEqual(['I am a nurse in Columbus!', 'My twins are 4?']);
  });
});

describe('whole file', () => {
  it('every model the extension built in this file was ONLY_ON_DEVICE (extract and blur)', () => {
    expect(calls.everMode.length).toBeGreaterThanOrEqual(2);
    expect(new Set(calls.everMode)).toEqual(new Set(['only_on_device']));
  });
});

describe('demo history', () => {
  it('is the synthetic persona, re-checked by verify(), without the answer key', () => {
    const f = demoFile();
    expect(f.synthetic).toBe(true);
    expect(JSON.stringify(f)).not.toMatch(/"truth"|"traps"/);
    const h = demoHistory(f as DemoFile);
    expect(h.label).toMatch(/^SYNTHETIC/);
    expect(h.facts.length).toBeGreaterThan(0);
    expect(h.facts.length).toBeLessThanOrEqual(f.facts.length);
    // The recording's "my sister in Seattle" fact is someone else's: today's checker drops it.
    expect(h.facts.some((x) => x.value === 'Seattle')).toBe(false);
  });
});
