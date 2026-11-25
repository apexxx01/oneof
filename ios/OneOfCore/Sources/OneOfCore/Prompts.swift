import Foundation

// Prompts shared with the web build (src/lib/prompts.ts, version x2r). Same words on both
// clients, so the held-out SynthPAI numbers in the README describe what the iPhone runs too.
public let EXTRACT_PROMPT_VERSION = "x2r"

public let EXTRACT_SYSTEM = #"""
You read posts written by ONE anonymous author and list facts that would help a stranger figure out WHO the author is.
Only include a fact if it narrows the author down to a smaller group of real people: where they live or work, their job, family situation, age, gender, vehicle, pets, distinctive hobbies, dated life events.
Rules:
- Facts about the AUTHOR only. Friends, relatives, hypotheticals ("if I had", "imagine") and obvious jokes get about_self=false.
- "quote" must be copied exactly, word for word, from the post.
- "value" is a short generic noun phrase ("registered nurse", "Columbus", "parent of twins"). Never "unknown", "unspecified" or "near me".
- Moods, opinions, food, weather, TV, sports fandom and everyday chores are NOT identifying. Output nothing for them.
- Most posts contain no identifying fact. Then output {"facts": []}.
- Output JSON only.
"""#

public let EXTRACT_EXAMPLE_USER = #"""
Posts:
[0] lol as an astronaut I can confirm the moon is overrated
[1] finally got my first night-shift rota at the county hospital, ICU here we go
[2] my cousin in Denver just bought a Tesla
[3] the twins turn 3 next week and I have not slept since 2023
[4] new bakery opened near me and my diet has officially ended
[5] watching football highlights at 2am is self care
"""#

public let EXTRACT_EXAMPLE_ASSISTANT = #"{"facts":[{"p":0,"cat":"occupation","value":"astronaut","quote":"as an astronaut I can confirm","about_self":false,"certainty":"stated"},{"p":1,"cat":"occupation","value":"ICU nurse","quote":"night-shift rota at the county hospital, ICU","about_self":true,"certainty":"implied"},{"p":1,"cat":"work_location","value":"night shift","quote":"night-shift rota","about_self":true,"certainty":"stated"},{"p":2,"cat":"vehicle","value":"Tesla","quote":"my cousin in Denver just bought a Tesla","about_self":false,"certainty":"stated"},{"p":3,"cat":"family","value":"parent of twins","quote":"the twins turn 3 next week","about_self":true,"certainty":"implied"}]}"#

public func batchPrompt(_ posts: [String]) -> String {
  "Posts:\n" + posts.enumerated().map { "[\($0.offset)] \($0.element)" }.joined(separator: "\n")
}

/// The full on-device prompt for one post: one worked example, then the post.
/// (The on-device session takes instructions plus one prompt, so the example travels inline.)
public func extractPrompt(_ postText: String) -> String {
  let text = postText.utf16.count > MAX_POST_CHARS ? String(postText.prefix(MAX_POST_CHARS)) : postText
  return """
  Example input:
  \(EXTRACT_EXAMPLE_USER)
  Example output:
  \(EXTRACT_EXAMPLE_ASSISTANT)

  Now the real input. Output JSON only.
  \(batchPrompt([text]))
  """
}

public let MAX_POST_CHARS = 2000

/// Base-rate lookup: ONE generic attribute, never the user's words.
public let BASERATE_SYSTEM = #"""
You estimate how common an attribute is among ADULTS in a named country, using Google Search for current official statistics.
Answer with a JSON object only: {"low": number, "high": number, "basis": string}
- low/high are fractions of all adults (0 to 1), a plausible range.
- basis: one sentence naming the statistic and its source/year.
"""#

public func baseRatePrompt(attribute: String, country: String) -> String {
  "Attribute: \(attribute)\nCountry: \(country)"
}

/// Draft rewrite ("Blur"): keep the meaning, drop what identifies the author.
public let BLUR_SYSTEM = #"""
Rewrite the user's draft so it keeps its meaning and tone but drops or generalizes details that identify the author (exact job, place, family specifics, dates, vehicles). Keep it natural and about the same length. Output JSON: {"rewrite": string, "removed": [string]}.
"""#

// MARK: - Apple Foundation Models prompt (iOS)

/// Prompt "a1" for Apple's on-device model. The web prompt (x2r) frames the task as "what would
/// help a stranger figure out who the author is"; Apple's model answered {"facts": []} to every
/// post with it, which reads as a refusal of a de-anonymisation task. OneOf's actual job is the
/// author auditing their OWN posts, so this prompt says exactly that. The deterministic checker
/// (verify) is unchanged, so anything over-eager is still filtered the same way as on the web.
/// a2: a1 told the model that weather posts reveal nothing, so it skipped "rain again here in
/// Columbus" entirely. a2 says the topic doesn't matter, a place or detail named in passing does.
public let EXTRACT_PROMPT_VERSION_APPLE = "a2"

public let EXTRACT_SYSTEM_APPLE = #"""
You help a person review their OWN social media post, so they can see which personal details about themselves it reveals. This is a privacy check the author runs on their own writing.
List each detail the post reveals about the AUTHOR's life: where they live or work, their job or field, family, relationship, age, gender, vehicle, pets, unusual hobbies, dated life events, health, religion, languages.
Rules:
- Only details about the author. A detail about a friend or relative ("my sister in Seattle"), a hypothetical ("if I had") or an obvious joke gets "about_self": false.
- "quote": the exact words copied from the post.
- "value": a short generic phrase, like "registered nurse", "Columbus", "parent of twins", "night shift".
- "cat": one of home_location, work_location, occupation, employer_type, education, age, gender, family, relationship, vehicle, pet, health, religion_community, language, dated_event, rare_hobby, other.
- "certainty": "stated" if said outright, "implied" if a careful reader would infer it.
- Opinions, moods, food, weather and TV reveal nothing by themselves, but a detail mentioned in passing still counts: "snowed in again here in Duluth" reveals home_location "Duluth".
- If the post reveals nothing about the author's life, answer {"facts": []}.
Answer with JSON only, in this shape:
{"facts": [{"p": 0, "cat": "occupation", "value": "registered nurse", "quote": "exact words", "about_self": true, "certainty": "stated"}]}
"""#

/// One post for the Apple prompt, with two short worked examples.
public func extractPromptApple(_ postText: String) -> String {
  let text = postText.utf16.count > MAX_POST_CHARS ? String(postText.prefix(MAX_POST_CHARS)) : postText
  return """
  Example post: "finally got my first night-shift rota at the county hospital, ICU here we go"
  Example answer: {"facts": [{"p": 0, "cat": "occupation", "value": "ICU nurse", "quote": "night-shift rota at the county hospital, ICU", "about_self": true, "certainty": "implied"}, {"p": 0, "cat": "work_location", "value": "night shift", "quote": "night-shift rota", "about_self": true, "certainty": "stated"}]}

  Example post: "my cousin in Denver just bought a Tesla"
  Example answer: {"facts": [{"p": 0, "cat": "vehicle", "value": "Tesla", "quote": "my cousin in Denver just bought a Tesla", "about_self": false, "certainty": "stated"}]}

  Post to review:
  \(text)
  """
}
