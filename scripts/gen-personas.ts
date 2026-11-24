/**
 * Deterministic synthetic persona generator. NO REAL PEOPLE.
 * Writes public/personas/<id>.json with posts + a ground-truth answer key:
 *   truth: facts about the author that a good extractor should find
 *   traps: facts that look identifying but are NOT about the author (jokes, other people, hypotheticals)
 * Run: npx tsx scripts/gen-personas.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';

type Cat = string;
interface Planted { cat: Cat; value: string; quote: string; text: string }
interface Post { id: string; date: string; text: string; subreddit: string }

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- P1: "quietnight_rn" — night-shift nurse, Columbus OH (SYNTHETIC — not a real person) ----------
const P1_FACTS: Planted[] = [
  { cat: 'occupation', value: 'registered nurse', quote: 'as a registered nurse', text: 'as a registered nurse I promise you nobody reads the discharge paperwork' },
  { cat: 'home_location', value: 'Columbus', quote: 'here in Columbus', text: 'it has rained for nine days straight here in Columbus, my socks are a lost cause' },
  { cat: 'family', value: 'single mother', quote: 'single mom', text: 'being a single mom on night shifts means coffee is a food group' },
  { cat: 'gender', value: 'female', quote: 'single mom tip', text: 'single mom tip: label everything, even the labels' },
  { cat: 'relationship', value: 'divorced', quote: 'since the divorce', text: 'since the divorce I have learned to fix the water heater myself' },
  { cat: 'work_location', value: 'night shift', quote: 'after a night shift', text: 'after a night shift the sunrise feels like a personal insult' },
  { cat: 'relationship', value: 'left an abusive ex', quote: 'since I left him', text: 'three years since I left him. the quiet still surprises me' },
  { cat: 'pet', value: 'cat owner', quote: 'my cat', text: 'my cat has decided the laundry basket is his kingdom now' },
];

const P1_TRAPS: Planted[] = [
  { cat: 'occupation', value: 'astronaut', quote: 'as an astronaut', text: 'lol as an astronaut I can confirm that the moon is overrated' },
  { cat: 'home_location', value: 'Seattle', quote: 'my sister in Seattle', text: 'my sister in Seattle says it is cold there. 45 degrees is not cold' },
  { cat: 'vehicle', value: 'Harley', quote: 'if I had a Harley', text: 'if I had a Harley I would ride to the coast and never come back' },
  { cat: 'occupation', value: 'software engineer', quote: 'my brother is a software engineer', text: 'my brother is a software engineer and he still cannot fix my printer' },
  { cat: 'family', value: 'five kids', quote: 'imagine having five kids', text: 'imagine having five kids. some days I am already a ghost' },
  { cat: 'home_location', value: 'Chicago', quote: 'my friend moved to Chicago', text: 'my friend moved to Chicago and now pays my salary in rent' },
  { cat: 'age', value: '80 years old', quote: 'I feel 80 years old', text: 'I feel 80 years old after that shift' },
  { cat: 'occupation', value: 'doctor', quote: 'the doctor on duty', text: 'the doctor on duty tonight asked me where the gloves are. they are in the glove box' },
];

/** The hero draft (typed live in the video): two new facts that combine with the history. */
export const P1_DRAFT = 'Twelve years in the ICU and my twins just started kindergarten, so if anyone knows a sitter who covers nights, DM me.';

