import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Metrics } from './scoring.js';

const nullableNumber = z.number().nullable();

export const metricsSchema = z.strictObject({
  intentAccuracy: nullableNumber,
  filterAccuracy: nullableNumber,
  hitAt5: nullableNumber,
  exclusion: nullableNumber,
  referenceAccuracy: nullableNumber,
  groundedness: nullableNumber,
  refusalCorrectness: nullableNumber,
  avgConversationLatencyMs: nullableNumber,
  totalTokens: nullableNumber,
}) satisfies z.ZodType<Metrics>;

export const baselineSchema = z.strictObject({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  provider: z.string(),
  model: z.string(),
  metrics: metricsSchema,
});

export type Baseline = z.infer<typeof baselineSchema>;

/** The committed baseline, or `null` when none has been recorded yet. */
export async function readBaseline(path: string): Promise<Baseline | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return baselineSchema.parse(JSON.parse(text) as unknown);
}

export async function writeBaseline(
  path: string,
  baseline: Baseline,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}
