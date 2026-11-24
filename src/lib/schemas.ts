import { z } from 'zod';

/** Fact categories the extractor may emit. Kept short so Nano's enum decoding stays cheap. */
export const CATEGORIES = [
  'home_location',
  'work_location',
  'occupation',
  'employer_type',
  'education',
  'age',
  'gender',
  'family',
  'relationship',
  'vehicle',
  'pet',
  'health',
  'religion_community',
  'language',
  'dated_event',
  'rare_hobby',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Categories that never leave the device, not even as a single generic word. */
export const SENSITIVE: ReadonlySet<Category> = new Set(['health', 'religion_community']);

/**
 * JSON Schema for a batch of extracted facts. The same object is used as the
 * on-device `responseConstraint` (Chrome Prompt API) and the cloud `responseJsonSchema`.
 */
export const FACT_BATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          p: { type: 'integer', description: 'index of the post in this batch' },
          cat: { type: 'string', enum: [...CATEGORIES] },
          value: { type: 'string', description: 'short normalized noun phrase, max 60 chars' },
          quote: { type: 'string', description: 'exact words copied from the post, max 120 chars' },
          about_self: { type: 'boolean', description: 'false if about someone else, hypothetical, or a joke' },
          certainty: { type: 'string', enum: ['stated', 'implied'] },
        },
        required: ['p', 'cat', 'value', 'quote', 'about_self', 'certainty'],
      },
    },
  },
  required: ['facts'],
} as const;

export const FactZ = z.object({
  p: z.number().int().nonnegative(),
  cat: z.enum(CATEGORIES),
  value: z.string().min(1).max(120),
  quote: z.string().min(1).max(300),
  about_self: z.boolean(),
  certainty: z.enum(['stated', 'implied']),
});
export const FactBatchZ = z.object({ facts: z.array(FactZ) });
export type RawFact = z.infer<typeof FactZ>;
