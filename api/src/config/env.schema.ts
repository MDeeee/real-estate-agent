import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const optionalUrl = optionalString.pipe(z.url().optional());

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
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  LLM_PROVIDER: z.enum(['claude', 'openai-compatible']).default('claude'),
  ANTHROPIC_API_KEY: optionalString,
  CLAUDE_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  OPENAI_COMPAT_BASE_URL: optionalUrl,
  OPENAI_COMPAT_API_KEY: optionalString,
  OPENAI_COMPAT_MODEL: optionalString,

  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  EMBEDDING_MODEL: z.string().min(1).default('bge-m3'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
