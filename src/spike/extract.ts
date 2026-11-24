import { getGenerativeModel, InferenceMode, type GenerativeModel } from 'firebase/ai';
import { getFirebase } from '../lib/firebase';
import { FACT_BATCH_JSON_SCHEMA, FactBatchZ, type RawFact } from '../lib/schemas';
import { EXTRACT_SYSTEM, EXTRACT_EXAMPLE_USER, EXTRACT_EXAMPLE_ASSISTANT, batchPrompt } from '../lib/prompts';

export const CLOUD_MODEL = 'gemini-3.5-flash-lite';

export function onDeviceExtractor(): GenerativeModel {
  const { ai } = getFirebase();
  return getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [
          { role: 'system', content: [{ type: 'text', value: EXTRACT_SYSTEM }] },
          { role: 'user', content: [{ type: 'text', value: EXTRACT_EXAMPLE_USER }] },
          { role: 'assistant', content: [{ type: 'text', value: EXTRACT_EXAMPLE_ASSISTANT }] },
        ],
      },
      promptOptions: { responseConstraint: FACT_BATCH_JSON_SCHEMA },
    },
  });
}

export function cloudExtractor(): GenerativeModel {
  const { ai } = getFirebase();
  return getGenerativeModel(ai, {
    model: CLOUD_MODEL,
    systemInstruction: EXTRACT_SYSTEM,
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: FACT_BATCH_JSON_SCHEMA },
  });
}

export interface CallResult {
  ms: number;
  ok: boolean;
  error?: string;
  source?: string;
  facts: RawFact[];
  rawLength: number;
}

export async function runBatch(model: GenerativeModel, posts: string[], cloud: boolean): Promise<CallResult> {
  const t0 = performance.now();
  try {
    const prompt = batchPrompt(posts);
    const res = cloud
      ? await model.generateContent({
          contents: [
            { role: 'user', parts: [{ type: 'text', text: EXTRACT_EXAMPLE_USER }] },
            { role: 'model', parts: [{ type: 'text', text: EXTRACT_EXAMPLE_ASSISTANT }] },
            { role: 'user', parts: [{ type: 'text', text: prompt }] },
          ],
        })
      : await model.generateContent(prompt);
    const text = res.response.text();
    const ms = performance.now() - t0;
    const source = res.response.inferenceSource;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ms, ok: false, error: 'invalid_json', source, facts: [], rawLength: text.length };
    }
    const z = FactBatchZ.safeParse(parsed);
    if (!z.success) return { ms, ok: false, error: 'schema_mismatch', source, facts: [], rawLength: text.length };
    return { ms, ok: true, source, facts: z.data.facts.filter((f) => f.p < posts.length), rawLength: text.length };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, error: String((e as Error).message ?? e).slice(0, 200), facts: [], rawLength: 0 };
  }
}

/** Quote must appear verbatim (case/whitespace-insensitive) in the source post, or the fact is dropped. */
export function quoteVerified(quote: string, post: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  return norm(post).includes(norm(quote));
}
