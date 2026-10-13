import { z } from 'zod';
import { optionalString } from '../src/config/env.schema.js';

const settingsSchema = z.object({
  EVAL_DELAY_MS: optionalString.pipe(
    z.coerce.number<string | undefined>().int().min(0).default(4000),
  ),
  EVAL_TOLERANCE: optionalString.pipe(
    z.coerce.number<string | undefined>().min(0).max(1).default(0.05),
  ),
  EVAL_RETRY_WAIT_MS: optionalString.pipe(
    z.coerce.number<string | undefined>().int().min(0).default(20_000),
  ),
});

export interface EvalSettings {
  /** Minimum pause between two LLM calls (free tiers allow a few per minute). */
  delayMs: number;
  /** How far a quality metric may fall below the baseline before the gate fails. */
  tolerance: number;
  /** Pause before the one retry of a case that hit a rate limit. */
  retryWaitMs: number;
}

export function parseSettings(env: NodeJS.ProcessEnv): EvalSettings {
  const result = settingsSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid eval settings:\n${z.prettifyError(result.error)}`);
  }
  return {
    delayMs: result.data.EVAL_DELAY_MS,
    tolerance: result.data.EVAL_TOLERANCE,
    retryWaitMs: result.data.EVAL_RETRY_WAIT_MS,
  };
}

/** `CI` is set by GitHub Actions; "false" and "0" count as not set. */
export function isCi(env: NodeJS.ProcessEnv): boolean {
  const value = env['CI']?.trim().toLowerCase();
  return (
    value !== undefined && value !== '' && value !== 'false' && value !== '0'
  );
}
