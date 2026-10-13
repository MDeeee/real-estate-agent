import { describe, expect, it } from 'vitest';
import { inspectLlm } from './llm.js';

describe('inspectLlm', () => {
  it('works without the rest of the environment (no database URL, no admin token)', () => {
    expect(inspectLlm({})).toEqual({
      provider: 'claude',
      model: 'claude-haiku-5-5',
      missing: ['ANTHROPIC_API_KEY'],
    });
  });

  it('treats blank variables as unset, as CI passes them', () => {
    expect(
      inspectLlm({ ANTHROPIC_API_KEY: '  ', OPENAI_COMPAT_BASE_URL: '' })
        .missing,
    ).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('is configured once the selected provider has its key', () => {
    expect(inspectLlm({ ANTHROPIC_API_KEY: 'k' })).toMatchObject({
      missing: [],
    });
    expect(
      inspectLlm({
        LLM_PROVIDER: 'openai-compatible',
        OPENAI_COMPAT_BASE_URL: 'http://localhost:11434/v1',
        OPENAI_COMPAT_API_KEY: 'k',
        OPENAI_COMPAT_MODEL: 'llama',
      }),
    ).toEqual({ provider: 'openai-compatible', model: 'llama', missing: [] });
  });

  it('lists what an openai-compatible setup lacks', () => {
    expect(inspectLlm({ LLM_PROVIDER: 'openai-compatible' })).toEqual({
      provider: 'openai-compatible',
      model: 'unknown',
      missing: [
        'OPENAI_COMPAT_BASE_URL',
        'OPENAI_COMPAT_API_KEY',
        'OPENAI_COMPAT_MODEL',
      ],
    });
  });
});
