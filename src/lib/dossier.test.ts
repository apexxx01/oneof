import { describe, expect, it } from 'vitest';
import { buildDossier, rateKey } from './dossier';
import type { BaseRate, Fact } from './types';

const fact = (cat: Fact['cat'], value: string, quote = value): Fact => ({ id: value, postId: value, date: '2024-01-01', cat, value, quote, certainty: 'stated', source: 'on_device' });

describe('only cited base rates narrow the crowd', () => {
  const cook = fact('occupation', 'home cook');
  const guessed: BaseRate = { key: rateKey(cook), label: 'home cook', cat: 'occupation', low: 0.005, high: 0.01, grade: 'C', source: 'Model estimate, no source: guess', origin: 'cloud' };
  const grounded: BaseRate = { ...guessed, grade: 'B', source: 'BLS', url: 'https://www.bls.gov/x', origin: 'cloud' };

  it('ignores an unsourced model estimate', () => {
    const d = buildDossier([cook], new Map([[guessed.key, guessed]]));
    expect(d.attributes).toHaveLength(0);
    expect(d.unresolved.map((f) => f.value)).toContain('home cook');
  });
  it('counts a grounded lookup with a source', () => {
    const d = buildDossier([cook], new Map([[grounded.key, grounded]]));
    expect(d.attributes.map((a) => a.rate.label)).toEqual(['home cook']);
  });
  it('keeps bundled tables', () => {
    const d = buildDossier([fact('occupation', 'registered nurse', 'as a registered nurse')]);
    expect(d.attributes[0].rate.origin).toBe('bundled');
  });
});

describe('life events map to family and relationship rates', () => {
  it('counts "since the divorce" filed as a dated event as divorced', () => {
    const d = buildDossier([fact('dated_event', 'divorce', 'since the divorce I have learned')]);
    expect(d.attributes.map((a) => a.rate.key)).toEqual(['relationship:divorced']);
  });
});
