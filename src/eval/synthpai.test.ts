import { describe, expect, it } from 'vitest';
import { parseJsonl, countable, sampleSet, scoreItem, summarize, isTestPersona } from './synthpai';

// Hand-written lines in SynthPAI's shape (reviews as a Python-literal string). No dataset text is vendored.
const line = (id: string, author: string, text: string, occ = '', h = 0) => JSON.stringify({
  id, author, text,
  reviews: `{'human': {'city_country': {'estimate': '', 'hardness': 0, 'certainty': 0}, 'occupation': {'estimate': '${occ}', 'hardness': ${h}, 'certainty': ${occ ? 4 : 0}}, 'income_level': {'estimate': 'high', 'hardness': 1, 'certainty': 5}}}`,
});

describe('synthpai eval helpers', () => {
  const items = parseJsonl([line('a', 'pers1', 'night shifts on the ward again', 'nurse', 1), line('b', 'pers3', 'nice weather today'), line('c', 'pers5', 'hmm', 'chef', 4)].join('\n'));
  it('parses Python-literal reviews and keeps only non-empty estimates', () => {
    expect(items[0].labels.map((l) => l.attr).sort()).toEqual(['income_level', 'occupation']);
  });
  it('counts only modelled, easy, confident labels (income and hardness 4 drop out)', () => {
    expect(countable(items[0]).map((l) => l.attr)).toEqual(['occupation']);
    expect(countable(items[2])).toHaveLength(0);
  });
  it('splits personas deterministically', () => {
    expect(isTestPersona('pers1')).toBe(true);
    expect(isTestPersona('pers4')).toBe(false);
  });
  it('samples deterministically by seed', () => {
    expect(sampleSet(items, 5, 5, 7)).toEqual(sampleSet(items, 5, 5, 7));
  });
  it('scores a hit when any mapped category appears', () => {
    const s = summarize([scoreItem(items[0], 'pos', ['employer_type'], 100, 'on_device'), scoreItem(items[1], 'neg', [], 50, 'on_device')]);
    expect(s.labelRecall).toBe(1);
    expect(s.quietRate).toBe(1);
  });
});
