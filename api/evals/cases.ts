import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { INTENTS } from '../src/llm/agent-model.js';
import { propertyFilterShape } from '../src/properties/property-filters.schema.js';
import type { Expectation } from './scoring.js';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);

const expectationSchema = z.strictObject({
  intent: z.enum(INTENTS),
  filters: z.strictObject(propertyFilterShape).partial().optional(),
  anyOfSlugs: z.array(slug).min(1).optional(),
  noneOfSlugs: z.array(slug).min(1).optional(),
  // One slug, or several when the earlier ranking is not deterministic.
  focusSlug: z
    .union([slug, z.array(slug).min(1)])
    .transform((value) => (typeof value === 'string' ? [value] : value))
    .optional(),
  expectRefusal: z.boolean().optional(),
});

const caseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1).optional(),
  /** Visitor messages in order; the expectations apply to the reply to the last one. */
  turns: z.array(z.string().trim().min(1).max(1000)).min(1),
  expect: expectationSchema,
});

const casesSchema = z.array(caseSchema).min(1);

export interface EvalCase {
  id: string;
  description?: string | undefined;
  turns: string[];
  expect: Expectation;
}

export function parseCases(raw: unknown): EvalCase[] {
  const cases = casesSchema.parse(raw);
  const seen = new Set<string>();
  for (const { id } of cases) {
    if (seen.has(id)) throw new Error(`Duplicate eval case id "${id}".`);
    seen.add(id);
  }
  return cases;
}

export async function loadCases(path: string): Promise<EvalCase[]> {
  return parseCases(JSON.parse(await readFile(path, 'utf8')) as unknown);
}
