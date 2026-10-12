import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chatRequestSchema, stripControlChars } from './chat.schema.js';

const threadId = randomUUID();

describe('chatRequestSchema', () => {
  it('accepts a uuid thread and a message of 1..1000 characters', () => {
    expect(
      chatRequestSchema.parse({ threadId, message: 'x'.repeat(1000) }).message,
    ).toHaveLength(1000);
    expect(
      chatRequestSchema.safeParse({ threadId, message: 'hi' }).success,
    ).toBe(true);
  });

  it.each([
    [{ threadId: 'not-a-uuid', message: 'hi' }],
    [{ threadId, message: '' }],
    [{ threadId, message: '   ' }],
    [{ threadId, message: 'x'.repeat(1001) }],
    [{ threadId, message: 42 }],
    [{ message: 'hi' }],
    [{ threadId, message: 'hi', extra: true }],
  ])('rejects %j', (body) => {
    expect(chatRequestSchema.safeParse(body).success).toBe(false);
  });

  it('strips control characters but keeps newlines, tabs and Arabic', () => {
    const parsed = chatRequestSchema.parse({
      threadId,
      message: ' شقة\u0000 في\u0007 الشيخ زايد\n\tعايز 3 غرف\u007f ',
    });
    expect(parsed.message).toBe('شقة في الشيخ زايد\n\tعايز 3 غرف');
  });

  it('rejects a message that is only control characters', () => {
    expect(
      chatRequestSchema.safeParse({ threadId, message: '\u0000\u0001' })
        .success,
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
