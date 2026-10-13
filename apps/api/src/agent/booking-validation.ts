import { toLatinDigits } from './digits.js';

export const MAX_BOOKING_DAYS_AHEAD = 90;

/** Viewing hours in the business time zone, `HH:mm`, both ends included. */
export const VIEWING_OPENS = '09:00';
export const VIEWING_CLOSES = '21:00';

const EGYPTIAN_MOBILE = /^(\+20|0)1[0125]\d{8}$/;
const CLOCK_TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
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

/** Today's calendar date in the business time zone as `YYYY-MM-DD`. */
export function businessToday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** English weekday name of a `YYYY-MM-DD` calendar date ("Monday"), or `null`. */
export function weekdayOf(isoDate: string): string | null {
  const date = parseIsoDate(isoDate);
  return date
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'UTC',
      }).format(date)
    : null;
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

/**
 * A 24-hour clock time as `HH:mm` ("9:30" => "09:30", Arabic-Indic digits and
 * a seconds part accepted), or `null` when it is not a valid time of day.
 */
export function normaliseTime(raw: string): string | null {
  const match = CLOCK_TIME.exec(toLatinDigits(raw).trim());
  if (!match) return null;
  const [, hours, minutes] = match;
  if (Number(hours) > 23 || Number(minutes) > 59) return null;
  return `${(hours ?? '').padStart(2, '0')}:${minutes}`;
}

export type TimeCheck =
  | { status: 'ok'; /** Normalised `HH:mm`. */ time: string }
  | { status: 'invalid' | 'outside_hours' };

/** The viewing time must be a valid time of day within 09:00-21:00. */
export function checkBookingTime(raw: string): TimeCheck {
  const time = normaliseTime(raw);
  if (!time) return { status: 'invalid' };
  return time >= VIEWING_OPENS && time <= VIEWING_CLOSES
    ? { status: 'ok', time }
    : { status: 'outside_hours' };
}

/** What the visitor's LATEST message says about the viewing time. */
export type TimeAnswer =
  | { kind: 'none' }
  | { kind: 'any' }
  | { kind: 'time'; time: string }
  | { kind: 'problem'; problem: 'invalid' | 'outside_hours' | 'vague' };

/**
 * Decides the time answer from the extracted fields of the latest message.
 * Precedence: an explicit "any time" wins over everything (small models even
 * return `{ preferredTime: "anyTime", anyTime: true }`); a vague part of the
 * day ("evening", "after 6") is never stored; otherwise the time is validated.
 */
export function interpretTimeAnswer(extraction: {
  preferredTime?: string | undefined;
  anyTime?: boolean | undefined;
  timeVague?: boolean | undefined;
}): TimeAnswer {
  if (extraction.anyTime === true) return { kind: 'any' };
  if (extraction.timeVague === true) {
    return { kind: 'problem', problem: 'vague' };
  }
  const raw = extraction.preferredTime?.trim();
  if (!raw) return { kind: 'none' };
  const check = checkBookingTime(raw);
  return check.status === 'ok'
    ? { kind: 'time', time: check.time }
    : { kind: 'problem', problem: check.status };
}
