import { toLatinDigits } from './digits.js';

export const MAX_BOOKING_DAYS_AHEAD = 90;

const EGYPTIAN_MOBILE = /^(\+20|0)1[0125]\d{8}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An Egyptian mobile number without spaces or dashes, or `null` if invalid. */
export function normalisePhone(raw: string): string | null {
  const cleaned = toLatinDigits(raw).replace(/[\s\-().]/g, '');
  return EGYPTIAN_MOBILE.test(cleaned) ? cleaned : null;
}

export function normaliseName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 80 ? name : null;
}

/** Today's calendar date in Cairo as `YYYY-MM-DD`. */
export function cairoToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export type DateCheck = 'ok' | 'invalid' | 'not_future' | 'too_far';

/** The viewing date must satisfy today < date <= today + 90 days. */
export function checkBookingDate(value: string, today: string): DateCheck {
  const date = parseIsoDate(value);
  const base = parseIsoDate(today);
  if (!date || !base) return 'invalid';
  const days = Math.round((date.getTime() - base.getTime()) / 86_400_000);
  if (days < 1) return 'not_future';
  if (days > MAX_BOOKING_DAYS_AHEAD) return 'too_far';
  return 'ok';
}
