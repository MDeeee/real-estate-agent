import { z } from 'zod';

/** A trimmed string where blank counts as unset (CI passes unset variables as ""). */
export const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const optionalUrl = optionalString.pipe(z.url().optional());

export const DEFAULT_TIMEZONE = 'Africa/Cairo';

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a PostgreSQL connection URL'),
  ADMIN_TOKEN: z.string().min(32, 'must be at least 32 characters'),
  // Number of reverse proxies you run in front of this server. Passed to
  // Express `trust proxy`: the visitor IP (rate limiting) is then taken from
  // the right of `X-Forwarded-For`, never from the left, which a visitor
  // controls. 0 trusts no proxy header: every request counts as its socket IP.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  // Directory of the built web app. Defaults to `apps/web/dist` in this repo.
  WEB_DIST_DIR: optionalString,
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  // Stricter budget for `POST /api/chat`: every request costs LLM tokens.
  CHAT_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
  // Budget for `POST /api/chat` across ALL visitors, per minute. Independent of
  // the client IP, so it caps LLM spend even if every visitor looks different.
  CHAT_GLOBAL_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),

  // Upper bound of one chat turn (a free-tier model can need 30-50 s for a
  // search turn). The turn is rolled back when it is exceeded.
  CHAT_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  // The business time zone (IANA name). "Today", "tomorrow" and the viewing
  // hours (09:00-21:00) of a booking are understood in it.
  APP_TIMEZONE: optionalString
    .transform((value) => value ?? DEFAULT_TIMEZONE)
    .refine(isTimeZone, 'must be an IANA time zone such as Africa/Cairo'),

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
  // Fail fast on a slow or overloaded provider. LangChain retries a failed call
  // silently with backoff (6 times by default); this caps the retries.
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  // Per LLM call: the whole call for structured output, the wait for the first
  // token for a streamed answer. Exceeding it ends the turn as "provider busy".
  LLM_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

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
  LLM_MAX_RETRIES: true,
  LLM_CALL_TIMEOUT_MS: true,
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
