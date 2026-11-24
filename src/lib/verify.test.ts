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
