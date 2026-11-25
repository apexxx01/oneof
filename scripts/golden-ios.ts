/**
 * Cross-language golden fixtures for the Swift port (ios/OneOfCore).
 * Usage: npx tsx scripts/golden-ios.ts
 *
 * Every expected value is produced by calling the real TypeScript functions. Nothing is typed by
 * hand. Inputs are hand-written or taken from public/personas; outputs are recorded.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from '../src/lib/verify';
import { cloudSafeAttribute } from '../src/lib/attribute';
import { estimate, humanCount, mulberry32 } from '../src/lib/estimate';
import { buildDossier, crowdNow, crumbTrail, leftTheCrowd, minimumFix, rateKey } from '../src/lib/dossier';
import { AFFINITY, DEFAULT_REGION, PACK, REGIONS, liftFor, matchPack, matchRegion } from '../src/data/baserates';
import { playReplay, type Replay } from '../src/lib/replay';
import type { RawFact } from '../src/lib/schemas';
import type { Attribute, BaseRate, Fact, Post, Region } from '../src/lib/types';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outPath = resolve(root, 'ios/OneOfCore/Tests/OneOfCoreTests/Resources/golden.json');

// ---------- helpers ----------
const P = (text: string, id = 'p', date = '2024-01-01'): Post => ({ id, date, text });
const RF = (o: Partial<RawFact>): RawFact => ({ p: 0, cat: 'other', value: 'x', quote: 'x', about_self: true, certainty: 'stated', ...o });
const F = (id: string, postId: string, cat: Fact['cat'], value: string, quote = value, date = '2024-01-01', certainty: Fact['certainty'] = 'stated'): Fact =>
  ({ id, postId, date, cat, value, quote, certainty, source: 'on_device' });

const stripAliases = <T extends { aliases: RegExp }>(x: T): Omit<T, 'aliases'> => {
  const { aliases: _a, ...rest } = x;
  void _a;
  return rest;
};

function regionByKey(key: string): Region {
  const r = REGIONS.find((x) => x.key === key);
  if (!r) throw new Error(`no region ${key}`);
  return stripAliases(r) as Region;
}

function bundledAttr(key: string): Attribute {
  const p = PACK.find((x) => x.key === key);
  if (!p) throw new Error(`no PACK entry ${key}`);
  return { rate: { ...stripAliases(p), origin: 'bundled' } as BaseRate, facts: [], firstSeen: '2024-01-01' };
}

// ---------- 1. mulberry32 ----------
const mulberry = [7, 123456789, 0].map((seed) => {
  const rnd = mulberry32(seed);
  return { seed, first10: Array.from({ length: 10 }, () => rnd()) };
});

// ---------- 2. verify ----------
const verifyCases: Array<{ fact: RawFact; post: Post }> = [];
const addV = (fact: Partial<RawFact>, text: string, post = P(text)) => verifyCases.push({ fact: RF(fact), post });

// every case from verify.test.ts
addV({ cat: 'home_location', value: 'near me', quote: 'new bakery opened near me' }, 'new bakery opened near me and my diet has officially ended');
addV({ cat: 'occupation', value: 'unknown', quote: 'cleaned my inbox' }, 'finally cleaned my inbox. 4000 unread to zero.');
addV({ cat: 'rare_hobby', value: 'board games', quote: 'board games exist' }, 'the power went out and I remembered that board games exist');
addV({ cat: 'rare_hobby', value: 'watching football highlights', quote: 'watching football highlights at 2am' }, 'watching football highlights at 2am is self care, right');
addV({ cat: 'family', value: 'parent of five children', quote: 'having five kids' }, 'imagine having five kids. some days I am already a ghost');
addV({ cat: 'home_location', value: 'glove box', quote: 'they are in the glove box' }, 'the doctor on duty tonight asked me where the gloves are. they are in the glove box');
addV({ cat: 'relationship', value: 'self', quote: 'when you reach your destination' }, 'why do all the good songs come on when you reach your destination');
addV({ cat: 'vehicle', value: 'red car', quote: 'my red car' }, 'my red Subaru has survived more potholes');
addV({ cat: 'occupation', value: 'registered nurse', quote: 'as a registered nurse' }, 'as a registered nurse I promise you nobody reads the discharge paperwork');
addV({ cat: 'home_location', value: 'Columbus', quote: 'here in Columbus' }, 'it has rained for nine days straight here in Columbus');
addV({ cat: 'family', value: 'single mother', quote: 'single mom' }, 'being a single mom on night shifts means coffee is a food group');
addV({ cat: 'work_location', value: 'night shift', quote: 'after a night shift' }, 'after a night shift the sunrise feels like a personal insult');

// verify.test.ts: SynthPAI rules
addV({ cat: 'occupation', value: 'grind', quote: 'back to the grind', certainty: 'stated' }, 'back to the grind');
addV({ cat: 'occupation', value: 'person', quote: 'as a person', certainty: 'stated' }, 'as a person who hates mornings');
addV({ cat: 'occupation', value: 'software developer', quote: 'debugging my code all day', certainty: 'implied' }, 'debugging my code all day, send help');
addV({ cat: 'rare_hobby', value: 'chili enthusiast', quote: 'good chili recipe', certainty: 'implied' }, 'anyone have a good chili recipe');
addV({ cat: 'age', value: '30s', quote: 'back in my day', certainty: 'implied' }, 'back in my day we walked');
addV({ cat: 'age', value: '34', quote: 'I turned 34', certainty: 'stated' }, 'I turned 34 today');
addV({ cat: 'family', value: 'single mom', quote: 'being a single mom', certainty: 'implied' }, 'being a single mom on night shifts');
addV({ cat: 'family', value: 'member of group', quote: 'the group chat', certainty: 'implied' }, 'the group chat has been silent');

// verify.test.ts: relatives
addV({ cat: 'home_location', value: 'Seattle', quote: 'my sister in Seattle says it is cold there', certainty: 'stated' }, 'my sister in Seattle says it is cold there');
addV({ cat: 'home_location', value: 'Columbus', quote: 'it has rained for nine days straight here in Columbus', certainty: 'stated' }, 'it has rained for nine days straight here in Columbus');
addV({ cat: 'relationship', value: 'married', quote: 'my husband', certainty: 'implied' }, 'my husband works nights too');

// privacy.test.ts post (the only verify-relevant text there)
const privacyPost = 'as a registered nurse at St. Luke’s in Boise I work nights';
addV({ cat: 'occupation', value: 'registered nurse', quote: 'as a registered nurse' }, privacyPost);
addV({ cat: 'work_location', value: 'night shift', quote: 'work nights' }, privacyPost);
addV({ cat: 'work_location', value: 'Boise', quote: 'in Boise' }, privacyPost);

// about_self false / uncategorized
addV({ cat: 'occupation', value: 'registered nurse', quote: 'as a registered nurse', about_self: false }, 'as a registered nurse I promise');
addV({ cat: 'other', value: 'coffee mug', quote: 'my mug' }, 'my mug is cold');

// placeholders (each entry of PLACEHOLDER, case-insensitive, plus word-boundary negatives)
for (const v of ['unknown', 'unspecified', 'not specified', 'n/a', 'none', 'near me', 'somewhere', 'location', 'self', 'myself', 'me', 'Unknown', 'NEAR ME', 'the location']) {
  addV({ cat: 'home_location', value: v, quote: 'today' }, 'today was fine');
}
addV({ cat: 'rare_hobby', value: 'medicine', quote: 'medicine' }, 'I love medicine');
addV({ cat: 'rare_hobby', value: 'mean', quote: 'mean' }, 'that is mean');

// quote not in post
addV({ cat: 'occupation', value: 'teacher', quote: 'I teach kids' }, 'I teach');

// smart quote normalisation
addV({ cat: 'relationship', value: 'parent', quote: "kid's school" }, 'my kid’s school is great');
addV({ cat: 'relationship', value: 'married', quote: 'said “hi”' }, 'she said "hi" to me');
addV({ cat: 'relationship', value: 'married', quote: '‘hi’' }, "she said 'hi' to me");

// every THIRD_PARTY category blocked when the quote names a relative
const thirdParty: Array<[Fact['cat'], string]> = [
  ['home_location', 'Seattle'], ['work_location', 'Mercy Hospital'], ['occupation', 'nurse'], ['employer_type', 'hospital'],
  ['education', 'BSN'], ['vehicle', 'Subaru'], ['pet', 'cat'], ['rare_hobby', 'chess'], ['age', '34'],
];
for (const [cat, value] of thirdParty) addV({ cat, value, quote: 'my sister lives in Seattle' }, 'my sister lives in Seattle');
// relatives are fine for non-third-party categories
addV({ cat: 'family', value: 'sister', quote: 'my sister' }, 'my sister');
addV({ cat: 'relationship', value: 'married', quote: 'my husband' }, 'my husband works nights');
addV({ cat: 'health', value: 'asthma', quote: 'my sister has asthma' }, 'my sister has asthma');
// every SOMEONE_ELSE alternative
for (const w of ['sister', 'brother', 'cousin', 'friend', 'best friend', 'bff', 'mom', 'mum', 'mother', 'dad', 'father', 'aunt', 'uncle',
  'grandma', 'grandpa', 'grandmother', 'grandfather', 'neighbor', 'neighbour', 'coworker', 'co-worker', 'colleague', 'boss',
  'roommate', 'son', 'daughter', 'kid', 'niece', 'nephew', 'in-law', 'in-laws', 'sisters']) {
  addV({ cat: 'occupation', value: 'nurse', quote: `my ${w} is a nurse` }, `my ${w} is a nurse`);
}

// hypotheticals (each HYPOTHETICAL alternative) and a negative where the hedge comes after the quote
for (const h of ['imagine', 'if i had', 'if i were', 'if i was', 'if i lived', 'i wish i', 'someday', 'hypothetically', 'pretend']) {
  addV({ cat: 'pet', value: 'cat', quote: 'I had a cat' }, `${h} I had a cat`);
}
addV({ cat: 'pet', value: 'cat', quote: 'I have two cats' }, 'I have two cats. imagine that');

// generic hobbies (each GENERIC alternative)
for (const v of ['board games', 'football', 'soccer', 'basketball', 'music', 'movies', 'tv', 'netflix', 'reading', 'books', 'gaming',
  'video games', 'coffee', 'tea', 'sleep', 'food', 'baking', 'walking', 'shopping', 'travel', 'cooking']) {
  addV({ cat: 'rare_hobby', value: v, quote: v }, `I love ${v} lately`);
}
addV({ cat: 'rare_hobby', value: 'half marathon', quote: 'half marathon' }, 'I trained for a half marathon');

// vague jobs (VAGUE_OCCUPATION) and trimming
for (const v of ['job', 'a job', 'work', 'worker', 'grind', 'person', 'people', 'professional', 'expert', 'individual', 'employee', 'staff', 'someone', 'flexible hours', 'intellectual pursuits', 'career']) {
  addV({ cat: 'occupation', value: v, quote: v }, `as ${v} I suffer`);
}
addV({ cat: 'employer_type', value: 'person', quote: 'person' }, 'as person I suffer');
addV({ cat: 'occupation', value: ' person ', quote: ' person ' }, 'as a person I suffer');
addV({ cat: 'occupation', value: 'social worker', quote: 'social worker' }, 'I am a social worker');

// implied hobby / age, stated hobby / age
addV({ cat: 'rare_hobby', value: 'chili enthusiast', quote: 'chili', certainty: 'implied' }, 'chili time');
addV({ cat: 'rare_hobby', value: 'chili enthusiast', quote: 'chili', certainty: 'stated' }, 'chili time');
addV({ cat: 'age', value: '30s', quote: '30s', certainty: 'implied' }, 'I am in my 30s');
addV({ cat: 'age', value: '34', quote: 'turned 34', certainty: 'implied' }, 'turned 34 today');

// implied family: role vs no role; stated family always passes this rule
addV({ cat: 'family', value: 'member of group', quote: 'group', certainty: 'implied' }, 'group chat');
addV({ cat: 'family', value: 'divorced', quote: 'divorced', certainty: 'implied' }, 'I am divorced');
addV({ cat: 'family', value: 'twins', quote: 'twins', certainty: 'implied' }, 'my twins');
addV({ cat: 'family', value: 'member of group', quote: 'group', certainty: 'stated' }, 'group chat');
addV({ cat: 'family', value: 'pet owner', quote: 'owner', certainty: 'implied' }, 'the owner');

// place name rule (lowercase without a capital, unless night|day|shift|remote|hospital|office)
addV({ cat: 'home_location', value: 'columbus', quote: 'columbus', certainty: 'stated' }, 'I live in columbus');
addV({ cat: 'home_location', value: 'Columbus', quote: 'Columbus', certainty: 'stated' }, 'I live in Columbus');
addV({ cat: 'work_location', value: 'night shift', quote: 'night shift' }, 'I work the night shift');
addV({ cat: 'work_location', value: 'NIGHT shift', quote: 'NIGHT shift' }, 'I work the NIGHT shift');
addV({ cat: 'work_location', value: 'remote', quote: 'remote' }, 'I work remote');
addV({ cat: 'work_location', value: 'the office', quote: 'the office' }, 'I miss the office');
addV({ cat: 'home_location', value: 'hospital', quote: 'hospital' }, 'stuck at the hospital');
addV({ cat: 'work_location', value: 'day shift', quote: 'day shift' }, 'on a day shift');

// grounding for each GROUNDED category (grounded vs ungrounded)
addV({ cat: 'home_location', value: 'Boise', quote: 'here in Columbus' }, 'I live here in Columbus');
addV({ cat: 'home_location', value: 'Columbus', quote: 'here in Columbus' }, 'I live here in Columbus');
addV({ cat: 'work_location', value: 'Mercy Hospital', quote: 'work at St Luke' }, 'I work at St Luke in Boise');
addV({ cat: 'work_location', value: 'Mercy Hospital', quote: 'work at Mercy Hospital' }, 'I work at Mercy Hospital');
addV({ cat: 'vehicle', value: 'Ford pickup', quote: 'my red Subaru' }, 'my red Subaru has potholes');
addV({ cat: 'vehicle', value: 'red Subaru', quote: 'my red Subaru' }, 'my red Subaru has potholes');
addV({ cat: 'pet', value: 'parrot', quote: 'my cat' }, 'my cat is asleep');
addV({ cat: 'pet', value: 'cat', quote: 'my cat' }, 'my cat is asleep');
addV({ cat: 'language', value: 'Tagalog', quote: 'I speak Spanish' }, 'I speak Spanish');
addV({ cat: 'language', value: 'Spanish', quote: 'I speak Spanish' }, 'I speak Spanish');
addV({ cat: 'education', value: 'MBA', quote: 'my BSN' }, 'my BSN is done');
addV({ cat: 'education', value: 'BSN', quote: 'my BSN' }, 'my BSN is done');
addV({ cat: 'employer_type', value: 'bank', quote: 'hospital work' }, 'hospital work all week');
addV({ cat: 'employer_type', value: 'hospital system', quote: 'hospital work' }, 'hospital work all week');
// tokens of length <= 2 never ground a value
addV({ cat: 'education', value: 'RN', quote: 'RN' }, 'I am an RN');
// plural does not match singular token ("nights" vs "night")
addV({ cat: 'work_location', value: 'night shift', quote: 'work nights' }, 'I work nights');

// Ok cases
addV({ cat: 'family', value: 'parent of twins', quote: 'my twins just started kindergarten' }, 'my twins just started kindergarten');
addV({ cat: 'pet', value: 'one-eyed cat', quote: 'my one-eyed cat' }, 'my one-eyed cat');
addV({ cat: 'vehicle', value: 'Subaru', quote: 'Subaru' }, 'my Subaru outback');

const verifyOut = verifyCases.map(({ fact, post }) => {
  const v = verify(fact, post);
  return { fact, post, ok: v.ok, why: v.why ?? null };
});

// ---------- 3. attribute ----------
const attrCases: Array<{ fact: { cat: string; value: string } }> = [];
const addA = (cat: string, value: string) => attrCases.push({ fact: { cat, value } });
// NEVER cats
for (const c of ['home_location', 'work_location', 'health', 'religion_community', 'dated_event', 'other']) addA(c, 'nurse');
addA('health', 'asthma');
addA('work_location', 'night shift');
addA('dated_event', 'moved in march');
addA('religion_community', 'Catholic');
// allowed
addA('occupation', 'registered nurse');
addA('family', 'parent of twins');
addA('occupation', 'ICU nurse');
addA('pet', 'my one-eyed cat');
addA('occupation', 'RN');
addA('education', 'BSN');
addA('occupation', 'ER/ICU & OR nurse');
addA('occupation', 'nurse  practitioner');
addA('occupation', 'nurse ');
addA('occupation', 'x');
addA('occupation', 'ICU');
addA('occupation', 'nurse-midwife');
addA('occupation', 'ICU-nurse');
addA('occupation', 'mcDonald cook');
addA('family', 'single mom');
addA('occupation', 'a nurse');
addA('family', 'my sister');
addA('vehicle', 'subaru/outback & forester');
addA('rare_hobby', 'half-marathon');
addA('rare_hobby', 'one two three four');
addA('occupation', 'our nurse');
addA('occupation', 'their nurse');
addA('occupation', 'my our his her their');
addA('occupation', 'HER');
addA('occupation', 'my');
addA('occupation', '  ');
// digits
addA('vehicle', '2014 subaru');
addA('occupation', '1st year');
addA('occupation', 'ICU nurse with 12 years');
// possessives (ASCII and curly)
addA('occupation', "nurse's aide");
addA('occupation', 'nurse’s aide');
addA('occupation', "chef's");
addA('occupation', 'chef’s');
addA('occupation', "rn's");
addA('employer_type', "St. Luke’s Boise");
// word count
addA('rare_hobby', 'restoring old wooden sailboats on weekends');
addA('rare_hobby', 'a b c d e');
// capitalised words are names
addA('vehicle', 'Subaru');
addA('employer_type', 'Mercy hospital');
addA('employer_type', 'St. Luke Boise');
addA('occupation', 'Registered Nurse');
addA('occupation', 'Ok');
addA('occupation', 'McDonald cook');
addA('occupation', 'Our Nurse');
// unusual characters
addA('occupation', 'nurse, rn');
addA('occupation', 'nurse.');
addA('occupation', '_nurse');
addA('occupation', 'nurses’');
addA('occupation', 'café owner');
addA('occupation', 'nurse_aide');
addA('occupation', '-nurse');
// privacy.test.ts examples
addA('employer_type', "St. Luke’s Boise");
addA('vehicle', '2014 subaru');
addA('home_location', 'boise');
addA('health', 'asthma');

const attrOut = attrCases.map(({ fact }) => ({ fact, result: cloudSafeAttribute(fact as never) }));

// ---------- 4. matchPack ----------
const packHits: Array<[string, string, string]> = [
  ['occupation', 'registered nurse', 'as a registered nurse'],
  ['occupation', 'ICU nurse', 'ICU nurse'],
  ['occupation', 'critical care nurse', 'critical care nurse'],
  ['occupation', 'software engineer', 'software engineer'],
  ['occupation', 'teacher', 'teacher'],
  ['occupation', 'teaching assistant', 'I teach'],
  ['gender', 'female', 'female'],
  ['gender', 'woman', 'woman'],
  ['family', 'single mom', 'single mom'],
  ['family', 'parent of twins', 'twins'],
  ['family', 'kindergartner', 'kindergarten'],
  ['relationship', 'divorced', 'divorced'],
  ['age', '34', 'turned 34'],
  ['rare_hobby', 'half marathon', 'half marathon'],
  ['vehicle', 'Subaru', 'my subaru'],
  ['education', 'BSN', 'BSN'],
  ['work_location', 'night shift', 'night shift'],
  ['dated_event', 'moved here', 'moved here'],
  ['pet', 'cat', 'my cat'],
  ['pet', 'one-eyed cat', 'one-eyed cat'],
  ['dated_event', 'medical volunteer', 'medical tent'],
  ['employer_type', 'nurse', 'nurse'],
  ['education', 'nurse', 'nurse'],
];
const packMisses: Array<[string, string, string]> = [
  ['occupation', 'plumber', 'plumber'],
  ['pet', 'dog', 'my dog'],
  ['gender', 'man', 'man'],
  ['health', 'asthma', 'asthma'],
  ['home_location', 'Columbus', 'here in Columbus'],
  ['rare_hobby', 'chess', 'chess'],
  ['vehicle', 'Honda Civic', 'civic'],
  ['relationship', 'married', 'married'],
  ['family', 'parent', 'parent'],
  ['age', 'twins', 'twins'],
  ['age', '34', 'I am 34'],
  ['vehicle', 'pickup', 'my pickup'],
  ['family', 'teacher', 'teacher'],
  ['health', 'nurse', 'nurse'],
  ['pet', 'cat', 'cat'],
  ['pet', 'cats', 'two cats'],
  ['occupation', '', 'as a nurse'],
  ['gender', 'female', 'she'],
  ['family', 'mum', 'mum'],
  ['education', 'MBA', 'MBA'],
  ['dated_event', 'moved', 'moved'],
];
const matchPackOut = [...packHits, ...packMisses].map(([cat, value, quote]) => ({
  cat, value, quote, key: matchPack(cat, value, quote)?.key ?? null,
}));
// Coverage: every PACK entry must be hit at least once.
for (const p of PACK) {
  if (!matchPackOut.some((c) => c.key === p.key)) throw new Error(`matchPack: no hit for ${p.key}`);
}

// ---------- 5. matchRegion ----------
const regionTexts = [
  'Columbus', 'clintonville', 'German Village', 'Short North', 'Olentangy', 'Franklin County', 'Columbus, Ohio',
  'Ohio', 'Cleveland', 'Dayton', 'buckeye state', 'USA', 'United States', 'America', 'American', 'Bengaluru', 'Bangalore',
  'Koramangala', 'Indiranagar', 'Whitefield', 'HSR layout', 'Seattle', 'Boise', 'California', '',
];
const matchRegionOut = regionTexts.map((text) => ({ text, key: matchRegion(text)?.key ?? null }));
for (const r of REGIONS) {
  if (!matchRegionOut.some((c) => c.key === r.key)) throw new Error(`matchRegion: no hit for ${r.key}`);
}

// ---------- 6. liftFor ----------
const liftOut: Array<{ key: string; present: string[]; lift: number; with: string | null }> = [];
const addLift = (key: string, present: string[]) => {
  const r = liftFor(key, present);
  liftOut.push({ key, present, lift: r.lift, with: r.with ?? null });
};
for (const pair of AFFINITY) {
  addLift(pair.a, [pair.b]);
  addLift(pair.b, [pair.a]);
}
addLift('occupation:nurse', []);
addLift('occupation:nurse', ['occupation:icu_nurse']);
addLift('occupation:nurse', ['gender:female', 'work:night_shift']);
addLift('occupation:nurse', ['work:night_shift', 'gender:female']);
addLift('pet:cat', ['occupation:nurse']);
addLift('family:twins', ['family:kindergartner', 'family:single_mother']);
addLift('family:single_mother', ['relationship:divorced', 'family:twins']);

// ---------- 7. rateKey ----------
const rateKeyCases: Array<{ cat: string; value: string }> = [
  { cat: 'occupation', value: 'Registered Nurse' },
  { cat: 'occupation', value: 'registered   nurse' },
  { cat: 'employer_type', value: "St. Luke’s Boise" },
  { cat: 'home_location', value: 'Columbus, OH' },
  { cat: 'pet', value: '  one-eyed   CAT!! ' },
  { cat: 'vehicle', value: '2014 Subaru/Outback' },
  { cat: 'family', value: 'single MOM' },
  { cat: 'rare_hobby', value: 'Half-Marathon' },
  { cat: 'occupation', value: '' },
  { cat: 'health', value: 'ASTHMA' },
];
const rateKeyOut = rateKeyCases.map((fact) => ({ fact, key: rateKey(fact) }));

// ---------- 8. humanCount ----------
const humanValues = [0.5, 1, 1.5, 2, 3, 9, 9.6, 10, 23.4, 99, 100, 555, 999, 1000, 1500, 9999, 10000, 12345, 99999, 100000,
  999999, 1000000, 1752753, 9999999, 10000000, 123456789, 999999999, 1000000000, 2500000000, 5000000000];
const humanOut = humanValues.map((n) => ({ n, s: humanCount(n) }));

// ---------- 9. estimate ----------
const estimateCombos: Array<{ region: string; attrs: string[] }> = [
  { region: 'us', attrs: [] },
  { region: 'us', attrs: ['occupation:nurse'] },
  { region: 'us', attrs: ['occupation:nurse', 'gender:female'] },
  { region: 'us', attrs: ['gender:female', 'occupation:nurse', 'work:night_shift'] },
  { region: 'us', attrs: ['family:single_mother', 'relationship:divorced'] },
  { region: 'us', attrs: ['family:single_mother', 'family:twins', 'family:kindergartner'] },
  { region: 'us', attrs: ['occupation:icu_nurse', 'education:bsn', 'occupation:nurse'] },
  { region: 'us', attrs: ['pet:one_eyed_cat', 'pet:cat'] },
  { region: 'us', attrs: ['event:race_medical_volunteer', 'hobby:half_marathon'] },
  { region: 'us:oh:franklin', attrs: ['occupation:teacher', 'age:single_year', 'pet:cat'] },
  { region: 'us:oh:franklin', attrs: ['family:twins', 'family:kindergartner', 'pet:one_eyed_cat'] },
  { region: 'us:oh:franklin', attrs: ['occupation:teacher', 'occupation:software_engineer', 'pet:cat', 'family:twins', 'event:moved_year', 'work:night_shift'] },
  { region: 'us:oh', attrs: ['family:single_mother', 'gender:female', 'relationship:divorced', 'family:kindergartner', 'work:night_shift', 'occupation:nurse'] },
  { region: 'us:oh', attrs: ['occupation:nurse', 'work:night_shift'] },
  { region: 'in:ka:bengaluru', attrs: [] },
  { region: 'in:ka:bengaluru', attrs: ['occupation:software_engineer', 'vehicle:subaru'] },
];
const estimateOut = [];
for (const combo of estimateCombos) {
  const region = regionByKey(combo.region);
  const attrs = combo.attrs.map(bundledAttr);
  for (const seed of [7, 42]) {
    estimateOut.push({ region, attrs, seed, result: estimate(region, attrs, seed) });
  }
}
// Region used by estimate for Bengaluru is grade C; also check the default region is what we expect.
if (DEFAULT_REGION.key !== 'us') throw new Error('unexpected default region');

// ---------- 10. dossier ----------
function dossierCase(name: string, facts: Fact[], extraRates: Array<[string, BaseRate]> = []) {
  const d = buildDossier(facts, new Map(extraRates));
  const trail = crumbTrail(d);
  const left = leftTheCrowd(trail);
  return {
    name,
    facts,
    extraRates,
    dossier: {
      regionKey: d.region.key,
      regionFactIds: d.regionFacts.map((f) => f.id),
      attributeKeys: d.attributes.map((a) => a.rate.key),
      attributeFactIds: d.attributes.map((a) => a.facts.map((f) => f.id)),
      attributeFirstSeen: d.attributes.map((a) => a.firstSeen),
      unresolvedIds: d.unresolved.map((f) => f.id),
      localOnlyIds: d.localOnly.map((f) => f.id),
    },
    crowd: crowdNow(d),
    trail: trail.map((p) => ({ date: p.date, added: p.added, estimate: p.estimate })),
    leftTheCrowdDate: left?.date ?? null,
    minimumFixKeys: minimumFix(d).map((a) => a.rate.key),
  };
}

// The p1 persona's facts, built the way the app does: playReplay() runs each recorded log entry
// through recheck() (verify.ts) against the persona's posts, and returns the kept facts.
const personaDir = resolve(root, 'public/personas');
const p1 = JSON.parse(readFileSync(resolve(personaDir, 'p1.json'), 'utf8')) as { posts: Array<{ id: string; date: string; text: string; subreddit?: string }> };
const replay = JSON.parse(readFileSync(resolve(personaDir, 'p1-replay.json'), 'utf8')) as Replay;
const postMap = new Map<string, Post>(p1.posts.map((p) => [p.id, { id: p.id, date: p.date, text: p.text, where: p.subreddit }]));
const playback = await playReplay(replay, 1e12, () => {}, undefined, postMap);
const p1Facts: Fact[] = playback.facts;
if (p1Facts.length === 0) throw new Error('p1 replay produced no facts');

const nurseRate = (key: string, low: number, high: number, grade: BaseRate['grade'], url?: string): BaseRate =>
  ({ key, label: key.split(':')[1].replace(/_/g, ' '), cat: 'occupation', low, high, grade, source: 'Test source', url, origin: 'cloud' });

const dossiers = [
  dossierCase('p1 full (all verified facts from p1-replay.json)', p1Facts),
  dossierCase('p1 first half of facts', p1Facts.slice(0, Math.floor(p1Facts.length / 2))),
  dossierCase('cloud rate cited (url + grade B) counts', [F('hc1', 'hc', 'occupation', 'home cook', 'home cook', '2024-03-01')],
    [[rateKey({ cat: 'occupation', value: 'home cook' }), nurseRate('occupation:home cook', 0.01, 0.02, 'B', 'https://www.bls.gov/x')]]),
  dossierCase('cloud rate uncited (grade C, no url) is ignored', [F('hc1', 'hc', 'occupation', 'home cook', 'home cook', '2024-03-01')],
    [[rateKey({ cat: 'occupation', value: 'home cook' }), nurseRate('occupation:home cook', 0.01, 0.02, 'C')]]),
  dossierCase('cloud rate with url but grade C is ignored', [F('hc1', 'hc', 'occupation', 'home cook', 'home cook', '2024-03-01')],
    [[rateKey({ cat: 'occupation', value: 'home cook' }), nurseRate('occupation:home cook', 0.01, 0.02, 'C', 'https://example.org/x')]]),
  dossierCase('cited live rate replaces a bundled grade C pack rate', [F('icu1', 'icu', 'occupation', 'ICU nurse', 'ICU nurse', '2024-03-01')],
    [[rateKey({ cat: 'occupation', value: 'ICU nurse' }), nurseRate('occupation:icu nurse', 0.001, 0.002, 'B', 'https://www.bls.gov/x')]]),
  dossierCase('empty fact list', []),
  dossierCase('nested family: nurse, ICU nurse, BSN', [
    F('n1', 'p1', 'occupation', 'registered nurse', 'as a registered nurse', '2024-01-05'),
    F('n2', 'p2', 'occupation', 'ICU nurse', 'ICU nurse', '2024-02-01'),
    F('n3', 'p3', 'education', 'BSN', 'BSN', '2024-03-01'),
  ]),
  dossierCase('health and religion stay local', [
    F('h1', 'p1', 'health', 'asthma', 'my asthma', '2024-01-01'),
    F('r1', 'p2', 'religion_community', 'Catholic', 'Catholic', '2024-02-01'),
    F('o1', 'p3', 'occupation', 'teacher', 'teacher', '2024-03-01'),
  ]),
  dossierCase('Bengaluru region', [
    F('b1', 'p1', 'home_location', 'Bengaluru', 'I live in Bengaluru', '2024-01-01'),
    F('b2', 'p2', 'occupation', 'teacher', 'teacher', '2024-02-01'),
    F('b3', 'p3', 'rare_hobby', 'half marathon', 'half marathon', '2024-03-01'),
  ]),
  dossierCase('gender is above the 15% cut and never narrows', [F('g1', 'p1', 'gender', 'female', 'female', '2024-01-01')]),
];

// ---------- write ----------
const golden = {
  mulberry32: mulberry,
  verify: verifyOut,
  attribute: attrOut,
  matchPack: matchPackOut,
  matchRegion: matchRegionOut,
  liftFor: liftOut,
  rateKey: rateKeyOut,
  humanCount: humanOut,
  estimate: estimateOut,
  dossier: dossiers,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(golden, null, 2) + '\n');

const counts = Object.fromEntries(Object.entries(golden).map(([k, v]) => [k, (v as unknown[]).length]));
console.log(`wrote ${outPath}`);
console.log(JSON.stringify(counts, null, 2));
console.log(`verify ok=${verifyOut.filter((c) => c.ok).length} dropped=${verifyOut.filter((c) => !c.ok).length}`);
