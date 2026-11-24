/**
 * Extraction prompt v2. Versioned so Remote Config can A/B it.
 * Spike S1 (v1): 96% recall but lots of filler ("unknown", "near me", "cricket enthusiast").
 * v2 adds negative examples and a hard rule: only facts that narrow down WHO the author is.
 */
export const EXTRACT_PROMPT_VERSION = 'x2';

export const EXTRACT_SYSTEM = `You read posts written by ONE anonymous author and list facts that would help a stranger figure out WHO the author is.
Only include a fact if it narrows the author down to a smaller group of real people: where they live or work, their job, family situation, age, gender, vehicle, pets, distinctive hobbies, dated life events.
Rules:
- Facts about the AUTHOR only. Friends, relatives, hypotheticals ("if I had", "imagine") and obvious jokes get about_self=false.
- "quote" must be copied exactly, word for word, from the post.
- "value" is a short generic noun phrase ("registered nurse", "Columbus", "parent of twins"). Never "unknown", "unspecified" or "near me".
- Moods, opinions, food, weather, TV, sports fandom and everyday chores are NOT identifying. Output nothing for them.
- Most posts contain no identifying fact. Then output {"facts": []}.
- Output JSON only.`;

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
