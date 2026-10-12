import { describe, expect, it } from 'vitest';
import { maskPhone, maskPhonesInText, threadLogId } from './pii.js';

describe('threadLogId', () => {
  it('is a short stable hash that does not contain the thread id', () => {
    const id = '3f2b8c1e-0a52-4d0e-9d1c-5b0e2f6a7c10';
    const tag = threadLogId(id);
    expect(tag).toMatch(/^[0-9a-f]{12}$/);
    expect(tag).toBe(threadLogId(id));
    expect(tag).not.toBe(threadLogId('3f2b8c1e-0a52-4d0e-9d1c-5b0e2f6a7c11'));
    expect(id).not.toContain(tag);
  });
});

describe('maskPhone', () => {
  it('keeps the prefix and the last four digits', () => {
    expect(maskPhone('01001234567')).toBe('010****4567');
    expect(maskPhone('+201001234567')).toBe('+20****4567');
    expect(maskPhone('123')).toBe('****');
  });
});

describe('maskPhonesInText', () => {
  it('masks Egyptian mobile numbers in any format and digit script', () => {
    expect(maskPhonesInText('call 01001234567 now')).toBe(
      'call 010****4567 now',
    );
    expect(maskPhonesInText('my name is Sam, 0100 123 4567.')).toBe(
      'my name is Sam, 010****4567.',
    );
    expect(maskPhonesInText('+20 100 123 4567')).toBe('+20****4567');
    expect(maskPhonesInText('رقمي ٠١٠٠١٢٣٤٥٦٧')).toBe('رقمي 010****4567');
  });

  it('does not swallow a date that follows the number', () => {
    expect(
      maskPhonesInText('my name is Test User, 01001234567 2026-10-19'),
    ).toBe('my name is Test User, 010****4567 2026-10-19');
    expect(maskPhonesInText('01001234567 2 days')).toBe('010****4567 2 days');
  });

  it('leaves dates, prices and other numbers alone', () => {
    const text = 'On 2026-10-12 it costs 6,000,000 EGP, ref 00000001, 180 m2.';
    expect(maskPhonesInText(text)).toBe(text);
  });
});
