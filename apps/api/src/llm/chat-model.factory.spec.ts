import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Env, validateEnv } from '../config/env.schema.js';
import { ChatModelFactory } from './chat-model.factory.js';
import { LlmNotConfiguredError } from './llm-not-configured.error.js';

const base = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/realestate',
  ADMIN_TOKEN: 'a-sufficiently-long-token-for-tests-0123',
};

function factoryFor(env: Record<string, string>): ChatModelFactory {
  const config = new ConfigService<Env, true>(validateEnv({ ...base, ...env }));
  return new ChatModelFactory(config);
}

/** LangChain keeps the retry cap on its (protected) async caller. */
function retriesOf(model: object): number {
  return (model as unknown as { caller: { maxRetries: number } }).caller
    .maxRetries;
}

describe('ChatModelFactory', () => {
  beforeEach(() => {
    // ConfigService falls back to process.env, which the developer's .env may fill.
    for (const name of [
      'LLM_PROVIDER',
      'ANTHROPIC_API_KEY',
      'OPENAI_COMPAT_BASE_URL',
      'OPENAI_COMPAT_API_KEY',
      'OPENAI_COMPAT_MODEL',
      'CLAUDE_MODEL',
      'LLM_MAX_RETRIES',
      'LLM_CALL_TIMEOUT_MS',
    ]) {
      vi.stubEnv(name, '');
    }
  });

  it('reports the missing variables of the selected provider', () => {
    expect(factoryFor({}).missingConfiguration()).toEqual([
      'ANTHROPIC_API_KEY',
    ]);
    expect(
      factoryFor({ LLM_PROVIDER: 'openai-compatible' }).missingConfiguration(),
    ).toEqual([
      'OPENAI_COMPAT_BASE_URL',
      'OPENAI_COMPAT_API_KEY',
      'OPENAI_COMPAT_MODEL',
    ]);
  });

  it('is unconfigured, and refuses to build a model, without credentials', () => {
    const factory = factoryFor({});
    expect(factory.isConfigured()).toBe(false);
    expect(() => factory.create()).toThrow(LlmNotConfiguredError);
  });

  it("ignores the other provider's variables", () => {
    expect(
      factoryFor({
        LLM_PROVIDER: 'claude',
        OPENAI_COMPAT_API_KEY: 'unused',
      }).isConfigured(),
    ).toBe(false);
  });

  it('builds ChatAnthropic without any sampling parameters', () => {
    const model = factoryFor({
      ANTHROPIC_API_KEY: 'test-key',
      CLAUDE_MODEL: 'claude-haiku-5-5',
    }).create();
    expect(model).toBeInstanceOf(ChatAnthropic);
    const anthropic = model as ChatAnthropic;
    expect(anthropic.model).toBe('claude-haiku-5-5');
    expect(anthropic.temperature).toBeUndefined();
    expect(anthropic.topP).toBeUndefined();
    expect(anthropic.topK).toBeUndefined();
  });

  it('builds ChatOpenAI against the configured endpoint with temperature 0', () => {
    const factory = factoryFor({
      LLM_PROVIDER: 'openai-compatible',
      OPENAI_COMPAT_BASE_URL:
        'https://generativelanguage.googleapis.com/v1beta/openai/',
      OPENAI_COMPAT_API_KEY: 'test-key',
      OPENAI_COMPAT_MODEL: 'gemini-3.8-flash',
    });
    expect(factory.isConfigured()).toBe(true);
    const model = factory.create();
    expect(model).toBeInstanceOf(ChatOpenAI);
    const openai = model as ChatOpenAI;
    expect(openai.model).toBe('gemini-3.8-flash');
    expect(openai.temperature).toBe(0);
    expect(openai.clientConfig.baseURL).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    );
  });

  it('passes the retry cap and the call timeout to both adapters', () => {
    const anthropic = factoryFor({
      ANTHROPIC_API_KEY: 'test-key',
      LLM_MAX_RETRIES: '2',
      LLM_CALL_TIMEOUT_MS: '12000',
    }).create() as ChatAnthropic;
    expect(retriesOf(anthropic)).toBe(2);
    expect(anthropic.clientOptions.timeout).toBe(12_000);

    const openai = factoryFor({
      LLM_PROVIDER: 'openai-compatible',
      OPENAI_COMPAT_BASE_URL: 'https://api.groq.com/openai/v1',
      OPENAI_COMPAT_API_KEY: 'test-key',
      OPENAI_COMPAT_MODEL: 'openai/gpt-oss-120b',
      LLM_MAX_RETRIES: '0',
      LLM_CALL_TIMEOUT_MS: '9000',
    }).create() as ChatOpenAI;
    expect(retriesOf(openai)).toBe(0);
    expect(openai.timeout).toBe(9000);
  });

  it('defaults to one retry and a 30 s call timeout', () => {
    const factory = factoryFor({ ANTHROPIC_API_KEY: 'test-key' });
    expect(factory.callTimeoutMs).toBe(30_000);
    expect(retriesOf(factory.create())).toBe(1);
  });

  it('builds the model once', () => {
    const factory = factoryFor({ ANTHROPIC_API_KEY: 'test-key' });
    expect(factory.create()).toBe(factory.create());
  });

  it('defaults to function calling and accepts jsonSchema', () => {
    expect(factoryFor({}).structuredMethod).toBe('functionCalling');
    expect(
      factoryFor({ LLM_STRUCTURED_METHOD: 'jsonSchema' }).structuredMethod,
    ).toBe('jsonSchema');
  });
});
