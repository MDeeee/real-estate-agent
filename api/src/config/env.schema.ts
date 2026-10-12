import { z } from 'zod';

/** A trimmed string where blank counts as unset (CI passes unset variables as ""). */
export const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const optionalUrl = optionalString.pipe(z.url().optional());

export const MIN_INTERNAL_API_KEY_LENGTH = 32;

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a PostgreSQL connection URL'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ADMIN_TOKEN: z.string().min(16, 'must be at least 16 characters'),
  // Shared secret of the trusted Next.js server. When a request carries it, the
  // rate limiter tracks the visitor IP forwarded in `x-client-ip` instead of
  // the web server's own address.
  INTERNAL_API_KEY: optionalString.pipe(
    z
      .string()
      .min(
        MIN_INTERNAL_API_KEY_LENGTH,
        `must be at least ${MIN_INTERNAL_API_KEY_LENGTH} characters`,
      )
      .optional(),
  ),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  // Stricter budget for `POST /api/chat`: every request costs LLM tokens.
  CHAT_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
  // Budget for `POST /api/chat` across ALL visitors, per minute. Independent of
  // the client IP, so it caps LLM spend even if every visitor looks different.
  CHAT_GLOBAL_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),

  LLM_PROVIDER: z.enum(['claude', 'openai-compatible']).default('claude'),
  ANTHROPIC_API_KEY: optionalString,
  CLAUDE_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  OPENAI_COMPAT_BASE_URL: optionalUrl,
  OPENAI_COMPAT_API_KEY: optionalString,
  OPENAI_COMPAT_MODEL: optionalString,
  // How `withStructuredOutput` asks the model for JSON: tool calling (widest
  // support) or the provider's native JSON-schema response format.
  LLM_STRUCTURED_METHOD: z
    .enum(['functionCalling', 'jsonSchema'])
    .default('functionCalling'),

  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  EMBEDDING_MODEL: z.string().min(1).default('bge-m3'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),
});

export type Env = z.infer<typeof envSchema>;

/** The variables that select and configure the LLM; nothing else is needed to tell whether one is set up. */
export const llmEnvSchema = envSchema.pick({
  LLM_PROVIDER: true,
  ANTHROPIC_API_KEY: true,
  CLAUDE_MODEL: true,
  OPENAI_COMPAT_BASE_URL: true,
  OPENAI_COMPAT_API_KEY: true,
  OPENAI_COMPAT_MODEL: true,
});

export type LlmEnv = z.infer<typeof llmEnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
