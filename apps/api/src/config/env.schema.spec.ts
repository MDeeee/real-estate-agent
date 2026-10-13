import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { envSchema, validateEnv } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/realestate',
  ADMIN_TOKEN: 'a-sufficiently-long-token-for-tests-0123',
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
    expect(env.CHAT_TURN_TIMEOUT_MS).toBe(90_000);
    expect(env.LLM_MAX_RETRIES).toBe(1);
    expect(env.LLM_CALL_TIMEOUT_MS).toBe(30_000);
  });

  it('reads LLM_MAX_RETRIES and LLM_CALL_TIMEOUT_MS and rejects bad values', () => {
    const env = validateEnv({
      ...base,
      LLM_MAX_RETRIES: '0',
      LLM_CALL_TIMEOUT_MS: '15000',
    });
    expect(env.LLM_MAX_RETRIES).toBe(0);
    expect(env.LLM_CALL_TIMEOUT_MS).toBe(15_000);
    expect(() => validateEnv({ ...base, LLM_MAX_RETRIES: '-1' })).toThrow(
      /LLM_MAX_RETRIES/,
    );
    expect(() => validateEnv({ ...base, LLM_CALL_TIMEOUT_MS: '0' })).toThrow(
      /LLM_CALL_TIMEOUT_MS/,
    );
  });

  it('reads CHAT_TURN_TIMEOUT_MS and rejects a non-positive value', () => {
    expect(
      validateEnv({ ...base, CHAT_TURN_TIMEOUT_MS: '120000' })
        .CHAT_TURN_TIMEOUT_MS,
    ).toBe(120_000);
    expect(() => validateEnv({ ...base, CHAT_TURN_TIMEOUT_MS: '0' })).toThrow(
      /CHAT_TURN_TIMEOUT_MS/,
    );
  });

  it('defaults the business time zone to Africa/Cairo, also when blank', () => {
    expect(validateEnv(base).APP_TIMEZONE).toBe('Africa/Cairo');
    expect(validateEnv({ ...base, APP_TIMEZONE: '' }).APP_TIMEZONE).toBe(
      'Africa/Cairo',
    );
    expect(
      validateEnv({ ...base, APP_TIMEZONE: 'Asia/Dubai' }).APP_TIMEZONE,
    ).toBe('Asia/Dubai');
  });

  it('rejects an unknown time zone', () => {
    expect(() => validateEnv({ ...base, APP_TIMEZONE: 'Mars/Base' })).toThrow(
      /IANA time zone[\s\S]*APP_TIMEZONE|APP_TIMEZONE[\s\S]*IANA time zone/,
    );
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

  it('trusts no proxy by default and bounds TRUSTED_PROXY_HOPS', () => {
    expect(validateEnv(base).TRUSTED_PROXY_HOPS).toBe(0);
    expect(
      validateEnv({ ...base, TRUSTED_PROXY_HOPS: '2' }).TRUSTED_PROXY_HOPS,
    ).toBe(2);
    expect(() => validateEnv({ ...base, TRUSTED_PROXY_HOPS: '-1' })).toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
    expect(() => validateEnv({ ...base, TRUSTED_PROXY_HOPS: '1.5' })).toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
  });

  it('treats a blank WEB_DIST_DIR as unset', () => {
    expect(validateEnv({ ...base, WEB_DIST_DIR: '' }).WEB_DIST_DIR).toBe(
      undefined,
    );
    expect(
      validateEnv({ ...base, WEB_DIST_DIR: '/srv/web' }).WEB_DIST_DIR,
    ).toBe('/srv/web');
  });

  it('defaults the chat budget and structured-output method', () => {
    const env = validateEnv(base);
    expect(env.CHAT_THROTTLE_LIMIT).toBe(10);
    expect(env.CHAT_GLOBAL_LIMIT_PER_MINUTE).toBe(30);
    expect(env.LLM_STRUCTURED_METHOD).toBe('functionCalling');
    expect(
      validateEnv({ ...base, LLM_STRUCTURED_METHOD: 'jsonSchema' })
        .LLM_STRUCTURED_METHOD,
    ).toBe('jsonSchema');
    expect(() =>
      validateEnv({ ...base, LLM_STRUCTURED_METHOD: 'xml' }),
    ).toThrow(/LLM_STRUCTURED_METHOD/);
  });

  it('boots without any LLM credentials', () => {
    const env = validateEnv(base);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_COMPAT_API_KEY).toBeUndefined();
  });

  it('fails fast with a readable message on invalid input', () => {
    expect(() =>
      validateEnv({ ADMIN_TOKEN: 'short', LLM_PROVIDER: 'gemini' }),
    ).toThrow(
      /Invalid environment configuration[\s\S]*DATABASE_URL[\s\S]*ADMIN_TOKEN[\s\S]*LLM_PROVIDER/,
    );
  });

  it('requires an ADMIN_TOKEN of at least 32 characters', () => {
    expect(() => validateEnv({ ...base, ADMIN_TOKEN: 'x'.repeat(31) })).toThrow(
      /ADMIN_TOKEN/,
    );
    expect(() =>
      validateEnv({ ...base, ADMIN_TOKEN: 'x'.repeat(32) }),
    ).not.toThrow();
  });
});

describe('.env.example', () => {
  const example = readFileSync(
    new URL('../../../../.env.example', import.meta.url),
    'utf8',
  );

  it('documents every variable of the env schema', () => {
    const missing = Object.keys(envSchema.shape).filter(
      (key) => !new RegExp(String.raw`^#?\s*${key}=`, 'm').test(example),
    );
    expect(missing).toEqual([]);
  });

  it('no longer mentions the removed CORS and Next.js variables', () => {
    expect(example).not.toMatch(/CORS_ORIGINS|NEXT_PUBLIC_/);
  });
});
