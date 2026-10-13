import { describe, expect, it } from 'vitest';
import { chatRequestSchema, stripControlChars } from './chat.schema.js';

describe('chatRequestSchema', () => {
  it('accepts a message of 1..1000 characters', () => {
    expect(
      chatRequestSchema.parse({ message: 'x'.repeat(1000) }).message,
    ).toHaveLength(1000);
    expect(chatRequestSchema.safeParse({ message: 'hi' }).success).toBe(true);
  });

  it.each([
    [{ threadId: 'a5b2c1d0-0000-4000-8000-000000000000', message: 'hi' }],
    [{ message: '' }],
    [{ message: '   ' }],
    [{ message: 'x'.repeat(1001) }],
    [{ message: 42 }],
    [{}],
    [{ message: 'hi', extra: true }],
  ])('rejects %j', (body) => {
    expect(chatRequestSchema.safeParse(body).success).toBe(false);
  });

  it('strips control characters but keeps newlines, tabs and Arabic', () => {
    const parsed = chatRequestSchema.parse({
      message: ' شقة\u0000 في\u0007 الشيخ زايد\n\tعايز 3 غرف\u007f ',
    });
    expect(parsed.message).toBe('شقة في الشيخ زايد\n\tعايز 3 غرف');
  });

  it('rejects a message that is only control characters', () => {
    expect(
      chatRequestSchema.safeParse({ message: '\u0000\u0001' }).success,
    ).toBe(false);
  });
});

describe('stripControlChars', () => {
  it('removes C0 controls except tab and newline', () => {
    expect(stripControlChars('a\u0000b\tc\nd\u001fe\u007ff')).toBe(
      'ab\tc\ndef',
    );
  });
});
