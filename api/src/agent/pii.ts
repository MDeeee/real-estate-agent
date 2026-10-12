import { createHash } from 'node:crypto';
import { normalisePhone } from './booking-validation.js';

/**
 * A stable, non-reversible tag of a thread id for logs. The raw id is a bearer
 * token for the conversation (it unlocks the history), so it never gets logged.
 */
export function threadLogId(threadId: string): string {
  return createHash('sha256').update(threadId).digest('hex').slice(0, 12);
}

/** `01001234567` -> `010****4567`; keeps the operator prefix and the last four digits. */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

const DIGIT = /[\d٠-٩۰-۹]/;
const SEPARATOR = /[\s\-().]/;
/** An Egyptian mobile is 11 digits (01xxxxxxxxx) or 12 with the country code. */
const PHONE_DIGIT_COUNTS = [12, 11];

/**
 * Reads a phone-shaped run starting at `start`: `digits` digits, each pair
 * separated by at most one space/dash/bracket, not touching further digits.
 * Returns the index just after the last digit.
 */
function phoneEndingAt(
  chars: readonly string[],
  start: number,
  digits: number,
): number | undefined {
  let index = start;
  if (chars[index] === '+') index += 1;
  let seen = 0;
  while (index < chars.length) {
    const char = chars[index] as string;
    if (DIGIT.test(char)) {
      seen += 1;
      index += 1;
      if (seen === digits) break;
    } else if (
      seen > 0 &&
      SEPARATOR.test(char) &&
      DIGIT.test(chars[index + 1] ?? '')
    ) {
      index += 1;
    } else {
      return undefined;
    }
  }
  if (seen !== digits || DIGIT.test(chars[index] ?? '')) return undefined;
  return index;
}

/** Masks every Egyptian mobile number written in free text (any digit script). */
export function maskPhonesInText(text: string): string {
  const chars = Array.from(text);
  let result = '';
  let index = 0;
  while (index < chars.length) {
    const char = chars[index] as string;
    const startsRun =
      (DIGIT.test(char) || char === '+') && !DIGIT.test(chars[index - 1] ?? '');
    let masked = false;
    if (startsRun) {
      for (const digits of PHONE_DIGIT_COUNTS) {
        const end = phoneEndingAt(chars, index, digits);
        if (end === undefined) continue;
        const phone = normalisePhone(chars.slice(index, end).join(''));
        if (!phone) continue;
        result += maskPhone(phone);
        index = end;
        masked = true;
        break;
      }
    }
    if (!masked) {
      result += char;
      index += 1;
    }
  }
  return result;
}
