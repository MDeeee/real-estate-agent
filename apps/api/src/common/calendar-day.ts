/**
 * Booking dates are calendar days (a Postgres DATE column), not instants.
 * Prisma reads a DATE as midnight UTC, so the day is the UTC date of that
 * instant and must never be shifted into a local time zone.
 */

/** `YYYY-MM-DD` of a DATE value read through Prisma. */
export function toCalendarDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The DATE value (midnight UTC) of a `YYYY-MM-DD` calendar day. */
export function fromCalendarDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Whether `value` is a real calendar day written `YYYY-MM-DD` ("2026-02-30" is not). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = fromCalendarDay(value);
  return !Number.isNaN(date.getTime()) && toCalendarDay(date) === value;
}
