import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/realestate',
  ADMIN_TOKEN: 'a-sufficiently-long-token',
};

describe('validateEnv', () => {
  it('applies documented defaults', () => {
    const env = validateEnv(base);
    expect(env.LLM_PROVIDER).toBe('claude');
    expect(env.CLAUDE_MODEL).toBe('claude-haiku-5-5');
    expect(env.OLLAMA_BASE_URL).toBe('http://localhost:11434');
    expect(env.EMBEDDING_MODEL).toBe('bge-m3');
    expect(env.EMBEDDING_DIM).toBe(1024);
    expect(env.THROTTLE_TTL_SECONDS).toBe(60);
    expect(env.THROTTLE_LIMIT).toBe(120);
  });

  it('treats empty optional variables as unset', () => {
    const env = validateEnv({
      ...base,
      ANTHROPIC_API_KEY: '',
      OPENAI_COMPAT_BASE_URL: '',
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_COMPAT_BASE_URL).toBeUndefined();
  });

  it('accepts an internal API key of at least 32 characters and treats empty as unset', () => {
    expect(
      validateEnv({ ...base, INTERNAL_API_KEY: 'k'.repeat(32) }),
    ).toMatchObject({
      INTERNAL_API_KEY: 'k'.repeat(32),
    });
    expect(
      validateEnv({ ...base, INTERNAL_API_KEY: '' }).INTERNAL_API_KEY,
    ).toBeUndefined();
    expect(validateEnv(base).INTERNAL_API_KEY).toBeUndefined();
  });

  it('rejects an internal API key shorter than 32 characters', () => {
    expect(() =>
      validateEnv({ ...base, INTERNAL_API_KEY: 'too-short' }),
    ).toThrow(/at least 32 characters[\s\S]*INTERNAL_API_KEY/);
  });

  it('fails fast with a readable message on invalid input', () => {
    expect(() =>
      validateEnv({ ADMIN_TOKEN: 'short', LLM_PROVIDER: 'gemini' }),
    ).toThrow(
      /Invalid environment configuration[\s\S]*DATABASE_URL[\s\S]*ADMIN_TOKEN[\s\S]*LLM_PROVIDER/,
    );
  });
});
