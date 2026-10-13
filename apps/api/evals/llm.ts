import type { ConfigService } from '@nestjs/config';
import { type LlmEnv, llmEnvSchema } from '../src/config/env.schema.js';
import { ChatModelFactory } from '../src/llm/chat-model.factory.js';

export interface LlmInfo {
  provider: string;
  model: string;
  /** Names of the variables the selected provider still lacks. */
  missing: string[];
}

/**
 * Reads ONLY the LLM-related variables, so a contributor without a complete
 * `.env` (no database URL, no admin token) still learns that the eval is
 * skipped for want of an LLM, instead of getting an unrelated validation error.
 */
export function inspectLlm(raw: Record<string, unknown>): LlmInfo {
  const result = llmEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid LLM configuration:\n${result.error.issues
        .map(({ path, message }) => `${path.join('.')}: ${message}`)
        .join('\n')}`,
    );
  }
  const env = result.data;
  const missing = new ChatModelFactory({
    get: (key: keyof LlmEnv) => env[key],
  } as unknown as ConfigService<LlmEnv, true>).missingConfiguration();
  return env.LLM_PROVIDER === 'claude'
    ? { provider: 'claude', model: env.CLAUDE_MODEL, missing }
    : {
        provider: 'openai-compatible',
        model: env.OPENAI_COMPAT_MODEL ?? 'unknown',
        missing,
      };
}
