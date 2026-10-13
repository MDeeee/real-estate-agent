const ISO_DAY = /^(\d{4}-\d{2}-\d{2})/;

/**
 * The viewing day is a calendar date, not an instant: it is formatted in UTC
 * so that no browser time zone can shift it to the day before or after.
 */
const day = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** "19 Oct 2026" from "2026-10-19" (or an ISO timestamp, read as its UTC day). */
export function formatBookingDate(value: string): string {
  const iso = ISO_DAY.exec(value)?.[1];
  const date = iso ? new Date(`${iso}T00:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : day.format(date);
}

/**
 * The booked day plus its time of day: "19 Oct 2026, 17:00", or
 * "19 Oct 2026 · any time" when the visitor had no time preference.
 */
export function formatBookingWhen(
  date: string,
  time: string | null | undefined,
): string {
  const formatted = formatBookingDate(date);
  const clock = time?.trim();
  return clock ? `${formatted}, ${clock}` : `${formatted} · any time`;
}
