/**
 * The privacy promise as tests. If any of these fail, the headline claim is false.
 * No mocks of the router: these call the real route(), extractFromPost(), blurDraft() and
 * lookupBaseRate() in an environment with no Gemini Nano (like most judges' browsers).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BlockedError, blurDraft, extractFromPost, lookupBaseRate, matchPrompt, matchTable, parseMatch, route } from './ai';
import { PACK } from '../data/baserates';
import { getLedger, resetLedger } from './ledger';

const post = { id: 'p', date: '2024-01-01', text: 'as a registered nurse at St. Luke’s in Boise I work nights' };

describe('own data never leaves the device', () => {
  beforeEach(() => { resetLedger(); delete (globalThis as { LanguageModel?: unknown }).LanguageModel; });

  it('routes every task on own data to ONLY_ON_DEVICE (base rates excepted, see below)', () => {
    for (const task of ['extract', 'draft', 'blur'] as const) expect(route(task, 'own').mode).toBe('ONLY_ON_DEVICE');
  });

  it('blocks extraction of own posts when there is no on-device model, and sends nothing', async () => {
    await expect(extractFromPost(post, 'own')).rejects.toBeInstanceOf(BlockedError);
    expect(getLedger().every((e) => e.sentToCloud === '' && e.source !== 'in_cloud')).toBe(true);
  });

  it('cannot be forced to the cloud, even with the eval override', async () => {
    await expect(extractFromPost(post, 'own', 'extract', 'ONLY_IN_CLOUD')).rejects.toBeInstanceOf(BlockedError);
  });

  it('blocks drafts and blur without an on-device model', async () => {
    await expect(extractFromPost(post, 'own', 'draft')).rejects.toBeInstanceOf(BlockedError);
    await expect(blurDraft(post.text, 'own')).rejects.toBeInstanceOf(BlockedError);
  });

  it('never looks up a base rate whose value carries a name, number or place', async () => {
    const f = (cat: string, value: string) => ({ id: 'f', postId: 'p', date: '', cat: cat as never, value, quote: value, certainty: 'stated' as const, source: 'on_device' as const });
    for (const fact of [f('employer_type', 'St. Luke’s Boise'), f('vehicle', '2014 subaru'), f('home_location', 'boise'), f('health', 'asthma')]) {
      expect(await lookupBaseRate(fact, 'United States')).toBeUndefined();
    }
    expect(getLedger()).toHaveLength(0);
  });
  it('never asks the cloud to match a table for a value that carries a name, number or place', async () => {
    const f = (cat: string, value: string) => ({ id: 'f', postId: 'p', date: '', cat: cat as never, value, quote: value, certainty: 'stated' as const, source: 'on_device' as const });
    for (const fact of [f('employer_type', 'St. Luke’s Boise'), f('vehicle', '2014 subaru'), f('home_location', 'boise'), f('health', 'asthma')]) {
      expect((await matchTable(fact, 'United States')).asked).toBe(false);
    }
    expect(getLedger()).toHaveLength(0);
  });
});

describe('the cloud picks the table, never the number', () => {
  it('routes table matching to the cloud with a reason, for own and demo data alike', () => {
    expect(route('match', 'own').mode).toBe('ONLY_IN_CLOUD');
    expect(route('match', 'synthetic').mode).toBe('ONLY_IN_CLOUD');
  });
  it('sends only the generic attribute plus the public table list', () => {
    const p = matchPrompt('occupation: ICU charge nurse', 'United States');
    expect(p.startsWith('Attribute: occupation: ICU charge nurse\nCountry: United States\n\nTables:\n')).toBe(true);
    for (const t of PACK) expect(p).toContain(`${t.key}: ${t.label}`);
  });
  it('accepts only an existing table key; "none", junk or invented keys count as no match', () => {
    expect(parseMatch('{"table":"occupation:icu_nurse"}')).toBe('occupation:icu_nurse');
    expect(parseMatch('```json\n{"table": "work:night_shift"}\n```')).toBe('work:night_shift');
    expect(parseMatch('{"table":"none"}')).toBeUndefined();
    expect(parseMatch('{"table":"occupation:astronaut"}')).toBeUndefined();
    expect(parseMatch('{"low":0.01,"high":0.02}')).toBeUndefined();
    expect(parseMatch('not json')).toBeUndefined();
  });
});
