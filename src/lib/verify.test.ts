import { describe, expect, it } from 'vitest';
import { verify } from './verify';
import type { RawFact } from './schemas';

// Regression cases taken verbatim from real Gemini Nano output in spike S1 (Nov 24).
const post = (text: string) => ({ id: 'p', date: '2024-01-01', text });
const fact = (o: Partial<RawFact>): RawFact => ({ p: 0, cat: 'other', value: 'x', quote: 'x', about_self: true, certainty: 'stated', ...o });

describe('verify (deterministic gate after the model)', () => {
  const cases: Array<[string, RawFact, string, boolean]> = [
    ['placeholder place', fact({ cat: 'home_location', value: 'near me', quote: 'new bakery opened near me' }), 'new bakery opened near me and my diet has officially ended', false],
    ['placeholder job', fact({ cat: 'occupation', value: 'unknown', quote: 'cleaned my inbox' }), 'finally cleaned my inbox. 4000 unread to zero.', false],
    ['generic hobby', fact({ cat: 'rare_hobby', value: 'board games', quote: 'board games exist' }), 'the power went out and I remembered that board games exist', false],
    ['generic hobby 2', fact({ cat: 'rare_hobby', value: 'watching football highlights', quote: 'watching football highlights at 2am' }), 'watching football highlights at 2am is self care, right', false],
    ['hypothetical', fact({ cat: 'family', value: 'parent of five children', quote: 'having five kids' }), 'imagine having five kids. some days I am already a ghost', false],
    ['not a place', fact({ cat: 'home_location', value: 'glove box', quote: 'they are in the glove box' }), 'the doctor on duty tonight asked me where the gloves are. they are in the glove box', false],
    ['self placeholder', fact({ cat: 'relationship', value: 'self', quote: 'when you reach your destination' }), 'why do all the good songs come on when you reach your destination', false],
    ['paraphrased quote', fact({ cat: 'vehicle', value: 'red car', quote: 'my red car' }), 'my red Subaru has survived more potholes', false],
    ['real: nurse', fact({ cat: 'occupation', value: 'registered nurse', quote: 'as a registered nurse' }), 'as a registered nurse I promise you nobody reads the discharge paperwork', true],
    ['real: city', fact({ cat: 'home_location', value: 'Columbus', quote: 'here in Columbus' }), 'it has rained for nine days straight here in Columbus', true],
    ['real: single mom', fact({ cat: 'family', value: 'single mother', quote: 'single mom' }), 'being a single mom on night shifts means coffee is a food group', true],
    ['real: night shift', fact({ cat: 'work_location', value: 'night shift', quote: 'after a night shift' }), 'after a night shift the sunrise feels like a personal insult', true],
  ];
  for (const [name, f, text, ok] of cases) {
    it(`${ok ? 'keeps' : 'drops'}: ${name}`, () => expect(verify(f, post(text)).ok).toBe(ok));
  }
});

describe('rules tuned on SynthPAI dev personas', () => {
  const post = (text: string) => ({ id: 'x', date: '2024-01-01', text });
  const fact = (cat: 'occupation' | 'rare_hobby' | 'age' | 'family', value: string, quote: string, certainty: 'stated' | 'implied' = 'implied') => ({ p: 0, cat, value, quote, about_self: true, certainty });
  it('drops jobs that name nothing', () => {
    expect(verify(fact('occupation', 'grind', 'back to the grind', 'stated'), post('back to the grind')).ok).toBe(false);
    expect(verify(fact('occupation', 'person', 'as a person', 'stated'), post('as a person who hates mornings')).ok).toBe(false);
  });
  it('keeps a real implied job', () => {
    expect(verify(fact('occupation', 'software developer', 'debugging my code all day'), post('debugging my code all day, send help')).ok).toBe(true);
  });
  it('drops a job named with "the" (someone else\'s), keeps one the author claims', () => {
    const t = 'the bus driver waited for me this morning';
    expect(verify({ p: 0, cat: 'occupation', value: 'bus driver', quote: 'the bus driver waited for me', about_self: true, certainty: 'stated' }, post(t)).why).toBe('about someone else');
    const c = 'as the night charge nurse I see everything';
    expect(verify({ p: 0, cat: 'occupation', value: 'night charge nurse', quote: 'as the night charge nurse', about_self: true, certainty: 'stated' }, post(c)).ok).toBe(true);
  });
  it('drops figurative ages ("I feel 80 years old"), keeps real ones', () => {
    const t = 'I feel 80 years old after that shift';
    expect(verify({ p: 0, cat: 'age', value: '80 years old', quote: 'I feel 80 years old', about_self: true, certainty: 'stated' }, post(t)).why).toBe('figure of speech');
    expect(verify({ p: 0, cat: 'age', value: '80', quote: '80 years old', about_self: true, certainty: 'stated' }, post(t)).why).toBe('figure of speech');
    const r = 'I turned 34 last week and nobody noticed';
    expect(verify({ p: 0, cat: 'age', value: '34', quote: 'I turned 34', about_self: true, certainty: 'stated' }, post(r)).ok).toBe(true);
  });
  it('drops implied hobbies and ages, keeps stated ones', () => {
    expect(verify(fact('rare_hobby', 'chili enthusiast', 'good chili recipe'), post('anyone have a good chili recipe')).ok).toBe(false);
    expect(verify(fact('age', '30s', 'back in my day'), post('back in my day we walked')).ok).toBe(false);
    expect(verify(fact('age', '34', 'I turned 34', 'stated'), post('I turned 34 today')).ok).toBe(true);
  });
  it('keeps implied family roles (Nano marks "being a single mom" as implied) but drops vague ones', () => {
    expect(verify(fact('family', 'single mom', 'being a single mom'), post('being a single mom on night shifts')).ok).toBe(true);
    expect(verify(fact('family', 'member of group', 'the group chat'), post('the group chat has been silent')).ok).toBe(false);
  });
});

describe('facts about relatives (seen live on Nano)', () => {
  const post = (text: string) => ({ id: 'x', date: '2024-01-01', text });
  it('drops "my sister in Seattle" as the author\'s location', () => {
    const text = 'my sister in Seattle says it is cold there';
    expect(verify({ p: 0, cat: 'home_location', value: 'Seattle', quote: text, about_self: true, certainty: 'stated' }, post(text)).ok).toBe(false);
  });
  it('keeps the author\'s own city', () => {
    const text = 'it has rained for nine days straight here in Columbus';
    expect(verify({ p: 0, cat: 'home_location', value: 'Columbus', quote: text, about_self: true, certainty: 'stated' }, post(text)).ok).toBe(true);
  });
  it('still keeps "my husband" as a relationship fact', () => {
    const text = 'my husband works nights too';
    expect(verify({ p: 0, cat: 'relationship', value: 'married', quote: 'my husband', about_self: true, certainty: 'implied' }, post(text)).ok).toBe(true);
  });
});