const NOISE = [
  'anyone else think the new phone update made the battery worse',
  'what is the best way to get coffee stains out of scrubs',
  'this subreddit has ruined me, I now judge every cup of coffee',
  'unpopular opinion: rain is only nice when you do not have to go anywhere',
  'is it normal for a slow cooker to smell this good at 6am',
  'just watched that new thriller everyone recommended. the ending made no sense',
  'reminder to drink water. that is it, that is the post',
  'why do all the good songs come on when you reach your destination',
  'cannot decide between learning guitar or keyboard, help',
  'pumpkin spice season started in august and I am not ok',
  'tried meal prepping on Sunday. by Tuesday I was eating cereal',
  'does anyone have a good chili recipe that is not boring',
  'my plants are thriving and I have no idea why',
  'today I learned octopuses have three hearts',
  'the group chat has been silent for six hours, someone is planning something',
  'how do people wake up at 5am voluntarily',
  'finally cleaned my inbox. 4000 unread to zero. I am a new person',
  'what book got you out of a reading slump',
  'the power went out and I remembered that board games exist',
  'can we talk about how expensive eggs are right now',
  'my alarm and I are no longer on speaking terms',
  'watching football highlights at 2am is self care, right',
  'just realised I have been pronouncing quinoa wrong for years',
  'is there any app that actually helps with budgeting',
  'the bus driver waited for me this morning and I want to thank him publicly',
  'nothing humbles you like a toddler asking why the sky is blue on repeat',
  'what is the most useless thing you own but refuse to throw away',
  'does anyone else talk to their phone when the internet is slow',
  'new bakery opened near me and my diet has officially ended',
  'I organised my spice rack alphabetically and I feel unstoppable',
];

function buildPersona(opts: {
  id: string; handle: string; seed: number; total: number; startYear: number; years: number;
  facts: Planted[]; traps: Planted[]; subs: string[];
}) {
  const r = rng(opts.seed);
  const slots: Array<{ kind: 'fact' | 'trap' | 'noise'; item?: Planted; text: string }> = [];
  for (const f of opts.facts) slots.push({ kind: 'fact', item: f, text: f.text });
  for (const t of opts.traps) slots.push({ kind: 'trap', item: t, text: t.text });
  while (slots.length < opts.total) {
    const base = NOISE[Math.floor(r() * NOISE.length)];
    const tail = r() < 0.35 ? ['', ' lol', ' honestly', ' 😭', ' (serious question)', '!!'][Math.floor(r() * 6)] : '';
    slots.push({ kind: 'noise', text: base + tail });
  }
  // shuffle deterministically
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const start = Date.UTC(opts.startYear, 0, 1);
  const span = opts.years * 365 * 24 * 3600 * 1000;
  const dates = slots.map(() => start + Math.floor(r() * span)).sort((a, b) => a - b);
  const posts: Post[] = [];
  const truth: Array<{ postId: string; cat: Cat; value: string; quote: string }> = [];
  const traps: Array<{ postId: string; cat: Cat; value: string; quote: string }> = [];
  slots.forEach((s, i) => {
    const id = `${opts.id}_${String(i).padStart(4, '0')}`;
    posts.push({ id, date: new Date(dates[i]).toISOString(), text: s.text, subreddit: opts.subs[Math.floor(r() * opts.subs.length)] });
    if (s.kind === 'fact' && s.item) truth.push({ postId: id, cat: s.item.cat, value: s.item.value, quote: s.item.quote });
    if (s.kind === 'trap' && s.item) traps.push({ postId: id, cat: s.item.cat, value: s.item.value, quote: s.item.quote });
  });
  return { id: opts.id, handle: opts.handle, synthetic: true, generator: 'scripts/gen-personas.ts', seed: opts.seed, posts, truth, traps };
}

const p1 = buildPersona({
  id: 'p1', handle: 'quietnight_rn', seed: 20261120, total: 200, startYear: 2019, years: 6,
  facts: P1_FACTS, traps: P1_TRAPS,
  subs: ['nursing', 'Columbus', 'Parenting', 'running', 'Cooking', 'AskReddit', 'Ohio'],
});

mkdirSync('public/personas', { recursive: true });
writeFileSync('public/personas/p1.json', JSON.stringify({ ...p1, draft: P1_DRAFT }, null, 2));
console.log(`p1: ${p1.posts.length} posts, ${p1.truth.length} planted facts, ${p1.traps.length} traps`);
