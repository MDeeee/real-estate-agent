import { describe, expect, it } from 'vitest';
import { isCi, parseSettings } from './settings.js';

describe('parseSettings', () => {
  it('has defaults sized for free-tier LLM quotas', () => {
    expect(parseSettings({})).toEqual({
      delayMs: 4000,
      tolerance: 0.05,
      retryWaitMs: 20_000,
    });
  });

  it('reads overrides and treats blank values as unset', () => {
    expect(
      parseSettings({
        EVAL_DELAY_MS: '500',
        EVAL_TOLERANCE: '0.1',
        EVAL_RETRY_WAIT_MS: '',
      }),
    ).toEqual({ delayMs: 500, tolerance: 0.1, retryWaitMs: 20_000 });
  });

  it('treats whitespace-only values as unset and trims numbers', () => {
    expect(
      parseSettings({ EVAL_DELAY_MS: '  ', EVAL_TOLERANCE: ' 0.2 ' }),
    ).toEqual({ delayMs: 4000, tolerance: 0.2, retryWaitMs: 20_000 });
  });

  it('rejects nonsense', () => {
    expect(() => parseSettings({ EVAL_DELAY_MS: '-1' })).toThrow(
      /Invalid eval settings/,
    );
    expect(() => parseSettings({ EVAL_TOLERANCE: '5' })).toThrow();
    expect(() => parseSettings({ EVAL_DELAY_MS: 'soon' })).toThrow();
  });
});

describe('isCi', () => {
  it('is true for any real value of CI', () => {
    expect(isCi({ CI: 'true' })).toBe(true);
    expect(isCi({ CI: '1' })).toBe(true);
  });

  it('is false when CI is unset, blank, "false" or "0"', () => {
    expect(isCi({})).toBe(false);
    expect(isCi({ CI: '' })).toBe(false);
    expect(isCi({ CI: 'false' })).toBe(false);
    expect(isCi({ CI: '0' })).toBe(false);
  });
});
