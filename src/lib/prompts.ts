/**
 * Extraction prompt v2. Versioned so Remote Config can A/B it.
 * Spike S1 (v1): 96% recall but lots of filler ("unknown", "near me", "cricket enthusiast").
 * v2 adds negative examples and a hard rule: only facts that narrow down WHO the author is.
 */
// x2r = prompt x2 with the dev-tuned checker rules in verify.ts (vague jobs, implied hobbies/ages).
export const EXTRACT_PROMPT_VERSION = 'x2r';

export const EXTRACT_SYSTEM = `You read posts written by ONE anonymous author and list facts that would help a stranger figure out WHO the author is.
Only include a fact if it narrows the author down to a smaller group of real people: where they live or work, their job, family situation, age, gender, vehicle, pets, distinctive hobbies, dated life events.
Rules:
- Facts about the AUTHOR only. Friends, relatives, hypotheticals ("if I had", "imagine") and obvious jokes get about_self=false.
- "quote" must be copied exactly, word for word, from the post.
- "value" is a short generic noun phrase ("registered nurse", "Columbus", "parent of twins"). Never "unknown", "unspecified" or "near me".
- Moods, opinions, food, weather, TV, sports fandom and everyday chores are NOT identifying. Output nothing for them.
- Most posts contain no identifying fact. Then output {"facts": []}.
- Output JSON only.`;

/**
 * REJECTED: extraction prompt v3, kept for the record and never shipped to users after 2026-11-25.
 * v1 (spike S1): high recall, lots of filler. v2: negative examples, cut filler.
 * v3 (tuned on SynthPAI dev personas only): v2 marked the author's own job or degree as
 * "not about the author" 70 times in 100 comments. v3 says first person is the author and
 * defines each category. Dev recall 40% -> 50% at the same false-alarm rate, together with
 * the implied-fact rules in verify.ts. On the held-out test half it raised recall 44% -> 50%
 * but quiet comments with a false fact rose 9/40 -> 20/40, almost all invented jobs
 * ("financial advisor", "film critic"). Rolled back. Receipt: receipts/heldout-synthpai-on_device-x3-rejected.json
 */
export const EXTRACT_SYSTEM_X3_REJECTED = `You read a post written by ONE anonymous author and list facts about the AUTHOR that would help a stranger figure out who they are.
Categories:
- occupation: their job, role or profession, also when implied by what they do at work ("debugging my code all day" = software developer, "my students" = teacher).
- education: student, degree, field of study, school or university.
- home_location / work_location: named places where they live, grew up or work.
- age: an age, decade or life stage (retired, in my 20s).
- gender: only when they say it or it is clear (my husband, as a mom).
- relationship: married, divorced, single, partner.
- family: children, parent, sibling roles.
- vehicle, pet, rare_hobby, dated_event: as named.
Rules:
- First-person statements ("I", "my", "as a") are about the author: about_self=true. Use about_self=false ONLY when the post says the fact belongs to someone else (my cousin, my friend) or it is a hypothetical or an obvious joke.
- "quote" is copied word for word from the post.
- "value" is a short generic noun phrase ("software developer", "psychology degree", "married", "Columbus"). Never "unknown", a weekday or a month.
- certainty is "stated" if said outright, "implied" if a careful reader would infer it.
- Moods, opinions, food, weather, TV, group chats and chores are not identifying. Output nothing for them.
- If nothing applies, output {"facts": []}. JSON only.`;

export const EXTRACT_EXAMPLE_USER = `Posts:
[0] lol as an astronaut I can confirm the moon is overrated
[1] finally got my first night-shift rota at the county hospital, ICU here we go
[2] my cousin in Denver just bought a Tesla
[3] the twins turn 3 next week and I have not slept since 2023
[4] new bakery opened near me and my diet has officially ended
[5] watching football highlights at 2am is self care`;

export const EXTRACT_EXAMPLE_ASSISTANT = JSON.stringify({
  facts: [
    { p: 0, cat: 'occupation', value: 'astronaut', quote: 'as an astronaut I can confirm', about_self: false, certainty: 'stated' },
    { p: 1, cat: 'occupation', value: 'ICU nurse', quote: 'night-shift rota at the county hospital, ICU', about_self: true, certainty: 'implied' },
    { p: 1, cat: 'work_location', value: 'night shift', quote: 'night-shift rota', about_self: true, certainty: 'stated' },
    { p: 2, cat: 'vehicle', value: 'Tesla', quote: 'my cousin in Denver just bought a Tesla', about_self: false, certainty: 'stated' },
    { p: 3, cat: 'family', value: 'parent of twins', quote: 'the twins turn 3 next week', about_self: true, certainty: 'implied' },
  ],
});

export function batchPrompt(posts: string[]): string {
  return `Posts:\n${posts.map((t, i) => `[${i}] ${t}`).join('\n')}`;
}

/** Base-rate lookup: ONE generic attribute, never the user's words. */
export const BASERATE_SYSTEM = `You estimate how common an attribute is among ADULTS in a named country, using Google Search for current official statistics.
Answer with a JSON object only: {"low": number, "high": number, "basis": string}
- low/high are fractions of all adults (0 to 1), a plausible range.
- basis: one sentence naming the statistic and its source/year.`;

/** Draft rewrite ("Blur"): keep the meaning, drop what identifies the author. */
export const BLUR_SYSTEM = `Rewrite the user's draft so it keeps its meaning and tone but drops or generalizes details that identify the author (exact job, place, family specifics, dates, vehicles). Keep it natural and about the same length. Output JSON: {"rewrite": string, "removed": [string]}.`;
