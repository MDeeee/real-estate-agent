import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 1000;

/** Drops C0 control characters (except tab and newline) and DEL. */
export function stripControlChars(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isControl =
      (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f;
    if (!isControl) result += char;
  }
  return result;
}

export const threadIdSchema = z.uuid();

export const chatRequestSchema = z.strictObject({
  threadId: threadIdSchema,
  message: z
    .string()
    .transform((value) => stripControlChars(value).trim())
    .pipe(z.string().min(1).max(MAX_MESSAGE_LENGTH)),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
